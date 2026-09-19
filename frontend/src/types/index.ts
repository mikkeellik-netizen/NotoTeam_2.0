// ─── Enums ────────────────────────────────────────────────────
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AiTone = 'FRIENDLY' | 'MINIMAL' | 'BUSINESS' | 'YOUTH' | 'STRICT' | 'PASTORAL';
export type ArchiveCleanupMode = 'never' | '2weeks' | '1month' | '3months';
export type TaskImportanceScore = 1 | 2 | 3 | 4 | 5;
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'HALF_TIME'
  | 'HOURS_15'
  | 'HOURS_2'
  | 'DEADLINE_REACHED'
  | 'OVERDUE'
  | 'TASK_COMPLETED';

// ─── User ─────────────────────────────────────────────────────
export interface User {
  id: number;
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  avatarUrl?: string;
  avatarMode?: 'none' | 'telegram' | 'manual';
  avatarStatus?: 'disabled' | 'ready' | 'unavailable' | 'error';
  avatarUpdatedAt?: string;
}

// ─── Project ──────────────────────────────────────────────────
export interface Project {
  id: number;
  ownerId: number;
  title: string;
  description?: string;
  inviteCode?: string;
  aiToneStyle: AiTone;
  isArchived: boolean;
  isDeleted?: boolean;
  deletedAt?: string;
  createdAt: string;
  members?: ProjectMember[];
  columns?: Column[];
  pages?: PageNode[];
  botSettings?: ProjectBotSettings;
  calendarCategories?: CalendarCategory[];
  responsibilityAreas?: ResponsibilityArea[];
  _count?: {
    tasks: number;
  };
}

