import type { BotOutboxMessage, WorkspaceRepository } from "../ports.js";
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
} from "../types.js";

interface ProjectSpaceMeta {
  collapsedIds: string[];
  recentPages: string[];
  dailyNotes: Record<string, string>;
}

export class HttpWorkspaceRepository implements WorkspaceRepository {
  constructor(private baseUrl: string, private internalApiToken: string = "") {}

  fetchPendingOutbox() {
    return this.request<BotOutboxMessage[]>("/outbox/pending");
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
    return this.requestAllPages<Task>(`/users/${encodeURIComponent(userId)}/assigned-tasks`, "tasks");
  }

  getTasksByProject(projectId: string) {
    return this.requestAllPages<Task>(
      `/projects/${encodeURIComponent(projectId)}/tasks?allBoards=1&includeArchived=1`,
      "tasks",
    );
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
    return this.requestAllPages<PageBlock>(`/projects/${encodeURIComponent(projectId)}/blocks`, "blocks");
  }

  async getProjectNodes(projectId: string) {
    return this.fetchProjectNodes(projectId);
  }

  createProjectNode(projectId: string, input: PageNodeInput) {
    return this.request<PageNode>(`/projects/${encodeURIComponent(projectId)}/space/nodes`, {
      method: "POST",
      body: {
        ...input,
        actorUserId: input.actorUserId ?? input.properties?.author,
      },
    });
  }

  async getProjectSpace(projectId: string) {
    const encodedProjectId = encodeURIComponent(projectId);
    const [meta, nodes, blocks] = await Promise.all([
      this.request<ProjectSpaceMeta>(`/projects/${encodedProjectId}/space/meta`),
      this.fetchProjectNodes(projectId, { includeDeleted: true }),
      this.getProjectBlocks(projectId),
    ]);

    return {
      nodes,
      blocks: blocks.map(stripProjectId),
      collapsedIds: meta.collapsedIds ?? [],
      recentPages: meta.recentPages ?? [],
      dailyNotes: meta.dailyNotes ?? {},
    };
  }

  async saveProjectSpace(projectId: string, space: WorkspaceSpace) {
    const encodedProjectId = encodeURIComponent(projectId);
    await this.request<ProjectSpaceMeta>(`/projects/${encodedProjectId}/space/meta`, {
      method: "PATCH",
      body: {
        collapsedIds: space.collapsedIds ?? [],
        recentPages: space.recentPages ?? [],
        dailyNotes: space.dailyNotes ?? {},
      },
    });

    await this.syncNodes(projectId, space.nodes ?? []);
    await this.syncBlocks(projectId, space.blocks ?? []);
    return this.getProjectSpace(projectId);
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
    return this.requestAllPages<NotificationEvent>(
      `/notifications/pending?before=${encodeURIComponent(nowIso)}`,
      "notifications",
    );
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

  private async requestAllPages<T>(path: string, key: string, pageSize = 500): Promise<T[]> {
    const items: T[] = [];
    let offset = 0;

    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const page = await this.request<T[] | Record<string, unknown>>(
        `${path}${separator}paginated=1&offset=${offset}&limit=${pageSize}`,
      );

      if (Array.isArray(page)) {
        return offset === 0 ? page : items.concat(page);
      }

      const chunk = Array.isArray(page[key]) ? (page[key] as T[]) : [];
      items.push(...chunk);

      if (!page.hasMore || chunk.length === 0) return items;
      offset += typeof page.limit === "number" && page.limit > 0 ? page.limit : chunk.length;
    }
  }

  private async fetchProjectNodes(projectId: string, options: { includeDeleted?: boolean } = {}) {
    const encodedProjectId = encodeURIComponent(projectId);
    const query = options.includeDeleted ? "?includeDeleted=1" : "";
    const response = await this.request<{ nodes: PageNode[] }>(`/projects/${encodedProjectId}/space/nodes${query}`);
    return response.nodes;
  }

