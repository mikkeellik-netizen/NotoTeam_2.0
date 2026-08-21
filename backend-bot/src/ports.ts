import type {
  Column,
  NotificationEvent,
  PageBlock,
  PageNode,
  PageNodeInput,
  ParsedTask,
  Project,
  ProjectBotSettings,
  Reminder,
  ReminderInput,
  Task,
  User,
  WorkspaceSpace,
  BotUserPreferences,
  CalendarEvent,
} from "./types.js";

export interface BotOutboxAttachment {
  fileName: string;
  content: string;
  mimeType?: string;
  encoding?: "utf8" | "base64";
}

export interface BotOutboxMessage {
  id: string;
  telegramId: string;
  text: string;
  attachment?: BotOutboxAttachment;
}

export interface WorkspaceRepository {
  findOrCreateTelegramUser(input: {
    telegramId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<User>;

  getUserById(userId: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBotPreferences(userId: string): Promise<BotUserPreferences>;
  updateUserBotPreferences(userId: string, preferences: BotUserPreferences): Promise<BotUserPreferences>;
  listProjects(): Promise<Project[]>;
  getUserProjects(userId: string): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | undefined>;
  createProject(input: { title: string; ownerId: string; description?: string }): Promise<Project>;
  requestJoinByCode(input: { code: string; userId: string; username?: string; displayName?: string }): Promise<unknown>;
  getProjectMembers(projectId: string): Promise<User[]>;
  getProjectColumns(projectId: string): Promise<Column[]>;
  getAssignedActiveTasks(userId: string): Promise<Task[]>;
  getTasksByProject(projectId: string): Promise<Task[]>;
  getProjectCalendarEvents(projectId: string): Promise<CalendarEvent[]>;
  createTask(input: ParsedTask & { projectId: string; pageId?: string; creatorId: string; assigneeId?: string }): Promise<Task>;
  updateProjectBotSettings(projectId: string, settings: ProjectBotSettings): Promise<ProjectBotSettings>;
  getProjectBlocks(projectId: string): Promise<PageBlock[]>;
  getProjectNodes(projectId: string): Promise<PageNode[]>;
  createProjectNode(projectId: string, input: PageNodeInput): Promise<PageNode>;
  getProjectSpace(projectId: string): Promise<WorkspaceSpace>;
  saveProjectSpace(projectId: string, space: WorkspaceSpace): Promise<WorkspaceSpace>;
  createReminder(projectId: string, reminder: ReminderInput): Promise<Reminder>;
  findDueReminders(nowIso: string): Promise<Reminder[]>;
  markReminderSent(reminderId: string): Promise<Reminder>;

  fetchPendingOutbox(): Promise<BotOutboxMessage[]>;
  markOutboxSent(id: string): Promise<void>;

  createNotification(event: Omit<NotificationEvent, "id" | "status">): Promise<NotificationEvent>;
  findPendingNotifications(nowIso: string): Promise<NotificationEvent[]>;
  markNotificationSent(id: string): Promise<void>;
  markNotificationFailed(id: string): Promise<void>;
  hasNotification(entityId: string, type: string, userId: string, sendAt?: string): Promise<boolean>;
}

export interface BotMessenger {
  sendMessage(telegramId: string, text: string, options?: { webAppUrl?: string; attachment?: BotOutboxAttachment }): Promise<void>;
}