export interface ResponsibilityArea {
  id: string;
  projectId: number | string;
  title: string;
  description?: string;
  ownerUserIds: Array<number | string>;
  color: string;
  icon: string;
  linkedPageIds?: string[];
  linkedKanbanBoardIds?: string[];
  linkedTaskIds?: Array<number | string>;
  notes?: string;
  planItems?: ResponsibilityPlanItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ResponsibilityPlanItem {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export type BotTone = 'soft' | 'neutral' | 'strict' | 'pastoral';

export interface KanbanReminderPoint {
  id: string;
  enabled: boolean;
  kind: 'on_assign' | 'before_deadline' | 'at_deadline';
  offsetMinutes?: number;
  label: string;
}

export interface BotReportSections {
  createdTasks: boolean;
  completedTasks: boolean;
  overdueTasks: boolean;
  approachingDeadlines: boolean;
  inactiveUsers: boolean;
  userActivity: boolean;
  kanbanMovement: boolean;
  mentions: boolean;
  recommendations: boolean;
}

export interface BotReportSettings {
  enabled: boolean;
  recipientUserIds: number[];
  weekdays: number[];
  time: string;
  skipEmpty: boolean;
  sendOnlyIfChanged: boolean;
  sections: BotReportSections;
}

export interface ProjectBotSettings {
  timezone: string;
  archiveCleanupMode: ArchiveCleanupMode;
  taskDeadlineNotificationsEnabled: boolean;
  mentionNotificationsEnabled: boolean;
  dutyNotificationsEnabled: boolean;
  smartAdminNotificationsEnabled: boolean;
  kanbanReminderTone: BotTone;
  kanbanReminderPoints: KanbanReminderPoint[];
  taskSignificance: TaskSignificanceSettings;
  reports: {
    weekly: BotReportSettings;
    overdue: BotReportSettings;
  };
}

export interface TaskSignificanceSettings {
  priorityBonus: Record<Priority, number>;
  overdueBonus: number;
  longOverdueBonus: number;
  longOverdueHours: number;
  blockingBonus: number;
  attentionThreshold: number;
  criticalThreshold: number;
}

// ─── Role & Member ────────────────────────────────────────────
export type ProjectRoleName = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Role {
  id: number;
  projectId: number;
  name: ProjectRoleName;
  permissions: RolePermissions;
}

export interface RolePermissions {
  viewProject?: boolean;
  createTask?: boolean;
  updateTask?: boolean;
  moveTask?: boolean;
  deleteTask?: boolean;
  manageColumns?: boolean;
  manageMembers?: boolean;
  viewAnalytics?: boolean;
  manageProject?: boolean;
  manageWorkspace?: boolean;
  createPage?: boolean;
  updatePage?: boolean;
  deletePage?: boolean;
  manageTemplates?: boolean;
  viewCalendar?: boolean;
  createCalendarEvents?: boolean;
  editOwnCalendarEvents?: boolean;
  editAllCalendarEvents?: boolean;
  deleteOwnCalendarEvents?: boolean;
  deleteAllCalendarEvents?: boolean;
  manageCalendar?: boolean;
  manageReminders?: boolean;
  manageBot?: boolean;
  exportProject?: boolean;
}

export interface ProjectMember {
  id: number;
  projectId: number;
  userId: number;
  roleId?: number;
  adminNotes?: string;
  user?: User;
  role?: Role;
}

export interface ProjectJoinRequest {
  id: number;
  projectId: number;
  inviteCode: string;
  username: string;
  displayName?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

// ─── Column ───────────────────────────────────────────────────
export interface Column {
  id: number;
  projectId: number;
  pageId?: string;
  title: string;
  position: number;
  isDefault: boolean;
  isArchive: boolean;
  isHidden: boolean;
  tasks?: Task[];
}

// ─── Task ─────────────────────────────────────────────────────
export interface Task {
  id: number;
  projectId: number;
  pageId?: string;
  columnId: number;
  assigneeId?: number;
  title: string;
  description?: string;
  priority: Priority;
  deadlineAt?: string;
  scheduledAt?: string;
  importanceScore?: TaskImportanceScore;
  isBlocking?: boolean;
  colorLabel?: string;
  isRepeating: boolean;
  position: number;
  isArchived: boolean;
  archivedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
  assignee?: User;
  project?: {
    id: number;
    title: string;
    icon?: string;
  };
  subtasks?: Subtask[];
  tags?: Tag[];
  linkedPageIds?: string[];
}

// ─── Subtask ──────────────────────────────────────────────────
export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  isCompleted: boolean;
  completedAt?: string;
  position: number;
}

// ─── Tag ──────────────────────────────────────────────────────
export interface Tag {
  id: number;
  projectId: number;
  title: string;
  color: string;
}

// ─── Notion-like pages ────────────────────────────────────────
export type PageNodeType = 'page' | 'folder' | 'kanban';

export interface PageNode {
  id: string;
  projectId: string;
  parentId: string | null;
  type: PageNodeType;
  title: string;
  icon: string;
  order: number;
  isPinned?: boolean;
  pinnedOrder?: number;
  isDeleted?: boolean;
  deletedAt?: string;
  properties?: PageProperties;
  createdAt: string;
  updatedAt: string;
}

export interface PageProperties {
  author?: string;
  status?: 'draft' | 'active' | 'done' | 'archived';
  tags?: string[];
  deadline?: string;
  responsibleUserId?: string;
}

export type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'todo'
  | 'bulleted_list'
  | 'numbered_list'
  | 'simple_table'
  | 'code'
  | 'link_to_page'
  | 'kanban_embed'
  | 'web_embed'
  | 'file'
  | 'smart_summary'
  | 'responsibility_map'
  | 'collapsible'
  | 'page_properties';

export interface Block {
  id: string;
  pageId: string;
  type: BlockType;
  content: any;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface LinkToPageContent {
  displayText: string;
  targetPageId: string;
}

export interface KanbanEmbedContent {
  projectId: string;
  pageId?: string;
}

export type WebEmbedProvider =
  | 'youtube'
  | 'figma'
  | 'miro'
  | 'google_calendar'
  | 'map'
  | 'generic';

export interface LinkPreviewData {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

export interface WebEmbedContent {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  provider?: WebEmbedProvider;
  embedUrl?: string;
  mode?: 'auto' | 'preview' | 'embed';
  height?: number;
}

export type ProjectFileCategory = 'image' | 'document' | 'audio';

export interface ProjectFileRecord {
  id: string;
  projectId: string;
  uploaderUserId: string;
  fileName: string;
  mimeType: string;
  category: ProjectFileCategory;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileBlockContent {
  fileId: string;
  fileName: string;
  mimeType: string;
  category: ProjectFileCategory;
  size: number;
  caption?: string;
}

export interface MentionEntity {
  id: string;
  userId: string;
  displayName: string;
}

export interface Template {
  id: string;
  title: string;
  icon: string;
  description?: string;
  order?: number;
  projectId?: string;
  nodeType?: PageNodeType;
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
  blocks: Array<{
    type: BlockType;
    content: any;
  }>;
}

export interface DailyNote {
  id: string;
  date: string;
  pageId: string;
}

export type ReminderSourceType = 'manual' | 'kanban' | 'mention' | 'table' | 'page' | 'bot';
export type ReminderScheduleType = 'once' | 'recurring';
export type ReminderStatus = 'active' | 'paused' | 'done' | 'cancelled';

export interface ReminderRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
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
  scheduleType: ReminderScheduleType;
  remindAt?: string;
  recurrence?: ReminderRecurrence;
  status: ReminderStatus;
  channels: {
    app: boolean;
    telegramBot: boolean;
  };
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
  nextRunAt?: string;
}

export type CalendarEventType = 'meeting' | 'service' | 'deadline' | 'duty' | 'event' | 'birthday' | 'custom';
export type CalendarType = 'PERSONAL' | 'PROJECT';
export type CalendarEventVisibility = 'project' | 'selected' | 'private';

export interface CalendarPermissions {
  create: boolean;
  editOwn: boolean;
  editAll: boolean;
  deleteOwn: boolean;
  deleteAll: boolean;
  manage?: boolean;
}

export interface Calendar {
  id: string;
  type: CalendarType;
  name: string;
  color: string;
  ownerUserId?: string;
  projectId?: string;
  sourceType?: 'local' | 'external';
  connectionId?: string;
  readOnly?: boolean;
  categories?: CalendarCategory[];
  permissions?: CalendarPermissions;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarCategory {
  id: string;
  label: string;
  color: string;
  type?: CalendarEventType;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarEventNotification {
  enabled: boolean;
  remindAt?: string;
  deliveryStatus?: 'pending' | 'retry' | 'sent' | 'failed' | 'disabled' | 'missed';
  deliveryAttempts?: number;
  sentAt?: string;
  nextAttemptAt?: string;
  deliveryCompletedAt?: string;
  deliveryError?: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  projectId?: string;
  ownerUserId: string;
  createdByUserId: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  type: CalendarEventType;
  color: string;
  categoryId?: string;
  categoryLabel?: string;
  visibility: CalendarEventVisibility;
  participantUserIds: string[];
  location?: string;
  link?: string;
  sourceType?: 'manual' | 'kanban' | 'table' | 'reminder' | 'external';
  sourceId?: string;
  readOnly?: boolean;
  notification: CalendarEventNotification;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalCalendarConnection {
  id: string;
  provider: 'yandex' | 'ical';
  projectId?: string;
  name: string;
  color: string;
  calendarId: string;
  enabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastSyncStatus: 'pending' | 'success' | 'error';
  lastSyncError?: string;
  importedEvents: number;
  createdAt: string;
  updatedAt: string;
}

export type ActivityEventType =
  | 'page_edit'
  | 'page_delete'
  | 'page_rename'
  | 'folder_rename'
  | 'task_create'
  | 'task_update'
  | 'task_move'
  | 'task_assign'
  | 'task_complete'
  | 'task_delete'
  | 'subtask_create'
  | 'subtask_update'
  | 'subtask_complete'
  | 'subtask_delete'
  | 'member_add'
  | 'member_remove'
  | 'ownership_transfer'
  | 'role_change'
  | 'project_leave';

export interface ActivityEvent {
  id: string;
  projectId: number;
  userId: number;
  userName: string;
  type: ActivityEventType;
  title: string;
  details?: string;
  entityType?: 'page' | 'folder' | 'task' | 'subtask' | 'member' | 'project';
  entityId?: string;
  context?: string;
  createdAt: string;
}

// ─── Deadline zone helpers ────────────────────────────────────
export type DeadlineZone = 'red' | 'yellow' | 'green' | 'none';

export function getDeadlineZone(deadlineAt?: string): DeadlineZone {
  if (!deadlineAt) return 'none';
  const diff = new Date(deadlineAt).getTime() - Date.now();
  const hours = diff / (1000 * 60 * 60);
  if (diff < 0) return 'red';          // просрочено
  if (hours <= 12) return 'red';       // < 12 часов
  if (hours <= 48) return 'yellow';    // 12–48 часов
  return 'green';                      // > 48 часов
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  CRITICAL: 'Критический',
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  LOW: '#6B7280',
  MEDIUM: '#F59E0B',
  HIGH: '#EF4444',
  CRITICAL: '#7C3AED',
};

export const TASK_IMPORTANCE_LABEL: Record<TaskImportanceScore, string> = {
  1: 'Низкая',
  2: 'Малая',
  3: 'Обычная',
  4: 'Важная',
  5: 'Критичная',
};

export const DEFAULT_TASK_SIGNIFICANCE_SETTINGS: TaskSignificanceSettings = {
  priorityBonus: {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 1,
    CRITICAL: 2,
  },
  overdueBonus: 1,
  longOverdueBonus: 2,
  longOverdueHours: 72,
  blockingBonus: 2,
  attentionThreshold: 6,
  criticalThreshold: 8,
};

export function normalizeTaskSignificanceSettings(settings?: Partial<TaskSignificanceSettings> | null): TaskSignificanceSettings {
  const priorityBonus = {
    ...DEFAULT_TASK_SIGNIFICANCE_SETTINGS.priorityBonus,
    ...settings?.priorityBonus,
  };
  return {
    priorityBonus: {
      LOW: clampWholeNumber(priorityBonus.LOW, 0, 5, 0),
      MEDIUM: clampWholeNumber(priorityBonus.MEDIUM, 0, 5, 0),
      HIGH: clampWholeNumber(priorityBonus.HIGH, 0, 5, 1),
      CRITICAL: clampWholeNumber(priorityBonus.CRITICAL, 0, 5, 2),
    },
    overdueBonus: clampWholeNumber(settings?.overdueBonus, 0, 5, 1),
    longOverdueBonus: clampWholeNumber(settings?.longOverdueBonus, 0, 5, 2),
    longOverdueHours: clampWholeNumber(settings?.longOverdueHours, 1, 24 * 30, 72),
    blockingBonus: clampWholeNumber(settings?.blockingBonus, 0, 5, 2),
    attentionThreshold: clampWholeNumber(settings?.attentionThreshold, 1, 10, 6),
    criticalThreshold: clampWholeNumber(settings?.criticalThreshold, 1, 10, 8),
  };
}

export function normalizeTaskImportanceScore(value?: number | string | null): TaskImportanceScore {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed))) as TaskImportanceScore;
}

export function calculateTaskSignificanceScore(
  task: Pick<Task, 'priority' | 'deadlineAt' | 'importanceScore' | 'isBlocking'>,
  now = Date.now(),
  settings?: Partial<TaskSignificanceSettings> | null,
) {
  const normalizedSettings = normalizeTaskSignificanceSettings(settings);
  const importance = normalizeTaskImportanceScore(task.importanceScore);
  let overdueBonus = 0;
  if (task.deadlineAt) {
    const overdueHours = (now - new Date(task.deadlineAt).getTime()) / 3600000;
    if (overdueHours > normalizedSettings.longOverdueHours) overdueBonus = normalizedSettings.longOverdueBonus;
    else if (overdueHours > 0) overdueBonus = normalizedSettings.overdueBonus;
  }
  const blockingBonus = task.isBlocking ? normalizedSettings.blockingBonus : 0;
  return Math.max(1, Math.min(10, importance + normalizedSettings.priorityBonus[task.priority] + overdueBonus + blockingBonus));
}

function clampWholeNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function getTaskSignificanceLabel(score: number) {
  if (score >= 9) return 'горит';
  if (score >= 7) return 'критично';
  if (score >= 5) return 'важно';
  if (score >= 3) return 'обычно';
  return 'низко';
}