  private async syncNodes(projectId: string, nodes: PageNode[]) {
    const current = await this.fetchProjectNodes(projectId, { includeDeleted: true });
    const currentById = new Map(current.map((node) => [node.id, node]));
    const orderedNodes = [...nodes].sort((a, b) => nodeDepth(nodes, a) - nodeDepth(nodes, b));

    for (const node of orderedNodes) {
      const existing = currentById.get(node.id);
      if (!existing) {
        await this.createProjectNode(projectId, {
          id: node.id,
          parentId: node.parentId ?? null,
          type: node.type,
          title: node.title,
          icon: node.icon,
          order: node.order,
        });
        continue;
      }

      if (existing.isDeleted && !node.isDeleted) {
        await this.request(`/projects/${encodeURIComponent(projectId)}/space/nodes/${encodeURIComponent(node.id)}/restore`, {
          method: "POST",
        });
      } else if (!existing.isDeleted && node.isDeleted) {
        await this.request(`/projects/${encodeURIComponent(projectId)}/space/nodes/${encodeURIComponent(node.id)}/trash`, {
          method: "POST",
        });
        continue;
      }

      if (nodeNeedsPatch(existing, node)) {
        await this.request<PageNode>(`/projects/${encodeURIComponent(projectId)}/space/nodes/${encodeURIComponent(node.id)}`, {
          method: "PATCH",
          body: {
            title: node.title,
            icon: node.icon,
            isPinned: Boolean(node.isPinned),
            pinnedOrder: node.pinnedOrder,
          },
        });
      }

      if ((existing.parentId ?? null) !== (node.parentId ?? null) || Number(existing.order) !== Number(node.order)) {
        await this.request<PageNode>(`/projects/${encodeURIComponent(projectId)}/space/nodes/${encodeURIComponent(node.id)}/move`, {
          method: "POST",
          body: {
            parentId: node.parentId ?? null,
            order: node.order,
          },
        });
      }
    }
  }

  private async syncBlocks(projectId: string, blocks: Array<Omit<PageBlock, "projectId">>) {
    const currentBlocks = await this.getProjectBlocks(projectId);
    const currentById = new Map(currentBlocks.map((block) => [block.id, block]));

    for (const block of blocks) {
      const existing = currentById.get(block.id);
      if (!existing) {
        await this.request<PageBlock>(
          `/projects/${encodeURIComponent(projectId)}/space/pages/${encodeURIComponent(block.pageId)}/blocks`,
          {
            method: "POST",
            body: {
              id: block.id,
              type: block.type,
              content: block.content,
              order: block.order,
            },
          },
        );
        continue;
      }

      if (blockNeedsPatch(existing, block)) {
        await this.request<PageBlock>(`/projects/${encodeURIComponent(projectId)}/space/blocks/${encodeURIComponent(block.id)}`, {
          method: "PATCH",
          body: {
            type: block.type,
            content: block.content,
          },
        });
      }

      if (Number(existing.order ?? 0) !== Number(block.order ?? 0)) {
        await this.request<PageBlock>(
          `/projects/${encodeURIComponent(projectId)}/space/blocks/${encodeURIComponent(block.id)}/move`,
          {
            method: "POST",
            body: { order: block.order ?? 0 },
          },
        );
      }
    }
  }
}

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function stripProjectId(block: PageBlock): Omit<PageBlock, "projectId"> {
  const { projectId: _projectId, ...rest } = block;
  return rest;
}

function nodeDepth(nodes: PageNode[], node: PageNode) {
  let depth = 0;
  let parentId = node.parentId ?? null;
  const byId = new Map(nodes.map((item) => [item.id, item]));
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId ?? null;
  }
  return depth;
}

function nodeNeedsPatch(current: PageNode, next: PageNode) {
  return (
    current.title !== next.title ||
    current.icon !== next.icon ||
    Boolean(current.isPinned) !== Boolean(next.isPinned) ||
    current.pinnedOrder !== next.pinnedOrder
  );
}

function blockNeedsPatch(current: PageBlock, next: Omit<PageBlock, "projectId">) {
  return current.type !== next.type || JSON.stringify(current.content ?? null) !== JSON.stringify(next.content ?? null);
}
