import type { BotMessenger, WorkspaceRepository } from "../ports.js";
import type { NotificationEvent, Project, ProjectBotSettings, Reminder, Task } from "../types.js";
import { escapeMarkdown, formatMentionNotification, formatTaskNotification } from "./formatters.js";

const MSK_NOON_HOUR_UTC = 9;

export class NotificationService {
  constructor(
    private repo: WorkspaceRepository,
    private messenger: BotMessenger,
    private webAppUrl: string,
  ) {}

  async scheduleTaskNotifications(task: Task) {
    if (task.isArchived) return;
    if (task.completedAt) return;
    if (task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now()) return;
    if (!task.assigneeId) return;
    const project = await this.repo.getProject(task.projectId);
    if (!project?.botSettings.taskDeadlineNotificationsEnabled) return;

    const settings = project.botSettings;

    for (const point of settings.kanbanReminderPoints.filter((item) => item.enabled)) {
      if (point.kind === "on_assign") {
        await this.createUniqueNotification(task, "task_assigned", task.assigneeId, task.createdAt, project);
      }

      if (point.kind === "before_deadline" && task.deadlineAt && point.offsetMinutes) {
        const sendAt = new Date(new Date(task.deadlineAt).getTime() - point.offsetMinutes * 60000).toISOString();
        if (new Date(sendAt).getTime() > Date.now()) {
          const type = point.offsetMinutes === 15 * 60 ? "task_deadline_15h" : point.offsetMinutes === 2 * 60 ? "task_deadline_2h" : "task_deadline_15h";
          await this.createUniqueNotification(task, type, task.assigneeId, sendAt, project);
        }
      }

      if (point.kind === "at_deadline" && task.deadlineAt) {
        await this.createUniqueNotification(task, "task_deadline_now", task.assigneeId, task.deadlineAt, project);
      }
    }
  }

  async syncProjectNotifications(projectId: string) {
    const [tasks, columns, blocks] = await Promise.all([
      this.repo.getTasksByProject(projectId),
      this.repo.getProjectColumns(projectId),
      this.repo.getProjectBlocks(projectId),
    ]);
    const doneColumnId = columns
      .filter((column) => !column.isArchive && !column.isHidden)
      .sort((a, b) => a.position - b.position)
      .at(-1)?.id;

    for (const task of tasks.filter((item) => !item.isArchived && item.columnId !== doneColumnId)) {
      await this.scheduleTaskNotifications(task);
      await this.scanMentions(projectId, {
        entityType: "task",
        entityId: task.id,
        title: task.title,
        text: `${task.title} ${task.description ?? ""} ${(task.subtasks ?? []).map((subtask) => subtask.title).join(" ")}`,
      });
    }

    for (const block of blocks) {
      const text = extractText(block.content);
      if (!text.includes("@")) continue;
      await this.scanMentions(projectId, {
        entityType: block.type === "simple_table" ? "table" : "block",
        entityId: block.id,
        title: "Workspace block",
        text,
      });
    }

    await this.scheduleDutyReminders(projectId);
  }

  async scanMentions(projectId: string, source: { entityType: "task" | "page" | "block" | "table"; entityId: string; title: string; text: string }) {
    const project = await this.repo.getProject(projectId);
    if (!project?.botSettings.mentionNotificationsEnabled) return;

    const mentions = [...new Set(source.text.match(/@[a-zA-Z0-9_]{3,}/g) ?? [])];
    for (const mention of mentions) {
      const user = await this.repo.getUserByUsername(mention);
      if (!user) continue;
      const alreadyExists = await this.repo.hasNotification(source.entityId, "mention", user.id);
      if (alreadyExists) continue;

      await this.repo.createNotification({
        projectId,
        userId: user.id,
        type: "mention",
        entityType: source.entityType,
        entityId: source.entityId,
        sendAt: new Date().toISOString(),
        payload: source,
      });
    }
  }

