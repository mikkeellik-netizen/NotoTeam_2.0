import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(backendDir, `.tmp-smoke-${Date.now()}-${process.pid}`);
const port = 19000 + Math.floor(Math.random() * 1000);
const botToken = "workspace-smoke-token";
const authToken = `workspace-smoke-internal-${crypto.randomBytes(16).toString("hex")}`;
const baseUrl = `http://127.0.0.1:${port}`;
const flushDebounceMs = process.platform === "win32" ? 200 : 5000;
const workspaceStorage = process.env.SMOKE_WORKSPACE_STORAGE ?? process.env.WORKSPACE_STORAGE ?? "json";
const normalizedTables = process.env.SMOKE_WORKSPACE_NORMALIZED_TABLES ?? process.env.WORKSPACE_NORMALIZED_TABLES ?? "";
const logs = [];

let server;
let sessionToken;

try {
  await mkdir(tempRoot, { recursive: true });

  server = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      APP_DATA_DIR: tempRoot,
      WORKSPACE_STORAGE: workspaceStorage,
      DATABASE_URL: "",
      WORKSPACE_NORMALIZED_TABLES: normalizedTables,
      CORS_ORIGIN: "http://127.0.0.1:5174,http://localhost:5174",
      BOT_TOKEN: botToken,
      TELEGRAM_BOT_TOKEN: botToken,
      INTERNAL_API_TOKEN: authToken,
      API_MAX_BODY_BYTES: "16384",
      DB_FLUSH_DEBOUNCE_MS: String(flushDebounceMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => logs.push(chunk));
  server.stderr.on("data", (chunk) => logs.push(chunk));

  await waitForServer();

  const corsAllowed = await requestResponse("/health", {
    auth: "none",
    headers: { Origin: "http://127.0.0.1:5174" },
  });
  assert(corsAllowed.response.headers.get("access-control-allow-origin") === "http://127.0.0.1:5174", "Allowed CORS origin was not reflected");
  await request("/health", {
    auth: "none",
    headers: { Origin: "https://evil.example" },
    expected: 403,
  });
  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "x".repeat(20000) },
    expected: 413,
  });

  const user = await request("/telegram/users", {
    method: "POST",
    auth: "bot",
    body: {
      telegramId: "900001",
      username: "smoke_admin",
      firstName: "Smoke",
      lastName: "Admin",
    },
  });

  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin" },
  });
  const outbox = await request("/outbox/pending", { auth: "bot" });
  const loginCode = String(outbox.find((item) => String(item.telegramId) === "900001")?.text ?? "").match(/\b\d{6}\b/)?.[0];
  assert(loginCode, "Auth code was not delivered to bot outbox");
  await delay(flushDebounceMs + 300);
  await assertAuthCodePersistedHashed(user.id, loginCode);
  const login = await request("/auth/verify-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin", code: loginCode },
  });
  sessionToken = login.token;
  await request(`/auth/me?token=${encodeURIComponent(sessionToken)}`, { auth: "none", expected: 401 });

  const freshInitData = createTelegramInitData({
    authDate: Math.floor(Date.now() / 1000),
    user: {
      id: 900001,
      username: "smoke_admin",
      first_name: "Smoke",
      last_name: "Admin",
    },
  });
  const tmaUser = await request("/auth/me", { auth: "tma", initData: freshInitData });
  assert(String(tmaUser.telegramId) === "900001", "Fresh Telegram initData was not accepted");

  const privateUserForBot = await request(`/users/${user.id}`, { auth: "bot" });
  assert(String(privateUserForBot.telegramId) === "900001", "Bot cannot access full user profile");
  const publicUserForClient = await request(`/users/${user.id}`);
  assert(!Object.prototype.hasOwnProperty.call(publicUserForClient, "telegramId"), "Client user lookup leaked telegramId");
  const publicUserByUsername = await request("/users/by-username/smoke_admin");
  assert(!Object.prototype.hasOwnProperty.call(publicUserByUsername, "telegramId"), "Client username lookup leaked telegramId");

  const staleInitData = createTelegramInitData({
    authDate: Math.floor(Date.now() / 1000) - 2 * 24 * 3600,
    user: {
      id: 900001,
      username: "smoke_admin",
      first_name: "Smoke",
      last_name: "Admin",
    },
  });
  await request("/auth/me", { auth: "tma", initData: staleInitData, expected: 401 });

  await request("/telegram/users", {
    method: "POST",
    auth: "bot",
    body: {
      telegramId: "900002",
      username: "rate_user",
      firstName: "Rate",
      lastName: "Limited",
    },
  });
  for (let index = 0; index < 3; index += 1) {
    await request("/auth/request-code", {
      method: "POST",
      auth: "none",
      body: { username: "rate_user" },
    });
  }
  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "rate_user" },
    expected: 429,
  });

  const project = await request("/projects", {
    method: "POST",
    body: { title: "Smoke Project", ownerId: user.id },
    expected: 201,
  });
  assert(!Object.prototype.hasOwnProperty.call(project, "inviteCode"), "Hydrated project leaked inviteCode");
  assert(!Object.prototype.hasOwnProperty.call(project, "botSettings"), "Hydrated project leaked botSettings");
  assert(project.members.every((member) => !Object.prototype.hasOwnProperty.call(member, "adminNotes")), "Hydrated project leaked member admin notes");
  assert(project.members.every((member) => !Object.prototype.hasOwnProperty.call(member.user ?? {}, "telegramId")), "Hydrated project leaked member telegramId");
  const inviteCode = await request(`/projects/${project.id}/invite-code?actorUserId=${encodeURIComponent(user.id)}`);
  assert(inviteCode.inviteCode, "Project invite code endpoint stopped returning inviteCode");
  const botSettings = await request(`/projects/${project.id}/bot-settings`);
  assert(Array.isArray(botSettings.kanbanReminderPoints), "Project bot settings endpoint stopped returning settings");
  const clientMembers = await request(`/projects/${project.id}/members`);
  assert(clientMembers.every((member) => !Object.prototype.hasOwnProperty.call(member ?? {}, "telegramId")), "Client project members leaked telegramId");
  const botMembers = await request(`/projects/${project.id}/members`, { auth: "bot" });
  assert(botMembers.some((member) => String(member.telegramId) === "900001"), "Bot project members lost telegramId");
  const exportedProject = await request(`/projects/${project.id}/export?format=json&token=${encodeURIComponent(sessionToken)}`, { auth: "none" });
  assert(String(exportedProject.project?.id) === String(project.id), "Session token query was not accepted for explicit project export");
  assertProjectExportIsSanitized(exportedProject, "Initial project export");

  const projects = await request(`/users/${user.id}/projects`);
  assert(projects.some((item) => item.id === project.id), "Created project is not returned for owner");

  await request("/telegram/users", {
    method: "POST",
    auth: "bot",
    body: {
      telegramId: "900003",
      username: "smoke_viewer",
      firstName: "Smoke",
      lastName: "Viewer",
    },
  });
  const withViewer = await request(`/projects/${project.id}/members`, {
    method: "POST",
    body: { username: "smoke_viewer" },
  });
  const viewerMember = withViewer.members.find((member) => String(member.userId) === "3");
  assert(viewerMember, "Smoke viewer was not added to the project");
  await request(`/projects/${project.id}/members/${viewerMember.id}/role`, {
    method: "POST",
    body: { role: "viewer", actorUserId: user.id },
  });
  await request(`/projects/${project.id}/members/${viewerMember.id}/admin-notes`, {
    method: "PATCH",
    body: { notes: "Private smoke admin note", actorUserId: user.id },
  });
  const exportedProjectWithNotes = await request(`/projects/${project.id}/export?format=json&token=${encodeURIComponent(sessionToken)}`, { auth: "none" });
  assertProjectExportIsSanitized(exportedProjectWithNotes, "Project export with member admin notes");
  const viewerInitData = createTelegramInitData({
    authDate: Math.floor(Date.now() / 1000),
    user: {
      id: 900003,
      username: "smoke_viewer",
      first_name: "Smoke",
      last_name: "Viewer",
    },
  });
  await request(`/projects/${project.id}/bot-settings`, { auth: "tma", initData: viewerInitData, expected: 403 });
  await request(`/projects/${project.id}/activity`, {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    body: {
      type: "viewer_spam",
      title: "Viewer should not write activity",
      entityType: "project",
      entityId: project.id,
    },
    expected: 403,
  });

  const rootTree = await request(`/projects/${project.id}/space/tree?parentId=null`);
  assert(rootTree.nodes.length > 0, "Root tree was not created");
  const root = rootTree.nodes[0];

  const folder = await request(`/projects/${project.id}/space/nodes`, {
    method: "POST",
    body: { type: "folder", title: "Smoke Folder", parentId: root.id },
    expected: 201,
  });

  const page = await request(`/projects/${project.id}/space/nodes`, {
    method: "POST",
    body: {
      type: "page",
      title: "Smoke Page",
      parentId: folder.id,
      initialBlocks: [{ type: "paragraph", content: { text: "Initial smoke text" }, order: 0 }],
    },
    expected: 201,
  });

  const folderTree = await request(`/projects/${project.id}/space/tree?parentId=${encodeURIComponent(folder.id)}`);
  assert(folderTree.nodes.some((item) => item.id === page.id), "Folder children are not loaded through lazy tree API");

  const createdBlock = await request(`/projects/${project.id}/space/pages/${page.id}/blocks`, {
    method: "POST",
    body: { type: "paragraph", content: { text: "Smoke block" } },
    expected: 201,
  });
  let pageBlocks = await request(`/projects/${project.id}/space/pages/${page.id}/blocks`);
  assert(
    pageBlocks.blocks.some((block) => block.id === createdBlock.id),
    `Created block is not visible through page blocks API: created=${JSON.stringify(createdBlock)} blocks=${JSON.stringify(pageBlocks.blocks)}`,
  );

  const patchedBlock = await request(`/projects/${project.id}/space/blocks/${createdBlock.id}`, {
    method: "PATCH",
    body: { content: { text: "Smoke block updated" } },
  });
  assert(patchedBlock.content?.text === "Smoke block updated", "Block PATCH response did not contain updated content");

  pageBlocks = await request(`/projects/${project.id}/space/pages/${page.id}/blocks`);
  assert(
    pageBlocks.blocks.some((block) => block.id === createdBlock.id && block.content?.text === "Smoke block updated"),
    `Block update was not visible through page blocks API: ${JSON.stringify(pageBlocks.blocks)}`,
  );

  await request(`/projects/${project.id}/space/blocks/${createdBlock.id}`, { method: "DELETE" });
  pageBlocks = await request(`/projects/${project.id}/space/pages/${page.id}/blocks`);
  assert(!pageBlocks.blocks.some((block) => block.id === createdBlock.id), "Deleted block is still returned");

  const kanbanPage = await request(`/projects/${project.id}/space/nodes`, {
    method: "POST",
    body: { type: "kanban", title: "Smoke Board", parentId: root.id },
    expected: 201,
  });

  const columns = await request(`/projects/${project.id}/columns?pageId=${encodeURIComponent(kanbanPage.id)}`);
  assert(columns.length >= 3, "Kanban board columns were not created");

  const task = await request("/tasks", {
    method: "POST",
    body: {
      projectId: project.id,
      pageId: kanbanPage.id,
      columnId: columns[0].id,
      title: "Smoke task",
      description: "Smoke task description",
      assigneeId: user.id,
      deadlineAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    },
    expected: 201,
  });

  await request("/tasks", {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    body: {
      projectId: project.id,
      pageId: kanbanPage.id,
      columnId: columns[0].id,
      title: "Viewer task should be rejected",
    },
    expected: 403,
  });
  await request(`/tasks/${task.id}`, {
    method: "PATCH",
    auth: "tma",
    initData: viewerInitData,
    body: { title: "Viewer edit should be rejected" },
    expected: 403,
  });
  await request(`/tasks/${task.id}/move`, {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    body: { columnId: columns[1].id, position: 0 },
    expected: 403,
  });

  const pagedTasks = await request(`/projects/${project.id}/tasks?allBoards=1&paginated=1&limit=1`);
  assert(Array.isArray(pagedTasks.tasks) && pagedTasks.tasks.length === 1 && pagedTasks.total >= 1, "Paginated project tasks response is invalid");

  await request(`/projects/${project.id}/activity`, {
    method: "POST",
    body: {
      type: "smoke",
      title: "Smoke activity",
      entityType: "task",
      entityId: task.id,
      createdAt: new Date().toISOString(),
    },
    expected: 201,
  });
  const pagedActivity = await request(`/projects/${project.id}/activity?paginated=1&limit=1`);
  assert(Array.isArray(pagedActivity.events) && pagedActivity.events.length === 1 && pagedActivity.total >= 1, "Paginated activity response is invalid");

  await request("/notifications", {
    method: "POST",
    auth: "bot",
    body: {
      projectId: project.id,
      entityId: `smoke-${task.id}`,
      entityType: "task",
      type: "smoke_notification",
      userId: user.id,
      sendAt: new Date(Date.now() - 1000).toISOString(),
      payload: { title: "Smoke notification" },
    },
    expected: 201,
  });
  const pagedNotifications = await request(`/notifications/pending?paginated=1&limit=1&before=${encodeURIComponent(new Date().toISOString())}`, { auth: "bot" });
  assert(Array.isArray(pagedNotifications.notifications) && pagedNotifications.notifications.length === 1 && pagedNotifications.total >= 1, "Paginated notifications response is invalid");

  const movedTask = await request(`/tasks/${task.id}/move`, {
    method: "POST",
    body: { columnId: columns[1].id, position: 0 },
  });
  assert(movedTask.columnId === columns[1].id, "Task was not moved to the target column");

  const assignedTasks = await request(`/users/${user.id}/assigned-tasks`);
  assert(assignedTasks.some((item) => item.id === task.id), "Active assigned task is missing");

  const searchResults = await request(`/projects/${project.id}/search?q=${encodeURIComponent("Smoke task")}`);
  assert(searchResults.some((item) => item.kind === "task" && item.id === task.id), "Search did not find created task");

  const archivedTask = await request(`/tasks/${task.id}/archive`, { method: "POST" });
  assert(archivedTask.isArchived === true, "Task archive endpoint did not archive the task");

  const assignedAfterArchive = await request(`/users/${user.id}/assigned-tasks`);
  assert(!assignedAfterArchive.some((item) => item.id === task.id), "Archived task is still returned as active");

  const allNodes = await request(`/projects/${project.id}/space/nodes`);
  assert(allNodes.nodes.some((item) => item.id === page.id), "All nodes API does not include created page");

  // Node signal delivery for child processes is not reliable on Windows. There we verify
  // the debounced write itself; Linux/macOS still verify the final shutdown flush below.
  if (process.platform === "win32") await delay(flushDebounceMs + 300);
  await stopServer();

  await assertPersisted(project.id, page.id, task.id, sessionToken);

  console.log("Smoke API passed");
} catch (error) {
  await stopServer().catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  if (logs.length > 0) {
    console.error("\nServer log:");
    console.error(logs.join(""));
  }
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function assertAuthCodePersistedHashed(userId, rawAuthCode) {
  const records = await persistedAuthCodes();
  const record = records.find((item) => String(item.userId) === String(userId));
  assert(record, "Auth code was not persisted before verification");
  assert(hasOnlyHashedAuthCode(record, rawAuthCode), "Raw auth code leaked into persistent storage");
}

async function persistedAuthCodes() {
  if (workspaceStorage === "sqlite" && normalizedTables) {
    const sqlite = new DatabaseSync(path.join(tempRoot, "database", "app.db"));
    try {
      return sqlite
        .prepare("SELECT payload FROM records WHERE collection = 'authCodes'")
        .all()
        .map((row) => JSON.parse(row.payload));
    } finally {
      sqlite.close();
    }
  }

  if (workspaceStorage === "sqlite") {
    const sqlite = new DatabaseSync(path.join(tempRoot, "database", "app.db"));
    try {
      const row = sqlite.prepare("SELECT value FROM app_state WHERE id = ?").get("workspace");
      const persisted = row?.value ? JSON.parse(row.value) : null;
      return persisted?.authCodes ?? [];
    } finally {
      sqlite.close();
    }
  }

  const persisted = JSON.parse(await readFile(path.join(tempRoot, "database", "app.json"), "utf8"));
  return persisted.authCodes ?? [];
}

function assertPersisted(projectId, pageId, taskId, rawSessionToken) {
  if (workspaceStorage === "sqlite" && normalizedTables) {
    const sqlite = new DatabaseSync(path.join(tempRoot, "database", "app.db"));
    try {
      assert(
        Number(sqlite.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = ?").get(projectId)?.count ?? 0) === 1,
        "Project was not persisted in sqlite",
      );
      assert(
        Number(sqlite.prepare("SELECT COUNT(*) AS count FROM nodes WHERE id = ?").get(pageId)?.count ?? 0) === 1,
        "Page node was not persisted in sqlite normalized nodes",
      );
      assert(
        Number(sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ? AND is_archived = 1").get(taskId)?.count ?? 0) === 1,
        "Archived task was not persisted in sqlite normalized tasks",
      );
      const sessionRows = sqlite.prepare("SELECT payload FROM records WHERE collection = 'sessions'").all();
      assert(sessionRows.length > 0, "Session was not persisted in sqlite normalized records");
      assert(sessionRows.every((row) => hasOnlyHashedSessionToken(JSON.parse(row.payload), rawSessionToken)), "Raw session token leaked into sqlite normalized records");
      const authCodeRows = sqlite.prepare("SELECT payload FROM records WHERE collection = 'authCodes'").all();
      assert(authCodeRows.every((row) => hasOnlyHashedAuthCode(JSON.parse(row.payload))), "Raw auth code leaked into sqlite normalized records");
    } finally {
      sqlite.close();
    }
    return;
  }

  if (workspaceStorage === "sqlite") {
    const sqlite = new DatabaseSync(path.join(tempRoot, "database", "app.db"));
    try {
      const row = sqlite.prepare("SELECT value FROM app_state WHERE id = ?").get("workspace");
      const persisted = row?.value ? JSON.parse(row.value) : null;
      assert(persisted?.projects?.some((item) => item.id === projectId), "Project was not persisted in sqlite app_state");
      assert(persisted?.spaces?.[projectId]?.nodes?.some((item) => item.id === pageId), "Page node was not persisted in sqlite app_state");
      assert(persisted?.tasks?.some((item) => item.id === taskId && item.isArchived), "Archived task was not persisted in sqlite app_state");
      assert((persisted?.sessions ?? []).some((item) => hasOnlyHashedSessionToken(item, rawSessionToken)), "Raw session token leaked into sqlite app_state");
      assert((persisted?.authCodes ?? []).every((item) => hasOnlyHashedAuthCode(item)), "Raw auth code leaked into sqlite app_state");
    } finally {
      sqlite.close();
    }
    return;
  }

  return readFile(path.join(tempRoot, "database", "app.json"), "utf8").then((text) => {
    const persisted = JSON.parse(text);
    assert(persisted.projects.some((item) => item.id === projectId), "Project was not persisted after shutdown flush");
    assert(persisted.spaces?.[projectId]?.nodes?.some((item) => item.id === pageId), "Page node was not persisted after shutdown flush");
    assert(persisted.tasks.some((item) => item.id === taskId && item.isArchived), "Archived task was not persisted after shutdown flush");
    assert((persisted.sessions ?? []).some((item) => hasOnlyHashedSessionToken(item, rawSessionToken)), "Raw session token leaked into app.json");
    assert((persisted.authCodes ?? []).every((item) => hasOnlyHashedAuthCode(item)), "Raw auth code leaked into app.json");
  });
}

function hasOnlyHashedSessionToken(session, rawSessionToken) {
  return Boolean(session?.tokenHash) && session.token !== rawSessionToken;
}

function hasOnlyHashedAuthCode(authCode, rawAuthCode) {
  if (!authCode) return false;
  return Boolean(authCode.codeHash) && !Object.prototype.hasOwnProperty.call(authCode, "code") && (rawAuthCode === undefined || authCode.code !== rawAuthCode);
}

async function request(pathname, options = {}) {
  const { payload } = await requestResponse(pathname, options);
  return payload;
}

async function requestResponse(pathname, { method = "GET", body, expected = 200, auth = "user", initData, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (auth === "bot") {
    headers.Authorization = `Bot ${authToken}`;
  } else if (auth === "tma") {
    if (!initData) throw new Error(`Telegram initData is not ready for ${method} ${pathname}`);
    headers.Authorization = `tma ${initData}`;
  } else if (auth === "user") {
    if (!sessionToken) throw new Error(`User session is not ready for ${method} ${pathname}`);
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${method} ${pathname} returned ${response.status}: ${text}`);
  }
  return { response, payload, text };
}

function createTelegramInitData({ authDate, user }) {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "smoke-query-id");
  params.set("user", JSON.stringify(user));
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error("Backend API did not start in time");
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exitPromise = new Promise((resolve) => server.once("exit", resolve));
  server.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
  await Promise.race([exitPromise, delay(5000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertProjectExportIsSanitized(payload, label) {
  assert(!Object.prototype.hasOwnProperty.call(payload.project ?? {}, "inviteCode"), `${label} leaked inviteCode`);
  assert(!Object.prototype.hasOwnProperty.call(payload.project ?? {}, "botSettings"), `${label} leaked botSettings`);
  assert((payload.project?.members ?? []).every((member) => !Object.prototype.hasOwnProperty.call(member, "adminNotes")), `${label} leaked member admin notes`);
  assert(
    (payload.project?.members ?? []).every((member) => !Object.prototype.hasOwnProperty.call(member.user ?? {}, "telegramId")),
    `${label} leaked member telegramId`,
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
