import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDataRepository } from "./dataRepository.js";

loadDotEnv();

const PORT = Number(process.env.PORT ?? 8787);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN ?? "";
const APP_OWNER_TELEGRAM_IDS = new Set(
  String(process.env.APP_OWNER_TELEGRAM_IDS ?? process.env.APP_OWNER_TELEGRAM_ID ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const INTERNAL_API_TOKEN = String(process.env.INTERNAL_API_TOKEN ?? "").trim();
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 дней
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 минут
const AUTH_CODE_MAX_ATTEMPTS = 5;

const now = () => new Date().toISOString();

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function generateAuthCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Разбирает заголовок Authorization. Поддерживает:
//   "Bot <token>"  — доверенный сервис (бот)
//   "tma <initData>" — Telegram Mini App
//   "Bearer <token>" — веб-сессия
function parseAuthHeader(req) {
  const raw = req.headers["authorization"];
  if (!raw || typeof raw !== "string") return undefined;
  const index = raw.indexOf(" ");
  if (index === -1) return undefined;
  const scheme = raw.slice(0, index).trim().toLowerCase();
  const value = raw.slice(index + 1).trim();
  if (!value) return undefined;
  return { scheme, value };
}

// Определяет, кто делает запрос. Возвращает:
//   { kind: "bot" }                — доверенный бот
//   { kind: "user", user }         — конкретный пользователь
//   undefined                      — не аутентифицирован
function resolveAuth(req, db, url) {
  const header = parseAuthHeader(req);

  // Бот по внутреннему токену
  if (header?.scheme === "bot") {
    if (INTERNAL_API_TOKEN && header.value === INTERNAL_API_TOKEN) {
      return { kind: "bot" };
    }
    return undefined;
  }

  // Telegram Mini App initData
  if (header?.scheme === "tma") {
    const tgUser = parseTelegramInitData(header.value);
    if (!tgUser) return undefined;
    const user = upsertTelegramUser(db, tgUser);
    if (!user || user.isBlocked) return undefined;
    return { kind: "user", user };
  }

  // Веб-сессия по Bearer-токену (или ?token= для скачивания файлов)
  const sessionToken =
    header?.scheme === "bearer" ? header.value : url?.searchParams.get("token") ?? undefined;
  if (sessionToken) {
    const session = db.sessions.find((item) => item.token === sessionToken);
    if (!session) return undefined;
    if (new Date(session.expiresAt).getTime() < Date.now()) return undefined;
    const user = db.users.find((item) => item.id === session.userId);
    if (!user || user.isBlocked) return undefined;
    session.lastSeenAt = now();
    return { kind: "user", user };
  }

  return undefined;
}

// Создаёт/обновляет пользователя по данным Telegram (без записи на диск — вызывающий пишет сам при необходимости)
function upsertTelegramUser(db, tgUser) {
  let user = db.users.find((item) => item.telegramId === tgUser.telegramId);
  if (!user) {
    user = { id: idFor(db.users), ...tgUser, createdAt: now(), updatedAt: now() };
    db.users.push(user);
    db._dirty = true;
  } else {
    const before = JSON.stringify(user);
    Object.assign(user, {
      username: tgUser.username ?? user.username,
      firstName: tgUser.firstName ?? user.firstName,
      lastName: tgUser.lastName ?? user.lastName,
      photoUrl: tgUser.photoUrl ?? user.photoUrl,
      updatedAt: now(),
    });
    if (JSON.stringify(user) !== before) db._dirty = true;
  }
  return user;
}

function pushOutbox(db, telegramId, text) {
  db.outbox.push({
    id: randomToken(8),
    telegramId: String(telegramId),
    text,
    status: "pending",
    createdAt: now(),
  });
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const defaultBotSettings = {
  timezone: "Europe/Moscow",
  taskDeadlineNotificationsEnabled: true,
  mentionNotificationsEnabled: true,
  dutyNotificationsEnabled: true,
  kanbanReminderTone: "soft",
  kanbanReminderPoints: [
    { id: "on_assign", enabled: true, kind: "on_assign", label: "Новая задача" },
    { id: "before_15h", enabled: true, kind: "before_deadline", offsetMinutes: 900, label: "За 15 часов" },
    { id: "before_2h", enabled: true, kind: "before_deadline", offsetMinutes: 120, label: "За 2 часа" },
    { id: "at_deadline", enabled: true, kind: "at_deadline", label: "В момент дедлайна" },
  ],
  reports: {
    weekly: {
      enabled: true,
      recipientUserIds: [],
      weekdays: [2],
      time: "19:00",
      skipEmpty: true,
      sendOnlyIfChanged: false,
      sections: {
        createdTasks: true,
        completedTasks: true,
        overdueTasks: true,
        approachingDeadlines: true,
        inactiveUsers: true,
        userActivity: true,
        kanbanMovement: true,
        mentions: true,
        recommendations: true,
      },
    },
    overdue: {
      enabled: true,
      recipientUserIds: [],
      weekdays: [4],
      time: "20:00",
      skipEmpty: true,
      sendOnlyIfChanged: true,
      sections: {
        createdTasks: false,
        completedTasks: false,
        overdueTasks: true,
        approachingDeadlines: false,
        inactiveUsers: false,
        userActivity: false,
        kanbanMovement: false,
        mentions: false,
        recommendations: true,
      },
    },
  },
};

const dataRepository = createDataRepository({ createDefaultDb });

function createDefaultDb() {
  const user = {
    id: "1",
    telegramId: "local-dev",
    username: "local_user",
    firstName: "Local",
    lastName: "User",
  };
  return {
    users: [user],
    projects: [
      {
        id: "1",
        title: "Командный проект",
        ownerId: "1",
        members: [{ userId: "1", role: "owner" }],
        botSettings: defaultBotSettings,
        calendarCategories: [],
      },
    ],
    columns: [
      { id: "1", projectId: "1", title: "Идея", position: 0 },
      { id: "2", projectId: "1", title: "В работе", position: 1 },
      { id: "3", projectId: "1", title: "Готово", position: 2 },
    ],
    tasks: [],
    subtasks: [],
    blocks: [],
    templates: [],
    reminders: [],
    calendarEvents: [],
    spaces: {},
    activity: [],
    notifications: [],
    joinRequests: [],
  };
}

async function readJson() {
  const db = await dataRepository.read();
  db.users ??= [];
  db.projects ??= [];
  db.columns ??= [];
  db.tasks ??= [];
  db.subtasks ??= [];
  db.blocks ??= [];
  db.templates ??= [];
  db.reminders ??= [];
  db.calendarEvents ??= [];
  db.spaces ??= {};
  db.activity ??= [];
  db.notifications ??= [];
  db.joinRequests ??= [];
  db.sessions ??= [];
  db.authCodes ??= [];
  db.outbox ??= [];
  const repairedTasks = normalizeDatabaseIds(db);
  if (repairedTasks > 0) {
    await dataRepository.write(db);
  }
  return db;
}

async function writeJson(db) {
  await dataRepository.write(db);
}

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(data));
}

function sendRaw(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(body);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function idFor(items) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.id) || 0), 0);
  return String(max + 1);
}

function route(method, pathname, pattern) {
  if (method && method !== pattern.method) return undefined;
  const match = pathname.match(pattern.path);
  return match ? match.groups ?? {} : undefined;
}

function resolveTelegramUser(body) {
  // На боевом сервере требуем валидный initData
  if (!body.initData) return undefined;

  const parsed = parseTelegramInitData(String(body.initData));
  if (!parsed) return undefined;
  return parsed;
}

// Доверенный путь (только для бота): данные Telegram берутся как есть.
function resolveTelegramUserTrusted(body) {
  if (body.initData) {
    const parsed = parseTelegramInitData(String(body.initData));
    if (parsed) return parsed;
  }
  if (!body.telegramId) return undefined;
  return {
    telegramId: String(body.telegramId),
    username: body.username,
    firstName: body.firstName,
    lastName: body.lastName,
    photoUrl: body.photoUrl,
  };
}

function parseTelegramInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const rawUser = params.get("user");
  if (!hash || !rawUser) return undefined;
  if (!TELEGRAM_BOT_TOKEN) return undefined;

  if (!isTelegramInitDataValid(params, hash, TELEGRAM_BOT_TOKEN)) {
    return undefined;
  }

  try {
    const user = JSON.parse(rawUser);
    if (!user?.id) return undefined;
    return {
      telegramId: String(user.id),
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      photoUrl: user.photo_url,
    };
  } catch {
    return undefined;
  }
}

