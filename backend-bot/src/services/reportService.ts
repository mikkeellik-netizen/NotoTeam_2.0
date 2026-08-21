import type { BotMessenger, WorkspaceRepository } from "../ports.js";
import type { Column, Project, Task } from "../types.js";
import { mergeBotSettings } from "../defaultSettings.js";
import { escapeMarkdown, formatMskDate } from "./formatters.js";

export class ReportService {
  constructor(
    private repo: WorkspaceRepository,
    private messenger: BotMessenger,
  ) {}

  async sendWeeklyReport(project: Project) {
    const settings = mergeBotSettings(project.botSettings).reports.weekly;
    if (!settings.enabled) return;

    const [tasks, columns] = await Promise.all([this.repo.getTasksByProject(project.id), this.repo.getProjectColumns(project.id)]);
    const since = Date.now() - 7 * 24 * 3600000;
    const created = tasks.filter((task) => new Date(task.createdAt).getTime() >= since);
    const completed = getCompletedSince(tasks, columns, since);
    const overdue = tasks.filter((task) => isOverdue(task, columns));

    if (settings.skipEmpty && !created.length && !completed.length && !overdue.length) return;

    const text = await buildWeeklyReportText(this.repo, project);
    const lines = text.split("\n");
    if (settings.sections.createdTasks) lines.splice(2, 0, `Создано задач: *${created.length}*`);
    if (settings.sections.overdueTasks) lines.splice(3, 0, `Просрочено сейчас: *${overdue.length}*`);
    if (settings.sections.approachingDeadlines) {
      const soon = tasks.filter((task) => deadlineInHours(task, columns, 48));
      lines.splice(4, 0, `Дедлайн в ближайшие 48 часов: *${soon.length}*`);
    }
    if (settings.sections.recommendations) {
      lines.push("");
      lines.push(makeRecommendation(overdue.length, completed.length, created.length));
    }

    await this.sendToReportRecipients(project, settings.recipientUserIds, lines.join("\n"));
  }

  async sendOverdueReport(project: Project) {
    const settings = mergeBotSettings(project.botSettings).reports.overdue;
    if (!settings.enabled) return;

    const [tasks, columns] = await Promise.all([
      this.repo.getTasksByProject(project.id),
      this.repo.getProjectColumns(project.id),
    ]);
    const overdue = tasks.filter((task) => isOverdue(task, columns) && task.assigneeId);
    if (settings.skipEmpty && !overdue.length) return;

    const byUser = new Map<string, Task[]>();
    for (const task of overdue) {
      const list = byUser.get(task.assigneeId!) ?? [];
      list.push(task);
      byUser.set(task.assigneeId!, list);
    }

    const lines = [`⚠️ *Отчет по просрочкам — ${escapeMarkdown(project.title)}*`, ""];
    for (const [userId, list] of byUser.entries()) {
      if (list.length < 3) continue;
      const user = await this.repo.getUserById(userId);
      lines.push(`• ${escapeMarkdown(user?.firstName ?? user?.username ?? userId)}: *${list.length}*`);
      for (const task of list.slice(0, 5)) {
        lines.push(`  - ${escapeMarkdown(task.title)} (${escapeMarkdown(formatMskDate(task.deadlineAt))})`);
      }
    }

    if (lines.length <= 2 && settings.skipEmpty) return;
    if (settings.sections.recommendations) {
      lines.push("");
      lines.push("Рекомендация: обсудить нагрузку, снять лишнее или перенести сроки там, где это честнее для команды.");
    }

    await this.sendToReportRecipients(project, settings.recipientUserIds, lines.join("\n"));
  }

  private async sendToReportRecipients(project: Project, recipientUserIds: string[], text: string) {
    const recipients = recipientUserIds.length ? recipientUserIds : [project.ownerId];
    for (const userId of recipients) {
      const user = await this.repo.getUserById(userId);
      if (user) await this.messenger.sendMessage(user.telegramId, text);
    }
  }
}

