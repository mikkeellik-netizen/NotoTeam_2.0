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
  aiToneStyle: AiTone;
  isArchived: boolean;
  createdAt: string;
  members?: ProjectMember[];
  columns?: Column[];
  pages?: PageNode[];
  _count?: {
    tasks: number;
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
  title: string;
  description?: string;
  priority: Priority;
  deadlineAt?: string;
  colorLabel?: string;
  isRepeating: boolean;
  position: number;
  isArchived: boolean;
  createdAt: string;
  assignee?: User;
  subtasks?: Subtask[];
  tags?: Tag[];
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
  createdAt: string;
  updatedAt: string;
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
  | 'kanban_embed';

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