function isTelegramInitDataValid(params, hash, botToken) {
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const calculatedBuffer = Buffer.from(calculated, "hex");
  const receivedBuffer = Buffer.from(hash, "hex");
  if (calculatedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(calculatedBuffer, receivedBuffer);
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  if (method === "OPTIONS") return send(res, 200, { ok: true });

  try {
    const db = await readJson();

    // ===== ПУБЛИЧНЫЕ ЭНДПОИНТЫ (без авторизации) =====
    if (method === "GET" && pathname === "/health") return send(res, 200, { ok: true, time: now() });

    // Временная диагностика заголовка авторизации (без раскрытия секрета)
    if (method === "GET" && pathname === "/auth/debug") {
      const rawHeaderNames = Object.keys(req.headers);
      const header = parseAuthHeader(req);
      return send(res, 200, {
        hasAuthorizationHeader: typeof req.headers["authorization"] === "string",
        scheme: header?.scheme ?? null,
        valueLen: header?.value?.length ?? 0,
        matchesInternal: Boolean(header && header.scheme === "bot" && INTERNAL_API_TOKEN && header.value === INTERNAL_API_TOKEN),
        headerNames: rawHeaderNames,
      });
    }

    // Шаг 1 веб-входа: запросить код. Пользователь должен сначала запустить бота.
    if (method === "POST" && pathname === "/auth/request-code") {
      const body = await parseBody(req);
      const username = String(body.username ?? "").trim().replace(/^@/, "").toLowerCase();
      if (!username) return send(res, 400, { error: "Укажите Telegram-ник" });

      const user = db.users.find((item) => item.username?.toLowerCase() === username);
      // Намеренно отвечаем одинаково, чтобы не раскрывать, кто зарегистрирован.
      const genericOk = { ok: true, message: "Если такой пользователь запускал бота, код отправлен в Telegram." };
      if (!user || !user.telegramId || user.isBlocked) return send(res, 200, genericOk);

      // Лимит: не больше 3 активных кодов за последнюю минуту
      const minuteAgo = Date.now() - 60 * 1000;
      const recent = db.authCodes.filter(
        (item) => item.userId === user.id && new Date(item.createdAt).getTime() > minuteAgo,
      );
      if (recent.length >= 3) return send(res, 429, { error: "Слишком много запросов. Попробуйте через минуту." });

      // Удаляем прежние коды этого пользователя
      db.authCodes = db.authCodes.filter((item) => item.userId !== user.id);
      const code = generateAuthCode();
      db.authCodes.push({
        id: randomToken(8),
        userId: user.id,
        telegramId: String(user.telegramId),
        code,
        attempts: 0,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
        createdAt: now(),
      });
      pushOutbox(
        db,
        user.telegramId,
        `Код для входа на сайт: ${code}\n\nКод действует 10 минут. Если вы не запрашивали вход — игнорируйте это сообщение.`,
      );
      await writeJson(db);
      return send(res, 200, genericOk);
    }

    // Шаг 2 веб-входа: проверить код, выдать сессию.
    if (method === "POST" && pathname === "/auth/verify-code") {
      const body = await parseBody(req);
      const username = String(body.username ?? "").trim().replace(/^@/, "").toLowerCase();
      const code = String(body.code ?? "").trim();
      const user = db.users.find((item) => item.username?.toLowerCase() === username);
      const record = user ? db.authCodes.find((item) => item.userId === user.id) : undefined;
      if (!user || !record) return send(res, 400, { error: "Неверный код или он истёк" });

      if (new Date(record.expiresAt).getTime() < Date.now()) {
        db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
        await writeJson(db);
        return send(res, 400, { error: "Код истёк. Запросите новый." });
      }
      if (record.attempts >= AUTH_CODE_MAX_ATTEMPTS) {
        db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
        await writeJson(db);
        return send(res, 429, { error: "Слишком много попыток. Запросите новый код." });
      }
      if (record.code !== code) {
        record.attempts += 1;
        await writeJson(db);
        return send(res, 400, { error: "Неверный код" });
      }

      // Успех: удаляем код, создаём сессию
      db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
      const token = randomToken(32);
      db.sessions.push({
        token,
        userId: user.id,
        createdAt: now(),
        lastSeenAt: now(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      });
      await writeJson(db);
      return send(res, 200, { token, user });
    }

    // ===== АУТЕНТИФИКАЦИЯ =====
    const auth = resolveAuth(req, db, url);
    if (db._dirty) {
      delete db._dirty;
      await writeJson(db);
    }
    if (!auth) return send(res, 401, { error: "Unauthorized" });

    // Текущий пользователь
    if (method === "GET" && pathname === "/auth/me") return send(res, 200, auth.user ?? null);
    if (method === "POST" && pathname === "/auth/logout") {
      const header = parseAuthHeader(req);
      if (header?.scheme === "bearer") {
        db.sessions = db.sessions.filter((item) => item.token !== header.value);
        await writeJson(db);
      }
      return send(res, 200, { ok: true });
    }

    // Outbox для бота: забрать ожидающие сообщения и пометить отправленными
    if (method === "GET" && pathname === "/outbox/pending") {
      return send(res, 200, db.outbox.filter((item) => item.status === "pending"));
    }
    {
      const sentParams = route(method, pathname, { method: "POST", path: /^\/outbox\/(?<id>[^/]+)\/sent$/ });
      if (sentParams) {
        db.outbox = db.outbox.filter((item) => item.id !== sentParams.id);
        await writeJson(db);
        return send(res, 200, { ok: true });
      }
    }

    // ===== АВТОРИЗАЦИЯ ДОСТУПА К РЕСУРСАМ =====
    const denied = authorizeRequest(auth, method, pathname, db);
    if (denied) return send(res, denied.status, { error: denied.error });

    if (method === "GET" && pathname === "/projects") return send(res, 200, db.projects.filter((project) => !project.isDeleted));

    if (method === "GET" && pathname === "/link-preview") {
      const targetUrl = url.searchParams.get("url") ?? "";
      const preview = await fetchLinkPreview(targetUrl);
      return send(res, 200, preview);
    }

    let params = route(method, pathname, { method: "POST", path: /^\/projects$/ });
    if (params) {
      const body = await parseBody(req);
      const ownerId = actorFor(auth, body.ownerId ?? body.actorUserId);
      const owner = db.users.find((user) => user.id === ownerId) ?? db.users[0];
      const project = {
        id: idFor(db.projects),
        title: body.title || "Новый проект",
        description: body.description,
        ownerId: owner?.id ?? ownerId,
        isArchived: false,
        createdAt: now(),
        members: [{ id: "1", projectId: "", userId: owner?.id ?? ownerId, role: "owner" }],
        botSettings: defaultBotSettings,
        calendarCategories: [],
        _count: { tasks: 0 },
      };
      project.members[0].projectId = project.id;
      db.projects.push(project);
      db.columns.push(
        { id: idFor(db.columns), projectId: project.id, title: "Идея", position: 0, isDefault: false, isArchive: false, isHidden: false },
        { id: String(Number(idFor(db.columns)) + 1), projectId: project.id, title: "В работе", position: 1, isDefault: true, isArchive: false, isHidden: false },
        { id: String(Number(idFor(db.columns)) + 2), projectId: project.id, title: "Готово", position: 2, isDefault: false, isArchive: false, isHidden: false },
      );
      await writeJson(db);
      return send(res, 201, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "POST", path: /^\/telegram\/users$/ });
    if (params) {
      const body = await parseBody(req);
      // Бот (доверенный сервис) может передавать telegramId напрямую.
      // Веб/Mini App — только через подписанный initData.
      const telegramUser = auth.kind === "bot" ? resolveTelegramUserTrusted(body) : resolveTelegramUser(body);
      if (!telegramUser) return send(res, 401, { error: "Invalid Telegram authorization" });

      let user = db.users.find((item) => item.telegramId === telegramUser.telegramId);
      if (user?.isBlocked) {
        return send(res, 403, { error: "User is blocked" });
      }
      if (!user) {
        user = { id: idFor(db.users), ...telegramUser, createdAt: now(), updatedAt: now() };
        db.users.push(user);
      } else {
        Object.assign(user, {
          username: telegramUser.username ?? user.username,
          firstName: telegramUser.firstName ?? user.firstName,
          lastName: telegramUser.lastName ?? user.lastName,
          photoUrl: telegramUser.photoUrl ?? user.photoUrl,
          updatedAt: now(),
        });
      }
      await writeJson(db);
      return send(res, 200, user);
    }

    params = route(method, pathname, { method: "POST", path: /^\/join-requests$/ });
    if (params) {
      const body = await parseBody(req);
      const code = String(body.code ?? "").trim().toUpperCase();
      const project = db.projects.find((item) => item.inviteCode === code || item.id === code);
      if (!project) return send(res, 404, { error: "Project not found" });
      // Для веб/Mini App заявку создаёт сам аутентифицированный пользователь.
      const userId = auth.kind === "user" ? auth.user.id : body.userId ? asRef(body.userId) : undefined;
      const username =
        auth.kind === "user"
          ? String(auth.user.username ?? "").replace(/^@/, "")
          : String(body.username ?? "").replace(/^@/, "");
      const existingUser = userId
        ? db.users.find((item) => item.id === userId)
        : db.users.find((item) => item.username?.toLowerCase() === username.toLowerCase());
      if (existingUser && project.members.some((member) => member.userId === existingUser.id)) {
        return send(res, 409, { error: "User is already a project member" });
      }
      const existingRequest = db.joinRequests.find(
        (item) =>
          item.projectId === project.id &&
          item.status === "pending" &&
          ((userId && item.userId === userId) || (!userId && item.username === username)),
      );
      if (existingRequest) {
        createJoinRequestSignals(db, project, existingRequest);
        await writeJson(db);
        return send(res, 200, existingRequest);
      }
      const request = {
        id: idFor(db.joinRequests),
        projectId: project.id,
        inviteCode: code,
        userId,
        username,
        displayName: body.displayName,
        status: "pending",
        createdAt: now(),
      };
      db.joinRequests.push(request);
      createJoinRequestSignals(db, project, request);
      await writeJson(db);
      return send(res, 201, request);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/join-requests\/(?<requestId>[^/]+)\/approve$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.projectId);
      const request = db.joinRequests.find((item) => item.id === params.requestId);
      if (!project || !request) return send(res, 404, { error: "Join request not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      let user = request.userId
        ? db.users.find((item) => item.id === request.userId)
        : db.users.find((item) => item.username === request.username);
      if (!user) {
        user = { id: idFor(db.users), telegramId: `mock-${request.username}`, username: request.username, firstName: request.displayName ?? request.username };
        db.users.push(user);
      }
      if (!project.members.some((member) => member.userId === user.id)) {
        project.members.push({ id: idFor(project.members), projectId: project.id, userId: user.id, role: "editor" });
      }
      request.status = "approved";
      request.resolvedAt = now();
      createJoinRequestResolutionSignal(db, project, request, user, "approved");
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/join-requests\/(?<requestId>[^/]+)\/reject$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.projectId);
      const request = db.joinRequests.find((item) => item.id === params.requestId);
      if (!project || !request) return send(res, 404, { error: "Join request not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      request.status = "rejected";
      request.resolvedAt = now();
      const user = request.userId
        ? db.users.find((item) => item.id === request.userId)
        : db.users.find((item) => item.username === request.username);
      if (user) createJoinRequestResolutionSignal(db, project, request, user, "rejected");
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)$/ });
    if (params) return send(res, 200, db.users.find((user) => user.id === params.id) ?? null);

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/bot-preferences$/ });
    if (params) {
      const user = db.users.find((item) => item.id === params.id);
      if (!user) return send(res, 404, { error: "User not found" });
      return send(res, 200, user.botPreferences ?? {});
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/users\/(?<id>[^/]+)\/bot-preferences$/ });
    if (params) {
      const body = await parseBody(req);
      const user = db.users.find((item) => item.id === params.id);
      if (!user) return send(res, 404, { error: "User not found" });
      user.botPreferences = {
        ...(user.botPreferences ?? {}),
        ...(body.defaultProjectId !== undefined ? { defaultProjectId: String(body.defaultProjectId) } : {}),
        ...(body.defaultBoardPageId !== undefined ? { defaultBoardPageId: String(body.defaultBoardPageId) } : {}),
      };
      await writeJson(db);
      return send(res, 200, user.botPreferences);
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/by-username\/(?<username>[^/]+)$/ });
    if (params) {
      const username = decodeURIComponent(params.username).replace(/^@/, "").toLowerCase();
      return send(res, 200, db.users.find((user) => user.username?.toLowerCase() === username) ?? null);
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/projects$/ });
    if (params) {
      const user = db.users.find((item) => item.id === params.id);
      if (user?.isBlocked) return send(res, 403, { error: "User is blocked" });
      return send(
        res,
        200,
        db.projects.filter((project) => !project.isDeleted && project.members.some((member) => member.userId === params.id)).map((project) => hydrateProject(db, project)),
      );
    }

    if (method === "GET" && pathname === "/system/access") {
      return send(res, 200, { isOwner: isSystemOwner(auth, db) });
    }

    if (method === "GET" && pathname === "/system/stats") {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      return send(res, 200, createSystemStats(db));
    }

    if (method === "GET" && pathname === "/system/users/export.json") {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      return sendRaw(res, 200, JSON.stringify(createSystemUserExport(db), null, 2), "application/json; charset=utf-8");
    }

    if (method === "GET" && pathname === "/system/users/export.csv") {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      return sendRaw(res, 200, toCsv(createSystemUserExport(db)), "text/csv; charset=utf-8");
    }

    params = route(method, pathname, { method: "POST", path: /^\/system\/users\/(?<id>[^/]+)\/block$/ });
    if (params) {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      const user = db.users.find((item) => item.id === params.id);
      if (!user) return send(res, 404, { error: "User not found" });
      if (APP_OWNER_TELEGRAM_IDS.has(String(user.telegramId))) {
        return send(res, 400, { error: "Cannot block system owner" });
      }
      const body = await parseBody(req);
      user.isBlocked = true;
      user.blockedAt = now();
      user.blockedByUserId = auth.user?.id ?? "";
      user.blockReason = String(body.reason ?? "").trim();
      await writeJson(db);
      return send(res, 200, publicSystemUser(user, db));
    }

    params = route(method, pathname, { method: "POST", path: /^\/system\/users\/(?<id>[^/]+)\/unblock$/ });
    if (params) {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      const user = db.users.find((item) => item.id === params.id);
      if (!user) return send(res, 404, { error: "User not found" });
      user.isBlocked = false;
      delete user.blockedAt;
      delete user.blockedByUserId;
      delete user.blockReason;
      await writeJson(db);
      return send(res, 200, publicSystemUser(user, db));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<projectId>[^/]+)\/join-requests$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = db.projects.find((item) => item.id === params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      return send(
        res,
        200,
        db.joinRequests
          .filter((request) => request.projectId === project.id && request.status === "pending")
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      );
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)$/ });
    if (params) return send(res, 200, hydrateProject(db, db.projects.find((project) => project.id === params.id && !project.isDeleted)) ?? null);

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/invite-code$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      project.inviteCode ??= createInviteCode(project.id);
      await writeJson(db);
      return send(res, 200, { inviteCode: project.inviteCode });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/invite-code\/rotate$/ });
    if (params) {
      const body = await parseBody(req);
      const actorUserId = actorFor(auth, body.actorUserId);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      project.inviteCode = createInviteCode(project.id);
      await writeJson(db);
      return send(res, 200, { inviteCode: project.inviteCode });
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      Object.assign(project, body);
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      project.isDeleted = true;
      project.deletedAt = now();
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    if (method === "GET" && pathname === "/projects-trash") {
      return send(res, 200, db.projects.filter((project) => project.isDeleted).map((project) => hydrateProject(db, project)));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/restore$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      project.isDeleted = false;
      delete project.deletedAt;
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/purge$/ });
    if (params) {
      db.projects = db.projects.filter((item) => item.id !== params.id);
      db.columns = db.columns.filter((item) => item.projectId !== params.id);
      db.tasks = db.tasks.filter((item) => item.projectId !== params.id);
      db.subtasks = db.subtasks.filter((subtask) => db.tasks.some((task) => task.id === subtask.taskId));
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/members$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      const users = project?.members.map((member) => db.users.find((user) => user.id === member.userId)).filter(Boolean) ?? [];
      return send(res, 200, users);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/members$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const username = String(body.username ?? "").replace(/^@/, "").trim();
      let user = db.users.find((item) => item.username === username);
      if (!user) {
        user = { id: idFor(db.users), telegramId: `mock-${username}`, username, firstName: username };
        db.users.push(user);
      }
      if (!project.members.some((member) => member.userId === user.id)) {
        project.members.push({ id: idFor(project.members), projectId: project.id, userId: user.id, role: "editor" });
      }
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      project.members = project.members.filter((member) => member.id !== params.memberId);
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)\/admin$/ });
    if (params) {
      const body = await parseBody(req);
      const actorUserId = actorFor(auth, body.actorUserId);
      const project = db.projects.find((item) => item.id === params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (project.ownerId !== actorUserId) return send(res, 403, { error: "Only project owner can manage admins" });
      const member = project.members.find((item) => item.id === params.memberId);
      if (!member) return send(res, 404, { error: "Member not found" });
      if (member.userId === project.ownerId) return send(res, 400, { error: "Owner already has admin access" });
      member.role = body.enabled ? "admin" : "editor";
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/leave$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (project.ownerId === actorUserId) {
        return send(res, 400, { error: "Owner cannot leave. Transfer ownership first." });
      }
      project.members = project.members.filter((member) => member.userId !== actorUserId);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/transfer-ownership$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (project.ownerId !== actorFor(auth, body.actorUserId)) {
        return send(res, 403, { error: "Only project owner can transfer ownership" });
      }
      const member = project.members.find((item) => item.id === String(body.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      project.ownerId = member.userId;
      project.members = project.members.map((item) => ({
        ...item,
        role: item.userId === member.userId ? "owner" : item.role === "owner" ? "admin" : item.role,
      }));
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/columns$/ });
    if (params) {
      const pageId = url.searchParams.get("pageId") ?? undefined;
      const created = ensureBoardColumns(db, params.id, pageId);
      if (created) await writeJson(db);
      return send(res, 200, db.columns
        .filter((column) => column.projectId === params.id && sameBoard(column.pageId, pageId))
        .sort((a, b) => a.position - b.position));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/columns$/ });
    if (params) {
      const body = await parseBody(req);
      const siblings = db.columns.filter((column) => column.projectId === params.id && sameBoard(column.pageId, body.pageId));
      const column = {
        id: idFor(db.columns),
        projectId: params.id,
        pageId: body.pageId,
        title: body.title || "Новая колонка",
        position: siblings.length,
        isDefault: false,
        isArchive: false,
        isHidden: false,
      };
      db.columns.push(column);
      await writeJson(db);
      return send(res, 201, column);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/columns\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const column = db.columns.find((item) => item.id === params.id);
      if (!column) return send(res, 404, { error: "Column not found" });
      if (body.title) column.title = body.title;
      await writeJson(db);
      return send(res, 200, column);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/columns\/(?<id>[^/]+)$/ });
    if (params) {
      const column = db.columns.find((item) => item.id === params.id);
      if (!column) return send(res, 404, { error: "Column not found" });
      const siblings = db.columns.filter((item) => item.projectId === column.projectId && sameBoard(item.pageId, column.pageId)).sort((a, b) => a.position - b.position);
      if (siblings.length <= 1) return send(res, 400, { error: "Cannot delete the last column" });
      const fallback = siblings.find((item) => item.id !== column.id);
      db.tasks = db.tasks.map((task) => task.columnId === column.id ? { ...task, columnId: fallback.id, updatedAt: now() } : task);
      db.columns = db.columns.filter((item) => item.id !== column.id);
      normalizeColumnPositions(db, column.projectId, column.pageId);
      await writeJson(db);
      return send(res, 200, db.columns.filter((item) => item.projectId === column.projectId && sameBoard(item.pageId, column.pageId)).sort((a, b) => a.position - b.position));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/columns\/reorder$/ });
    if (params) {
      const body = await parseBody(req);
      db.columns = db.columns.map((column) => {
        const position = body.orderedIds.map(String).indexOf(column.id);
        return column.projectId === params.id && position !== -1 ? { ...column, position } : column;
      });
      await writeJson(db);
      return send(res, 200, db.columns.filter((column) => column.projectId === params.id && sameBoard(column.pageId, body.pageId)).sort((a, b) => a.position - b.position));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/tasks$/ });
    if (params) {
      const archived = url.searchParams.get("archived") === "1";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      const pageId = url.searchParams.get("pageId") ?? undefined;
      const allBoards = url.searchParams.get("allBoards") === "1";
      return send(res, 200, db.tasks
        .filter((task) => task.projectId === params.id && (allBoards || sameBoard(task.pageId, pageId)) && (includeArchived || Boolean(task.isArchived) === archived))
        .sort((a, b) => a.position - b.position)
        .map((task) => hydrateTask(db, task)));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/blocks$/ });
    if (params) return send(res, 200, db.blocks.filter((block) => block.projectId === params.id));

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/calendar-events$/ });
    if (params) {
      return send(res, 200, db.calendarEvents
        .filter((event) => event.projectId === params.id)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/calendar-events$/ });
    if (params) {
      const body = await parseBody(req);
      const createdAt = now();
      const event = {
        id: `event_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId: params.id,
        title: String(body.title || "РќРѕРІРѕРµ СЃРѕР±С‹С‚РёРµ").trim(),
        description: body.description ? String(body.description) : "",
        startsAt: body.startsAt ? new Date(body.startsAt).toISOString() : createdAt,
        endsAt: body.endsAt ? new Date(body.endsAt).toISOString() : undefined,
        allDay: Boolean(body.allDay),
        type: normalizeCalendarEventType(body.type),
        color: String(body.color || "#3B82F6"),
        categoryId: body.categoryId ? String(body.categoryId) : undefined,
        categoryLabel: body.categoryLabel ? String(body.categoryLabel) : "",
        visibility: body.visibility === "selected" ? "selected" : "project",
        participantUserIds: Array.isArray(body.participantUserIds) ? body.participantUserIds.map(String) : [],
        location: body.location ? String(body.location) : "",
        link: body.link ? String(body.link) : "",
        sourceType: body.sourceType ? String(body.sourceType) : "manual",
        sourceId: body.sourceId ? String(body.sourceId) : undefined,
        createdAt,
        updatedAt: createdAt,
      };
      db.calendarEvents.push(event);
      await writeJson(db);
      return send(res, 201, event);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/calendar-events\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const event = db.calendarEvents.find((item) => item.id === params.id);
      if (!event) return send(res, 404, { error: "Calendar event not found" });
      Object.assign(event, {
        title: body.title !== undefined ? String(body.title).trim() : event.title,
        description: body.description !== undefined ? String(body.description) : event.description,
        startsAt: body.startsAt !== undefined ? new Date(body.startsAt).toISOString() : event.startsAt,
        endsAt: body.endsAt !== undefined ? (body.endsAt ? new Date(body.endsAt).toISOString() : undefined) : event.endsAt,
        allDay: body.allDay !== undefined ? Boolean(body.allDay) : event.allDay,
        type: body.type !== undefined ? normalizeCalendarEventType(body.type) : event.type,
        color: body.color !== undefined ? String(body.color) : event.color,
        categoryId: body.categoryId !== undefined ? (body.categoryId ? String(body.categoryId) : undefined) : event.categoryId,
        categoryLabel: body.categoryLabel !== undefined ? String(body.categoryLabel) : event.categoryLabel,
        visibility: body.visibility === "selected" ? "selected" : body.visibility === "project" ? "project" : event.visibility,
        participantUserIds: body.participantUserIds !== undefined && Array.isArray(body.participantUserIds) ? body.participantUserIds.map(String) : event.participantUserIds,
        location: body.location !== undefined ? String(body.location) : event.location,
        link: body.link !== undefined ? String(body.link) : event.link,
        updatedAt: now(),
      });
      await writeJson(db);
      return send(res, 200, event);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/calendar-events\/(?<id>[^/]+)$/ });
    if (params) {
      db.calendarEvents = db.calendarEvents.filter((event) => event.id !== params.id);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/templates$/ });
    if (params) {
      return send(res, 200, db.templates
        .filter((template) => template.projectId === params.id)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/templates$/ });
    if (params) {
      const body = await parseBody(req);
      const createdAt = now();
      const template = {
        id: `template_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId: params.id,
        title: String(body.title || "Новый шаблон").trim(),
        icon: String(body.icon || "📄").trim() || "📄",
        description: body.description ? String(body.description) : "",
        order: db.templates.filter((item) => item.projectId === params.id).length,
        nodeType: body.nodeType === "kanban" || body.nodeType === "folder" ? body.nodeType : "page",
        isCustom: true,
        blocks: Array.isArray(body.blocks) ? body.blocks : [],
        createdAt,
        updatedAt: createdAt,
      };
      db.templates.push(template);
      await writeJson(db);
      return send(res, 201, template);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/templates\/reorder$/ });
    if (params) {
      const body = await parseBody(req);
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
      db.templates = db.templates.map((template) => {
        const order = orderedIds.indexOf(template.id);
        return template.projectId === params.id && order !== -1
          ? { ...template, order, updatedAt: now() }
          : template;
      });
      normalizeTemplateOrder(db, params.id);
      await writeJson(db);
      return send(res, 200, db.templates
        .filter((template) => template.projectId === params.id)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/templates\/(?<templateId>[^/]+)$/ });
    if (params) {
      db.templates = db.templates.filter((template) => !(template.projectId === params.id && template.id === params.templateId));
      normalizeTemplateOrder(db, params.id);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/reminders$/ });
    if (params) {
      return send(res, 200, db.reminders
        .filter((reminder) => reminder.projectId === params.id && reminder.status !== "cancelled")
        .sort((a, b) => new Date(a.nextRunAt ?? a.remindAt ?? 0).getTime() - new Date(b.nextRunAt ?? b.remindAt ?? 0).getTime()));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/reminders$/ });
    if (params) {
      const body = await parseBody(req);
      const createdAt = now();
      const scheduleType = body.scheduleType === "recurring" ? "recurring" : "once";
      const reminder = {
        id: `reminder_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId: params.id,
        creatorUserId: asRef(body.creatorUserId ?? "1"),
        targetUserId: asRef(body.targetUserId ?? body.creatorUserId ?? "1"),
        sourceType: normalizeReminderSourceType(body.sourceType),
        sourceId: body.sourceId ? String(body.sourceId) : undefined,
        title: String(body.title || "РќРѕРІРѕРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ").trim(),
        description: body.description ? String(body.description) : "",
        scheduleType,
        remindAt: body.remindAt ? new Date(body.remindAt).toISOString() : undefined,
        recurrence: scheduleType === "recurring" ? normalizeReminderRecurrence(body.recurrence) : undefined,
        status: "active",
        channels: {
          app: body.channels?.app !== false,
          telegramBot: body.channels?.telegramBot !== false,
        },
        createdAt,
        updatedAt: createdAt,
      };
      reminder.nextRunAt = computeReminderNextRun(reminder, createdAt);
      db.reminders.push(reminder);
      await writeJson(db);
      return send(res, 201, reminder);
    }

    if (method === "GET" && pathname === "/reminders/due") {
      const before = new Date(url.searchParams.get("before") ?? now()).getTime();
      return send(res, 200, db.reminders
        .filter((reminder) => reminder.status === "active")
        .filter((reminder) => reminder.nextRunAt && new Date(reminder.nextRunAt).getTime() <= before));
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/reminders\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const reminder = db.reminders.find((item) => item.id === params.id);
      if (!reminder) return send(res, 404, { error: "Reminder not found" });
      Object.assign(reminder, {
        targetUserId: body.targetUserId !== undefined ? asRef(body.targetUserId) : reminder.targetUserId,
        title: body.title !== undefined ? String(body.title).trim() : reminder.title,
        description: body.description !== undefined ? String(body.description) : reminder.description,
        sourceType: body.sourceType !== undefined ? normalizeReminderSourceType(body.sourceType) : reminder.sourceType,
        sourceId: body.sourceId !== undefined ? (body.sourceId ? String(body.sourceId) : undefined) : reminder.sourceId,
        scheduleType: body.scheduleType === "recurring" ? "recurring" : body.scheduleType === "once" ? "once" : reminder.scheduleType,
        remindAt: body.remindAt !== undefined ? (body.remindAt ? new Date(body.remindAt).toISOString() : undefined) : reminder.remindAt,
        recurrence: body.recurrence !== undefined ? normalizeReminderRecurrence(body.recurrence) : reminder.recurrence,
        status: body.status ?? reminder.status,
        channels: body.channels ? {
          app: body.channels.app !== false,
          telegramBot: body.channels.telegramBot !== false,
        } : reminder.channels,
        updatedAt: now(),
      });
      reminder.nextRunAt = reminder.status === "active" ? computeReminderNextRun(reminder, reminder.lastSentAt ?? now()) : reminder.nextRunAt;
      await writeJson(db);
      return send(res, 200, reminder);
    }

    params = route(method, pathname, { method: "POST", path: /^\/reminders\/(?<id>[^/]+)\/sent$/ });
    if (params) {
      const reminder = db.reminders.find((item) => item.id === params.id);
      if (!reminder) return send(res, 404, { error: "Reminder not found" });
      const sentAt = now();
      reminder.lastSentAt = sentAt;
      reminder.updatedAt = sentAt;
      if (reminder.scheduleType === "once") {
        reminder.status = "done";
        reminder.nextRunAt = undefined;
      } else {
        reminder.nextRunAt = computeReminderNextRun(reminder, sentAt);
      }
      await writeJson(db);
      return send(res, 200, reminder);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/reminders\/(?<id>[^/]+)$/ });
    if (params) {
      const reminder = db.reminders.find((item) => item.id === params.id);
      if (!reminder) return send(res, 404, { error: "Reminder not found" });
      reminder.status = "cancelled";
      reminder.updatedAt = now();
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/space$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!db.spaces) db.spaces = {};
      if (!db.spaces[params.id]) {
        db.spaces[params.id] = createDefaultSpace(params.id, project.title);
        db.blocks = syncBlocksFromSpaces(db.spaces);
        await writeJson(db);
      }
      return send(res, 200, db.spaces[params.id]);
    }

    params = route(method, pathname, { method: "PUT", path: /^\/projects\/(?<id>[^/]+)\/space$/ });
    if (params) {
      const body = await parseBody(req);
      if (!db.spaces) db.spaces = {};
      db.spaces[params.id] = {
        nodes: body.nodes ?? [],
        blocks: body.blocks ?? [],
        collapsedIds: body.collapsedIds ?? [],
        recentPages: body.recentPages ?? [],
        dailyNotes: body.dailyNotes ?? {},
      };
      db.blocks = syncBlocksFromSpaces(db.spaces);
      await writeJson(db);
      return send(res, 200, db.spaces[params.id]);
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/assigned-tasks$/ });
    if (params) {
      return send(
        res,
        200,
        db.tasks
          .filter((task) => task.assigneeId === params.id && isTaskActiveForUserList(db, task))
          .map((task) => hydrateTask(db, task)),
      );
    }

    params = route(method, pathname, { method: "GET", path: /^\/tasks\/(?<id>[^/]+)$/ });
    if (params) {
      const task = db.tasks.find((item) => item.id === params.id);
      return send(res, task ? 200 : 404, task ? hydrateTask(db, task) : { error: "Task not found" });
    }

    params = route(method, pathname, { method: "POST", path: /^\/tasks$/ });
    if (params) {
      const body = await parseBody(req);
      const projectId = String(body.projectId);
      if (auth.kind === "user" && !isProjectMember(db, projectId, auth.user.id)) {
        return send(res, 403, { error: "Access denied" });
      }
      const pageId = body.pageId ? String(body.pageId) : undefined;
      const firstColumn = db.columns
        .filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId) && !column.isHidden)
        .sort((a, b) => a.position - b.position)[0];
      const columnId = String(body.columnId ?? firstColumn?.id ?? "");
      if (!columnId) return send(res, 400, { error: "Column not found" });
      const siblings = db.tasks.filter((task) => task.columnId === columnId && !task.isArchived);
      const task = {
        id: idFor(db.tasks),
        projectId,
        pageId,
        columnId,
        creatorId: auth.kind === "user" ? auth.user.id : body.creatorId !== undefined ? String(body.creatorId) : undefined,
        assigneeId: body.assigneeId !== undefined ? String(body.assigneeId) : undefined,
        title: body.title || "Новая задача",
        description: body.description,
        priority: body.priority ?? "MEDIUM",
        deadlineAt: body.deadlineAt,
        scheduledAt: body.scheduledAt,
        colorLabel: body.colorLabel,
        isRepeating: Boolean(body.isRepeating),
        position: Number(body.position ?? siblings.length),
        isArchived: false,
        createdAt: now(),
        updatedAt: now(),
        subtasks: [],
      };
      db.tasks.push(task);
      createTaskNotificationSignals(db, task);
      await writeJson(db);
      return send(res, 201, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/tasks\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const task = db.tasks.find((item) => item.id === params.id);
      if (!task) return send(res, 404, { error: "Task not found" });
      const previousColumnId = task.columnId;
      const previousArchived = Boolean(task.isArchived);
      Object.assign(task, normalizeTaskPatch(body), { updatedAt: now() });
      updateTaskCompletionState(db, task, previousColumnId, previousArchived);
      createTaskNotificationSignals(db, task);
      await writeJson(db);
      return send(res, 200, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "POST", path: /^\/tasks\/(?<id>[^/]+)\/move$/ });
    if (params) {
      const body = await parseBody(req);
      const task = db.tasks.find((item) => item.id === params.id);
      if (!task) return send(res, 404, { error: "Task not found" });
      const previousColumnId = task.columnId;
      task.columnId = String(body.columnId);
      task.position = Number(body.position ?? 0);
      task.updatedAt = now();
      updateTaskCompletionState(db, task, previousColumnId, Boolean(task.isArchived));
      normalizeTaskPositions(db, task.columnId);
      await writeJson(db);
      return send(res, 200, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "POST", path: /^\/columns\/(?<id>[^/]+)\/tasks\/reorder$/ });
    if (params) {
      const body = await parseBody(req);
      const ordered = body.orderedIds.map(String);
      db.tasks = db.tasks.map((task) => {
        const position = ordered.indexOf(task.id);
        if (position === -1) return task;
        const nextTask = { ...task, columnId: params.id, position, updatedAt: now() };
        updateTaskCompletionState(db, nextTask, task.columnId, Boolean(task.isArchived));
        return nextTask;
      });
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "POST", path: /^\/tasks\/(?<id>[^/]+)\/archive$/ });
    if (params) {
      const task = db.tasks.find((item) => item.id === params.id);
      if (!task) return send(res, 404, { error: "Task not found" });
      task.isArchived = true;
      task.archivedAt = now();
      task.completedAt ??= task.archivedAt;
      task.updatedAt = now();
      await writeJson(db);
      return send(res, 200, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/tasks\/(?<id>[^/]+)$/ });
    if (params) {
      db.tasks = db.tasks.filter((task) => task.id !== params.id);
      db.subtasks = db.subtasks.filter((subtask) => subtask.taskId !== params.id);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/archive$/ });
    if (params) {
      const archivedIds = new Set(db.tasks.filter((task) => task.projectId === params.id && task.isArchived).map((task) => task.id));
      db.tasks = db.tasks.filter((task) => !archivedIds.has(task.id));
      db.subtasks = db.subtasks.filter((subtask) => !archivedIds.has(subtask.taskId));
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "POST", path: /^\/tasks\/(?<id>[^/]+)\/subtasks$/ });
    if (params) {
      const body = await parseBody(req);
      const siblings = db.subtasks.filter((subtask) => subtask.taskId === params.id);
      const subtask = { id: idFor(db.subtasks), taskId: params.id, title: body.title || "", isCompleted: false, position: siblings.length };
      db.subtasks.push(subtask);
      await writeJson(db);
      return send(res, 201, subtask);
    }

    params = route(method, pathname, { method: "POST", path: /^\/tasks\/(?<taskId>[^/]+)\/subtasks\/(?<subtaskId>[^/]+)\/toggle$/ });
    if (params) {
      const subtask = db.subtasks.find((item) => item.id === params.subtaskId && item.taskId === params.taskId);
      if (!subtask) return send(res, 404, { error: "Subtask not found" });
      subtask.isCompleted = !subtask.isCompleted;
      subtask.completedAt = subtask.isCompleted ? now() : undefined;
      const siblings = db.subtasks.filter((item) => item.taskId === params.taskId);
      await writeJson(db);
      return send(res, 200, { subtask, allCompleted: siblings.every((item) => item.isCompleted) });
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/tasks\/(?<taskId>[^/]+)\/subtasks\/(?<subtaskId>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const subtask = db.subtasks.find((item) => item.id === params.subtaskId && item.taskId === params.taskId);
      if (!subtask) return send(res, 404, { error: "Subtask not found" });
      subtask.title = body.title ?? subtask.title;
      await writeJson(db);
      return send(res, 200, subtask);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/tasks\/(?<taskId>[^/]+)\/subtasks\/(?<subtaskId>[^/]+)$/ });
    if (params) {
      db.subtasks = db.subtasks.filter((item) => !(item.id === params.subtaskId && item.taskId === params.taskId));
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/bot-settings$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      project.botSettings ??= defaultBotSettings;
      await writeJson(db);
      return send(res, 200, project.botSettings);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)\/bot-settings$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      project.botSettings = mergeSettings(project.botSettings ?? defaultBotSettings, body);
      await writeJson(db);
      return send(res, 200, project.botSettings);
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/activity$/ });
    if (params) {
      const retentionDays = Number(url.searchParams.get("retentionDays") ?? 7);
      const minTime = Date.now() - retentionDays * 24 * 3600000;
      const events = db.activity
        .filter((event) => event.projectId === params.id && new Date(event.createdAt).getTime() >= minTime)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return send(res, 200, events);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/activity$/ });
    if (params) {
      const body = await parseBody(req);
      const event = {
        ...body,
        id: body.id ?? `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId: params.id,
        createdAt: body.createdAt ?? now(),
      };
      db.activity.unshift(event);
      db.activity = db.activity.slice(0, 2000);
      await writeJson(db);
      return send(res, 201, event);
    }

    params = route(method, pathname, { method: "POST", path: /^\/notifications$/ });
    if (params) {
      const body = await parseBody(req);
      const event = { ...body, id: idFor(db.notifications), status: "pending" };
      db.notifications.push(event);
      await writeJson(db);
      return send(res, 201, event);
    }

    if (method === "GET" && pathname === "/notifications/pending") {
      const before = url.searchParams.get("before") ?? now();
      const time = new Date(before).getTime();
      return send(
        res,
        200,
        db.notifications.filter((item) => item.status === "pending" && new Date(item.sendAt).getTime() <= time && !isNotificationSuppressed(db, item)),
      );
    }

    params = route(method, pathname, { method: "GET", path: /^\/notifications\/exists$/ });
    if (params) {
      const entityId = url.searchParams.get("entityId");
      const type = url.searchParams.get("type");
      const userId = url.searchParams.get("userId");
      const sendAt = url.searchParams.get("sendAt");
      return send(res, 200, {
        exists: db.notifications.some(
          (item) =>
            item.entityId === entityId &&
            item.type === type &&
            item.userId === userId &&
            (!sendAt || item.sendAt === sendAt),
        ),
      });
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/notifications\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const item = db.notifications.find((notification) => notification.id === params.id);
      if (!item) return send(res, 404, { error: "Notification not found" });
      Object.assign(item, body);
      await writeJson(db);
      return send(res, 200, item);
    }

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
}

