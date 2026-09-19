import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertApiContract, assertPaginatedContract } from "./api-contracts.mjs";

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
      APP_OWNER_TELEGRAM_IDS: "900001",
      AUTH_CODE_REQUEST_MAX_PER_IP: "5",
      AUTH_IP_BLOCK_MS: "60000",
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
  assertApiContract("authenticatedUser", user);

  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin" },
  });
  const outbox = await request("/outbox/pending", { auth: "bot" });
  const loginCode = String(outbox.find((item) => String(item.telegramId) === "900001")?.text ?? "").match(/\b[A-Z0-9]{6}\b/)?.[0];
  assert(loginCode, "Auth code was not delivered to bot outbox");
  assert(/[A-Z]/.test(loginCode) && /\d/.test(loginCode), "Auth code must contain both letters and digits");
  await delay(flushDebounceMs + 300);
  await assertAuthCodePersistedHashed(user.id, loginCode);
  await request("/auth/verify-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin", code: "AAAAAA" },
    expected: 400,
  });
  const login = await request("/auth/verify-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin", code: loginCode.toLowerCase() },
  });
  sessionToken = login.token;
  await request(`/auth/me?token=${encodeURIComponent(sessionToken)}`, { auth: "none", expected: 401 });

  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin" },
  });
  for (let index = 0; index < 4; index += 1) {
    const failedAttempt = await request("/auth/verify-code", {
      method: "POST",
      auth: "none",
      body: { username: "smoke_admin", code: "AAAAAA" },
      expected: 400,
    });
    assert(failedAttempt.attemptsRemaining === 4 - index, "Wrong-code attempts remaining are incorrect");
  }
  const lockedAttempt = await request("/auth/verify-code", {
    method: "POST",
    auth: "none",
    body: { username: "smoke_admin", code: "AAAAAA" },
    expected: 429,
  });
  assert(lockedAttempt.attemptsRemaining === 0, "Auth code was not invalidated after five wrong attempts");

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

  const rateUser = await request("/telegram/users", {
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
  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "another_unknown_user" },
    expected: 429,
  });
  await request("/auth/request-code", {
    method: "POST",
    auth: "none",
    body: { username: "blocked_by_ip" },
    expected: 429,
  });

  const project = await request("/projects", {
    method: "POST",
    body: { title: "Smoke Project", ownerId: user.id },
    expected: 201,
  });
  assertApiContract("project", project);
  assertApiContract("projectMember", project.members[0]);
  assert(!Object.prototype.hasOwnProperty.call(project, "inviteCode"), "Hydrated project leaked inviteCode");
  assert(!Object.prototype.hasOwnProperty.call(project, "botSettings"), "Hydrated project leaked botSettings");
  assert(project.members.every((member) => !Object.prototype.hasOwnProperty.call(member, "adminNotes")), "Hydrated project leaked member admin notes");
  assert(project.members.every((member) => !Object.prototype.hasOwnProperty.call(member.user ?? {}, "telegramId")), "Hydrated project leaked member telegramId");
  const inviteCode = await request(`/projects/${project.id}/invite-code?actorUserId=${encodeURIComponent(user.id)}`);
  assert(inviteCode.inviteCode, "Project invite code endpoint stopped returning inviteCode");
  const botSettings = await request(`/projects/${project.id}/bot-settings`);
  assertApiContract("botSettings", botSettings);
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

  const ownerCalendars = await request("/me/calendars");
  const ownerPersonalCalendar = ownerCalendars.find((calendar) => calendar.type === "PERSONAL");
  const projectCalendar = ownerCalendars.find(
    (calendar) => calendar.type === "PROJECT" && String(calendar.projectId) === String(project.id),
  );
  assert(ownerPersonalCalendar, "Personal calendar was not created for the owner");
  assert(projectCalendar, "Project calendar was not created");
  assertApiContract("calendar", ownerPersonalCalendar);
  assertApiContract("calendar", projectCalendar);
  assert(ownerPersonalCalendar.permissions?.create === true, "Owner cannot create personal calendar events");
  assert(projectCalendar.permissions?.editAll === true, "Owner did not receive full project calendar permissions");

  const projectCalendarCategory = await request(`/calendars/${projectCalendar.id}/categories`, {
    method: "POST",
    body: { label: "Smoke project category", color: "#EC4899" },
    expected: 201,
  });
  const personalCalendarCategory = await request(`/calendars/${ownerPersonalCalendar.id}/categories`, {
    method: "POST",
    body: { label: "Smoke personal category", color: "#14B8A6" },
    expected: 201,
  });
  assertApiContract("calendarCategory", projectCalendarCategory);
  assertApiContract("calendarCategory", personalCalendarCategory);
  const updatedProjectCalendarCategory = await request(`/calendars/${projectCalendar.id}/categories/${projectCalendarCategory.id}`, {
    method: "PATCH",
    body: { color: "#A855F7" },
  });
  assert(updatedProjectCalendarCategory.color === "#A855F7", "Calendar category color was not updated");
  const calendarsWithCategories = await request("/me/calendars");
  assert(
    calendarsWithCategories.find((calendar) => calendar.id === projectCalendar.id)?.categories?.some((category) => category.id === projectCalendarCategory.id && category.color === "#A855F7"),
    "Project calendar category was not returned",
  );
  assert(
    calendarsWithCategories.find((calendar) => calendar.id === ownerPersonalCalendar.id)?.categories?.some((category) => category.id === personalCalendarCategory.id),
    "Personal calendar category was not returned",
  );

  const viewerCalendars = await request("/me/calendars", {
    auth: "tma",
    initData: viewerInitData,
  });
  const viewerProjectCalendar = viewerCalendars.find(
    (calendar) => calendar.type === "PROJECT" && String(calendar.projectId) === String(project.id),
  );
  assert(viewerProjectCalendar, "Viewer cannot see an accessible project calendar");
  assert(viewerProjectCalendar.permissions?.create === false, "Viewer received calendar create permission");
  assert(!viewerCalendars.some((calendar) => calendar.id === ownerPersonalCalendar.id), "Owner personal calendar leaked to viewer");
  await request(`/calendars/${projectCalendar.id}/categories`, {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    body: { label: "Forbidden viewer category", color: "#000000" },
    expected: 403,
  });
  await request(`/calendars/${projectCalendar.id}/categories/${projectCalendarCategory.id}`, {
    method: "PATCH",
    auth: "tma",
    initData: viewerInitData,
    body: { color: "#000000" },
    expected: 403,
  });

  const selectedCalendarEvent = await request(`/projects/${project.id}/calendar-events`, {
    method: "POST",
    body: {
      title: "Owner-only selected event",
      startsAt: "2026-10-10T10:00:00.000Z",
      endsAt: "2026-10-10T11:00:00.000Z",
      notification: { enabled: true, remindAt: "2026-10-10T09:30:00.000Z" },
      type: "custom",
      color: updatedProjectCalendarCategory.color,
      categoryId: projectCalendarCategory.id,
      categoryLabel: projectCalendarCategory.label,
      visibility: "selected",
      participantUserIds: [user.id],
    },
    expected: 201,
  });
  assertApiContract("calendarEvent", selectedCalendarEvent);
  const sharedCalendarEvent = await request(`/projects/${project.id}/calendar-events`, {
    method: "POST",
    body: {
      title: "Shared project event",
      startsAt: "2026-10-11T10:00:00.000Z",
      visibility: "project",
    },
    expected: 201,
  });
  assert(String(selectedCalendarEvent.calendarId) === String(projectCalendar.id), "Project event was not linked to its calendar");
  assert(String(selectedCalendarEvent.createdByUserId) === String(user.id), "Calendar event creator was not recorded");
  assert(selectedCalendarEvent.notification?.enabled === true, "Calendar event notification was not enabled");
  assert(selectedCalendarEvent.notification?.remindAt === "2026-10-10T09:30:00.000Z", "Calendar event notification time was not preserved");
  assert(selectedCalendarEvent.notification?.deliveryStatus === "pending", "Calendar event notification was not queued");
  assert(selectedCalendarEvent.categoryId === projectCalendarCategory.id, "Calendar event category id was not preserved");
  assert(selectedCalendarEvent.categoryLabel === projectCalendarCategory.label, "Calendar event category label was not preserved");
  assert(selectedCalendarEvent.color === updatedProjectCalendarCategory.color, "Calendar event category color was not preserved");
  assert(sharedCalendarEvent.notification?.enabled === false, "Calendar event notification must be disabled by default");

  const viewerProjectEvents = await request(`/projects/${project.id}/calendar-events`, {
    auth: "tma",
    initData: viewerInitData,
  });
  assert(viewerProjectEvents.some((event) => event.id === sharedCalendarEvent.id), "Viewer cannot see a shared project event");
  assert(!viewerProjectEvents.some((event) => event.id === selectedCalendarEvent.id), "Selected calendar event leaked to a non-participant");
  await request(`/projects/${project.id}/calendar-events`, {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    body: { title: "Forbidden viewer event", startsAt: "2026-10-12T10:00:00.000Z" },
    expected: 403,
  });
  await request(`/calendar-events/${selectedCalendarEvent.id}`, {
    method: "PATCH",
    auth: "tma",
    initData: viewerInitData,
    body: { title: "Forbidden change" },
    expected: 403,
  });
  const movedCalendarEvent = await request(`/calendar-events/${selectedCalendarEvent.id}`, {
    method: "PATCH",
    body: {
      startsAt: "2026-10-10T12:00:00.000Z",
      endsAt: "2026-10-10T13:30:00.000Z",
      notification: { enabled: true, remindAt: "2026-10-10T11:15:00.000Z" },
    },
  });
  assert(movedCalendarEvent.startsAt === "2026-10-10T12:00:00.000Z", "Calendar event move was not persisted");
  assert(movedCalendarEvent.endsAt === "2026-10-10T13:30:00.000Z", "Calendar event resize was not persisted");
  assert(movedCalendarEvent.notification?.remindAt === "2026-10-10T11:15:00.000Z", "Calendar event notification was not updated");
  assert(movedCalendarEvent.notification?.deliveryStatus === "pending", "Updated calendar notification was not re-queued");

  const personalCalendarEvent = await request(`/calendars/${ownerPersonalCalendar.id}/events`, {
    method: "POST",
    body: {
      title: "Private personal event",
      startsAt: "2026-10-13T10:00:00.000Z",
      visibility: "project",
    },
    expected: 201,
  });
  assert(personalCalendarEvent.visibility === "private" && !personalCalendarEvent.projectId, "Personal event was not made private");
  await request(`/calendars/${ownerPersonalCalendar.id}/events`, {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    body: { title: "Foreign personal event", startsAt: "2026-10-14T10:00:00.000Z" },
    expected: 403,
  });

  const aggregateRange = "from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z";
  const ownerAggregate = await request(`/me/calendar-events?${aggregateRange}`);
  assert(ownerAggregate.some((event) => event.id === selectedCalendarEvent.id), "Owner aggregate omitted a selected project event");
  assert(ownerAggregate.some((event) => event.id === personalCalendarEvent.id), "Owner aggregate omitted a personal event");
  const viewerAggregate = await request(`/me/calendar-events?${aggregateRange}`, {
    auth: "tma",
    initData: viewerInitData,
  });
  assert(viewerAggregate.some((event) => event.id === sharedCalendarEvent.id), "Viewer aggregate omitted a shared project event");
  assert(!viewerAggregate.some((event) => event.id === selectedCalendarEvent.id), "Selected event leaked through the aggregate calendar");
  assert(!viewerAggregate.some((event) => event.id === personalCalendarEvent.id), "Personal event leaked through the aggregate calendar");
  const recoloredProjectCategory = await request(`/calendars/${projectCalendar.id}/categories/${projectCalendarCategory.id}`, {
    method: "PATCH",
    body: { color: "#0EA5E9" },
  });
  const projectEventsAfterCategoryRecolor = await request(`/projects/${project.id}/calendar-events`);
  assert(
    projectEventsAfterCategoryRecolor.find((event) => event.id === selectedCalendarEvent.id)?.color === recoloredProjectCategory.color,
    "Existing event colors were not updated with their category",
  );
  const deletedProjectCategory = await request(`/calendars/${projectCalendar.id}/categories/${projectCalendarCategory.id}`, {
    method: "DELETE",
  });
  assert(deletedProjectCategory.reassignedEvents === 1, "Deleted category events were not reassigned");
  const projectEventsAfterCategoryDelete = await request(`/projects/${project.id}/calendar-events`);
  assert(
    projectEventsAfterCategoryDelete.find((event) => event.id === selectedCalendarEvent.id)?.categoryId === "base:meeting",
    "Deleted category event did not fall back to the meeting category",
  );
  await request(`/calendars/${ownerPersonalCalendar.id}/categories/${personalCalendarCategory.id}`, { method: "DELETE" });
  await request("/me/calendar-events", { expected: 400 });

  await request(`/projects/${project.id}/bot-settings`, { auth: "tma", initData: viewerInitData, expected: 403 });
  const privateProject = await request("/projects", {
    method: "POST",
    body: { title: "Private Smoke Project", ownerId: user.id },
    expected: 201,
  });
  await request(`/projects/${privateProject.id}/members`, { auth: "tma", initData: viewerInitData, expected: 403 });
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

  await request(`/projects/${project.id}/members/${viewerMember.id}/role`, {
    method: "POST",
    body: { role: "editor", actorUserId: user.id },
  });
  const ownedArea = await request(`/projects/${project.id}/responsibility-areas`, {
    method: "POST",
    body: { title: "Owned Area", ownerUserIds: [viewerMember.userId], notes: "" },
    expected: 201,
  });
  assertApiContract("responsibilityArea", ownedArea);
  const updatedOwnedArea = await request(`/projects/${project.id}/responsibility-areas/${ownedArea.id}`, {
    method: "PATCH",
    auth: "tma",
    initData: viewerInitData,
    body: {
      title: "Tampered title",
      ownerUserIds: [user.id],
      notes: "Area owner note",
      planItems: [{ id: "plan_smoke", title: "Area owner plan", completed: false, dueDate: "2026-12-31" }],
    },
  });
  assert(updatedOwnedArea.title === "Owned Area", "Responsibility owner changed protected area fields");
  assert(updatedOwnedArea.notes === "Area owner note", "Responsibility owner could not update workspace notes");
  assert(updatedOwnedArea.planItems?.[0]?.title === "Area owner plan", "Responsibility owner could not update workspace plan");
  assert(updatedOwnedArea.ownerUserIds.some((id) => String(id) === String(viewerMember.userId)), "Responsibility owner changed ownership");
  const foreignArea = await request(`/projects/${project.id}/responsibility-areas`, {
    method: "POST",
    body: { title: "Foreign Area", ownerUserIds: [user.id] },
    expected: 201,
  });
  await request(`/projects/${project.id}/responsibility-areas/${foreignArea.id}`, {
    method: "PATCH",
    auth: "tma",
    initData: viewerInitData,
    body: { notes: "Forbidden note" },
    expected: 403,
  });
  await request(`/projects/${project.id}/members/${viewerMember.id}/role`, {
    method: "POST",
    body: { role: "viewer", actorUserId: user.id },
  });

  const rootTree = await request(`/projects/${project.id}/space/tree?parentId=null`);
  assertApiContract("pageTree", rootTree);
  assert(rootTree.nodes.length > 0, "Root tree was not created");
  const root = rootTree.nodes[0];

  const folder = await request(`/projects/${project.id}/space/nodes`, {
    method: "POST",
    body: { type: "folder", title: "Smoke Folder", parentId: root.id },
    expected: 201,
  });
  assertApiContract("pageNode", folder);

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
  assertApiContract("pageNode", page);

  const inboxFolder = await request(`/projects/${project.id}/space/nodes`, {
    method: "POST",
    body: { type: "folder", title: "Inbox", parentId: null },
    expected: 201,
  });
  const inboxPage = await request(`/projects/${project.id}/space/nodes`, {
    method: "POST",
    body: {
      type: "page",
      title: "Smoke Inbox idea",
      parentId: inboxFolder.id,
      properties: { author: String(user.id) },
      initialBlocks: [{ type: "paragraph", content: { text: "Inbox text for AI analysis" }, order: 0 }],
    },
    expected: 201,
  });

  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const uploadedFile = await request(`/projects/${project.id}/files?fileName=smoke.png&mode=block`, {
    method: "POST",
    rawBody: pngBytes,
    headers: { "Content-Type": "image/png" },
    expected: 201,
  });
  assertApiContract("projectFile", uploadedFile);
  assert(uploadedFile.fileName === "smoke.png" && uploadedFile.category === "image", "Project file metadata is invalid");

  await request(`/projects/${project.id}/files?fileName=forbidden.png&mode=block`, {
    method: "POST",
    auth: "tma",
    initData: viewerInitData,
    rawBody: pngBytes,
    headers: { "Content-Type": "image/png" },
    expected: 403,
  });
  await request(`/projects/${project.id}/files?fileName=fake.png&mode=block`, {
    method: "POST",
    rawBody: Buffer.from("not a png"),
    headers: { "Content-Type": "image/png" },
    expected: 400,
  });

  const additionalFileFixtures = [
    {
      fileName: "smoke.pdf",
      bytes: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii"),
      mimeType: "application/pdf",
      category: "document",
    },
    {
      fileName: "smoke.docx",
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      category: "document",
    },
    {
      fileName: "smoke.mp3",
      bytes: Buffer.from("ID3smoke-audio", "ascii"),
      mimeType: "audio/mpeg",
      category: "audio",
    },
  ];
  for (const fixture of additionalFileFixtures) {
    const record = await request(`/projects/${project.id}/files?fileName=${encodeURIComponent(fixture.fileName)}&mode=block`, {
      method: "POST",
      rawBody: fixture.bytes,
      headers: { "Content-Type": fixture.mimeType },
      expected: 201,
    });
    assert(record.mimeType === fixture.mimeType && record.category === fixture.category, `Invalid metadata for ${fixture.fileName}`);
    await request(`/projects/${project.id}/files/${record.id}`, { method: "DELETE" });
  }

  const fileContentResponse = await fetch(
    `${baseUrl}/projects/${project.id}/files/${uploadedFile.id}/content`,
    { headers: { Authorization: `Bearer ${sessionToken}` } },
  );
  assert(fileContentResponse.status === 200, "Uploaded project file cannot be read");
  const downloadedFile = Buffer.from(await fileContentResponse.arrayBuffer());
  assert(downloadedFile.equals(pngBytes), "Downloaded project file differs from uploaded content");

  const fileBlock = await request(`/projects/${project.id}/space/pages/${page.id}/blocks`, {
    method: "POST",
    body: {
      type: "file",
      content: {
        fileId: uploadedFile.id,
        fileName: uploadedFile.fileName,
        mimeType: uploadedFile.mimeType,
        category: uploadedFile.category,
        size: uploadedFile.size,
      },
    },
    expected: 201,
  });
  await request(`/projects/${project.id}/files/${uploadedFile.id}`, { method: "DELETE", expected: 409 });
  await request(`/projects/${project.id}/space/blocks/${fileBlock.id}`, { method: "DELETE" });
  await request(`/projects/${project.id}/files/${uploadedFile.id}`, { expected: 404 });

  const persistedFile = await request(`/projects/${project.id}/files?fileName=persisted.png&mode=block`, {
    method: "POST",
    rawBody: pngBytes,
    headers: { "Content-Type": "image/png" },
    expected: 201,
  });
  await request(`/projects/${project.id}/space/pages/${page.id}/blocks`, {
    method: "POST",
    body: {
      type: "file",
      content: {
        fileId: persistedFile.id,
        fileName: persistedFile.fileName,
        mimeType: persistedFile.mimeType,
        category: persistedFile.category,
        size: persistedFile.size,
      },
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
  assertApiContract("block", createdBlock);
  let pageBlocks = await request(`/projects/${project.id}/space/pages/${page.id}/blocks`);
  assertApiContract("pageBlocks", pageBlocks);
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
  assertApiContract("column", columns[0]);

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
  assertApiContract("task", task);

  const reminder = await request(`/projects/${project.id}/reminders`, {
    method: "POST",
    body: {
      title: "Smoke reminder",
      targetUserId: user.id,
      sourceType: "manual",
      scheduleType: "once",
      remindAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      channels: { app: true, telegramBot: true },
    },
    expected: 201,
  });
  assertApiContract("reminder", reminder);

  const deadlineRange = new URLSearchParams({
    from: new Date(Date.now() - 60 * 1000).toISOString(),
    to: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    projectId: String(project.id),
  });
  const taskDeadlines = await request(`/me/task-deadlines?${deadlineRange}`);
  assert(taskDeadlines.some((item) => item.id === task.id), "Active task deadline is missing from the calendar layer");
  assert(taskDeadlines.find((item) => item.id === task.id)?.project?.title === project.title, "Task deadline does not include its project");

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
  assertPaginatedContract(pagedTasks, "tasks");
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
  assertPaginatedContract(pagedActivity, "events");
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
  assertPaginatedContract(pagedNotifications, "notifications");
  assert(Array.isArray(pagedNotifications.notifications) && pagedNotifications.notifications.length === 1 && pagedNotifications.total >= 1, "Paginated notifications response is invalid");

  const completedInFinalColumn = await request(`/tasks/${task.id}/move`, {
    method: "POST",
    body: { columnId: columns.at(-1).id, position: 0 },
  });
  assert(Boolean(completedInFinalColumn.completedAt), "Task in the rightmost column was not marked completed");
  const taskDeadlinesAfterCompletion = await request(`/me/task-deadlines?${deadlineRange}`);
  assert(!taskDeadlinesAfterCompletion.some((item) => item.id === task.id), "Completed task leaked into the calendar deadline layer");

  const assignedAfterCompletion = await request(`/users/${user.id}/assigned-tasks`);
  assert(!assignedAfterCompletion.some((item) => item.id === task.id), "Task in the rightmost column is still returned as active");
  const weeklyProgressAfterCompletion = await request(`/users/${user.id}/task-progress?days=7`);
  assert(weeklyProgressAfterCompletion.completed >= 1, "Weekly task progress does not count a completed assigned task");
  assert(weeklyProgressAfterCompletion.percent === 100, "Weekly task progress percentage is invalid after completion");

  const addedRightmostColumn = await request(`/projects/${project.id}/columns`, {
    method: "POST",
    body: { title: "Smoke final column", pageId: kanbanPage.id },
    expected: 201,
  });
  const reopenedAfterColumnAdded = await request(`/tasks/${task.id}`);
  assert(!reopenedAfterColumnAdded.completedAt, "Task stayed completed after a new column was added to its right");

  const reorderedColumnIds = [
    ...columns.slice(0, -1).map((column) => column.id),
    addedRightmostColumn.id,
    columns.at(-1).id,
  ];
  await request(`/projects/${project.id}/columns/reorder`, {
    method: "POST",
    body: { orderedIds: reorderedColumnIds, pageId: kanbanPage.id },
  });
  const completedAfterReorder = await request(`/tasks/${task.id}`);
  assert(Boolean(completedAfterReorder.completedAt), "Task was not completed after its column became rightmost again");

  const movedTask = await request(`/tasks/${task.id}/move`, {
    method: "POST",
    body: { columnId: columns[1].id, position: 0 },
  });
  assert(movedTask.columnId === columns[1].id, "Task was not moved to the target column");
  const taskDeadlinesAfterReopen = await request(`/me/task-deadlines?${deadlineRange}`);
  assert(taskDeadlinesAfterReopen.some((item) => item.id === task.id), "Reopened task deadline did not return to the calendar layer");

  const assignedTasks = await request(`/users/${user.id}/assigned-tasks`);
  assert(assignedTasks.some((item) => item.id === task.id), "Active assigned task is missing");
  assert(assignedTasks.find((item) => item.id === task.id)?.project?.title === project.title, "Assigned task does not include its project title");
  const weeklyProgressWithActiveTask = await request(`/users/${user.id}/task-progress?days=7`);
  assert(
    weeklyProgressWithActiveTask.total === weeklyProgressWithActiveTask.completed + weeklyProgressWithActiveTask.active,
    "Weekly task progress total does not match completed plus active tasks",
  );

  const searchResults = await request(`/projects/${project.id}/search?q=${encodeURIComponent("Smoke task")}`);
  assert(searchResults.some((item) => item.kind === "task" && item.id === task.id), "Search did not find created task");

  const archivedTask = await request(`/tasks/${task.id}/archive`, { method: "POST" });
  assert(archivedTask.isArchived === true, "Task archive endpoint did not archive the task");
  const taskDeadlinesAfterArchive = await request(`/me/task-deadlines?${deadlineRange}`);
  assert(!taskDeadlinesAfterArchive.some((item) => item.id === task.id), "Archived task leaked into the calendar deadline layer");

  const assignedAfterArchive = await request(`/users/${user.id}/assigned-tasks`);
  assert(!assignedAfterArchive.some((item) => item.id === task.id), "Archived task is still returned as active");

  const allNodes = await request(`/projects/${project.id}/space/nodes`);
  assert(allNodes.nodes.some((item) => item.id === page.id), "All nodes API does not include created page");

  const aiToken = await request(`/projects/${project.id}/ai-tokens`, {
    method: "POST",
    body: {
      name: "Smoke AI token",
      expiresInDays: 1,
      accessPolicy: {
        scope: "summary",
        includeTasks: true,
        includeWorkspace: false,
        includeCalendar: false,
        includeReminders: false,
        includeInbox: false,
        includeResponsibility: false,
        includeActivity: false,
        includeBlocks: false,
        includeArchived: false,
        maxTasks: 1,
        maxBlocks: 1,
      },
    },
    expected: 201,
  });
  assertApiContract("aiTokenRecord", aiToken.tokenRecord);
  assert(aiToken.token && aiToken.tokenRecord?.id, "AI connector token was not created");

  const aiContext = await request(
    `/projects/${project.id}/ai-context?tool=smoke_mcp_tool&scope=full&includeWorkspace=1&includeBlocks=1&includeActivity=1&maxTasks=50&maxBlocks=50`,
    { auth: "ai", bearerToken: aiToken.token },
  );
  assertApiContract("aiContext", aiContext);
  assert(aiContext.scope === "summary", "AI connector access policy did not clamp requested scope");
  assert((aiContext.workspace?.nodes ?? []).length === 0, "AI connector access policy leaked disabled workspace nodes");
  assert((aiContext.workspace?.blocks ?? []).length === 0, "AI connector access policy leaked disabled workspace blocks");
  assert((aiContext.inboxItems ?? []).length === 0, "AI connector access policy leaked disabled Inbox items");
  assert(aiContext.limits?.tasksReturned <= 1, "AI connector access policy did not clamp task limit");

  const projectSectionsToken = await request(`/projects/${project.id}/ai-tokens`, {
    method: "POST",
    body: {
      name: "Project sections AI token",
      expiresInDays: 1,
      accessPolicy: {
        scope: "full",
        includeTasks: false,
        includeWorkspace: false,
        includeCalendar: true,
        includeReminders: true,
        includeInbox: true,
        includeResponsibility: false,
        includeActivity: false,
        includeBlocks: false,
        includeArchived: false,
        maxTasks: 1,
        maxBlocks: 1,
      },
    },
    expected: 201,
  });
  const projectSectionsContext = await request(
    `/projects/${project.id}/ai-context?scope=full&includeWorkspace=0&includeCalendar=1&includeReminders=1&includeInbox=1`,
    { auth: "ai", bearerToken: projectSectionsToken.token },
  );
  assert(projectSectionsContext.calendarEvents.some((event) => event.id === selectedCalendarEvent.id), "Project calendar did not reach AI context");
  assert(projectSectionsContext.limits?.sectionsIncluded?.reminders === true, "Project reminders section was not enabled in AI context");
  assert(projectSectionsContext.inboxItems.some((item) => item.id === inboxPage.id), "Project Inbox did not reach AI context");
  assert(
    projectSectionsContext.inboxItems.find((item) => item.id === inboxPage.id)?.blocks?.some((block) => String(block.content).includes("Inbox text for AI analysis")),
    "Project Inbox block content did not reach AI context",
  );

  const scopedAiToken = await request(`/projects/${project.id}/ai-tokens`, {
    method: "POST",
    body: {
      name: "Scoped AI token",
      expiresInDays: 1,
      accessPolicy: {
        scope: "full",
        includeTasks: true,
        includeWorkspace: true,
        includeCalendar: false,
        includeReminders: false,
        includeInbox: false,
        includeResponsibility: false,
        includeActivity: true,
        includeBlocks: true,
        includeArchived: true,
        workspaceAccessMode: "include",
        workspaceNodeIds: [kanbanPage.id],
        maxTasks: 50,
        maxBlocks: 50,
      },
    },
    expected: 201,
  });
  const scopedContext = await request(
    `/projects/${project.id}/ai-context?scope=full&includeBlocks=1&includeArchived=1&maxTasks=50&maxBlocks=50`,
    { auth: "ai", bearerToken: scopedAiToken.token },
  );
  assert(scopedContext.limits?.workspaceAccess?.mode === "include", "AI connector workspace selection mode was not applied");
  assert(scopedContext.workspace.nodes.some((node) => node.id === kanbanPage.id), "Selected Kanban board was not returned");
  assert(!scopedContext.workspace.nodes.some((node) => node.id === page.id), "Unselected page leaked into scoped AI context");
  assert(scopedContext.tasks.some((item) => item.id === task.id), "Task from selected Kanban board was not returned");

  const scopedChanges = await request(
    `/projects/${project.id}/ai-context/changes?since=${encodeURIComponent(new Date(Date.now() - 3600000).toISOString())}&includeBlocks=1&includeArchived=1`,
    { auth: "ai", bearerToken: scopedAiToken.token },
  );
  assertApiContract("aiChanges", scopedChanges);
  assert(scopedChanges.kind === "noto_project_ai_changes", "AI connector changes endpoint returned an invalid payload");
  assert(!scopedChanges.newPages.some((node) => node.id === page.id), "Unselected page leaked into AI changes");

  const projectSectionsChanges = await request(
    `/projects/${project.id}/ai-context/changes?since=${encodeURIComponent(new Date(Date.now() - 3600000).toISOString())}&includeCalendar=1&includeReminders=1&includeInbox=1`,
    { auth: "ai", bearerToken: projectSectionsToken.token },
  );
  assert(projectSectionsChanges.newCalendarEvents.some((event) => event.id === selectedCalendarEvent.id), "Calendar changes did not reach AI delta context");
  assert(projectSectionsChanges.newInboxItems.some((item) => item.id === inboxPage.id), "Inbox changes did not reach AI delta context");

  const aiAccessEvents = await request(`/projects/${project.id}/ai-access-events?limit=20`);
  assert(aiAccessEvents.some((event) => event.toolName === "smoke_mcp_tool"), "AI connector access log did not store MCP tool name");
  assert(aiAccessEvents.some((event) => event.toolName === "get_project_changes"), "AI connector access log did not store changes tool name");

  await request(`/projects/${project.id}/ai-tokens/${aiToken.tokenRecord.id}`, { method: "DELETE" });
  await request(`/projects/${project.id}/ai-tokens/${scopedAiToken.tokenRecord.id}`, { method: "DELETE" });
  await request(`/projects/${project.id}/ai-tokens/${projectSectionsToken.tokenRecord.id}`, { method: "DELETE" });
  await request(`/projects/${project.id}/ai-context`, { auth: "ai", bearerToken: aiToken.token, expected: 401 });

  await request(`/system/users/${rateUser.id}/block`, { method: "POST" });
  const security = await request("/system/security-events?paginated=1&limit=500");
  assertApiContract("systemSecurity", security);
  assert(security.summary.windows["24h"].failedLogins > 0, "Failed login attempts were not summarized");
  assert(security.summary.windows["24h"].rateLimitHits > 0, "Rate-limit events were not summarized");
  assert(security.summary.windows["24h"].foreignProjectAccessAttempts > 0, "Foreign project access attempts were not summarized");
  assert(security.summary.blocked.ips.length > 0, "Active IP blocks were not returned");
  assert(security.summary.blocked.users.some((item) => String(item.id) === String(rateUser.id)), "Blocked users were not returned");
  assert(security.events.some((event) => event.type === "project_access_denied" && /^P-[A-F0-9]{8}$/.test(event.projectReference)), "Foreign project event is incomplete");
  assert(security.events.every((event) => !Object.prototype.hasOwnProperty.call(event, "projectId")), "Security events leaked internal project IDs");

  const systemStats = await request("/system/stats");
  assertApiContract("systemStats", systemStats);
  assert(systemStats.owner.telegramIds.includes("900001"), "System owner access is not bound to Telegram ID");
  assert(systemStats.services.some((service) => service.id === "api" && service.status === "online"), "System service status is missing");
  assert(systemStats.performance.windows["1h"].requests > 0, "System API performance metrics were not collected");
  assert(systemStats.server.memory.rssBytes > 0 && systemStats.server.cpu.cores > 0, "Server metrics are incomplete");
  assert(systemStats.storage.topProjects.some((item) => /^P-[A-F0-9]{8}$/.test(item.reference)), "Project storage metrics are incomplete");
  assert(systemStats.storage.topProjects.every((item) => !Object.prototype.hasOwnProperty.call(item, "id") && !Object.prototype.hasOwnProperty.call(item, "title")), "System stats leaked project identity");
  assert(systemStats.bot.requestsSinceApiStart > 0 && systemStats.bot.lastSeenAt, "Telegram bot heartbeat was not detected");
  assert(systemStats.database.files.every((file) => !String(file.path).includes("/") && !String(file.path).includes("\\")), "System stats leaked an absolute database path");

  // Node signal delivery for child processes is not reliable on Windows. There we verify
  // the debounced write itself; Linux/macOS still verify the final shutdown flush below.
  if (process.platform === "win32") await delay(flushDebounceMs + 300);
  await stopServer();

  await assertPersisted(project.id, page.id, task.id, sessionToken, persistedFile.id);

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

function assertPersisted(projectId, pageId, taskId, rawSessionToken, projectFileId) {
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
      const projectFileRows = sqlite.prepare("SELECT payload FROM records WHERE collection = 'projectFiles'").all();
      assert(projectFileRows.some((row) => JSON.parse(row.payload).id === projectFileId), "Project file metadata was not persisted in sqlite normalized records");
      const calendarRows = sqlite.prepare("SELECT payload FROM records WHERE collection = 'calendars'").all();
      assert(calendarRows.some((row) => JSON.parse(row.payload).type === "PERSONAL"), "Personal calendar was not persisted in sqlite normalized records");
      assert(calendarRows.some((row) => JSON.parse(row.payload).type === "PROJECT"), "Project calendar was not persisted in sqlite normalized records");
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
      assert((persisted?.projectFiles ?? []).some((item) => item.id === projectFileId), "Project file metadata was not persisted in sqlite app_state");
      assert((persisted?.calendars ?? []).some((item) => item.type === "PERSONAL"), "Personal calendar was not persisted in sqlite app_state");
      assert((persisted?.calendars ?? []).some((item) => item.type === "PROJECT"), "Project calendar was not persisted in sqlite app_state");
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
    assert((persisted.projectFiles ?? []).some((item) => item.id === projectFileId), "Project file metadata was not persisted in app.json");
    assert((persisted.calendars ?? []).some((item) => item.type === "PERSONAL"), "Personal calendar was not persisted in app.json");
    assert((persisted.calendars ?? []).some((item) => item.type === "PROJECT"), "Project calendar was not persisted in app.json");
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

async function requestResponse(pathname, { method = "GET", body, rawBody, expected = 200, auth = "user", initData, bearerToken, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (auth === "bot") {
    headers.Authorization = `Bot ${authToken}`;
  } else if (auth === "ai") {
    if (!bearerToken) throw new Error(`AI token is not ready for ${method} ${pathname}`);
    headers.Authorization = `Bearer ${bearerToken}`;
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
    body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
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
