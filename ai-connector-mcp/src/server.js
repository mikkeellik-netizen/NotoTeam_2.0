#!/usr/bin/env node

const API_URL = normalizeApiUrl(process.env.AI_CONNECTOR_API_URL);
const AUTH_TOKEN = process.env.AI_CONNECTOR_AUTH_TOKEN || "";
const AUTH_HEADER = process.env.AI_CONNECTOR_AUTH_HEADER || (AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : "");
const PROJECT_ID = process.env.AI_CONNECTOR_PROJECT_ID || "";
const REQUEST_TIMEOUT_MS = envPositiveNumber("AI_CONNECTOR_REQUEST_TIMEOUT_MS", 15000);
const AI_TOKEN_PREFIX = "noto_ai_";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const tools = [
  {
    name: "list_projects",
    description: "List projects available to the authenticated Noto user.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_project_context",
    description: "Read a sanitized AI context snapshot for a Noto project.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        scope: { type: "string", enum: ["summary", "full"], default: "summary" },
        includeTasks: { type: "boolean", default: true },
        includeWorkspace: { type: "boolean", default: true },
        includeCalendar: { type: "boolean", default: true },
        includeReminders: { type: "boolean", default: true },
        includeInbox: { type: "boolean", default: true },
        includeResponsibility: { type: "boolean", default: true },
        includeActivity: { type: "boolean", default: true },
        includeBlocks: { type: "boolean", default: false },
        includeArchived: { type: "boolean", default: false },
        maxTasks: { type: "number", minimum: 1, maximum: 2000, default: 300 },
        maxBlocks: { type: "number", minimum: 1, maximum: 2000, default: 300 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_project_changes",
    description: "Read only project changes since an ISO date/time. Use after the initial full project analysis.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        since: { type: "string", description: "ISO date/time of the previous review." },
        includeCalendar: { type: "boolean", default: true },
        includeReminders: { type: "boolean", default: true },
        includeInbox: { type: "boolean", default: true },
        includeBlocks: { type: "boolean", default: false },
        includeArchived: { type: "boolean", default: false },
        maxTasks: { type: "number", minimum: 1, maximum: 2000, default: 300 },
        maxBlocks: { type: "number", minimum: 1, maximum: 2000, default: 300 },
      },
      required: ["since"],
      additionalProperties: false,
    },
  },
  {
    name: "get_project_summary",
    description: "Read a compact project summary, members, counters and context limits.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_project_tasks",
    description: "List project tasks without loading workspace page blocks.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        state: { type: "string", enum: ["all", "active", "completed", "deferred", "overdue"], default: "all" },
        assigneeId: { type: ["string", "number"], description: "Optional assignee user id filter." },
        search: { type: "string", description: "Optional case-insensitive search in task title, description and tags." },
        includeArchived: { type: "boolean", default: false },
        maxTasks: { type: "number", minimum: 1, maximum: 2000, default: 300 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_project_calendar",
    description: "List calendar events for a project. Kanban task deadlines are not included.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        from: { type: "string", description: "Optional ISO date/time lower bound." },
        to: { type: "string", description: "Optional ISO date/time upper bound." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_project_reminders",
    description: "List project reminders available to the AI token.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        from: { type: "string", description: "Optional ISO date/time lower bound." },
        to: { type: "string", description: "Optional ISO date/time upper bound." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_project_inbox",
    description: "List project Inbox notes, ideas and quick tasks with their text blocks.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_project_workspace",
    description: "List workspace folders, pages, kanban boards and optionally page blocks.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        parentId: { type: ["string", "number", "null"], description: "Optional parent node id filter. Use null for root nodes." },
        includeBlocks: { type: "boolean", default: false },
        maxBlocks: { type: "number", minimum: 1, maximum: 2000, default: 300 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "search_project_context",
    description: "Search tasks, calendar events, reminders, Inbox items, workspace nodes and loaded page blocks.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: ["string", "number"], description: "Project id. Defaults to AI_CONNECTOR_PROJECT_ID." },
        query: { type: "string", minLength: 1 },
        includeBlocks: { type: "boolean", default: false },
        includeArchived: { type: "boolean", default: false },
        maxResults: { type: "number", minimum: 1, maximum: 100, default: 30 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

let inputBuffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  let newlineIndex = inputBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = inputBuffer.slice(0, newlineIndex).trim();
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (line) void handleLine(line);
    newlineIndex = inputBuffer.indexOf("\n");
  }
});

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    respondError(null, -32700, "Parse error", error.message);
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    return;
  }

  try {
    const result = await handleRequest(message);
    respond(message.id, result);
  } catch (error) {
    respondError(message.id, -32000, error.message || "Internal error");
  }
}

async function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "noto-ai-connector",
          version: "0.2.0",
        },
        instructions: "Read-only access to one Noto project. Use summary tools first and request page blocks only when the user needs their contents. This connector cannot modify project data.",
      };
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(message.params?.name, message.params?.arguments ?? {});
    default:
      throw new Error(`Unsupported method: ${message.method}`);
  }
}