function mergeSettings(current, patch) {
  return {
    ...current,
    ...patch,
    reports: {
      weekly: {
        ...current.reports?.weekly,
        ...patch.reports?.weekly,
        sections: {
          ...current.reports?.weekly?.sections,
          ...patch.reports?.weekly?.sections,
        },
      },
      overdue: {
        ...current.reports?.overdue,
        ...patch.reports?.overdue,
        sections: {
          ...current.reports?.overdue?.sections,
          ...patch.reports?.overdue?.sections,
        },
      },
    },
  };
}

function asRef(value) {
  return value === undefined || value === null || value === "" ? value : String(value);
}

function normalizeDatabaseIds(db) {
  db.users = db.users.map((user) => ({ ...user, id: asRef(user.id) }));
  db.projects = db.projects.map((project) => ({
    ...project,
    id: asRef(project.id),
    ownerId: asRef(project.ownerId),
    calendarCategories: normalizeCalendarCategories(project.calendarCategories),
    members: (project.members ?? []).map((member) => ({
      ...member,
      id: asRef(member.id),
      projectId: asRef(member.projectId),
      userId: asRef(member.userId),
    })),
  }));
  db.columns = db.columns.map((column) => ({
    ...column,
    id: asRef(column.id),
    projectId: asRef(column.projectId),
    pageId: asRef(column.pageId),
  }));
  db.tasks = db.tasks.map((task) => ({
    ...task,
    id: asRef(task.id),
    projectId: asRef(task.projectId),
    pageId: asRef(task.pageId),
    columnId: asRef(task.columnId),
    creatorId: asRef(task.creatorId),
    assigneeId: asRef(task.assigneeId),
  }));
  const repairedTasks = repairIncompleteTasks(db);
  db.subtasks = db.subtasks.map((subtask) => ({
    ...subtask,
    id: asRef(subtask.id),
    taskId: asRef(subtask.taskId),
  }));
  db.activity = db.activity.map((event) => ({
    ...event,
    projectId: asRef(event.projectId),
    userId: asRef(event.userId),
    entityId: asRef(event.entityId),
  }));
  db.notifications = db.notifications.map((notification) => ({
    ...notification,
    projectId: asRef(notification.projectId),
    userId: asRef(notification.userId),
    taskId: asRef(notification.taskId),
  }));
  db.joinRequests = db.joinRequests.map((request) => ({
    ...request,
    id: asRef(request.id),
    projectId: asRef(request.projectId),
  }));
  db.templates = db.templates.map((template) => ({
    ...template,
    id: asRef(template.id),
    projectId: asRef(template.projectId),
  }));
  db.reminders = db.reminders.map((reminder) => ({
    ...reminder,
    id: asRef(reminder.id),
    projectId: asRef(reminder.projectId),
    creatorUserId: asRef(reminder.creatorUserId),
    targetUserId: asRef(reminder.targetUserId),
    sourceId: asRef(reminder.sourceId),
    sourceType: normalizeReminderSourceType(reminder.sourceType),
    scheduleType: reminder.scheduleType === "recurring" ? "recurring" : "once",
    status: reminder.status ?? "active",
    channels: {
      app: reminder.channels?.app !== false,
      telegramBot: reminder.channels?.telegramBot !== false,
    },
    nextRunAt: reminder.nextRunAt ?? computeReminderNextRun(reminder),
  }));
  db.calendarEvents = db.calendarEvents.map((event) => ({
    ...event,
    id: asRef(event.id),
    projectId: asRef(event.projectId),
    sourceId: asRef(event.sourceId),
    categoryId: asRef(event.categoryId),
    categoryLabel: event.categoryLabel ? String(event.categoryLabel) : "",
    participantUserIds: Array.isArray(event.participantUserIds) ? event.participantUserIds.map(String) : [],
    type: normalizeCalendarEventType(event.type),
    visibility: event.visibility === "selected" ? "selected" : "project",
  }));
  return repairedTasks;
}

