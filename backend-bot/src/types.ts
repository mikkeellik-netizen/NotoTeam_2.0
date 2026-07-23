export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type BotTone = "soft" | "neutral" | "strict" | "pastoral";

export type NotificationKind =
  | "task_assigned"
  | "task_deadline_15h"
  | "task_deadline_2h"
  | "task_deadline_now"
  | "task_overdue"
  | "mention"
  | "duty_reminder"
  | "manual_notification"
  | "voice_note"
  | "admin_weekly_report"
  | "admin_overdue_report";

export interface User {
  id: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  botPreferences?: BotUserPreferences;
}

export interface BotUserPreferences {
  defaultProjectId?: string;
  defaultBoardPageId?: string;
}

export interface ProjectMember {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
}

export interface Project {
  id: string;
  title: string;
  ownerId: string;
  members: ProjectMember[];
  botSettings: ProjectBotSettings;
}

export interface Column {
  id: string;
  projectId: string;
  pageId?: string;
  title: string;
  position: number;
  isArchive?: boolean;
  isHidden?: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  pageId?: string;
  columnId: string;
  creatorId: string;
  assigneeId?: string;
  title: string;
  description?: string;
  priority: Priority;
  deadlineAt?: string;
  scheduledAt?: string;
  isArchived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  subtasks?: Subtask[];
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
}

export interface PageBlock {
  id: string;
  projectId: string;
  pageId: string;
  type: string;
  content: unknown;
  order?: number;
  createdAt?: string;
  updatedAt: string;
}

export interface PageNode {
  id: string;
  projectId: string;
  parentId: string | null;
  type: "page" | "folder" | "kanban";
  title: string;
  icon: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSpace {
  nodes: PageNode[];
  blocks: Array<Omit<PageBlock, "projectId">>;
  collapsedIds?: string[];
  recentPages?: string[];
  dailyNotes?: Record<string, string>;
}

export interface KanbanReminderPoint {
  id: string;
  enabled: boolean;
  kind: "on_assign" | "before_deadline" | "at_deadline" | "after_deadline";
  offsetMinutes?: number;
  label: string;
}

export interface BotReportSettings {
  enabled: boolean;
  recipientUserIds: string[];
  weekdays: number[];
  time: string;
  skipEmpty: boolean;
  sendOnlyIfChanged: boolean;
  /** Дата (МСК, YYYY-MM-DD) последней автоотправки — чтобы не слать дважды в день и не пропускать. */
  lastSentDate?: string;
  sections: {
    createdTasks: boolean;
    completedTasks: boolean;
    overdueTasks: boolean;
    approachingDeadlines: boolean;
    inactiveUsers: boolean;
    userActivity: boolean;
    kanbanMovement: boolean;
    mentions: boolean;
    recommendations: boolean;
  };
}

export interface ProjectBotSettings {
  timezone: "Europe/Moscow";
  taskDeadlineNotificationsEnabled: boolean;
  mentionNotificationsEnabled: boolean;
  dutyNotificationsEnabled: boolean;
  kanbanReminderTone: BotTone;
  kanbanReminderPoints: KanbanReminderPoint[];
  reports: {
    weekly: BotReportSettings;
    overdue: BotReportSettings;
  };
}

export interface NotificationEvent {
  id: string;
  projectId: string;
  userId: string;
  type: NotificationKind;
  entityType: "task" | "page" | "block" | "table" | "duty" | "project";
  entityId: string;
  sendAt: string;
  sentAt?: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  payload: Record<string, unknown>;
}

export type ReminderSourceType = "manual" | "kanban" | "mention" | "table" | "page" | "bot";

export interface ReminderRecurrence {
  frequency: "daily" | "weekly" | "monthly" | "custom";
  weekdays?: number[];
  time: string;
  interval?: number;
  dates?: string[];
  monthDay?: number;
}

export interface Reminder {
  id: string;
  projectId: string;
  creatorUserId: string;
  targetUserId: string;
  sourceType: ReminderSourceType;
  sourceId?: string;
  title: string;
  description?: string;
  scheduleType: "once" | "recurring";
  remindAt?: string;
  recurrence?: ReminderRecurrence;
  status: "active" | "paused" | "done" | "cancelled";
  channels: {
    app: boolean;
    telegramBot: boolean;
  };
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
  nextRunAt?: string;
}

export interface ReminderInput {
  creatorUserId?: string;
  targetUserId: string;
  sourceType?: ReminderSourceType;
  sourceId?: string;
  title: string;
  description?: string;
  scheduleType: "once" | "recurring";
  remindAt?: string;
  recurrence?: ReminderRecurrence;
  channels?: {
    app?: boolean;
    telegramBot?: boolean;
  };
}

export interface CalendarEvent {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  type: "meeting" | "service" | "deadline" | "duty" | "event" | "custom";
  color?: string;
  categoryId?: string;
  categoryLabel?: string;
  location?: string;
  link?: string;
  sourceType?: string;
}

export interface ParsedTask {
  title: string;
  assigneeUsername?: string;
  deadlineAt?: string;
  priority: Priority;
  description?: string;
  pageId?: string;
}

export interface TaskBuckets {
  red: Task[];
  yellow: Task[];
  green: Task[];
  noDeadline: Task[];
}
