import type { WorkspaceRepository } from "../ports.js";
import type {
  Column,
  NotificationEvent,
  PageBlock,
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
} from "../types.js";

export class HttpWorkspaceRepository implements WorkspaceRepository {
  constructor(private baseUrl: string, private internalApiToken: string = "") {}

  fetchPendingOutbox() {
    return this.request<Array<{ id: string; telegramId: string; text: string }>>("/outbox/pending");
  }

  async markOutboxSent(id: string) {
    await this.request(`/outbox/${encodeURIComponent(id)}/sent`, { method: "POST" });
  }

  findOrCreateTelegramUser(input: {
    telegramId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }) {
    return this.request<User>("/telegram/users", { method: "POST", body: input });
  }

  async getUserById(userId: string) {
    return nullToUndefined(await this.request<User | null>(`/users/${encodeURIComponent(userId)}`));
  }

  async getUserByUsername(username: string) {
    return nullToUndefined(
      await this.request<User | null>(`/users/by-username/${encodeURIComponent(username.replace(/^@/, ""))}`),
    );
  }

  getUserBotPreferences(userId: string) {
    return this.request<BotUserPreferences>(`/users/${encodeURIComponent(userId)}/bot-preferences`);
  }

  updateUserBotPreferences(userId: string, preferences: BotUserPreferences) {
    return this.request<BotUserPreferences>(`/users/${encodeURIComponent(userId)}/bot-preferences`, {
      method: "PATCH",
      body: preferences,
    });
  }

  listProjects() {
    return this.request<Project[]>("/projects");
  }

  getUserProjects(userId: string) {
    return this.request<Project[]>(`/users/${encodeURIComponent(userId)}/projects`);
  }

  async getProject(projectId: string) {
    return nullToUndefined(await this.request<Project | null>(`/projects/${encodeURIComponent(projectId)}`));
  }

  createProject(input: { title: string; ownerId: string; description?: string }) {
    return this.request<Project>("/projects", { method: "POST", body: input });
  }

  requestJoinByCode(input: { code: string; userId: string; username?: string; displayName?: string }) {
    return this.request("/join-requests", { method: "POST", body: input });
  }

  getProjectMembers(projectId: string) {
    return this.request<User[]>(`/projects/${encodeURIComponent(projectId)}/members`);
  }

  getProjectColumns(projectId: string) {
    return this.request<Column[]>(`/projects/${encodeURIComponent(projectId)}/columns`);
  }

  getAssignedActiveTasks(userId: string) {
    return this.request<Task[]>(`/users/${encodeURIComponent(userId)}/assigned-tasks`);
  }

  getTasksByProject(projectId: string) {
    return this.request<Task[]>(`/projects/${encodeURIComponent(projectId)}/tasks?allBoards=1&includeArchived=1`);
  }

  getProjectCalendarEvents(projectId: string) {
    return this.request<CalendarEvent[]>(`/projects/${encodeURIComponent(projectId)}/calendar-events`);
  }

  createTask(input: ParsedTask & { projectId: string; pageId?: string; creatorId: string; assigneeId?: string }) {
    return this.request<Task>("/tasks", { method: "POST", body: input });
  }

  updateProjectBotSettings(projectId: string, settings: ProjectBotSettings) {
    return this.request<ProjectBotSettings>(`/projects/${encodeURIComponent(projectId)}/bot-settings`, {
      method: "PATCH",
      body: settings,
    });
  }

  getProjectBlocks(projectId: string) {
    return this.request<PageBlock[]>(`/projects/${encodeURIComponent(projectId)}/blocks`);
  }

  getProjectSpace(projectId: string) {
    return this.request<WorkspaceSpace>(`/projects/${encodeURIComponent(projectId)}/space`);
  }

  saveProjectSpace(projectId: string, space: WorkspaceSpace) {
    return this.request<WorkspaceSpace>(`/projects/${encodeURIComponent(projectId)}/space`, {
      method: "PUT",
      body: space,
    });
  }

  createReminder(projectId: string, reminder: ReminderInput) {
    return this.request<Reminder>(`/projects/${encodeURIComponent(projectId)}/reminders`, {
      method: "POST",
      body: reminder,
    });
  }

  findDueReminders(nowIso: string) {
    return this.request<Reminder[]>(`/reminders/due?before=${encodeURIComponent(nowIso)}`);
  }

  markReminderSent(reminderId: string) {
    return this.request<Reminder>(`/reminders/${encodeURIComponent(reminderId)}/sent`, { method: "POST" });
  }

  createNotification(event: Omit<NotificationEvent, "id" | "status">) {
    return this.request<NotificationEvent>("/notifications", { method: "POST", body: event });
  }

  findPendingNotifications(nowIso: string) {
    return this.request<NotificationEvent[]>(`/notifications/pending?before=${encodeURIComponent(nowIso)}`);
  }

  async markNotificationSent(id: string) {
    await this.request(`/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { status: "sent", sentAt: new Date().toISOString() },
    });
  }

  async markNotificationFailed(id: string) {
    await this.request(`/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { status: "failed" },
    });
  }

  async hasNotification(entityId: string, type: string, userId: string, sendAt?: string) {
    const params = new URLSearchParams({ entityId, type, userId });
    if (sendAt) params.set("sendAt", sendAt);
    const response = await this.request<{ exists: boolean }>(`/notifications/exists?${params.toString()}`);
    return response.exists;
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body) headers["Content-Type"] = "application/json";
    if (this.internalApiToken) headers["Authorization"] = `Bot ${this.internalApiToken}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Workspace API ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  }
}

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}