  async scheduleDutyReminders(projectId: string) {
    const project = await this.repo.getProject(projectId);
    if (!project?.botSettings.dutyNotificationsEnabled) return;

    const blocks = await this.repo.getProjectBlocks(projectId);
    const dutyTables = blocks.filter((block) => block.type === "simple_table" && hasDutyShape(block.content));

    for (const table of dutyTables) {
      const rows = (table.content as any).rows as string[][];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const dutyDate = parseDate(row[0]);
        const username = row.find((cell) => /^@[a-zA-Z0-9_]{3,}$/.test(String(cell).trim()));
        if (!dutyDate || !username) continue;

        const user = await this.repo.getUserByUsername(username);
        if (!user) continue;

        for (const offsetDays of [4, 1]) {
          const sendAt = new Date(dutyDate);
          sendAt.setDate(sendAt.getDate() - offsetDays);
          sendAt.setUTCHours(MSK_NOON_HOUR_UTC, 0, 0, 0);
          if (sendAt.getTime() <= Date.now()) continue;

          const entityId = `${table.id}:${rowIndex}:${offsetDays}`;
          const alreadyExists = await this.repo.hasNotification(entityId, "duty_reminder", user.id, sendAt.toISOString());
          if (alreadyExists) continue;

          await this.repo.createNotification({
            projectId,
            userId: user.id,
            type: "duty_reminder",
            entityType: "duty",
            entityId,
            sendAt: sendAt.toISOString(),
            payload: { dutyDate: dutyDate.toISOString(), offsetDays },
          });
        }
      }
    }
  }

  async deliverDueNotifications() {
    const due = await this.repo.findPendingNotifications(new Date().toISOString());
    for (const event of due) {
      try {
        await this.deliver(event);
        await this.repo.markNotificationSent(event.id);
      } catch {
        await this.repo.markNotificationFailed(event.id);
      }
    }
  }

  async deliverDueReminders() {
    const due = await this.repo.findDueReminders(new Date().toISOString());
    for (const reminder of due) {
      try {
        await this.deliverReminder(reminder);
        await this.repo.markReminderSent(reminder.id);
      } catch {
        // Keep the reminder active. The next scheduler tick can retry it.
      }
    }
  }

  private async deliver(event: NotificationEvent) {
    const user = await this.repo.getUserById(event.userId);
    const project = await this.repo.getProject(event.projectId);
    if (!user || !project) return;

    if (event.type.startsWith("task_")) {
      const task = event.payload.task as Task | undefined;
      if (!task) return;
      await this.messenger.sendMessage(
        user.telegramId,
        formatTaskNotification({ kind: event.type, task, project, tone: project.botSettings.kanbanReminderTone }),
        { webAppUrl: this.taskUrl(project.id, task.id) },
      );
      return;
    }

    if (event.type === "mention") {
      const payload = event.payload as any;
      await this.messenger.sendMessage(
        user.telegramId,
        formatMentionNotification({
          mentioned: user,
          project,
          sourceTitle: payload.title ?? "Рабочее пространство",
          text: payload.text ?? "",
        }),
        { webAppUrl: `${this.webAppUrl}/project/${project.id}/workspace` },
      );
      return;
    }

    if (event.type === "duty_reminder") {
      const dutyDate = String(event.payload.dutyDate ?? "");
      const dateText = new Date(dutyDate).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
      await this.messenger.sendMessage(
        user.telegramId,
        [
          "🟣 *ДЕЖУРСТВО*",
          "",
          `📅 Дата: ${escapeMarkdown(dateText)}`,
          `📁 Проект: ${escapeMarkdown(project.title)}`,
        ].join("\n"),
        { webAppUrl: `${this.webAppUrl}/project/${project.id}/workspace` },
      );
      return;
    }

    if (event.type === "manual_notification" || event.type === "voice_note") {
      const payload = event.payload as any;
      const isJoinRequest = payload.action === "join_request";
      const isJoinApproved = payload.action === "join_request_approved";
      const isJoinRejected = payload.action === "join_request_rejected";
      const title = isJoinRequest
        ? "👋 *ЗАЯВКА НА ВСТУПЛЕНИЕ*"
        : isJoinApproved
          ? "✅ *ДОСТУП ОТКРЫТ*"
          : isJoinRejected
            ? "⛔ *ЗАЯВКА ОТКЛОНЕНА*"
            : event.type === "voice_note"
              ? "🎤 *ГОЛОСОВАЯ ЗАМЕТКА*"
              : "🔔 *УВЕДОМЛЕНИЕ*";
      const webAppUrl = isJoinRequest
        ? `${this.webAppUrl}/project/${project.id}/settings`
        : isJoinApproved
          ? `${this.webAppUrl}/project/${project.id}/workspace`
          : this.webAppUrl;
      await this.messenger.sendMessage(
        user.telegramId,
        [
          title,
          "",
          `📁 Проект: ${escapeMarkdown(project.title)}`,
          payload.title ? `📝 ${escapeMarkdown(String(payload.title))}` : "",
          payload.text ? escapeMarkdown(String(payload.text)) : "",
          isJoinApproved ? "\nДобро пожаловать в команду\\! 🎉" : "",
          isJoinRequest ? "\nОткройте настройки проекта, чтобы принять или отклонить заявку\\." : "",
        ].filter(Boolean).join("\n"),
        { webAppUrl },
      );
    }
  }

  private async deliverReminder(reminder: Reminder) {
    if (!reminder.channels.telegramBot) return;
    const user = await this.repo.getUserById(reminder.targetUserId);
    const project = await this.repo.getProject(reminder.projectId);
    if (!user || !project) return;

    await this.messenger.sendMessage(
      user.telegramId,
      [
        "⏰ *НАПОМИНАНИЕ*",
        "",
        `🔔 ${escapeMarkdown(reminder.title)}`,
        reminder.description ? `📝 ${escapeMarkdown(reminder.description)}` : "",
        `📁 Проект: ${escapeMarkdown(project.title)}`,
      ].filter(Boolean).join("\n"),
      { webAppUrl: `${this.webAppUrl}/project/${project.id}/reminders` },
    );
  }

  private async createUniqueNotification(
    task: Task,
    type: "task_assigned" | "task_deadline_15h" | "task_deadline_2h" | "task_deadline_now",
    userId: string,
    sendAt: string,
    project: Project,
  ) {
    const alreadyExists = await this.repo.hasNotification(task.id, type, userId, sendAt);
    if (alreadyExists) return;

    await this.repo.createNotification({
      projectId: task.projectId,
      userId,
      type,
      entityType: "task",
      entityId: task.id,
      sendAt,
      payload: { task, projectTitle: project.title },
    });
  }

  private taskUrl(projectId: string, taskId: string) {
    return `${this.webAppUrl}/project/${projectId}/workspace?task=${taskId}`;
  }
}

function hasDutyShape(content: unknown) {
  const value = content as any;
  if (!value?.rows || !Array.isArray(value.rows)) return false;
  const serialized = JSON.stringify(value).toLowerCase();
  return serialized.includes("дежур") || serialized.includes("reminderconfig") || serialized.includes("@username");
}

function parseDate(value: unknown) {
  if (!value) return undefined;
  const text = String(value).trim();
  const ru = text.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (ru) {
    const year = ru[3] ? normalizeYear(Number(ru[3])) : new Date().getFullYear();
    return new Date(year, Number(ru[2]) - 1, Number(ru[1]), 12, 0, 0, 0);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function extractText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(extractText).join(" ");
  if (typeof value === "object") return Object.values(value).map(extractText).join(" ");
  return "";
}