function normalizeTaskPatch(patch) {
  const next = { ...patch };
  for (const key of ["projectId", "pageId", "columnId", "creatorId", "assigneeId"]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key] !== undefined && patch[key] !== null ? asRef(patch[key]) : undefined;
    }
  }
  return next;
}

function repairIncompleteTasks(db) {
  let repaired = 0;
  for (const task of db.tasks) {
    if (task.isArchived) continue;

    const currentColumn = task.columnId ? db.columns.find((column) => column.id === task.columnId) : undefined;
    if (currentColumn) {
      task.projectId ??= currentColumn.projectId;
      task.pageId ??= currentColumn.pageId;
      repaired += 1;
      continue;
    }

    const projectId = task.projectId ?? db.projects[0]?.id;
    if (!projectId) continue;

    const projectNodes = db.spaces?.[projectId]?.nodes ?? [];
    const kanbanPage = projectNodes.find((node) => node.type === "kanban" && !node.isDeleted);
    const targetColumn = db.columns
      .filter((column) => column.projectId === projectId && sameBoard(column.pageId, kanbanPage?.id) && !column.isHidden)
      .sort((a, b) => a.position - b.position)[0];

    if (!targetColumn) continue;

    task.projectId = projectId;
    task.pageId = targetColumn.pageId;
    task.columnId = targetColumn.id;
    task.position = Number.isFinite(Number(task.position)) ? Number(task.position) : db.tasks.filter((item) => item.columnId === targetColumn.id).length;
    repaired += 1;
  }
  return repaired;
}