async function callTool(name, args) {
  if (name === "list_projects") {
    if (usesProjectScopedToken()) {
      return jsonToolResult({
        note: "Project-scoped AI token can read only one project. Set AI_CONNECTOR_PROJECT_ID and call get_project_context.",
        projects: PROJECT_ID ? [{ id: PROJECT_ID, title: "Project-scoped AI Connector", role: "ai_readonly" }] : [],
      });
    }
    const user = await apiFetch("/auth/me");
    const projects = await apiFetch(`/users/${encodeURIComponent(String(user.id))}/projects`);
    return jsonToolResult({
      user: compactUser(user),
      projects: projects.map((project) => ({
        id: project.id,
        title: project.title,
        description: project.description,
        ownerId: project.ownerId,
        role: project.members?.find((member) => String(member.userId) === String(user.id))?.role?.name,
        tasksCount: project._count?.tasks ?? 0,
      })),
    });
  }

  if (name === "get_project_context") {
    const projectId = args.projectId || PROJECT_ID;
    if (!projectId) throw new Error("projectId is required or AI_CONNECTOR_PROJECT_ID must be set");
    const context = await fetchProjectContext(projectId, args, name);
    return jsonToolResult(context);
  }

  if (name === "get_project_changes") {
    const projectId = requireProjectId(args);
    const changes = await fetchProjectChanges(projectId, args, name);
    return jsonToolResult(changes);
  }

  if (name === "get_project_summary") {
    const projectId = requireProjectId(args);
    const context = await fetchProjectContext(projectId, {
      scope: "summary",
      includeTasks: true,
      includeWorkspace: true,
      includeCalendar: true,
      includeReminders: true,
      includeInbox: true,
      includeResponsibility: true,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: false,
      maxTasks: 1,
      maxBlocks: 1,
    }, name);
    return jsonToolResult({
      kind: context.kind,
      version: context.version,
      generatedAt: context.generatedAt,
      scope: context.scope,
      project: context.project,
      members: context.members,
      summary: context.summary,
      limits: context.limits,
    });
  }

  if (name === "list_project_tasks") {
    const projectId = requireProjectId(args);
    const context = await fetchProjectContext(projectId, {
      scope: "summary",
      includeTasks: true,
      includeWorkspace: false,
      includeCalendar: false,
      includeReminders: false,
      includeInbox: false,
      includeResponsibility: false,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: Boolean(args.includeArchived),
      maxTasks: boundedNumber(args.maxTasks, 300, 1, 2000),
      maxBlocks: 1,
    }, name);
    const tasks = filterTasks(context.tasks ?? [], args);
    return jsonToolResult({
      project: context.project,
      generatedAt: context.generatedAt,
      summary: context.summary,
      columns: context.columns ?? [],
      filters: {
        state: args.state || "all",
        assigneeId: args.assigneeId,
        search: args.search,
        includeArchived: Boolean(args.includeArchived),
      },
      tasks,
      limits: context.limits,
    });
  }

  if (name === "list_project_calendar") {
    const projectId = requireProjectId(args);
    const context = await fetchProjectContext(projectId, {
      scope: "summary",
      includeTasks: false,
      includeWorkspace: false,
      includeCalendar: true,
      includeReminders: false,
      includeInbox: false,
      includeResponsibility: false,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: false,
      maxTasks: 1,
      maxBlocks: 1,
    }, name);
    return jsonToolResult({
      project: context.project,
      generatedAt: context.generatedAt,
      calendarEvents: filterByDateRange(context.calendarEvents ?? [], args.from, args.to),
      limits: context.limits,
    });
  }

  if (name === "list_project_reminders") {
    const projectId = requireProjectId(args);
    const context = await fetchProjectContext(projectId, {
      scope: "summary",
      includeTasks: false,
      includeWorkspace: false,
      includeCalendar: false,
      includeReminders: true,
      includeInbox: false,
      includeResponsibility: false,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: false,
      maxTasks: 1,
      maxBlocks: 1,
    }, name);
    return jsonToolResult({
      project: context.project,
      generatedAt: context.generatedAt,
      reminders: filterByDateRange(context.reminders ?? [], args.from, args.to),
      limits: context.limits,
    });
  }

  if (name === "list_project_inbox") {
    const projectId = requireProjectId(args);
    const context = await fetchProjectContext(projectId, {
      scope: "full",
      includeTasks: false,
      includeWorkspace: false,
      includeCalendar: false,
      includeReminders: false,
      includeInbox: true,
      includeResponsibility: false,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: false,
      maxTasks: 1,
      maxBlocks: 1,
    }, name);
    return jsonToolResult({
      project: context.project,
      generatedAt: context.generatedAt,
      inboxItems: context.inboxItems ?? [],
      limits: context.limits,
    });
  }

  if (name === "list_project_workspace") {
    const projectId = requireProjectId(args);
    const context = await fetchProjectContext(projectId, {
      scope: args.includeBlocks ? "full" : "summary",
      includeTasks: false,
      includeWorkspace: true,
      includeCalendar: false,
      includeReminders: false,
      includeInbox: false,
      includeResponsibility: false,
      includeActivity: false,
      includeBlocks: Boolean(args.includeBlocks),
      includeArchived: false,
      maxTasks: 1,
      maxBlocks: boundedNumber(args.maxBlocks, 300, 1, 2000),
    }, name);
    return jsonToolResult({
      project: context.project,
      generatedAt: context.generatedAt,
      parentId: args.parentId ?? undefined,
      nodes: filterWorkspaceNodes(context.workspace?.nodes ?? [], args.parentId),
      blocks: context.workspace?.blocks ?? [],
      files: context.workspace?.files ?? [],
      limits: context.limits,
    });
  }

  if (name === "search_project_context") {
    const projectId = requireProjectId(args);
    const maxResults = boundedNumber(args.maxResults, 30, 1, 100);
    const context = await fetchProjectContext(projectId, {
      scope: args.includeBlocks ? "full" : "summary",
      includeTasks: true,
      includeWorkspace: true,
      includeCalendar: true,
      includeReminders: true,
      includeInbox: true,
      includeResponsibility: true,
      includeActivity: false,
      includeBlocks: Boolean(args.includeBlocks),
      includeArchived: Boolean(args.includeArchived),
      maxTasks: 1000,
      maxBlocks: args.includeBlocks ? 1000 : 1,
    }, name);
    return jsonToolResult({
      project: context.project,
      generatedAt: context.generatedAt,
      query: String(args.query ?? ""),
      results: searchContext(context, args.query, maxResults),
      limits: context.limits,
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function setBooleanQuery(query, key, value, defaultValue) {
  if (value === undefined || value === defaultValue) return;
  query.set(key, value ? "1" : "0");
}

function requireProjectId(args = {}) {
  const projectId = args.projectId || PROJECT_ID;
  if (!projectId) throw new Error("projectId is required or AI_CONNECTOR_PROJECT_ID must be set");
  return projectId;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function fetchProjectContext(projectId, args = {}, toolName = "") {
  const query = new URLSearchParams();
  query.set("scope", args.scope === "full" ? "full" : "summary");
  if (toolName) query.set("tool", toolName);
  setBooleanQuery(query, "includeTasks", args.includeTasks, true);
  setBooleanQuery(query, "includeWorkspace", args.includeWorkspace, true);
  setBooleanQuery(query, "includeCalendar", args.includeCalendar, true);
  setBooleanQuery(query, "includeReminders", args.includeReminders, true);
  setBooleanQuery(query, "includeInbox", args.includeInbox, true);
  setBooleanQuery(query, "includeResponsibility", args.includeResponsibility, true);
  setBooleanQuery(query, "includeActivity", args.includeActivity, true);
  if (args.includeBlocks) query.set("includeBlocks", "1");
  if (args.includeArchived) query.set("includeArchived", "1");
  if (args.maxTasks) query.set("maxTasks", String(args.maxTasks));
  if (args.maxBlocks) query.set("maxBlocks", String(args.maxBlocks));
  return apiFetch(`/projects/${encodeURIComponent(String(projectId))}/ai-context?${query}`);
}

async function fetchProjectChanges(projectId, args = {}, toolName = "") {
  const since = String(args.since ?? "").trim();
  if (!since || !Number.isFinite(new Date(since).getTime())) throw new Error("since must be a valid ISO date/time");
  const query = new URLSearchParams({ since, scope: "full" });
  if (toolName) query.set("tool", toolName);
  setBooleanQuery(query, "includeCalendar", args.includeCalendar, true);
  setBooleanQuery(query, "includeReminders", args.includeReminders, true);
  setBooleanQuery(query, "includeInbox", args.includeInbox, true);
  if (args.includeBlocks) query.set("includeBlocks", "1");
  if (args.includeArchived) query.set("includeArchived", "1");
  if (args.maxTasks) query.set("maxTasks", String(args.maxTasks));
  if (args.maxBlocks) query.set("maxBlocks", String(args.maxBlocks));
  return apiFetch(`/projects/${encodeURIComponent(String(projectId))}/ai-context/changes?${query}`);
}

function filterTasks(tasks, args = {}) {
  const state = args.state || "all";
  const assigneeId = args.assigneeId === undefined || args.assigneeId === null ? "" : String(args.assigneeId);
  const search = normalizeSearch(args.search);
  return tasks.filter((task) => {
    if (state === "completed" && task.state !== "completed") return false;
    if (state === "active" && task.state !== "active") return false;
    if (state === "deferred" && task.state !== "deferred") return false;
    if (state === "overdue" && !task.isOverdue) return false;
    if (assigneeId && String(task.assigneeId ?? "") !== assigneeId) return false;
    if (!search) return true;
    return textMatches([
      task.title,
      task.description,
      task.priority,
      task.assignee?.username,
      task.assignee?.firstName,
      task.assignee?.lastName,
      ...(Array.isArray(task.tags) ? task.tags : []),
    ], search);
  });
}

function filterByDateRange(items, from, to) {
  const fromMs = parseOptionalDate(from);
  const toMs = parseOptionalDate(to);
  return items.filter((item) => {
    const time = parseOptionalDate(item.startsAt ?? item.remindAt ?? item.deadlineAt ?? item.createdAt);
    if (!time) return !fromMs && !toMs;
    if (fromMs && time < fromMs) return false;
    if (toMs && time > toMs) return false;
    return true;
  });
}

function parseOptionalDate(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function filterWorkspaceNodes(nodes, parentId) {
  if (parentId === undefined) return nodes;
  if (parentId === null) return nodes.filter((node) => node.parentId === null || node.parentId === undefined);
  return nodes.filter((node) => String(node.parentId ?? "") === String(parentId));
}

function searchContext(context, query, maxResults) {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const results = [];
  addSearchResults(results, "task", context.tasks ?? [], normalized, maxResults, (item) => [
    item.title,
    item.description,
    item.priority,
    item.state,
    item.assignee?.username,
    item.assignee?.firstName,
    item.assignee?.lastName,
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]);
  addSearchResults(results, "calendar_event", context.calendarEvents ?? [], normalized, maxResults, (item) => [
    item.title,
    item.description,
    item.category,
    item.startsAt,
  ]);
  addSearchResults(results, "reminder", context.reminders ?? [], normalized, maxResults, (item) => [
    item.title,
    item.text,
    item.remindAt,
  ]);
  addSearchResults(results, "inbox_item", context.inboxItems ?? [], normalized, maxResults, (item) => [
    item.title,
    item.authorUserId,
    ...(Array.isArray(item.blocks) ? item.blocks.map((block) => `${block.type} ${block.content ?? ""}`) : []),
  ]);
  addSearchResults(results, "responsibility_area", context.responsibilityAreas ?? [], normalized, maxResults, (item) => [
    item.title,
    item.description,
  ]);
  addSearchResults(results, "workspace_node", context.workspace?.nodes ?? [], normalized, maxResults, (item) => [
    item.title,
    item.type,
  ]);
  addSearchResults(results, "page_block", context.workspace?.blocks ?? [], normalized, maxResults, (item) => [
    item.type,
    item.content,
    JSON.stringify(item.props ?? {}),
  ]);
  return results.slice(0, maxResults);
}

function addSearchResults(results, type, items, query, maxResults, getFields) {
  if (results.length >= maxResults) return;
  for (const item of items) {
    if (results.length >= maxResults) return;
    if (!textMatches(getFields(item), query)) continue;
    results.push({ type, item });
  }
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function textMatches(values, query) {
  return values
    .filter((value) => value !== undefined && value !== null)
    .some((value) => String(value).toLowerCase().includes(query));
}

function usesProjectScopedToken() {
  return AUTH_TOKEN.startsWith(AI_TOKEN_PREFIX) || AUTH_HEADER.includes(`Bearer ${AI_TOKEN_PREFIX}`);
}

async function apiFetch(path) {
  if (!API_URL) {
    throw new Error("AI_CONNECTOR_API_URL is required. Set it to the public Noto backend URL, for example https://api.example.com");
  }
  if (!AUTH_HEADER) {
    throw new Error("AI_CONNECTOR_AUTH_TOKEN or AI_CONNECTOR_AUTH_HEADER is required");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: {
        Authorization: AUTH_HEADER,
        Accept: "application/json",
        "User-Agent": "noto-ai-connector-mcp/0.2.0",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Noto API request timed out after ${REQUEST_TIMEOUT_MS} ms`);
    }
    throw new Error(`Cannot reach Noto API at ${API_URL}: ${error?.message || "network error"}`);
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const details = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Noto API ${response.status}: ${details}`);
  }
  return data;
}

function normalizeApiUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("AI_CONNECTOR_API_URL must be a valid http:// or https:// URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AI_CONNECTOR_API_URL must use http:// or https://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("AI_CONNECTOR_API_URL must not contain credentials");
  }
  return raw.replace(/\/+$/, "");
}

function envPositiveNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function jsonToolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function compactUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`);
}