export async function buildWeeklyReportText(repo: WorkspaceRepository, project: Project) {
  const [tasks, columns] = await Promise.all([repo.getTasksByProject(project.id), repo.getProjectColumns(project.id)]);
  const since = Date.now() - 7 * 24 * 3600000;
  const completed = getCompletedSince(tasks, columns, since).sort((a, b) => completedTime(b) - completedTime(a));
  const lines = [`📊 *Еженедельный отчет — ${escapeMarkdown(project.title)}*`, "", `Завершено за 7 дней: *${completed.length}*`];

  lines.push("", "*Завершенные задачи:*");
  if (!completed.length) lines.push("Нет завершенных задач за неделю.");
  for (const task of completed.slice(0, 30)) {
    const assignee = task.assigneeId ? await repo.getUserById(task.assigneeId) : undefined;
    const result = completionResult(task);
    lines.push(`• ${escapeMarkdown(task.title)} — ${escapeMarkdown(userName(assignee, task.assigneeId))} · ${escapeMarkdown(result.label)}`);
  }
  if (completed.length > 30) lines.push(`Еще ${completed.length - 30} задач не показано.`);

  lines.push("", "*По ответственным:*");
  const byUser = new Map<string, Task[]>();
  for (const task of completed) {
    const key = task.assigneeId ?? "none";
    byUser.set(key, [...(byUser.get(key) ?? []), task]);
  }
  if (!byUser.size) lines.push("Нет данных по ответственным.");
  for (const [userId, userTasks] of byUser.entries()) {
    const user = userId === "none" ? undefined : await repo.getUserById(userId);
    const stats = summarizeCompletion(userTasks);
    lines.push(`• *${escapeMarkdown(userName(user, userId))}*: ${userTasks.length}`);
    lines.push(`  досрочно ${stats.earlyPercent}% · вовремя ${stats.onTimePercent}% · с опозданием ${stats.latePercent}%`);
    if (stats.noDeadline) lines.push(`  без дедлайна: ${stats.noDeadline}`);
  }

  return lines.join("\n");
}

function isOverdue(task: Task, columns: Column[]) {
  return Boolean(task.deadlineAt && !isCompleted(task, columns) && new Date(task.deadlineAt).getTime() < Date.now());
}

function deadlineInHours(task: Task, columns: Column[], hours: number) {
  if (!task.deadlineAt || isCompleted(task, columns)) return false;
  const diff = new Date(task.deadlineAt).getTime() - Date.now();
  return diff > 0 && diff <= hours * 3600000;
}

function isCompleted(task: Task, columns: Column[]) {
  if (task.isArchived || task.completedAt) return true;
  const finalColumn = columns
    .filter((column) => column.projectId === task.projectId && sameBoard(column.pageId, task.pageId) && !column.isArchive && !column.isHidden)
    .sort((a, b) => a.position - b.position)
    .at(-1);
  return Boolean(finalColumn && finalColumn.id === task.columnId);
}

function getCompletedSince(tasks: Task[], columns: Column[], since: number) {
  return tasks.filter((task) => isCompleted(task, columns) && completedTime(task) >= since);
}

function completedTime(task: Task) {
  return new Date(task.completedAt ?? task.archivedAt ?? task.updatedAt).getTime();
}

function completionResult(task: Task) {
  if (!task.deadlineAt) return { kind: "noDeadline", label: "без дедлайна" };
  const deadline = new Date(task.deadlineAt).getTime();
  const done = completedTime(task);
  if (!Number.isFinite(deadline) || !Number.isFinite(done)) return { kind: "noDeadline", label: "без дедлайна" };
  if (done < deadline - 60 * 60 * 1000) return { kind: "early", label: "досрочно" };
  if (done <= deadline) return { kind: "onTime", label: "вовремя" };
  return { kind: "late", label: "с опозданием" };
}

function summarizeCompletion(tasks: Task[]) {
  const stats = { early: 0, onTime: 0, late: 0, noDeadline: 0 };
  for (const task of tasks) {
    const result = completionResult(task).kind;
    if (result === "early") stats.early += 1;
    else if (result === "onTime") stats.onTime += 1;
    else if (result === "late") stats.late += 1;
    else stats.noDeadline += 1;
  }
  const totalWithDeadline = stats.early + stats.onTime + stats.late;
  return {
    ...stats,
    earlyPercent: percent(stats.early, totalWithDeadline),
    onTimePercent: percent(stats.onTime, totalWithDeadline),
    latePercent: percent(stats.late, totalWithDeadline),
  };
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function userName(user: { firstName?: string; lastName?: string; username?: string } | undefined, fallback?: string) {
  const displayName = [user?.firstName, user?.lastName].filter((part) => part && !isBrokenText(part)).join(" ").trim();
  if (displayName) return displayName;
  if (user?.username) return `@${user.username}`;
  return fallback === "none" ? "Без исполнителя" : fallback ?? "Не назначен";
}

function isBrokenText(value: string) {
  const text = value.trim();
  return !text || /^[?\s]+$/.test(text) || /Р[Ѐ-ӿ]/.test(text);
}

function sameBoard(itemPageId: string | undefined, pageId: string | undefined) {
  return pageId ? itemPageId === pageId : !itemPageId;
}

function makeRecommendation(overdue: number, completed: number, created: number) {
  if (overdue >= 3) return "Рекомендация: есть риск перегруза. Лучше проверить исполнителей и сроки.";
  if (completed >= created && completed > 0) return "Команда идет ровно: темп хороший, можно продолжать в этом ритме.";
  return "Стоит посмотреть задачи без движения и мягко подтолкнуть ответственных.";
}