function hydrateProject(db, project) {
  if (!project) return undefined;
  return {
    ...project,
    columns: db.columns.filter((column) => column.projectId === project.id).sort((a, b) => a.position - b.position),
    members: (project.members ?? []).map((member) => ({
      ...member,
      user: db.users.find((user) => user.id === member.userId),
      role: { name: member.role, permissions: {} },
    })),
    _count: {
      tasks: db.tasks.filter((task) => task.projectId === project.id && !task.isArchived).length,
    },
  };
}

function hydrateTask(db, task) {
  return {
    ...task,
    assignee: task.assigneeId ? db.users.find((user) => user.id === task.assigneeId) : undefined,
    subtasks: db.subtasks.filter((subtask) => subtask.taskId === task.id).sort((a, b) => a.position - b.position),
    tags: task.tags ?? [],
  };
}

function canManageProjectAccess(project, userId) {
  return project.ownerId === userId || (project.members ?? []).some((member) => member.userId === userId && member.role === "admin");
}

// Владелец приложения определяется ТОЛЬКО по telegramId аутентифицированного пользователя.
function isSystemOwner(auth, db) {
  if (!APP_OWNER_TELEGRAM_IDS.size) return false;
  if (auth.kind === "bot") return true;
  const telegramId = auth.user?.telegramId;
  return Boolean(telegramId && APP_OWNER_TELEGRAM_IDS.has(String(telegramId)));
}

