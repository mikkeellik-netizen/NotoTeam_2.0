import type { BotMessenger, WorkspaceRepository } from "../ports.js";
import type { NotificationEvent, Project, ProjectBotSettings, Reminder, Task, User } from "../types.js";
import { mergeBotSettings } from "../defaultSettings.js";
import { escapeMarkdown, formatMentionNotification, formatTaskNotification } from "./formatters.js";
import { buildWebAppUrl } from "../webAppLinks.js";

const MSK_UTC_OFFSET_HOURS = 3;

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
    const settings = mergeBotSettings(project?.botSettings);
    if (!project || !settings.taskDeadlineNotificationsEnabled) return;

    for (const point of settings.kanbanReminderPoints.filter((item) => item.enabled)) {
      if (point.kind === "on_assign") {
        await this.createUniqueNotification(task, "task_assigned", task.assigneeId, task.createdAt, project);
      }

      if (point.kind === "before_deadline" && task.deadlineAt && point.offsetMinutes) {
        const sendAt = new Date(new Date(task.deadlineAt).getTime() - point.offsetMinutes * 60000).toISOString();
        if (new Date(sendAt).getTime() > Date.now()) {
          const type = notificationTypeForOffset(point.offsetMinutes);
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
    for (const task of tasks.filter((item) => isActiveTaskForNotificationSync(item, columns))) {
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
    const settings = mergeBotSettings(project?.botSettings);
    if (!project || !settings.mentionNotificationsEnabled) return;

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
    const settings = mergeBotSettings(project?.botSettings);
    if (!project || !settings.dutyNotificationsEnabled) return;

    const [blocks, members] = await Promise.all([
      this.repo.getProjectBlocks(projectId),
      this.repo.getProjectMembers(projectId),
    ]);
    const dutyTables = blocks.filter((block) => block.type === "simple_table" && hasDutyShape(block.content));

    for (const table of dutyTables) {
      const content = table.content as any;
      const rows = Array.isArray(content?.rows) ? content.rows as string[][] : [];
      const columns = Array.isArray(content?.columns) ? content.columns as Array<{ title?: string; type?: string }> : [];
      const shape = getDutyTableShape(columns);
      const fallbackDefaults = Array.isArray(content?.reminderConfig?.defaults) ? content.reminderConfig.defaults : [];

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const dutyDate = parseDutyDate(row[shape.dateIndex] ?? row[0]);
        const user = await resolveDutyUser(this.repo, members, row[shape.assigneeIndex] ?? findLegacyDutyUsername(row));

        if (!dutyDate || !user) continue;

        const reminderRules = buildDutyReminderRules(row, shape.reminderIndexes, fallbackDefaults);
        for (const rule of reminderRules) {
          const sendAt = mskDateTimeToUtcDate(dutyDate.year, dutyDate.month, dutyDate.day - rule.offsetDays, rule.hour, rule.minute);
          if (sendAt.getTime() <= Date.now()) continue;

          const entityId = `${table.id}:${rowIndex}:${rule.sourceIndex}:${rule.offsetDays}:${rule.hour}:${rule.minute}`;
          const alreadyExists = await this.repo.hasNotification(entityId, "duty_reminder", user.id, sendAt.toISOString());
          if (alreadyExists) continue;

          await this.repo.createNotification({
            projectId,
            userId: user.id,
            type: "duty_reminder",
            entityType: "duty",
            entityId,
            sendAt: sendAt.toISOString(),
            payload: {
              dutyDate: mskDateTimeToUtcDate(dutyDate.year, dutyDate.month, dutyDate.day, 12, 0).toISOString(),
              offsetDays: rule.offsetDays,
              time: formatTime(rule.hour, rule.minute),
              comment: shape.commentIndex >= 0 ? String(row[shape.commentIndex] ?? "").trim() : "",
              pageId: table.pageId,
              tableId: table.id,
            },
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
    const settings = mergeBotSettings(project.botSettings);

    if (event.type.startsWith("task_")) {
      const task = event.payload.task as Task | undefined;
      if (!task) return;
      await this.messenger.sendMessage(
        user.telegramId,
        formatTaskNotification({ kind: event.type, task, project, tone: settings.kanbanReminderTone }),
        { webAppUrl: this.taskUrl(project.id, task) },
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
        { webAppUrl: this.appLink(`/project/${project.id}/workspace`) },
      );
      return;
    }

    if (event.type === "duty_reminder") {
      const dutyDate = String(event.payload.dutyDate ?? "");
      const dateText = new Date(dutyDate).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
      const comment = String(event.payload.comment ?? "").trim();
      await this.messenger.sendMessage(
        user.telegramId,
        [
          "🟣 *ДЕЖУРСТВО*",
          "",
          `📅 Дата: ${escapeMarkdown(dateText)}`,
          `📁 Проект: ${escapeMarkdown(project.title)}`,
          comment ? `📝 ${escapeMarkdown(comment)}` : "",
        ].filter(Boolean).join("\n"),
        { webAppUrl: this.appLink(`/project/${project.id}/workspace${event.payload.pageId ? `/page/${event.payload.pageId}` : ""}`) },
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
        ? this.appLink(`/project/${project.id}/settings`)
        : isJoinApproved
          ? this.appLink(`/project/${project.id}/workspace`)
          : this.appLink();
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
      { webAppUrl: this.appLink(`/project/${project.id}/reminders`) },
    );
  }

  private async createUniqueNotification(
    task: Task,
    type: "task_assigned" | "task_deadline_15h" | "task_deadline_2h" | `task_deadline_${number}m` | "task_deadline_now",
    userId: string,
    sendAt: string,
    project: Project,
  ) {
    const alreadyExists = await this.repo.hasNotification(task.id, type, userId, type === "task_assigned" ? undefined : sendAt);
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

  private taskUrl(projectId: string, task: Task) {
    if (task.pageId) {
      return this.appLink(`/project/${projectId}/workspace/page/${task.pageId}?taskId=${task.id}`);
    }
    return this.appLink(`/project/${projectId}/workspace?taskId=${task.id}`);
  }

  private appLink(target?: string) {
    return buildWebAppUrl(this.webAppUrl, target);
  }
}

function notificationTypeForOffset(offsetMinutes: number) {
  if (Number(offsetMinutes) === 15 * 60) return "task_deadline_15h";
  if (Number(offsetMinutes) === 2 * 60) return "task_deadline_2h";
  return `task_deadline_${Number(offsetMinutes)}m` as const;
}

function isActiveTaskForNotificationSync(
  task: Task,
  columns: Array<{ id: string; position: number; projectId?: string; pageId?: string; isArchive?: boolean; isHidden?: boolean }>,
) {
  if (task.isArchived || task.completedAt) return false;
  if (task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now()) return false;
  const boardColumns = columns
    .filter((column) => (!column.projectId || column.projectId === task.projectId) && sameBoard(column.pageId, task.pageId) && !column.isArchive && !column.isHidden)
    .sort((left, right) => left.position - right.position);
  return boardColumns.at(-1)?.id !== task.columnId;
}

function sameBoard(columnPageId: string | undefined, taskPageId: string | undefined) {
  return taskPageId ? columnPageId === taskPageId : !columnPageId;
}

function hasDutyShape(content: unknown) {
  const value = content as any;
  if (!value?.rows || !Array.isArray(value.rows)) return false;
  const serialized = JSON.stringify(value).toLowerCase();
  return value.tableKind === "duty_schedule" || serialized.includes("дежур") || serialized.includes("reminderconfig") || serialized.includes("@username");
}

function getDutyTableShape(columns: Array<{ title?: string; type?: string }>) {
  const normalized = columns.map((column) => String(column.title ?? "").trim().toLowerCase());
  const dateIndex = normalized.findIndex((title) => title.includes("дата"));
  const assigneeIndex = normalized.findIndex((title) => title.includes("ответствен") || title.includes("руковод"));
  const commentIndex = normalized.findIndex((title) => title.includes("коммент"));
  const reminderIndexes = normalized
    .map((title, index) => ({ title, index }))
    .filter((item) => item.title.includes("напомнить") || item.title.includes("напомин"))
    .map((item) => item.index);

  return {
    dateIndex: dateIndex >= 0 ? dateIndex : 0,
    assigneeIndex: assigneeIndex >= 0 ? assigneeIndex : 1,
    reminderIndexes,
    commentIndex,
  };
}

function buildDutyReminderRules(
  row: string[],
  reminderIndexes: number[],
  fallbackDefaults: Array<{ offsetDays?: number; time?: string }>,
) {
  const sources = reminderIndexes.length
    ? reminderIndexes.map((columnIndex) => ({ columnIndex, value: row[columnIndex] }))
    : fallbackDefaults.map((rule, index) => ({ columnIndex: index, value: `За ${rule.offsetDays} дня в ${rule.time}` }));

  return sources
    .map((source) => {
      const parsed = parseDutyReminderCell(source.value);
      return parsed ? { ...parsed, sourceIndex: source.columnIndex } : null;
    })
    .filter((rule): rule is DutyReminderRule => Boolean(rule));
}

type DutyReminderRule = {
  offsetDays: number;
  hour: number;
  minute: number;
  sourceIndex: number;
};

function parseDutyReminderCell(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text.includes("не напомин")) return undefined;

  const daysMatch = text.match(/(?:за\s*)?(\d{1,3})\s*(?:дн|day)/i);
  const offsetDays = daysMatch ? Number(daysMatch[1]) : Number(text.match(/^\d{1,3}$/)?.[0]);
  if (!Number.isFinite(offsetDays) || offsetDays < 0) return undefined;

  const timeMatch = text.match(/(\d{1,2})[:.](\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;

  return { offsetDays, hour, minute };
}

async function resolveDutyUser(repo: WorkspaceRepository, members: User[], value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;

  const byId = members.find((user) => user.id === text) ?? await repo.getUserById(text);
  if (byId) return byId;

  const username = text.replace(/^@/, "").toLowerCase();
  const byUsername = members.find((user) => user.username?.toLowerCase() === username) ?? await repo.getUserByUsername(username);
  if (byUsername) return byUsername;

  const normalizedName = text.toLowerCase();
  return members.find((user) => {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").toLowerCase();
    return fullName === normalizedName || user.firstName?.toLowerCase() === normalizedName;
  });
}

function findLegacyDutyUsername(row: string[]) {
  return row.find((cell) => /^@[a-zA-Z0-9_]{3,}$/.test(String(cell).trim())) ?? "";
}

function parseDutyDate(value: unknown) {
  if (!value) return undefined;
  const text = String(value).trim();
  const ru = text.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
  if (ru) {
    const year = ru[3] ? normalizeYear(Number(ru[3])) : new Date().getFullYear();
    const month = Number(ru[2]);
    const day = Number(ru[1]);
    return isValidDateParts(year, month, day) ? { year, month, day } : undefined;
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidDateParts(year, month, day) ? { year, month, day } : undefined;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function normalizeYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function mskDateTimeToUtcDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - MSK_UTC_OFFSET_HOURS, minute, 0, 0));
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(extractText).join(" ");
  if (typeof value === "object") return Object.values(value).map(extractText).join(" ");
  return "";
}
