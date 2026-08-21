import { defaultBotSettings } from "../defaultSettings.js";
import type { WorkspaceRepository } from "../ports.js";
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
  CalendarEvent,
} from "../types.js";

const now = () => new Date().toISOString();

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private users: User[] = [
    { id: "1", telegramId: "local-dev", username: "local_user", firstName: "Local", lastName: "User" },
  ];

  private projects: Project[] = [
    {
      id: "1",
      title: "Командный проект",
      ownerId: "1",
      members: [{ userId: "1", role: "owner" }],
      botSettings: defaultBotSettings,
    },
  ];

  private columns: Column[] = [
    { id: "1", projectId: "1", title: "Идея", position: 0 },
    { id: "2", projectId: "1", title: "В работе", position: 1 },
    { id: "3", projectId: "1", title: "Готово", position: 2 },
  ];

  private tasks: Task[] = [];
  private blocks: PageBlock[] = [];
  private notifications: NotificationEvent[] = [];
  private reminders: Reminder[] = [];
  private calendarEvents: CalendarEvent[] = [];
  private spaces = new Map<string, WorkspaceSpace>();

  async findOrCreateTelegramUser(input: {
    telegramId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }) {
    const existing = this.users.find((user) => user.telegramId === input.telegramId);
    if (existing) return existing;

    const user: User = {
      id: String(this.users.length + 1),
      telegramId: input.telegramId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
    };
    this.users.push(user);
    return user;
  }

  async getUserById(userId: string) {
    return this.users.find((user) => user.id === userId);
  }

  async getUserByUsername(username: string) {
    const normalized = username.replace(/^@/, "").toLowerCase();
    return this.users.find((user) => user.username?.toLowerCase() === normalized);
  }

  async getUserBotPreferences(userId: string) {
    return this.users.find((user) => user.id === userId)?.botPreferences ?? {};
  }

  async updateUserBotPreferences(userId: string, preferences: { defaultProjectId?: string; defaultBoardPageId?: string }) {
    const user = this.users.find((item) => item.id === userId);
    if (!user) return preferences;
    user.botPreferences = { ...(user.botPreferences ?? {}), ...preferences };
    return user.botPreferences;
  }

  async listProjects() {
    return this.projects;
  }

  async getUserProjects(userId: string) {
    return this.projects.filter((project) => project.members.some((member) => member.userId === userId));
  }

  async getProject(projectId: string) {
    return this.projects.find((project) => project.id === projectId);
  }

  async createProject(input: { title: string; ownerId: string; description?: string }) {
    const project: Project = {
      id: String(this.projects.length + 1),
      title: input.title,
      ownerId: input.ownerId,
      members: [{ userId: input.ownerId, role: "owner" }],
      botSettings: defaultBotSettings,
    };
    this.projects.push(project);
    const firstColumnId = String(this.columns.length + 1);
    this.columns.push(
      { id: firstColumnId, projectId: project.id, title: "Идея", position: 0 },
      { id: String(Number(firstColumnId) + 1), projectId: project.id, title: "В работе", position: 1 },
      { id: String(Number(firstColumnId) + 2), projectId: project.id, title: "Готово", position: 2 },
    );
    return project;
  }

  async requestJoinByCode() {
    return { success: true };
  }

  async getProjectMembers(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) return [];
    return project.members
      .map((member) => this.users.find((user) => user.id === member.userId))
      .filter(Boolean) as User[];
  }

  async getProjectColumns(projectId: string) {
    return this.columns.filter((column) => column.projectId === projectId && !column.isHidden);
  }

  async getAssignedActiveTasks(userId: string) {
    return this.tasks.filter((task) => task.assigneeId === userId && !task.isArchived);
  }

  async getTasksByProject(projectId: string) {
    return this.tasks.filter((task) => task.projectId === projectId);
  }

  async getProjectCalendarEvents(projectId: string) {
    return this.calendarEvents.filter((event) => event.projectId === projectId);
  }

  async createTask(input: ParsedTask & { projectId: string; pageId?: string; creatorId: string; assigneeId?: string }) {
    const firstColumn = this.columns
      .filter((column) => column.projectId === input.projectId)
      .sort((a, b) => a.position - b.position)[0];

    const task: Task = {
      id: String(this.tasks.length + 1),
      projectId: input.projectId,
      pageId: input.pageId,
      columnId: firstColumn?.id ?? "1",
      creatorId: input.creatorId,
      assigneeId: input.assigneeId,
      title: input.title,
      description: input.description,
      deadlineAt: input.deadlineAt,
      priority: input.priority,
      isArchived: false,
      createdAt: now(),
      updatedAt: now(),
      subtasks: [],
    };

    this.tasks.push(task);
    return task;
  }

  async updateProjectBotSettings(projectId: string, settings: ProjectBotSettings) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error("Project not found");
    project.botSettings = settings;
    return settings;
  }

  async getProjectBlocks(projectId: string) {
    return this.blocks.filter((block) => block.projectId === projectId);
  }

  async getProjectNodes(projectId: string) {
    const space = await this.getProjectSpace(projectId);
    return space.nodes.filter((node) => node.projectId === projectId && !node.isDeleted);
  }

  async createProjectNode(projectId: string, input: PageNodeInput) {
    const space = await this.getProjectSpace(projectId);
    const createdAt = now();
    const siblings = space.nodes.filter((node) => (node.parentId ?? null) === (input.parentId ?? null));
    const node: PageNode = {
      id: input.id ?? `${input.type}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      projectId,
      parentId: input.parentId ?? null,
      type: input.type,
      title: input.title ?? (input.type === "folder" ? "Новая папка" : input.type === "kanban" ? "Kanban-доска" : "Новая страница"),
      icon: input.icon ?? (input.type === "folder" ? "📁" : input.type === "kanban" ? "📋" : "📝"),
      order: input.order ?? siblings.length,
      properties: input.properties,
      createdAt,
      updatedAt: createdAt,
    };
    space.nodes.push(node);

    if (node.type === "page") {
      for (const [index, block] of (input.initialBlocks ?? []).entries()) {
        const pageBlock: Omit<PageBlock, "projectId"> = {
          id: block.id ?? `block_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          pageId: node.id,
          type: block.type,
          content: block.content ?? {},
          order: block.order ?? index,
          createdAt,
          updatedAt: createdAt,
        };
        space.blocks.push(pageBlock);
        this.blocks.push({ ...pageBlock, projectId });
      }
    }

    return node;
  }

  async getProjectSpace(projectId: string) {
    const existing = this.spaces.get(projectId);
    if (existing) return existing;
    const createdAt = now();
    const space: WorkspaceSpace = {
      nodes: [
        {
          id: `page_${Date.now()}_inbox`,
          projectId,
          parentId: null,
          type: "page",
          title: "Inbox",
          icon: "📥",
          order: 0,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      blocks: [],
      collapsedIds: [],
      recentPages: [],
      dailyNotes: {},
    };
    this.spaces.set(projectId, space);
    return space;
  }

  async saveProjectSpace(projectId: string, space: WorkspaceSpace) {
    this.spaces.set(projectId, space);
    this.blocks = space.blocks.map((block) => ({
      ...block,
      projectId,
    }));
    return space;
  }

  async createReminder(projectId: string, input: ReminderInput) {
    const reminder: Reminder = {
      id: `reminder_${this.reminders.length + 1}`,
      projectId,
      creatorUserId: input.creatorUserId ?? input.targetUserId,
      targetUserId: input.targetUserId,
      sourceType: input.sourceType ?? "bot",
      sourceId: input.sourceId,
      title: input.title,
      description: input.description,
      scheduleType: input.scheduleType,
      remindAt: input.remindAt,
      recurrence: input.recurrence,
      status: "active",
      channels: {
        app: input.channels?.app !== false,
        telegramBot: input.channels?.telegramBot !== false,
      },
      createdAt: now(),
      updatedAt: now(),
      nextRunAt: input.remindAt,
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async findDueReminders(nowIso: string) {
    const time = new Date(nowIso).getTime();
    return this.reminders.filter(
      (reminder) =>
        reminder.status === "active" &&
        reminder.nextRunAt &&
        new Date(reminder.nextRunAt).getTime() <= time,
    );
  }

  async markReminderSent(reminderId: string) {
    const reminder = this.reminders.find((item) => item.id === reminderId);
    if (!reminder) throw new Error("Reminder not found");
    reminder.lastSentAt = now();
    reminder.updatedAt = now();
    if (reminder.scheduleType === "once") {
      reminder.status = "done";
      reminder.nextRunAt = undefined;
    }
    return reminder;
  }

  async fetchPendingOutbox() {
    return [];
  }

  async markOutboxSent(_id: string) {
    // нет хранилища в памяти
  }

  async createNotification(event: Omit<NotificationEvent, "id" | "status">) {
    const notification: NotificationEvent = {
      ...event,
      id: String(this.notifications.length + 1),
      status: "pending",
    };
    this.notifications.push(notification);
    return notification;
  }

  async findPendingNotifications(nowIso: string) {
    const time = new Date(nowIso).getTime();
    return this.notifications.filter(
      (notification) => notification.status === "pending" && new Date(notification.sendAt).getTime() <= time,
    );
  }

  async markNotificationSent(id: string) {
    const notification = this.notifications.find((item) => item.id === id);
    if (notification) {
      notification.status = "sent";
      notification.sentAt = now();
    }
  }

  async markNotificationFailed(id: string) {
    const notification = this.notifications.find((item) => item.id === id);
    if (notification) notification.status = "failed";
  }

  async hasNotification(entityId: string, type: string, userId: string, sendAt?: string) {
    return this.notifications.some(
      (item) =>
        item.entityId === entityId &&
        item.type === type &&
        item.userId === userId &&
        (!sendAt || item.sendAt === sendAt),
    );
  }
}