// Возвращает id того, кто реально выполняет действие.
// Для веб/Mini App — это всегда аутентифицированный пользователь (тело запроса игнорируется).
// Для бота (доверенный сервис) — берётся переданное значение.
function actorFor(auth, provided) {
  if (auth.kind === "user") return auth.user.id;
  return asRef(provided);
}

function isProjectMember(db, projectId, userId) {
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return true; // проект не найден — пусть эндпоинт вернёт 404
  return project.ownerId === userId || (project.members ?? []).some((member) => member.userId === userId);
}

// Извлекает projectId из пути, если маршрут привязан к проекту.
//   null      — маршрут не про конкретный проект (проверка членства не нужна)
//   undefined — сущность не найдена (пусть эндпоинт вернёт 404)
//   string    — id проекта
function resolveProjectIdFromPath(pathname, db) {
  if (pathname === "/join-requests") return null; // вступление по коду — членство ещё не требуется

  let m = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  if (m) return m[1];

  m = pathname.match(/^\/tasks\/([^/]+)(?:\/|$)/);
  if (m) return db.tasks.find((task) => task.id === m[1])?.projectId;

  m = pathname.match(/^\/columns\/([^/]+)(?:\/|$)/);
  if (m) return db.columns.find((column) => column.id === m[1])?.projectId;

  m = pathname.match(/^\/calendar-events\/([^/]+)(?:\/|$)/);
  if (m) return db.calendarEvents.find((event) => event.id === m[1])?.projectId;

  m = pathname.match(/^\/reminders\/([^/]+)(?:\/|$)/);
  if (m) {
    if (m[1] === "due") return null;
    return db.reminders.find((reminder) => reminder.id === m[1])?.projectId;
  }

  return null;
}

// Центральный guard доступа. Бот доверенный. Пользователь ограничен своими данными и проектами.
function authorizeRequest(auth, method, pathname, db) {
  if (auth.kind === "bot") return undefined;
  const userId = auth.user.id;

  // Личные маршруты — только про себя
  const selfOnly = pathname.match(/^\/users\/([^/]+)\/(projects|assigned-tasks|bot-preferences)$/);
  if (selfOnly) {
    if (selfOnly[1] !== userId) return { status: 403, error: "Access denied" };
    return undefined;
  }

  // Список всех проектов и outbox — только для бота
  if (method === "GET" && pathname === "/projects") return { status: 403, error: "Access denied" };
  if (pathname.startsWith("/outbox")) return { status: 403, error: "Access denied" };

  // Системная админка — только владелец приложения
  if (pathname.startsWith("/system/")) {
    if (!isSystemOwner(auth, db)) return { status: 403, error: "Forbidden" };
    return undefined;
  }

  // Проектно-ограниченные маршруты — нужно быть участником проекта
  const projectId = resolveProjectIdFromPath(pathname, db);
  if (projectId && !isProjectMember(db, projectId, userId)) {
    return { status: 403, error: "Access denied" };
  }
  return undefined;
}

function createSystemStats(db) {
  const nodes = Object.values(db.spaces ?? {}).flatMap((space) => Array.isArray(space.nodes) ? space.nodes : []);
  const blocks = db.blocks ?? [];
  const completedTasks = db.tasks.filter((task) => task.isArchived || task.completedAt || isTaskInFinalColumn(db, task));
  const activeUsersSince = Date.now() - 30 * 24 * 3600000;
  const activeUsers = db.users.filter((user) => new Date(user.updatedAt ?? user.createdAt ?? 0).getTime() >= activeUsersSince);
  const database = getDatabaseVolume(db);
  const projectDataBytes = getAllProjectsDataBytes(db);

  return {
    generatedAt: now(),
    totals: {
      users: db.users.length,
      blockedUsers: db.users.filter((user) => user.isBlocked).length,
      activeUsers30d: activeUsers.length,
      projects: db.projects.length,
      activeProjects: db.projects.filter((project) => !project.isDeleted && !project.isArchived).length,
      archivedProjects: db.projects.filter((project) => project.isDeleted || project.isArchived).length,
      projectMembers: db.projects.reduce((sum, project) => sum + (project.members?.length ?? 0), 0),
      tasks: db.tasks.length,
      activeTasks: db.tasks.filter((task) => !task.isArchived && !task.completedAt && !isTaskInFinalColumn(db, task)).length,
      completedTasks: completedTasks.length,
      archivedTasks: db.tasks.filter((task) => task.isArchived).length,
      subtasks: db.subtasks.length,
      pages: nodes.filter((node) => node.type === "page").length,
      folders: nodes.filter((node) => node.type === "folder").length,
      kanbanPages: nodes.filter((node) => node.type === "kanban").length,
      blocks: blocks.length,
      simpleTables: blocks.filter((block) => block.type === "simple_table").length,
      reminders: db.reminders.length,
      calendarEvents: db.calendarEvents.length,
      notifications: db.notifications.length,
      pendingNotifications: db.notifications.filter((item) => item.status === "pending").length,
      failedNotifications: db.notifications.filter((item) => item.status === "failed").length,
      activityEvents: db.activity.length,
      joinRequests: db.joinRequests.length,
      projectDataBytes,
      projectDataMb: Number((projectDataBytes / 1024 / 1024).toFixed(2)),
    },
    database,
    users: createSystemUserExport(db).slice(0, 200),
    recentUsers: [...db.users]
      .sort((a, b) => new Date(b.createdAt ?? b.updatedAt ?? 0).getTime() - new Date(a.createdAt ?? a.updatedAt ?? 0).getTime())
      .slice(0, 20)
      .map((user) => publicSystemUser(user, db)),
  };
}

