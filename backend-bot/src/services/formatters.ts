import type { BotTone, Project, Task, TaskBuckets, User } from "../types.js";

const moscowFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatMskDate(value?: string) {
  if (!value) return "не указан";
  return `${moscowFormatter.format(new Date(value))} МСК`;
}

export function escapeMarkdown(text: string) {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

export function bucketTasks(tasks: Task[], columns: Array<{ id: string; position: number }>): TaskBuckets {
  const now = Date.now();
  const active = tasks.filter((task) => isActiveTaskForMyList(task, columns, now));
  const red: Task[] = [];
  const yellow: Task[] = [];
  const green: Task[] = [];
  const noDeadline: Task[] = [];

  for (const task of active) {
    if (!task.deadlineAt) {
      noDeadline.push(task);
      continue;
    }
    const hoursLeft = (new Date(task.deadlineAt).getTime() - now) / 3600000;
    if (hoursLeft < 12) red.push(task);
    else if (hoursLeft <= 48) yellow.push(task);
    else green.push(task);
  }

  const byDeadline = (a: Task, b: Task) =>
    new Date(a.deadlineAt ?? "9999-01-01").getTime() - new Date(b.deadlineAt ?? "9999-01-01").getTime();

  return {
    red: red.sort(byDeadline),
    yellow: yellow.sort(byDeadline),
    green: green.sort(byDeadline),
    noDeadline: noDeadline.sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export function formatMyTasksMessage(
  tasks: Task[],
  columns: Array<{ id: string; position: number; projectId?: string; pageId?: string }>,
  projectById: Map<string, Project>,
  progressTasks = tasks,
) {
  const buckets = bucketTasks(tasks, columns);
  const lines = ["📋 *Мои задачи*", ""];

  appendBucket(lines, "🔴 Просрочены или осталось < 12 часов", buckets.red, projectById);
  appendBucket(lines, "🟡 12–48 часов", buckets.yellow, projectById);
  appendBucket(lines, "🟢 Больше 48 часов", buckets.green, projectById);
  appendBucket(lines, "⚪ Без дедлайна", buckets.noDeadline, projectById);

  const activeCount = buckets.red.length + buckets.yellow.length + buckets.green.length + buckets.noDeadline.length;
  if (!activeCount) {
    lines.push("Активных задач нет. Можно спокойно выдохнуть.");
  }

  lines.push("");
  lines.push(formatSevenDayProgress(progressTasks, columns));
  return lines.join("\n");
}

export function formatTaskNotification(input: {
  kind: string;
  task: Task;
  project?: Project;
  tone: BotTone;
}) {
  const lines = [taskBanner(input.kind), ""];
  lines.push(`📌 *${escapeMarkdown(input.task.title)}*`);
  if (input.kind === "task_assigned" && input.task.description) {
    lines.push(`📝 ${escapeMarkdown(input.task.description)}`);
  }
  if (input.task.deadlineAt) {
    const label = input.kind === "task_deadline_now" ? "⏰ Срок был" : "⏰ Дедлайн";
    lines.push(`${label}: ${escapeMarkdown(formatMskDate(input.task.deadlineAt))}`);
  }
  if (input.project) lines.push(`📁 Проект: ${escapeMarkdown(input.project.title)}`);
  return lines.join("\n");
}

function taskBanner(kind: string) {
  const customBeforeDeadline = kind.match(/^task_deadline_(\d+)m$/);
  if (customBeforeDeadline) {
    const minutes = Number(customBeforeDeadline[1]);
    const label = minutes % 60 === 0 ? `${minutes / 60} ч` : `${minutes} мин`;
    return `🟡 *СКОРО ДЕДЛАЙН* — осталось ${escapeMarkdown(label)}`;
  }

  switch (kind) {
    case "task_assigned":
      return "📋 *НОВАЯ ЗАДАЧА*";
    case "task_deadline_15h":
      return "🟡 *СКОРО ДЕДЛАЙН* — осталось около 15 часов";
    case "task_deadline_2h":
      return "🟠 *ГОРИТ* — до дедлайна около 2 часов";
    case "task_deadline_now":
      return "🔴 *ДЕДЛАЙН НАСТУПИЛ*";
    default:
      return "🔔 *Напоминание по задаче*";
  }
}

export function formatMentionNotification(input: {
  mentioned: User;
  project: Project;
  sourceTitle: string;
  text: string;
}) {
  return [
    "💬 *ВАС УПОМЯНУЛИ*",
    "",
    `📁 Проект: *${escapeMarkdown(input.project.title)}*`,
    `📍 Где: ${escapeMarkdown(input.sourceTitle)}`,
    "",
    `«${escapeMarkdown(trimText(input.text, 500))}»`,
  ].join("\n");
}

function appendBucket(lines: string[], title: string, tasks: Task[], projectById: Map<string, Project>) {
  if (!tasks.length) return;
  lines.push(title);
  for (const task of tasks) {
    const project = projectById.get(task.projectId);
    lines.push(`• *${escapeMarkdown(task.title)}*`);
    lines.push(`  ${escapeMarkdown(formatMskDate(task.deadlineAt))}`);
    if (project) lines.push(`  ${escapeMarkdown(project.title)}`);
  }
  lines.push("");
}

function formatSevenDayProgress(tasks: Task[], columns: Array<{ id: string; position: number; projectId?: string; pageId?: string }>) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 3600000;
  const completed = tasks.filter((task) => {
    if (!isCompletedTask(task, columns)) return false;
    const time = new Date(task.completedAt ?? task.archivedAt ?? task.updatedAt).getTime();
    return Number.isFinite(time) && time >= sevenDaysAgo && time <= now;
  }).length;
  const total = tasks.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const filled = Math.round(percent / 10);
  const bar = "🟩".repeat(filled) + "⬜".repeat(10 - filled);

  return [
    "📊 *Прогресс за 7 дней*",
    `Завершено: *${completed} из ${total}*`,
    `${bar} ${percent}%`,
  ].join("\n");
}

function isFinalColumn(task: Task, columns: Array<{ id: string; position: number; projectId?: string; pageId?: string }>) {
  const sorted = [...columns]
    .filter((column) => (!column.projectId || column.projectId === task.projectId) && sameBoard(column.pageId, task.pageId))
    .sort((a, b) => a.position - b.position);
  return sorted.at(-1)?.id === task.columnId;
}

function sameBoard(columnPageId: string | undefined, taskPageId: string | undefined) {
  return taskPageId ? columnPageId === taskPageId : !columnPageId;
}

function isCompletedTask(task: Task, columns: Array<{ id: string; position: number; projectId?: string; pageId?: string }>) {
  return Boolean(task.isArchived || task.completedAt || isFinalColumn(task, columns));
}

function isActiveTaskForMyList(task: Task, columns: Array<{ id: string; position: number; projectId?: string; pageId?: string }>, now: number) {
  if (isCompletedTask(task, columns)) return false;
  if (task.scheduledAt && new Date(task.scheduledAt).getTime() > now) return false;
  return true;
}

function trimText(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
