// ─── Enums ────────────────────────────────────────────────────
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AiTone = 'FRIENDLY' | 'MINIMAL' | 'BUSINESS' | 'YOUTH' | 'STRICT' | 'PASTORAL';
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
  _count?: {
    tasks: number;
  };
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

// ─── Role & Member ────────────────────────────────────────────
export interface Role {
  id: number;
  projectId: number;
  name: string;
  permissions: RolePermissions;
}

export interface RolePermissions {
  createTask?: boolean;
  deleteTask?: boolean;
  manageColumns?: boolean;
  manageMembers?: boolean;
  viewAnalytics?: boolean;
  manageProject?: boolean;
}

export interface ProjectMember {
  id: number;
  projectId: number;
  userId: number;
  roleId?: number;
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
  colorLabel?: string;
  isRepeating: boolean;
  position: number;
  isArchived: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt?: string;
  assignee?: User;
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
  | 'smart_summary'
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

export type CalendarEventType = 'meeting' | 'service' | 'deadline' | 'duty' | 'event' | 'custom';
export type CalendarEventVisibility = 'project' | 'selected';

export interface CalendarCategory {
  id: string;
  label: string;
  color: string;
  type?: CalendarEventType;
  createdAt?: string;
}

export interface CalendarEvent {
  id: string;
  projectId: string;
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
  sourceType?: 'manual' | 'kanban' | 'table' | 'reminder';
  sourceId?: string;
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