function createSystemUserExport(db) {
  return db.users.map((user) => publicSystemUser(user, db));
}

function publicSystemUser(user, db) {
  const memberships = db.projects.filter((project) => (project.members ?? []).some((member) => member.userId === user.id));
  const ownedProjects = db.projects.filter((project) => project.ownerId === user.id);
  const assignedTasks = db.tasks.filter((task) => task.assigneeId === user.id);
  const createdTasks = db.tasks.filter((task) => task.creatorId === user.id);
  const completedTasks = assignedTasks.filter((task) => task.isArchived || task.completedAt || isTaskInFinalColumn(db, task));
  const lastActivity = db.activity.find((event) => event.userId === user.id);
  const storageBytes = getUserDataBytes(db, user);
  const storageLimitBytes = 50 * 1024 * 1024;
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    createdAt: user.createdAt ?? "",
    updatedAt: user.updatedAt ?? "",
    lastActivityAt: lastActivity?.createdAt ?? "",
    isBlocked: Boolean(user.isBlocked),
    blockedAt: user.blockedAt ?? "",
    storageBytes,
    storageMb: Number((storageBytes / 1024 / 1024).toFixed(2)),
    storageLimitBytes,
    storageLimitMb: 50,
    storageUsagePercent: Math.min(100, Number(((storageBytes / storageLimitBytes) * 100).toFixed(1))),
    projectsCount: memberships.length,
    ownedProjectsCount: ownedProjects.length,
    assignedTasksCount: assignedTasks.length,
    activeAssignedTasksCount: assignedTasks.filter((task) => !task.isArchived && !task.completedAt && !isTaskInFinalColumn(db, task)).length,
    completedAssignedTasksCount: completedTasks.length,
    createdTasksCount: createdTasks.length,
  };
}

function getAllProjectsDataBytes(db) {
  return Buffer.byteLength(JSON.stringify({
    projects: db.projects,
    spaces: db.spaces,
    columns: db.columns,
    tasks: db.tasks,
    subtasks: db.subtasks,
    blocks: db.blocks,
    templates: db.templates,
    reminders: db.reminders,
    calendarEvents: db.calendarEvents,
    joinRequests: db.joinRequests,
  }), "utf8");
}

function getUserDataBytes(db, user) {
  const ownedProjectIds = new Set(db.projects.filter((project) => project.ownerId === user.id).map((project) => project.id));
  const membershipProjectIds = new Set(
    db.projects
      .filter((project) => (project.members ?? []).some((member) => member.userId === user.id))
      .map((project) => project.id),
  );
  const relatedTaskIds = new Set(
    db.tasks
      .filter((task) => task.creatorId === user.id || task.assigneeId === user.id || ownedProjectIds.has(task.projectId))
      .map((task) => task.id),
  );
  return Buffer.byteLength(JSON.stringify({
    user,
    ownedProjects: db.projects.filter((project) => ownedProjectIds.has(project.id)),
    memberships: db.projects.flatMap((project) => (project.members ?? []).filter((member) => member.userId === user.id)),
    memberProjectRefs: [...membershipProjectIds],
    createdOrAssignedTasks: db.tasks.filter((task) => relatedTaskIds.has(task.id)),
    subtasks: db.subtasks.filter((subtask) => relatedTaskIds.has(subtask.taskId)),
    notifications: db.notifications.filter((event) => event.userId === user.id),
    reminders: db.reminders.filter((reminder) => reminder.targetUserId === user.id || ownedProjectIds.has(reminder.projectId)),
    activity: db.activity.filter((event) => event.userId === user.id),
  }), "utf8");
}

function getDatabaseVolume(db) {
  const jsonBytes = Buffer.byteLength(JSON.stringify(db), "utf8");
  const files = [];
  for (const file of [dataRepository.paths?.dbFile, dataRepository.paths?.jsonDbFile].filter(Boolean)) {
    try {
      const stat = fs.statSync(file);
      files.push({ path: file, bytes: stat.size });
    } catch {
      // The active storage may not use both files.
    }
  }
  return {
    storage: String(process.env.WORKSPACE_STORAGE ?? "sqlite"),
    jsonStateBytes: jsonBytes,
    jsonStateMb: Number((jsonBytes / 1024 / 1024).toFixed(2)),
    files,
  };
}

function toCsv(rows) {
  const headers = [
    "id",
    "telegramId",
    "username",
    "firstName",
    "lastName",
    "createdAt",
    "updatedAt",
    "lastActivityAt",
    "isBlocked",
    "blockedAt",
    "storageBytes",
    "storageMb",
    "storageLimitMb",
    "storageUsagePercent",
    "projectsCount",
    "ownedProjectsCount",
    "assignedTasksCount",
    "activeAssignedTasksCount",
    "completedAssignedTasksCount",
    "createdTasksCount",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")),
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function createInviteCode(projectId) {
  return `P${projectId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function createJoinRequestSignals(db, project, request) {
  const createdAt = now();
  const recipients = (project.members ?? [])
    .filter((member) => member.userId === project.ownerId || member.role === "admin")
    .map((member) => member.userId)
    .filter(Boolean);

  const uniqueRecipients = [...new Set(recipients)];
  const requester = request.displayName || request.username || "Новый участник";
  const title = `Заявка на вход в проект`;
  const text = `${requester} просит доступ к проекту "${project.title}"`;

  for (const userId of uniqueRecipients) {
    const alreadyExists = db.notifications.some(
      (item) =>
        item.type === "manual_notification" &&
        item.entityType === "project" &&
        item.entityId === request.id &&
        item.userId === userId,
    );
    if (alreadyExists) continue;
    db.notifications.push({
      id: idFor(db.notifications),
      projectId: project.id,
      userId,
      type: "manual_notification",
      entityType: "project",
      entityId: request.id,
      sendAt: createdAt,
      status: "pending",
      payload: {
        title,
        text,
        action: "join_request",
        requestId: request.id,
        username: request.username,
      },
    });
  }

  db.activity.unshift({
    id: `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    projectId: project.id,
    userId: request.userId ?? undefined,
    userName: requester,
    type: "member_add",
    title,
    details: text,
    entityType: "member",
    entityId: request.id,
    context: "Доступ по коду",
    createdAt,
  });
  db.activity = db.activity.slice(0, 2000);
}

function createJoinRequestResolutionSignal(db, project, request, user, status) {
  const createdAt = now();
  const approved = status === "approved";
  const title = approved ? "Заявка на вход принята" : "Заявка на вход отклонена";
  const text = approved
    ? `Тебя добавили в проект "${project.title}"`
    : `Заявка на вход в проект "${project.title}" отклонена`;
  const entityId = `${request.id}:${status}`;

  const alreadyExists = db.notifications.some(
    (item) =>
      item.type === "manual_notification" &&
      item.entityType === "project" &&
      item.entityId === entityId &&
      item.userId === user.id,
  );

  if (!alreadyExists) {
    db.notifications.push({
      id: idFor(db.notifications),
      projectId: project.id,
      userId: user.id,
      type: "manual_notification",
      entityType: "project",
      entityId,
      sendAt: createdAt,
      status: "pending",
      payload: {
        title,
        text,
        action: approved ? "join_request_approved" : "join_request_rejected",
        requestId: request.id,
        projectId: project.id,
      },
    });
  }

  db.activity.unshift({
    id: `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    projectId: project.id,
    userId: user.id,
    userName: user.firstName || user.username || user.telegramId,
    type: "member_add",
    title,
    details: text,
    entityType: "member",
    entityId,
    context: "Доступ по коду",
    createdAt,
  });
  db.activity = db.activity.slice(0, 2000);
}

function createTaskNotificationSignals(db, task) {
  if (!task.assigneeId) return;
  if (!isTaskActiveForKanbanNotifications(db, task)) return;
  const project = db.projects.find((item) => item.id === task.projectId);
  if (!project?.botSettings?.taskDeadlineNotificationsEnabled) return;
  const settings = project.botSettings;

  for (const point of (settings.kanbanReminderPoints ?? []).filter((item) => item.enabled)) {
    if (point.kind === "on_assign") {
      createUniqueTaskNotification(db, task, "task_assigned", task.assigneeId, now(), project);
    }

    if (point.kind === "before_deadline" && task.deadlineAt && point.offsetMinutes) {
      const sendAt = new Date(new Date(task.deadlineAt).getTime() - Number(point.offsetMinutes) * 60000).toISOString();
      if (new Date(sendAt).getTime() > Date.now()) {
        createUniqueTaskNotification(db, task, notificationTypeForOffset(point.offsetMinutes), task.assigneeId, sendAt, project);
      }
    }

    if (point.kind === "at_deadline" && task.deadlineAt && new Date(task.deadlineAt).getTime() > Date.now()) {
      createUniqueTaskNotification(db, task, "task_deadline_now", task.assigneeId, task.deadlineAt, project);
    }
  }
}

function createUniqueTaskNotification(db, task, type, userId, sendAt, project) {
  const alreadyExists = db.notifications.some(
    (item) =>
      item.type === type &&
      item.entityType === "task" &&
      item.entityId === task.id &&
      item.userId === userId &&
      item.sendAt === sendAt,
  );
  if (alreadyExists) return;

  db.notifications.push({
    id: idFor(db.notifications),
    projectId: task.projectId,
    userId,
    type,
    entityType: "task",
    entityId: task.id,
    sendAt,
    status: "pending",
    payload: {
      task: hydrateTask(db, task),
      projectTitle: project.title,
    },
  });
}

function notificationTypeForOffset(offsetMinutes) {
  if (Number(offsetMinutes) === 15 * 60) return "task_deadline_15h";
  if (Number(offsetMinutes) === 2 * 60) return "task_deadline_2h";
  return `task_deadline_${Number(offsetMinutes)}m`;
}

function isNotificationSuppressed(db, notification) {
  if (!String(notification.type ?? "").startsWith("task_")) return false;
  const task = db.tasks.find((item) => item.id === notification.entityId);
  if (!task) return true;
  return !isTaskActiveForKanbanNotifications(db, task);
}

function isTaskActiveForKanbanNotifications(db, task) {
  if (task.isArchived || isTaskInFinalColumn(db, task)) return false;
  if (task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now()) return false;
  return true;
}

function isTaskActiveForUserList(db, task) {
  if (task.isArchived || task.completedAt || isTaskInFinalColumn(db, task)) return false;
  if (task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now()) return false;
  return true;
}

function updateTaskCompletionState(db, task, previousColumnId, previousArchived) {
  const wasCompleted = Boolean(task.completedAt);
  const isCompleted = Boolean(task.isArchived) || isTaskInFinalColumn(db, task);
  if (isCompleted && !wasCompleted) {
    task.completedAt = now();
    return;
  }
  if (!isCompleted && !previousArchived && previousColumnId !== task.columnId) {
    task.completedAt = undefined;
  }
}

function isTaskInFinalColumn(db, task) {
  if (!task.columnId) return false;
  const finalColumn = db.columns
    .filter((column) => column.projectId === task.projectId && sameBoard(column.pageId, task.pageId) && !column.isArchive && !column.isHidden)
    .sort((a, b) => a.position - b.position)
    .at(-1);
  return Boolean(finalColumn && finalColumn.id === task.columnId);
}

function sameBoard(itemPageId, pageId) {
  return pageId ? itemPageId === pageId : !itemPageId;
}

function normalizeTaskPositions(db, columnId) {
  const tasks = db.tasks
    .filter((task) => task.columnId === columnId && !task.isArchived)
    .sort((a, b) => a.position - b.position);
  for (let index = 0; index < tasks.length; index += 1) {
    tasks[index].position = index;
  }
}

function normalizeColumnPositions(db, projectId, pageId) {
  const columns = db.columns
    .filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId))
    .sort((a, b) => a.position - b.position);
  for (let index = 0; index < columns.length; index += 1) {
    columns[index].position = index;
  }
}

function normalizeTemplateOrder(db, projectId) {
  const templates = db.templates
    .filter((template) => template.projectId === projectId)
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  for (let index = 0; index < templates.length; index += 1) {
    templates[index].order = index;
  }
}

function normalizeReminderSourceType(value) {
  const allowed = new Set(["manual", "kanban", "mention", "table", "page", "bot"]);
  return allowed.has(value) ? value : "manual";
}

function normalizeCalendarEventType(value) {
  const allowed = new Set(["meeting", "service", "deadline", "duty", "event", "custom"]);
  return allowed.has(value) ? value : "event";
}

function normalizeCalendarCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories
    .filter((category) => category && category.label)
    .map((category) => ({
      id: asRef(category.id) || `category_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      label: String(category.label).trim(),
      color: String(category.color || "#64748B"),
      type: normalizeCalendarEventType(category.type),
      createdAt: category.createdAt ? String(category.createdAt) : now(),
    }));
}

async function fetchLinkPreview(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https links are supported");
  }

  const fallback = {
    url: parsed.toString(),
    title: parsed.hostname.replace(/^www\./, ""),
    siteName: parsed.hostname.replace(/^www\./, ""),
    favicon: `${parsed.origin}/favicon.ico`,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "TelegramWorkspacePreview/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return fallback;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return fallback;
    const html = (await response.text()).slice(0, 350000);
    const title = metaContent(html, "og:title") || metaContent(html, "twitter:title") || titleTag(html) || fallback.title;
    const description = metaContent(html, "og:description") || metaContent(html, "twitter:description") || metaContent(html, "description");
    const image = absolutize(metaContent(html, "og:image") || metaContent(html, "twitter:image"), parsed);
    const siteName = metaContent(html, "og:site_name") || fallback.siteName;
    const favicon = absolutize(linkHref(html, "icon") || linkHref(html, "shortcut icon"), parsed) || fallback.favicon;
    return { url: parsed.toString(), title, description, image, siteName, favicon };
  } catch {
    return fallback;
  }
}

function metaContent(html, name) {
  const escaped = escapeRegex(name);
  const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const contentFirstPattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
  return decodeHtml(propertyPattern.exec(html)?.[1] || contentFirstPattern.exec(html)?.[1] || "");
}

function linkHref(html, rel) {
  const escaped = escapeRegex(rel);
  const relPattern = new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']*)["'][^>]*>`, "i");
  const hrefFirstPattern = new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]*>`, "i");
  return decodeHtml(relPattern.exec(html)?.[1] || hrefFirstPattern.exec(html)?.[1] || "");
}

function titleTag(html) {
  return decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || "");
}

function absolutize(value, baseUrl) {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeReminderRecurrence(value) {
  const weekdays = Array.isArray(value?.weekdays)
    ? value.weekdays.map(Number).filter((day) => day >= 0 && day <= 6)
    : [];
  const time = typeof value?.time === "string" && /^\d{2}:\d{2}$/.test(value.time) ? value.time : "09:00";
  const dates = Array.isArray(value?.dates)
    ? value.dates
        .map((date) => {
          const parsed = new Date(date);
          return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
        })
        .filter(Boolean)
        .sort()
    : [];
  return {
    frequency: value?.frequency === "daily" || value?.frequency === "monthly" || value?.frequency === "custom" ? value.frequency : "weekly",
    weekdays: weekdays.length ? weekdays : [new Date().getDay()],
    time,
    interval: Number(value?.interval ?? 1) || 1,
    dates,
    monthDay: Math.min(31, Math.max(1, Number(value?.monthDay ?? new Date().getDate()))),
  };
}

function computeReminderNextRun(reminder, after = now()) {
  if (reminder.status && reminder.status !== "active") return undefined;
  if (reminder.scheduleType !== "recurring") {
    return reminder.remindAt ? new Date(reminder.remindAt).toISOString() : undefined;
  }

  const recurrence = normalizeReminderRecurrence(reminder.recurrence);
  const base = new Date(after);
  if (recurrence.frequency === "custom") {
    return recurrence.dates.find((date) => new Date(date).getTime() > base.getTime());
  }

  const [hours, minutes] = recurrence.time.split(":").map(Number);
  if (recurrence.frequency === "monthly") {
    for (let offset = 0; offset <= 36; offset += recurrence.interval) {
      const candidate = new Date(base);
      candidate.setMonth(base.getMonth() + offset, recurrence.monthDay);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate.getTime() > base.getTime()) return candidate.toISOString();
    }
    return undefined;
  }

  const weekdays = recurrence.frequency === "daily" ? [0, 1, 2, 3, 4, 5, 6] : recurrence.weekdays ?? [base.getDay()];

  for (let offset = 0; offset <= 370; offset += 1) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (recurrence.frequency === "daily" && offset % recurrence.interval !== 0) continue;
    if (recurrence.frequency === "weekly" && Math.floor(offset / 7) % recurrence.interval !== 0) continue;
    if (!weekdays.includes(candidate.getDay())) continue;
    if (candidate.getTime() > base.getTime()) return candidate.toISOString();
  }

  return undefined;
}

function ensureBoardColumns(db, projectId, pageId) {
  const existing = db.columns.filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId));
  if (existing.length > 0) return false;

  const defaults = [
    { title: "Идея", isDefault: false, isArchive: false },
    { title: "В работе", isDefault: true, isArchive: false },
    { title: "Готово", isDefault: false, isArchive: false },
  ];
  const firstId = Number(idFor(db.columns));
  for (let index = 0; index < defaults.length; index += 1) {
    db.columns.push({
      id: String(firstId + index),
      projectId,
      pageId,
      title: defaults[index].title,
      position: index,
      isDefault: defaults[index].isDefault,
      isArchive: defaults[index].isArchive,
      isHidden: false,
    });
  }
  return true;
}

function createDefaultSpace(projectId, projectTitle) {
  const createdAt = now();
  const rootId = `folder_${Date.now()}_root`;
  const overviewId = `page_${Date.now()}_overview`;
  const kanbanId = `kanban_${Date.now()}_board`;
  return {
    nodes: [
      {
        id: rootId,
        projectId,
        parentId: null,
        type: "folder",
        title: projectTitle || "Новая папка",
        icon: "📁",
        order: 0,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: overviewId,
        projectId,
        parentId: rootId,
        type: "page",
        title: "Обзор",
        icon: "📝",
        order: 0,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: kanbanId,
        projectId,
        parentId: rootId,
        type: "kanban",
        title: "Kanban-доска",
        icon: "📋",
        order: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    blocks: [
      {
        id: `block_${Date.now()}_overview`,
        pageId: overviewId,
        type: "paragraph",
        content: { text: "Рабочая страница проекта. Добавь блок через / или кнопку +." },
        order: 0,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    collapsedIds: [],
    recentPages: [],
    dailyNotes: {},
  };
}

function syncBlocksFromSpaces(spaces) {
  return Object.values(spaces).flatMap((space) => {
    const nodesById = new Map((space.nodes ?? []).map((node) => [node.id, node]));
    return (space.blocks ?? []).map((block) => {
      const node = nodesById.get(block.pageId);
      return {
        ...block,
        projectId: node?.projectId,
      };
    });
  }).filter((block) => block.projectId);
}

http.createServer(handle).listen(PORT, "0.0.0.0", () => {
  console.log(`Telegram Workspace API listening on http://127.0.0.1:${PORT}`);
  console.log(`INTERNAL_API_TOKEN configured: ${INTERNAL_API_TOKEN ? "yes (len " + INTERNAL_API_TOKEN.length + ")" : "NO"}`);
  if (INTERNAL_API_TOKEN) {
    const fp = crypto.createHash("sha256").update(INTERNAL_API_TOKEN).digest("hex").slice(0, 12);
    console.log(`INTERNAL_API_TOKEN sha256[:12]: ${fp}`);
  }
  console.log(`APP_OWNER_TELEGRAM_IDS: ${[...APP_OWNER_TELEGRAM_IDS].join(",") || "(none)"}`);
});
