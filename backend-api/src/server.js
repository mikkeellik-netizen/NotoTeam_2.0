import http from "node:http";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ical from "node-ical";
import { createDataRepository, resolveAppDataDir } from "./dataRepository.js";
import { contentDisposition, createProjectExportFile, normalizeExportOptions, validateExportTarget } from "./exportService.js";
import { createFileStorage } from "./fileStorage.js";

loadDotEnv();

const PORT = Number(process.env.PORT ?? 8787);
const DEFAULT_DEV_CORS_ORIGINS = [
  "http://127.0.0.1:5175",
  "http://localhost:5175",
  "http://127.0.0.1:5174",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];
const CORS_CONFIG = createCorsConfig(process.env.CORS_ORIGIN ?? "");
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN ?? "";
const TELEGRAM_WEB_APP_URL = String(process.env.TELEGRAM_WEB_APP_URL ?? "").trim().replace(/\/$/, "");
const CALENDAR_NOTIFICATION_INTERVAL_MS = envPositiveNumber("CALENDAR_NOTIFICATION_INTERVAL_MS", 15_000);
const CALENDAR_NOTIFICATION_RETRY_MS = envPositiveNumber("CALENDAR_NOTIFICATION_RETRY_MS", 60_000);
const CALENDAR_NOTIFICATION_MAX_ATTEMPTS = envPositiveNumber("CALENDAR_NOTIFICATION_MAX_ATTEMPTS", 5);
const CALENDAR_NOTIFICATION_BATCH_SIZE = envPositiveNumber("CALENDAR_NOTIFICATION_BATCH_SIZE", 50);
const CALENDAR_NOTIFICATION_STALE_AFTER_MS = envPositiveNumber("CALENDAR_NOTIFICATION_STALE_AFTER_MS", 15 * 60_000);
const EXTERNAL_CALENDAR_SYNC_INTERVAL_MS = envPositiveNumber("EXTERNAL_CALENDAR_SYNC_INTERVAL_MS", 15 * 60_000);
const EXTERNAL_CALENDAR_FETCH_TIMEOUT_MS = envPositiveNumber("EXTERNAL_CALENDAR_FETCH_TIMEOUT_MS", 12_000);
const EXTERNAL_CALENDAR_MAX_BYTES = envPositiveNumber("EXTERNAL_CALENDAR_MAX_BYTES", 5 * 1024 * 1024);
const EXTERNAL_CALENDAR_CREDENTIALS_SECRET = String(process.env.EXTERNAL_CALENDAR_CREDENTIALS_SECRET ?? "").trim();
const YANDEX_CALENDAR_HOSTS = new Set([
  "calendar.yandex.ru",
  "calendar.yandex.com",
  "calendar.360.yandex.ru",
  "caldav.yandex.ru",
  "caldav.yandex.com",
]);
const YANDEX_ICAL_LINK_HINT = "Нужна ссылка iCal из настроек календаря: Экспорт -> iCal. Код iframe и публичный адрес /embed/week не подходят";
const APP_OWNER_TELEGRAM_IDS = new Set(
  String(process.env.APP_OWNER_TELEGRAM_IDS ?? process.env.APP_OWNER_TELEGRAM_ID ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

// Внутренний токен для общения бот<->API.
// Важно: это отдельный секрет, не Telegram bot token. Если Telegram bot token
// утечёт, он не должен автоматически открывать полный доступ к Workspace API.
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN?.trim() ?? "";
const SYSTEM_STATS_PSEUDONYM_SECRET =
  process.env.SYSTEM_STATS_PSEUDONYM_SECRET?.trim() || INTERNAL_API_TOKEN || crypto.randomBytes(32).toString("hex");
const TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = envPositiveNumber("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", 24 * 3600);
const TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS = envPositiveNumber("TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS", 300);
const AUTH_CODE_REQUEST_WINDOW_MS = envPositiveNumber("AUTH_CODE_REQUEST_WINDOW_MS", 60 * 1000);
const AUTH_CODE_REQUEST_MAX = envPositiveNumber("AUTH_CODE_REQUEST_MAX", 3);
const AUTH_CODE_REQUEST_MAX_PER_IP = envPositiveNumber("AUTH_CODE_REQUEST_MAX_PER_IP", 30);
const AUTH_CODE_VERIFY_WINDOW_MS = envPositiveNumber("AUTH_CODE_VERIFY_WINDOW_MS", 60 * 1000);
const AUTH_CODE_VERIFY_MAX = envPositiveNumber("AUTH_CODE_VERIFY_MAX", 20);
const AUTH_CODE_VERIFY_MAX_PER_IP = envPositiveNumber("AUTH_CODE_VERIFY_MAX_PER_IP", 100);
const AUTH_IP_BLOCK_MS = envPositiveNumber("AUTH_IP_BLOCK_MS", 15 * 60 * 1000);
const API_MAX_BODY_BYTES = envPositiveNumber("API_MAX_BODY_BYTES", 5 * 1024 * 1024);
const LINK_PREVIEW_MAX_BODY_BYTES = envPositiveNumber("LINK_PREVIEW_MAX_BODY_BYTES", 160 * 1024);
const LINK_PREVIEW_TIMEOUT_MS = envPositiveNumber("LINK_PREVIEW_TIMEOUT_MS", 6000);
const LINK_PREVIEW_MAX_REDIRECTS = envPositiveNumber("LINK_PREVIEW_MAX_REDIRECTS", 3);
const OUTBOX_ATTACHMENT_MAX_BYTES = envPositiveNumber("OUTBOX_ATTACHMENT_MAX_BYTES", 20 * 1024 * 1024);
const OUTBOX_ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);
const USER_AVATAR_MAX_BYTES = envPositiveNumber("USER_AVATAR_MAX_BYTES", 512 * 1024);
const USER_AVATAR_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROJECT_FILE_MAX_BYTES = envPositiveNumber("PROJECT_FILE_MAX_BYTES", 25 * 1024 * 1024);
const PROJECT_FILE_ALLOWED_TYPES = new Map([
  [".jpg", { mimeType: "image/jpeg", category: "image" }],
  [".jpeg", { mimeType: "image/jpeg", category: "image" }],
  [".png", { mimeType: "image/png", category: "image" }],
  [".webp", { mimeType: "image/webp", category: "image" }],
  [".gif", { mimeType: "image/gif", category: "image" }],
  [".pdf", { mimeType: "application/pdf", category: "document" }],
  [".doc", { mimeType: "application/msword", category: "document" }],
  [".docx", { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document" }],
  [".mp3", { mimeType: "audio/mpeg", category: "audio" }],
  [".wav", { mimeType: "audio/wav", category: "audio" }],
  [".ogg", { mimeType: "audio/ogg", category: "audio" }],
  [".m4a", { mimeType: "audio/mp4", category: "audio" }],
  [".aac", { mimeType: "audio/aac", category: "audio" }],
  [".flac", { mimeType: "audio/flac", category: "audio" }],
  [".webm", { mimeType: "audio/webm", category: "audio" }],
]);
const SECURITY_EVENT_LIMIT = envPositiveNumber("SECURITY_EVENT_LIMIT", 5000);
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 дней
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 минут
const AUTH_CODE_MAX_ATTEMPTS = envPositiveNumber("AUTH_CODE_MAX_ATTEMPTS", 5);
const PROJECT_PRESENCE_ONLINE_MS = envPositiveNumber("PROJECT_PRESENCE_ONLINE_MS", 45_000);
const PROJECT_PRESENCE_MAX_SESSIONS = 8;
const AI_CONNECTOR_TOKEN_PREFIX = "noto_ai_";
const AI_CONNECTOR_TOKEN_DEFAULT_TTL_DAYS = envPositiveNumber("AI_CONNECTOR_TOKEN_DEFAULT_TTL_DAYS", 90);
const AI_CONNECTOR_TOKEN_MAX_TTL_DAYS = envPositiveNumber("AI_CONNECTOR_TOKEN_MAX_TTL_DAYS", 365);
const AI_CONNECTOR_ACCESS_LOG_LIMIT = envPositiveNumber("AI_CONNECTOR_ACCESS_LOG_LIMIT", 1000);
const fileStorage = await createFileStorage();

const now = () => new Date().toISOString();
const authRateLimitBuckets = new Map();
const PROCESS_STARTED_AT = Date.now();
const REQUEST_METRIC_LIMIT = envPositiveNumber("REQUEST_METRIC_LIMIT", 5000);
const requestMetrics = [];
const botRuntime = {
  lastSeenAt: undefined,
  lastPath: undefined,
  lastStatus: undefined,
  requestCount: 0,
};
let calendarNotificationTickRunning = false;
let externalCalendarSyncRunning = false;
let eventLoopLagMs = 0;
let eventLoopExpectedAt = Date.now() + 1000;
const eventLoopMonitor = setInterval(() => {
  const currentTime = Date.now();
  eventLoopLagMs = Math.max(0, currentTime - eventLoopExpectedAt);
  eventLoopExpectedAt = currentTime + 1000;
}, 1000);
eventLoopMonitor.unref?.();

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);
}

function createCorsConfig(rawOrigin) {
  const origins = String(rawOrigin ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const production = isProductionRuntime();
  if (!origins.length) {
    if (production) throw new Error("CORS_ORIGIN must be set in production");
    return { allowAll: false, origins: DEFAULT_DEV_CORS_ORIGINS };
  }
  if (origins.includes("*")) {
    if (production) throw new Error("CORS_ORIGIN=* is not allowed in production");
    return { allowAll: true, origins: [] };
  }
  return { allowAll: false, origins };
}

function validateProductionSecurityConfig() {
  if (!isProductionRuntime()) return;
  const missing = [];
  if (!process.env.CORS_ORIGIN) missing.push("CORS_ORIGIN");
  if (!TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!INTERNAL_API_TOKEN || INTERNAL_API_TOKEN.length < 32) missing.push("INTERNAL_API_TOKEN(32+ chars)");
  if (!APP_OWNER_TELEGRAM_IDS.size) missing.push("APP_OWNER_TELEGRAM_IDS");
  if (missing.length) {
    throw new Error(`Unsafe production config: ${missing.join(", ")} must be set`);
  }
  if (TELEGRAM_INIT_DATA_MAX_AGE_SECONDS > 24 * 3600) {
    throw new Error("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS must be 86400 or less in production");
  }
}

function requestOrigin(req) {
  const raw = req.headers.origin;
  if (!raw) return undefined;
  return String(Array.isArray(raw) ? raw[0] : raw).trim();
}

function hostnameFromHeader(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname;
  } catch {
    return raw.replace(/^\[/, "").replace(/\]$/, "").split(":")[0];
  }
}

function isLocalHostname(value) {
  const host = String(value ?? "").toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function codespacesFrontendHostname() {
  const name = String(process.env.CODESPACE_NAME ?? "").trim().toLowerCase();
  const domain = String(process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (!name || !domain) return "";
  return `${name}-5175.${domain}`;
}

function isLocalDevRequest(req) {
  if (process.env.LOCAL_DEV_LOGIN !== "1") return false;
  if (isProductionRuntime()) return false;
  const hostName = hostnameFromHeader(req.headers.host);
  const origin = requestOrigin(req);
  const originHost = origin ? hostnameFromHeader(origin) : hostName;
  if (isLocalHostname(hostName) && isLocalHostname(originHost)) return true;

  const codespacesHost = codespacesFrontendHostname();
  return Boolean(
    codespacesHost &&
      origin?.toLowerCase().startsWith("https://") &&
      originHost === codespacesHost &&
      (isLocalHostname(hostName) || hostName === codespacesHost)
  );
}

function corsForRequest(req) {
  const origin = requestOrigin(req);
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
  if (CORS_CONFIG.allowAll) {
    return { rejected: false, headers: { ...headers, "Access-Control-Allow-Origin": "*" } };
  }
  if (!origin) {
    return {
      rejected: false,
      headers: {
        ...headers,
        "Access-Control-Allow-Origin": CORS_CONFIG.origins[0] ?? DEFAULT_DEV_CORS_ORIGINS[0],
        Vary: "Origin",
      },
    };
  }
  if (CORS_CONFIG.origins.includes(origin)) {
    return { rejected: false, headers: { ...headers, "Access-Control-Allow-Origin": origin, Vary: "Origin" } };
  }
  return { rejected: true, headers: { ...headers, Vary: "Origin" } };
}

function responseCorsHeaders(res) {
  return res.corsHeaders ?? {
    "Access-Control-Allow-Origin": CORS_CONFIG.allowAll ? "*" : CORS_CONFIG.origins[0] ?? DEFAULT_DEV_CORS_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    ...(CORS_CONFIG.allowAll ? {} : { Vary: "Origin" }),
  };
}

function envPositiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(`workspace-session:${token}`).digest("hex");
}

function aiConnectorTokenHash(token) {
  return crypto.createHash("sha256").update(`ai-connector-token:${token}`).digest("hex");
}

function isAiConnectorTokenValue(value) {
  return String(value ?? "").startsWith(AI_CONNECTOR_TOKEN_PREFIX);
}

function isAiConnectorTokenExpired(record) {
  return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() < Date.now());
}

function clampAiConnectorLimit(value, fallback = 300) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 2000));
}

function normalizeAiConnectorWorkspaceAccessMode(value) {
  return value === "include" || value === "exclude" ? value : "all";
}

function normalizeAiConnectorWorkspaceNodeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 2000);
}

function normalizeAiConnectorAccessPolicy(input = {}) {
  const raw = input?.accessPolicy ?? input ?? {};
  const includeWorkspace = raw.includeWorkspace !== false;
  return {
    scope: raw.scope === "full" ? "full" : "summary",
    includeTasks: raw.includeTasks !== false,
    includeWorkspace,
    includeCalendar: raw.includeCalendar !== false,
    includeReminders: raw.includeReminders !== false,
    // Inbox access is opt-in so tokens created before this field existed do not
    // silently gain access to newly exposed project data.
    includeInbox: raw.includeInbox === true,
    includeResponsibility: raw.includeResponsibility !== false,
    includeActivity: raw.includeActivity !== false,
    includeBlocks: includeWorkspace && raw.includeBlocks === true,
    includeArchived: raw.includeArchived === true,
    workspaceAccessMode: normalizeAiConnectorWorkspaceAccessMode(raw.workspaceAccessMode),
    workspaceNodeIds: normalizeAiConnectorWorkspaceNodeIds(raw.workspaceNodeIds),
    maxTasks: clampAiConnectorLimit(raw.maxTasks, 300),
    maxBlocks: clampAiConnectorLimit(raw.maxBlocks, 300),
  };
}

function legacyAiConnectorAccessPolicy() {
  return {
    scope: "full",
    includeTasks: true,
    includeWorkspace: true,
    includeCalendar: true,
    includeReminders: true,
    includeInbox: false,
    includeResponsibility: true,
    includeActivity: true,
    includeBlocks: true,
    includeArchived: true,
    workspaceAccessMode: "all",
    workspaceNodeIds: [],
    maxTasks: 2000,
    maxBlocks: 2000,
  };
}

function aiConnectorAccessPolicyFor(record) {
  return record?.accessPolicy ? normalizeAiConnectorAccessPolicy(record.accessPolicy) : legacyAiConnectorAccessPolicy();
}

function applyAiConnectorAccessPolicy(options, tokenRecord) {
  const policy = aiConnectorAccessPolicyFor(tokenRecord);
  const effectiveScope = options.scope === "full" && policy.scope === "full" ? "full" : "summary";
  const includeWorkspace = Boolean(options.includeWorkspace && policy.includeWorkspace);
  return {
    scope: effectiveScope,
    includeTasks: Boolean(options.includeTasks && policy.includeTasks),
    includeWorkspace,
    includeCalendar: Boolean(options.includeCalendar && policy.includeCalendar),
    includeReminders: Boolean(options.includeReminders && policy.includeReminders),
    includeInbox: Boolean(options.includeInbox && policy.includeInbox),
    includeResponsibility: Boolean(options.includeResponsibility && policy.includeResponsibility),
    includeActivity: Boolean(options.includeActivity && policy.includeActivity),
    includeBlocks: Boolean(options.includeBlocks && policy.includeBlocks && includeWorkspace),
    includeArchived: Boolean(options.includeArchived && policy.includeArchived),
    workspaceAccessMode: policy.workspaceAccessMode,
    workspaceNodeIds: policy.workspaceNodeIds,
    maxTasks: Math.min(clampAiConnectorLimit(options.maxTasks, 300), policy.maxTasks),
    maxBlocks: Math.min(clampAiConnectorLimit(options.maxBlocks, 300), policy.maxBlocks),
  };
}

function publicAiConnectorToken(record) {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    revokedByUserId: record.revokedByUserId,
    useCount: Number(record.useCount ?? 0),
    isActive: !record.revokedAt && !isAiConnectorTokenExpired(record),
    accessPolicy: aiConnectorAccessPolicyFor(record),
  };
}

function publicAiConnectorAccessEvent(record) {
  return {
    id: record.id,
    projectId: record.projectId,
    tokenId: record.tokenId,
    tokenName: record.tokenName,
    toolName: record.toolName,
    status: record.status,
    scope: record.scope,
    sections: record.sections ?? {},
    maxTasks: record.maxTasks,
    maxBlocks: record.maxBlocks,
    tasksReturned: record.tasksReturned,
    tasksTotal: record.tasksTotal,
    blocksReturned: record.blocksReturned,
    blocksTotal: record.blocksTotal,
    error: record.error,
    createdAt: record.createdAt,
  };
}

function normalizeAiConnectorToolName(value) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.replace(/[^\w.-]/g, "_").slice(0, 80);
}

function logAiConnectorAccessEvent(db, input = {}) {
  db.aiConnectorAccessEvents ??= [];
  const contextLimits = input.context?.limits ?? {};
  const options = input.options ?? {};
  db.aiConnectorAccessEvents.unshift({
    id: randomToken(8),
    projectId: String(input.projectId ?? input.tokenRecord?.projectId ?? ""),
    tokenId: input.tokenRecord?.id ? String(input.tokenRecord.id) : undefined,
    tokenName: input.tokenRecord?.name ? String(input.tokenRecord.name).slice(0, 80) : undefined,
    toolName: normalizeAiConnectorToolName(input.toolName),
    status: input.status === "error" ? "error" : "success",
    scope: options.scope === "full" ? "full" : "summary",
    sections: {
      tasks: options.includeTasks !== false,
      workspace: options.includeWorkspace !== false,
      calendar: options.includeCalendar !== false,
      reminders: options.includeReminders !== false,
      inbox: options.includeInbox !== false,
      responsibility: options.includeResponsibility !== false,
      activity: options.includeActivity !== false,
      blocks: Boolean(options.includeBlocks),
      archived: Boolean(options.includeArchived),
    },
    maxTasks: Number(options.maxTasks ?? 0) || undefined,
    maxBlocks: Number(options.maxBlocks ?? 0) || undefined,
    tasksReturned: Number(contextLimits.tasksReturned ?? 0),
    tasksTotal: Number(contextLimits.tasksTotal ?? 0),
    blocksReturned: Number(contextLimits.blocksReturned ?? 0),
    blocksTotal: Number(contextLimits.blocksTotal ?? 0),
    clientRef: input.req ? securityHash(clientIpFor(input.req)) : undefined,
    error: input.error ? String(input.error).slice(0, 180) : undefined,
    createdAt: now(),
  });
  db.aiConnectorAccessEvents = db.aiConnectorAccessEvents.slice(0, AI_CONNECTOR_ACCESS_LOG_LIMIT);
  db._dirty = true;
}

function normalizeAiConnectorTokenTtlDays(value) {
  const fallback = Math.min(AI_CONNECTOR_TOKEN_DEFAULT_TTL_DAYS, AI_CONNECTOR_TOKEN_MAX_TTL_DAYS);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), AI_CONNECTOR_TOKEN_MAX_TTL_DAYS));
}

function createAiConnectorToken(db, projectId, userId, input = {}) {
  db.aiConnectorTokens ??= [];
  const rawToken = `${AI_CONNECTOR_TOKEN_PREFIX}${randomToken(24)}`;
  const ttlDays = normalizeAiConnectorTokenTtlDays(input.expiresInDays);
  const name = String(input.name ?? "AI Connector").trim().slice(0, 80) || "AI Connector";
  const record = {
    id: randomToken(8),
    projectId: String(projectId),
    name,
    tokenHash: aiConnectorTokenHash(rawToken),
    createdByUserId: String(userId),
    createdAt: now(),
    expiresAt: new Date(Date.now() + ttlDays * 24 * 3600 * 1000).toISOString(),
    lastUsedAt: undefined,
    revokedAt: undefined,
    revokedByUserId: undefined,
    useCount: 0,
    accessPolicy: normalizeAiConnectorAccessPolicy(input),
  };
  db.aiConnectorTokens.unshift(record);
  return { token: rawToken, record };
}

function findAiConnectorTokenByValue(db, token) {
  db.aiConnectorTokens ??= [];
  const rawToken = String(token ?? "").trim();
  if (!isAiConnectorTokenValue(rawToken)) return undefined;
  const hash = aiConnectorTokenHash(rawToken);
  const record = db.aiConnectorTokens.find((item) => item.tokenHash === hash || item.token === rawToken);
  if (record?.token === rawToken) {
    record.tokenHash = hash;
    delete record.token;
    db._dirty = true;
  }
  if (!record || record.revokedAt || isAiConnectorTokenExpired(record)) return undefined;
  record.lastUsedAt = now();
  record.useCount = Number(record.useCount ?? 0) + 1;
  db._dirty = true;
  return record;
}

function findSessionByToken(db, token) {
  const hash = sessionTokenHash(token);
  const session = db.sessions.find((item) => item.tokenHash === hash || item.token === token);
  if (session?.token === token) {
    session.tokenHash = hash;
    delete session.token;
    db._dirty = true;
  }
  return session;
}

function revokeSessionByToken(db, token) {
  const hash = sessionTokenHash(token);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((item) => item.tokenHash !== hash && item.token !== token);
  return db.sessions.length !== before;
}

function createSessionForUser(db, user) {
  const token = randomToken(32);
  db.sessions.push({
    id: randomToken(8),
    tokenHash: sessionTokenHash(token),
    userId: user.id,
    createdAt: now(),
    lastSeenAt: now(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  return token;
}

const AUTH_CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const AUTH_CODE_DIGITS = "0123456789";
const AUTH_CODE_ALPHABET = `${AUTH_CODE_LETTERS}${AUTH_CODE_DIGITS}`;

function generateAuthCode() {
  const characters = [
    AUTH_CODE_LETTERS[crypto.randomInt(0, AUTH_CODE_LETTERS.length)],
    AUTH_CODE_DIGITS[crypto.randomInt(0, AUTH_CODE_DIGITS.length)],
  ];
  while (characters.length < 6) {
    characters.push(AUTH_CODE_ALPHABET[crypto.randomInt(0, AUTH_CODE_ALPHABET.length)]);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(0, index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join("");
}

function normalizeAuthCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

function authCodeHash(userId, code) {
  const secret = INTERNAL_API_TOKEN || TELEGRAM_BOT_TOKEN || "workspace-local-auth-code-secret";
  return crypto.createHmac("sha256", secret).update(`${userId}:${normalizeAuthCode(code)}`).digest("hex");
}

function isAuthCodeMatch(record, userId, code) {
  if (!record) return false;
  if (record.codeHash) return safeEqual(record.codeHash, authCodeHash(userId, code));
  if (record.code) return safeEqual(normalizeAuthCode(record.code), normalizeAuthCode(code));
  return false;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clientIpFor(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(raw?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown").slice(0, 128);
}

function isAuthRateLimited(key, maxAttempts, windowMs) {
  const nowMs = Date.now();
  trimAuthRateLimitBuckets(nowMs);
  const attempts = (authRateLimitBuckets.get(key) ?? []).filter((timestamp) => nowMs - timestamp < windowMs);
  if (attempts.length >= maxAttempts) {
    authRateLimitBuckets.set(key, attempts);
    return true;
  }
  attempts.push(nowMs);
  authRateLimitBuckets.set(key, attempts);
  return false;
}

function activeAuthIpBlock(db, clientIp, currentTime = Date.now()) {
  const ipRef = securityHash(clientIp);
  return (db.securityEvents ?? []).find((event) =>
    event.type === "auth_ip_block" &&
    event.details?.ipRef === ipRef &&
    new Date(event.details?.blockedUntil ?? 0).getTime() > currentTime
  );
}

function blockAuthIp(db, clientIp, reason) {
  const existing = activeAuthIpBlock(db, clientIp);
  if (existing) return existing.details.blockedUntil;
  const blockedUntil = new Date(Date.now() + AUTH_IP_BLOCK_MS).toISOString();
  logSecurityEvent(db, {
    type: "auth_ip_block",
    outcome: "blocked",
    details: {
      ipRef: securityHash(clientIp),
      reason,
      blockedUntil,
    },
  });
  return blockedUntil;
}

function trimAuthRateLimitBuckets(nowMs) {
  if (authRateLimitBuckets.size < 10000) return;
  const maxWindowMs = Math.max(AUTH_CODE_REQUEST_WINDOW_MS, AUTH_CODE_VERIFY_WINDOW_MS);
  for (const [key, attempts] of authRateLimitBuckets.entries()) {
    const fresh = attempts.filter((timestamp) => nowMs - timestamp < maxWindowMs);
    if (fresh.length) authRateLimitBuckets.set(key, fresh);
    else authRateLimitBuckets.delete(key);
  }
}

// Разбирает заголовок Authorization. Поддерживает:
//   "Bot <token>"  — доверенный сервис (бот)
//   "tma <initData>" — Telegram Mini App
//   "Bearer <token>" — веб-сессия
function isSessionTokenQueryAllowed(method, pathname) {
  if (method !== "GET") return false;
  if (pathname === "/system/users/export.json" || pathname === "/system/users/export.csv") return true;
  return /^\/projects\/[^/]+\/export$/.test(pathname);
}

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

  // Бот по внутреннему токену. FAIL-CLOSED: если токен не настроен на сервере
  // или не совпадает — доступ запрещён. Никогда не пускаем «любой» bot-запрос.
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

  if (header?.scheme === "bearer" && isAiConnectorTokenValue(header.value)) {
    const tokenRecord = findAiConnectorTokenByValue(db, header.value);
    if (!tokenRecord) return undefined;
    return { kind: "ai", token: tokenRecord };
  }

  // Веб-сессия по Bearer-токену (или ?token= для скачивания файлов)
  const queryToken = url?.searchParams.get("token") ?? undefined;
  const sessionToken =
    header?.scheme === "bearer"
      ? header.value
      : queryToken && isSessionTokenQueryAllowed(req.method ?? "GET", url?.pathname ?? "")
        ? queryToken
        : undefined;
  if (sessionToken) {
    const session = findSessionByToken(db, sessionToken);
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
    // При первой регистрации реального пользователя — переносим проекты от local-dev
    migrateLocalDevProjects(db, user);
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

// Когда первый реальный Telegram-пользователь регистрируется,
// переносим к нему проекты от системного local-dev пользователя.
// Это одноразовый перенос при первом входе нового пользователя.
function migrateLocalDevProjects(db, newUser) {
  const localDevUser = db.users.find((u) => u.telegramId === "local-dev");
  if (!localDevUser) return;

  // Считаем реальных пользователей (без local-dev и без только что созданного)
  const realUsers = db.users.filter((u) => u.telegramId !== "local-dev" && u.id !== newUser.id);
  // Миграцию делаем только для первого реального пользователя
  if (realUsers.length > 0) return;

  const localId = String(localDevUser.id);
  const newId = String(newUser.id);
  let migrated = 0;

  for (const project of db.projects) {
    if (String(project.ownerId) === localId) {
      project.ownerId = newId;
      migrated++;
    }
    for (const member of (project.members ?? [])) {
      if (String(member.userId) === localId) member.userId = newId;
    }
  }
  for (const item of db.columns) { if (String(item.userId) === localId) item.userId = newId; }
  for (const item of db.tasks) {
    if (String(item.creatorId) === localId) item.creatorId = newId;
    if (String(item.assigneeId) === localId) item.assigneeId = newId;
  }

  if (migrated > 0) {
    console.log(`Migrated ${migrated} project(s) from local-dev to user ${newId}`);
    db._dirty = true;
  }
}

// Удаляет local-dev пользователя если у него больше нет проектов
// (то есть после миграции или если его никогда и не было).
function purgeLocalDevUser(db) {
  const localDev = db.users.find((u) => u.telegramId === "local-dev");
  if (!localDev) return false;
  const hasProjects = db.projects.some(
    (p) => String(p.ownerId) === String(localDev.id) ||
           (p.members ?? []).some((m) => String(m.userId) === String(localDev.id)),
  );
  if (hasProjects) return false; // ещё есть данные — не трогаем
  db.users = db.users.filter((u) => u.telegramId !== "local-dev");
  console.log("Removed orphaned local-dev user from database");
  return true;
}

function pushOutbox(db, telegramId, text, attachment) {
  const safeAttachment = sanitizeOutboxAttachment(attachment);
  db.outbox.push({
    id: randomToken(8),
    telegramId: String(telegramId),
    text,
    ...(safeAttachment ? { attachment: safeAttachment } : {}),
    status: "pending",
    createdAt: now(),
  });
}

function sanitizeOutboxAttachment(attachment) {
  if (!attachment) return undefined;
  const encoding = attachment.encoding === "base64" ? "base64" : "utf8";
  const content = String(attachment.content ?? "");
  if (encoding === "base64" && !/^[A-Za-z0-9+/=\s]*$/.test(content)) {
    throw new RequestBodyError(400, "Invalid attachment encoding");
  }

  const bytes = Buffer.byteLength(content, encoding === "base64" ? "base64" : "utf8");
  if (bytes > OUTBOX_ATTACHMENT_MAX_BYTES) {
    throw new RequestBodyError(413, "Attachment is too large for Telegram delivery");
  }

  const mimeType = normalizeOutboxMimeType(attachment.mimeType);
  if (!OUTBOX_ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new RequestBodyError(400, "Unsupported attachment type");
  }

  return {
    fileName: sanitizeOutboxFileName(attachment.fileName, mimeType),
    content,
    mimeType,
    encoding,
  };
}

function normalizeOutboxMimeType(value) {
  return String(value ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function sanitizeOutboxFileName(value, mimeType) {
  const extensionByMimeType = {
    "application/json": ".json",
    "application/pdf": ".pdf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
    "text/html": ".html",
    "text/markdown": ".md",
    "text/plain": ".txt",
  };
  const fallback = `export${extensionByMimeType[mimeType] ?? ".txt"}`;
  const raw = String(value ?? fallback).replace(/[/\\:*?"<>|]+/g, "_").trim();
  const baseName = path.basename(raw).slice(0, 160).trim();
  return baseName || fallback;
}

function logSecurityEvent(db, input = {}) {
  db.securityEvents ??= [];
  db.securityEvents.unshift({
    id: randomToken(8),
    type: String(input.type ?? "security_event").slice(0, 80),
    actorUserId: input.actorUserId ? String(input.actorUserId) : undefined,
    projectId: input.projectId ? String(input.projectId) : undefined,
    targetUserId: input.targetUserId ? String(input.targetUserId) : undefined,
    outcome: input.outcome ? String(input.outcome).slice(0, 40) : "success",
    details: sanitizeSecurityDetails(input.details),
    createdAt: now(),
  });
  db.securityEvents = db.securityEvents.slice(0, SECURITY_EVENT_LIMIT);
}

function sanitizeSecurityDetails(details) {
  if (!details || typeof details !== "object") return {};
  const allowed = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|code|secret|password|hash|invite/i.test(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      allowed[key] = value;
    } else {
      allowed[key] = String(value).slice(0, 180);
    }
  }
  return allowed;
}

function avatarDirectory() {
  return path.join(resolveAppDataDir(), "user-avatars");
}

function avatarExtensionForMime(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function avatarPublicPath(user) {
  if (!user?.avatarFileName || user.avatarMode === "none") return undefined;
  const version = encodeURIComponent(String(user.avatarUpdatedAt ?? user.updatedAt ?? ""));
  return `/users/${encodeURIComponent(String(user.id))}/avatar${version ? `?v=${version}` : ""}`;
}

function sanitizeAvatarFileName(fileName) {
  const raw = String(fileName ?? "");
  const base = path.basename(raw);
  return /^[a-zA-Z0-9_.-]+$/.test(base) ? base : "";
}

function avatarFilePath(fileName) {
  const safeName = sanitizeAvatarFileName(fileName);
  if (!safeName) return undefined;
  return path.join(avatarDirectory(), safeName);
}

async function deleteUserAvatarFile(user) {
  const filePath = avatarFilePath(user?.avatarFileName);
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function parseAvatarDataUrl(dataUrl) {
  const match = String(dataUrl ?? "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) throw new RequestBodyError(400, "Unsupported avatar image");
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  if (!USER_AVATAR_ALLOWED_MIME_TYPES.has(mimeType)) throw new RequestBodyError(400, "Unsupported avatar image type");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  validateAvatarBuffer(buffer, mimeType);
  return { buffer, mimeType };
}

function validateAvatarBuffer(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new RequestBodyError(400, "Avatar image is empty");
  if (buffer.length > USER_AVATAR_MAX_BYTES) throw new RequestBodyError(413, "Avatar image is too large");
  if (!USER_AVATAR_ALLOWED_MIME_TYPES.has(mimeType)) throw new RequestBodyError(400, "Unsupported avatar image type");
}

async function saveUserAvatarBuffer(user, buffer, mimeType, source) {
  validateAvatarBuffer(buffer, mimeType);
  await fs.promises.mkdir(avatarDirectory(), { recursive: true });
  await deleteUserAvatarFile(user);
  const fileName = `user-${String(user.id).replace(/[^a-zA-Z0-9_-]/g, "_")}-${randomToken(4)}${avatarExtensionForMime(mimeType)}`;
  await fs.promises.writeFile(path.join(avatarDirectory(), fileName), buffer);
  user.avatarMode = source;
  user.avatarStatus = "ready";
  user.avatarFileName = fileName;
  user.avatarMimeType = mimeType;
  user.avatarUpdatedAt = now();
  user.avatarConsentAt ??= now();
  user.updatedAt = now();
}

async function clearUserAvatar(user, mode = "none", status = "disabled") {
  await deleteUserAvatarFile(user);
  user.avatarMode = mode;
  user.avatarStatus = status;
  if (mode === "none") delete user.avatarConsentAt;
  delete user.avatarFileName;
  delete user.avatarMimeType;
  user.avatarUpdatedAt = now();
  user.updatedAt = now();
}

async function fetchTelegramAvatarForUser(user) {
  if (!TELEGRAM_BOT_TOKEN) throw new RequestBodyError(400, "Telegram bot token is not configured");
  if (!user?.telegramId || String(user.telegramId).startsWith("local") || String(user.telegramId).startsWith("mock-")) {
    throw new RequestBodyError(400, "Telegram avatar is unavailable for this user");
  }
  const photos = await telegramBotApi("getUserProfilePhotos", { user_id: Number(user.telegramId), limit: 1 });
  const variants = photos?.photos?.[0] ?? [];
  const bestPhoto = variants
    .filter((item) => item?.file_id)
    .sort((a, b) => Number(b.file_size ?? 0) - Number(a.file_size ?? 0))[0];
  if (!bestPhoto) return undefined;

  const file = await telegramBotApi("getFile", { file_id: bestPhoto.file_id });
  if (!file?.file_path) return undefined;
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new RequestBodyError(502, "Telegram avatar download failed");
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || mimeTypeFromTelegramFilePath(file.file_path);
  const buffer = Buffer.from(await response.arrayBuffer());
  validateAvatarBuffer(buffer, mimeType);
  return { buffer, mimeType };
}

async function telegramBotApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new RequestBodyError(502, payload.description || "Telegram API request failed");
  }
  return payload.result;
}

function mimeTypeFromTelegramFilePath(filePath) {
  const extension = path.extname(String(filePath)).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function canViewUserAvatar(auth, db, targetUser) {
  if (!targetUser || auth.kind !== "user") return false;
  if (String(auth.user.id) === String(targetUser.id)) return true;
  if (isSystemOwner(auth, db)) return true;
  return db.projects.some((project) => {
    if (project.isDeleted) return false;
    return isProjectMemberRecord(project, auth.user.id) && isProjectMemberRecord(project, targetUser.id);
  });
}

function projectFileDirectoryKey(projectId) {
  const projectKey = crypto.createHash("sha256").update(`project-file-dir:${String(projectId)}`).digest("hex").slice(0, 24);
  return projectKey;
}

function sanitizeProjectFileName(value) {
  const base = path.basename(String(value ?? "")).replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, " ").trim();
  if (!base) throw new RequestBodyError(400, "File name is required");
  return base.slice(0, 180);
}

function projectFileTypeForName(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  const type = PROJECT_FILE_ALLOWED_TYPES.get(extension);
  if (!type) throw new RequestBodyError(400, "Unsupported file type");
  return { extension, ...type };
}

function projectFileStorageKey(record) {
  const storageName = String(record?.storageName ?? "");
  const extension = path.extname(storageName).toLowerCase();
  if (!/^[a-f0-9]{24}\.[a-z0-9]+$/.test(storageName) || !PROJECT_FILE_ALLOWED_TYPES.has(extension)) return undefined;
  return `${projectFileDirectoryKey(record.projectId)}/${storageName}`;
}

function validateProjectFileSignature(prefix, extension) {
  const starts = (...bytes) => bytes.every((value, index) => prefix[index] === value);
  const ascii = (start, length) => prefix.subarray(start, start + length).toString("ascii");
  let valid = false;

  if (extension === ".jpg" || extension === ".jpeg") valid = starts(0xff, 0xd8, 0xff);
  else if (extension === ".png") valid = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  else if (extension === ".webp") valid = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  else if (extension === ".gif") valid = ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
  else if (extension === ".pdf") valid = prefix.toString("latin1").includes("%PDF-");
  else if (extension === ".doc") valid = starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  else if (extension === ".docx") valid = starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06);
  else if (extension === ".mp3") valid = ascii(0, 3) === "ID3" || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0);
  else if (extension === ".wav") valid = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
  else if (extension === ".ogg") valid = ascii(0, 4) === "OggS";
  else if (extension === ".m4a") valid = ascii(4, 4) === "ftyp";
  else if (extension === ".aac") valid = prefix[0] === 0xff && (prefix[1] === 0xf1 || prefix[1] === 0xf9);
  else if (extension === ".flac") valid = ascii(0, 4) === "fLaC";
  else if (extension === ".webm") valid = starts(0x1a, 0x45, 0xdf, 0xa3);

  if (!valid) throw new RequestBodyError(400, "File content does not match its extension");
}

async function saveProjectFileFromRequest(req, projectId, uploaderUserId, requestedName) {
  const fileName = sanitizeProjectFileName(requestedName);
  const type = projectFileTypeForName(fileName);
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > PROJECT_FILE_MAX_BYTES) {
    throw new RequestBodyError(413, "File is too large");
  }

  const id = randomToken(12);
  const storageName = `${id}${type.extension}`;
  const directory = path.join(resolveAppDataDir(), "tmp", "project-file-uploads");
  const temporaryPath = path.join(directory, `.upload-${id}.tmp`);
  await fs.promises.mkdir(directory, { recursive: true });
  const handle = await fs.promises.open(temporaryPath, "wx");
  let totalBytes = 0;
  let prefix = Buffer.alloc(0);

  try {
    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > PROJECT_FILE_MAX_BYTES) throw new RequestBodyError(413, "File is too large");
      if (prefix.length < 1024) prefix = Buffer.concat([prefix, chunk.subarray(0, 1024 - prefix.length)]);
      await handle.write(chunk);
    }
    if (totalBytes === 0) throw new RequestBodyError(400, "File is empty");
    validateProjectFileSignature(prefix, type.extension);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  await handle.close();
  const record = {
    id,
    projectId: String(projectId),
    uploaderUserId: String(uploaderUserId),
    fileName,
    storageName,
    mimeType: type.mimeType,
    category: type.category,
    size: totalBytes,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await fileStorage.putFile({
      key: projectFileStorageKey(record),
      filePath: temporaryPath,
      contentType: record.mimeType,
      contentLength: record.size,
    });
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
  }
  return record;
}

function projectFileForClient(record) {
  return {
    id: record.id,
    projectId: record.projectId,
    uploaderUserId: record.uploaderUserId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    category: record.category,
    size: record.size,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isProjectFileReferenced(db, fileId) {
  return Object.values(db.spaces ?? {}).some((space) =>
    (space.blocks ?? []).some((block) => block.type === "file" && String(block.content?.fileId ?? "") === String(fileId)),
  );
}

async function removeProjectFileRecord(db, record) {
  db.projectFiles = (db.projectFiles ?? []).filter((item) => item.id !== record.id);
  const storageKey = projectFileStorageKey(record);
  if (!storageKey) return;
  try {
    await fileStorage.deleteObject(storageKey);
  } catch (error) {
    console.warn(`Failed to delete project file ${record.id}:`, error?.message ?? error);
  }
}

async function removeUnreferencedProjectFiles(db, fileIds) {
  for (const fileId of new Set(fileIds.filter(Boolean).map(String))) {
    if (isProjectFileReferenced(db, fileId)) continue;
    const record = (db.projectFiles ?? []).find((item) => item.id === fileId);
    if (record) await removeProjectFileRecord(db, record);
  }
}

async function sendProjectFileContent(res, record) {
  const storageKey = projectFileStorageKey(record);
  if (!storageKey) return false;
  const stored = await fileStorage.getObject(storageKey);
  if (!stored?.body) return false;
  const inline = record.category === "image" || record.category === "audio" || record.mimeType === "application/pdf";
  const disposition = contentDisposition(record.fileName).replace(/^attachment/i, inline ? "inline" : "attachment");
  res.writeHead(200, {
    "Content-Type": record.mimeType,
    ...(Number.isFinite(stored.contentLength) ? { "Content-Length": stored.contentLength } : {}),
    "Content-Disposition": disposition,
    "Cache-Control": "private, max-age=3600",
    ...responseCorsHeaders(res),
    ...securityHeaders(record.mimeType),
    "Access-Control-Expose-Headers": "Content-Disposition,Content-Length",
  });
  const stream = stored.body;
  stream.on("error", (error) => res.destroy(error));
  stream.pipe(res);
  return true;
}

function securityHash(value) {
  return crypto
    .createHmac("sha256", SYSTEM_STATS_PSEUDONYM_SECRET)
    .update(`workspace-security:${String(value ?? "")}`)
    .digest("hex")
    .slice(0, 16);
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
  archiveCleanupMode: "never",
  taskDeadlineNotificationsEnabled: true,
  mentionNotificationsEnabled: true,
  dutyNotificationsEnabled: true,
  smartAdminNotificationsEnabled: true,
  kanbanReminderTone: "soft",
  taskSignificance: {
    priorityBonus: {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 1,
      CRITICAL: 2,
    },
    overdueBonus: 1,
    longOverdueBonus: 2,
    longOverdueHours: 72,
    blockingBonus: 2,
    attentionThreshold: 6,
    criticalThreshold: 8,
  },
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

const PROJECT_ROLE_PERMISSIONS = {
  owner: {
    viewProject: true,
    createTask: true,
    updateTask: true,
    moveTask: true,
    deleteTask: true,
    manageColumns: true,
    manageMembers: true,
    viewAnalytics: true,
    manageProject: true,
    manageWorkspace: true,
    createPage: true,
    updatePage: true,
    deletePage: true,
    manageTemplates: true,
    viewCalendar: true,
    createCalendarEvents: true,
    editOwnCalendarEvents: true,
    editAllCalendarEvents: true,
    deleteOwnCalendarEvents: true,
    deleteAllCalendarEvents: true,
    manageCalendar: true,
    manageReminders: true,
    manageBot: true,
    exportProject: true,
  },
  admin: {
    viewProject: true,
    createTask: true,
    updateTask: true,
    moveTask: true,
    deleteTask: true,
    manageColumns: true,
    manageMembers: true,
    viewAnalytics: true,
    manageProject: true,
    manageWorkspace: true,
    createPage: true,
    updatePage: true,
    deletePage: true,
    manageTemplates: true,
    viewCalendar: true,
    createCalendarEvents: true,
    editOwnCalendarEvents: true,
    editAllCalendarEvents: true,
    deleteOwnCalendarEvents: true,
    deleteAllCalendarEvents: true,
    manageCalendar: true,
    manageReminders: true,
    manageBot: true,
    exportProject: true,
  },
  editor: {
    viewProject: true,
    createTask: true,
    updateTask: true,
    moveTask: true,
    deleteTask: true,
    manageColumns: true,
    manageMembers: false,
    viewAnalytics: false,
    manageProject: false,
    manageWorkspace: true,
    createPage: true,
    updatePage: true,
    deletePage: true,
    manageTemplates: true,
    viewCalendar: true,
    createCalendarEvents: true,
    editOwnCalendarEvents: true,
    editAllCalendarEvents: true,
    deleteOwnCalendarEvents: true,
    deleteAllCalendarEvents: true,
    manageCalendar: true,
    manageReminders: true,
    manageBot: false,
    exportProject: true,
  },
  viewer: {
    viewProject: true,
    createTask: false,
    updateTask: false,
    moveTask: false,
    deleteTask: false,
    manageColumns: false,
    manageMembers: false,
    viewAnalytics: false,
    manageProject: false,
    manageWorkspace: false,
    createPage: false,
    updatePage: false,
    deletePage: false,
    manageTemplates: false,
    viewCalendar: true,
    createCalendarEvents: false,
    editOwnCalendarEvents: false,
    editAllCalendarEvents: false,
    deleteOwnCalendarEvents: false,
    deleteAllCalendarEvents: false,
    manageCalendar: false,
    manageReminders: false,
    manageBot: false,
    exportProject: false,
  },
};

const dataRepository = createDataRepository({ createDefaultDb });
const DB_FLUSH_DEBOUNCE_MS = Number(process.env.DB_FLUSH_DEBOUNCE_MS ?? 2500);
let cachedDb;
let cachedDbPromise;
let dbDirty = false;
let dbFlushTimer;
let dbFlushPromise;

function createDefaultDb() {
  return {
    users: [],
    projects: [],
    columns: [],
    tasks: [],
    subtasks: [],
    blocks: [],
    templates: [],
    reminders: [],
    calendars: [],
    calendarEvents: [],
    externalCalendarConnections: [],
    spaces: {},
    activity: [],
    securityEvents: [],
    notifications: [],
    joinRequests: [],
    aiConnectorTokens: [],
    aiConnectorAccessEvents: [],
    projectFiles: [],
  };
}

async function readJson() {
  const db = await loadCachedDb();
  db.users ??= [];
  db.projects ??= [];
  db.columns ??= [];
  db.tasks ??= [];
  db.subtasks ??= [];
  db.blocks ??= [];
  db.templates ??= [];
  db.reminders ??= [];
  db.calendars ??= [];
  db.calendarEvents ??= [];
  db.externalCalendarConnections ??= [];
  db.spaces ??= {};
  db.activity ??= [];
  db.securityEvents ??= [];
  db.notifications ??= [];
  db.joinRequests ??= [];
  db.sessions ??= [];
  db.authCodes ??= [];
  db.outbox ??= [];
  db.aiConnectorTokens ??= [];
  db.aiConnectorAccessEvents ??= [];
  db.projectFiles ??= [];
  const repairedTasks = normalizeDatabaseIds(db);
  const removedLocalDev = purgeLocalDevUser(db);
  if (repairedTasks > 0 || removedLocalDev) {
    await writeJson(db);
  }
  return db;
}

async function writeJson(db) {
  cachedDb = db;
  dbDirty = true;
  scheduleDbFlush();
}

async function loadCachedDb() {
  if (cachedDb) return cachedDb;
  if (!cachedDbPromise) {
    cachedDbPromise = dataRepository.read().then((db) => {
      cachedDb = db;
      return cachedDb;
    });
  }
  return cachedDbPromise;
}

function scheduleDbFlush() {
  if (dbFlushTimer) clearTimeout(dbFlushTimer);
  dbFlushTimer = setTimeout(() => {
    dbFlushTimer = undefined;
    void flushDbNow().catch((error) => {
      console.error("Database flush failed", error instanceof Error ? error.message : error);
      if (dbDirty) scheduleDbFlush();
    });
  }, DB_FLUSH_DEBOUNCE_MS);
}

async function flushDbNow() {
  if (dbFlushPromise) {
    await dbFlushPromise;
  }
  if (!dbDirty || !cachedDb) return;

  const dbToWrite = cachedDb;
  dbDirty = false;
  dbFlushPromise = dataRepository
    .write(dbToWrite)
    .catch((error) => {
      dbDirty = true;
      throw error;
    })
    .finally(() => {
      dbFlushPromise = undefined;
    });

  await dbFlushPromise;
  if (dbDirty) await flushDbNow();
}

async function flushDbBeforeExit(signal) {
  try {
    if (dbFlushTimer) clearTimeout(dbFlushTimer);
    await flushDbNow();
  } catch (error) {
    console.error("Final database flush failed", error instanceof Error ? error.message : error);
  } finally {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
}

process.once("SIGINT", () => void flushDbBeforeExit("SIGINT"));
process.once("SIGTERM", () => void flushDbBeforeExit("SIGTERM"));

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.metricResponseBytes = Buffer.byteLength(body, "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...responseCorsHeaders(res),
    ...securityHeaders("application/json"),
  });
  res.end(body);
}

function sendRaw(res, status, body, contentType, headers = {}) {
  res.metricResponseBytes = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body ?? ""), "utf8");
  res.writeHead(status, {
    "Content-Type": contentType,
    ...responseCorsHeaders(res),
    ...securityHeaders(contentType),
    "Access-Control-Expose-Headers": "Content-Disposition",
    ...headers,
  });
  res.end(body);
}

function securityHeaders(contentType = "") {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (String(contentType).toLowerCase().startsWith("text/html")) {
    headers["Content-Security-Policy"] = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
  }
  return headers;
}

function sendDownload(res, file) {
  return sendRaw(res, 200, file.content, file.mimeType, {
    "Content-Disposition": contentDisposition(file.fileName),
    "Cache-Control": "no-store",
  });
}

class RequestBodyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function parseBody(req) {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > API_MAX_BODY_BYTES) {
    throw new RequestBodyError(413, "Request body is too large");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > API_MAX_BODY_BYTES) {
      throw new RequestBodyError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new RequestBodyError(400, "Invalid JSON body");
  }
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

async function ensureProjectSpace(db, projectId, projectTitle) {
  db.spaces ??= {};
  if (!db.spaces[projectId]) {
    db.spaces[projectId] = createDefaultSpace(projectId, projectTitle);
    db.blocks = syncBlocksFromSpaces(db.spaces);
    await writeJson(db);
  }
  return db.spaces[projectId];
}

function normalizeParentQuery(value) {
  if (value === undefined || value === null || value === "" || value === "null" || value === "root") return null;
  return String(value);
}

function numberQuery(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function booleanQuery(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function paginationQuery(url, options = {}) {
  const defaultLimit = options.defaultLimit ?? 100;
  const maxLimit = options.maxLimit ?? 500;
  return {
    offset: numberQuery(url.searchParams.get("offset"), 0, 0, 1000000),
    limit: numberQuery(url.searchParams.get("limit"), defaultLimit, 1, maxLimit),
  };
}

function sendPaginatedOrArray(res, url, items, options = {}) {
  const key = options.key ?? "items";
  if (!wantsPaginatedResponse(url)) return send(res, 200, items);
  const { offset, limit } = paginationQuery(url, options);
  return send(res, 200, {
    [key]: items.slice(offset, offset + limit),
    offset,
    limit,
    total: items.length,
    hasMore: offset + limit < items.length,
  });
}

function wantsPaginatedResponse(url) {
  return url.searchParams.get("paginated") === "1" || url.searchParams.has("offset") || url.searchParams.has("limit");
}

function isBotServiceRoute(method, pathname) {
  if (method === "GET" && pathname === "/projects") return true;
  if (method === "POST" && pathname === "/projects") return true;
  if (method === "POST" && pathname === "/telegram/users") return true;
  if (method === "POST" && pathname === "/join-requests") return true;
  if (method === "GET" && pathname === "/outbox/pending") return true;
  if (method === "POST" && /^\/outbox\/[^/]+\/sent$/.test(pathname)) return true;

  if (method === "GET" && /^\/users\/[^/]+$/.test(pathname)) return true;
  if (method === "GET" && /^\/users\/by-username\/[^/]+$/.test(pathname)) return true;
  if (/^\/users\/[^/]+\/(projects|assigned-tasks|task-progress|bot-preferences)$/.test(pathname)) return true;

  if (method === "GET" && /^\/projects\/[^/]+$/.test(pathname)) return true;
  if (method === "GET" && /^\/projects\/[^/]+\/(members|columns|tasks|blocks|calendar-events|bot-settings)$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/projects\/[^/]+\/bot-settings$/.test(pathname)) return true;

  if (method === "GET" && /^\/projects\/[^/]+\/space\/(meta|nodes)$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/projects\/[^/]+\/space\/meta$/.test(pathname)) return true;
  if (method === "POST" && /^\/projects\/[^/]+\/space\/nodes$/.test(pathname)) return true;
  if (method === "POST" && /^\/projects\/[^/]+\/space\/nodes\/[^/]+\/(trash|restore|move)$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/projects\/[^/]+\/space\/nodes\/[^/]+$/.test(pathname)) return true;
  if (method === "POST" && /^\/projects\/[^/]+\/space\/pages\/[^/]+\/blocks$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/projects\/[^/]+\/space\/blocks\/[^/]+$/.test(pathname)) return true;
  if (method === "POST" && /^\/projects\/[^/]+\/space\/blocks\/[^/]+\/move$/.test(pathname)) return true;

  if (method === "POST" && pathname === "/tasks") return true;
  if (method === "PATCH" && /^\/tasks\/[^/]+$/.test(pathname)) return true;

  if (method === "POST" && /^\/projects\/[^/]+\/reminders$/.test(pathname)) return true;
  if (method === "GET" && pathname === "/reminders/due") return true;
  if (method === "POST" && /^\/reminders\/[^/]+\/sent$/.test(pathname)) return true;

  if (method === "POST" && pathname === "/notifications") return true;
  if (method === "GET" && pathname === "/notifications/pending") return true;
  if (method === "GET" && pathname === "/notifications/exists") return true;
  if (method === "PATCH" && /^\/notifications\/[^/]+$/.test(pathname)) return true;

  return false;
}

function isBotOnlyRoute(method, pathname) {
  if (method === "GET" && pathname === "/outbox/pending") return true;
  if (method === "POST" && /^\/outbox\/[^/]+\/sent$/.test(pathname)) return true;
  if (method === "GET" && pathname === "/reminders/due") return true;
  if (method === "POST" && /^\/reminders\/[^/]+\/sent$/.test(pathname)) return true;
  if (method === "POST" && pathname === "/notifications") return true;
  if (method === "GET" && pathname === "/notifications/pending") return true;
  if (method === "GET" && pathname === "/notifications/exists") return true;
  if (method === "PATCH" && /^\/notifications\/[^/]+$/.test(pathname)) return true;
  return false;
}

function makePageNodeId(type) {
  const prefix = type === "folder" ? "folder" : type === "kanban" ? "kanban" : "page";
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeBlockId() {
  return `block_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizePageNodeType(value) {
  return value === "folder" || value === "kanban" || value === "page" ? value : "page";
}

function defaultPageNodeIcon(type) {
  if (type === "folder") return "📁";
  if (type === "kanban") return "📋";
  return "📝";
}

function defaultPageNodeTitle(type) {
  if (type === "folder") return "Новая папка";
  if (type === "kanban") return "Kanban-доска";
  return "Новая страница";
}

function getUniqueTitle(baseTitle, existingTitles) {
  const title = String(baseTitle || "").trim() || "Новая страница";
  const taken = new Set(existingTitles.map((item) => String(item || "").trim()).filter(Boolean));
  if (!taken.has(title)) return title;

  let index = 1;
  while (taken.has(`${title}_${index}`)) index += 1;
  return `${title}_${index}`;
}

function createInitialPageBlock(pageId, requestedId) {
  const createdAt = now();
  const canUseRequestedId = requestedId && /^[a-zA-Z0-9_-]+$/.test(requestedId);
  return {
    id: canUseRequestedId ? requestedId : makeBlockId(),
    pageId,
    type: "paragraph",
    content: { text: "" },
    order: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeBlockType(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "paragraph";
}

function defaultBlockContent(type) {
  if (type === "todo") return { text: "", checked: false };
  if (type === "simple_table") return { rows: [["", ""], ["", ""]] };
  if (type === "link_to_page") return { displayText: "", targetPageId: "" };
  if (type === "kanban_embed") return { projectId: "", pageId: "" };
  if (type === "web_embed") return { url: "", mode: "auto", provider: "generic", height: 280 };
  if (type === "smart_summary") return {};
  if (type === "collapsible") return { title: "Новый раздел", text: "", collapsed: false };
  if (type === "page_properties") return {};
  return { text: "" };
}

function reorderSpaceSiblings(space, parentId) {
  const siblings = (space.nodes ?? [])
    .filter((node) => !node.isDeleted && (node.parentId ?? null) === (parentId ?? null))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  siblings.forEach((node, index) => {
    node.order = index;
  });
}

function collectSpaceDescendantIds(nodes, parentId) {
  const result = new Set();
  const visit = (id) => {
    for (const node of nodes) {
      if ((node.parentId ?? null) !== id || result.has(node.id)) continue;
      result.add(node.id);
      visit(node.id);
    }
  };
  visit(parentId);
  return result;
}

function isSpaceDescendant(nodes, possibleChildId, parentId) {
  let current = nodes.find((node) => node.id === possibleChildId);
  while (current) {
    if ((current.parentId ?? null) === parentId) return true;
    current = current.parentId ? nodes.find((node) => node.id === current.parentId) : undefined;
  }
  return false;
}

function findSpacePage(space, projectId, pageId) {
  return (space.nodes ?? []).find(
    (item) => item.id === pageId && String(item.projectId) === String(projectId) && item.type === "page" && !item.isDeleted,
  );
}

function findSpaceBlock(space, blockId) {
  return (space.blocks ?? []).find((item) => item.id === blockId);
}

function reorderPageBlocks(space, pageId) {
  const blocks = (space.blocks ?? [])
    .filter((block) => block.pageId === pageId)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  blocks.forEach((block, index) => {
    block.order = index;
  });
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
  if (!isTelegramInitDataFresh(params)) {
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

function isTelegramInitDataFresh(params) {
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds < -TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS) return false;
  return ageSeconds <= TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;
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
  const metricStartedAt = process.hrtime.bigint();
  res.once("finish", () => {
    recordRequestMetric({
      method,
      pathname,
      statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - metricStartedAt) / 1_000_000,
      requestBytes: Number(req.headers["content-length"] ?? 0) || 0,
      responseBytes: Number(res.metricResponseBytes ?? res.getHeader("content-length") ?? 0) || 0,
      authKind: res.metricAuthKind ?? "public",
    });
  });
  const cors = corsForRequest(req);
  res.corsHeaders = cors.headers;

  if (cors.rejected) return send(res, 403, { error: "Origin not allowed" });
  if (method === "OPTIONS") return send(res, 200, { ok: true });

  try {
    const db = await readJson();

    // ===== ПУБЛИЧНЫЕ ЭНДПОИНТЫ (без авторизации) =====
    if (method === "GET" && pathname === "/health") return send(res, 200, { ok: true, time: now() });


    // Шаг 1 веб-входа: запросить код. Пользователь должен сначала запустить бота.
    if (method === "POST" && pathname === "/auth/request-code") {
      const body = await parseBody(req);
      const username = String(body.username ?? "").trim().replace(/^@/, "").toLowerCase();
      if (!username) return send(res, 400, { error: "Укажите Telegram-ник" });
      const clientIp = clientIpFor(req);
      if (activeAuthIpBlock(db, clientIp)) {
        return send(res, 429, { error: "Слишком много запросов. Попробуйте позже." });
      }
      const ipRateLimited = isAuthRateLimited(`auth-code-request:ip:${clientIp}`, AUTH_CODE_REQUEST_MAX_PER_IP, AUTH_CODE_REQUEST_WINDOW_MS);
      const usernameRateLimited = isAuthRateLimited(`auth-code-request:username:${username}`, AUTH_CODE_REQUEST_MAX, AUTH_CODE_REQUEST_WINDOW_MS);
      if (ipRateLimited || usernameRateLimited) {
        const blockedUntil = ipRateLimited ? blockAuthIp(db, clientIp, "auth_code_request_rate_limit") : undefined;
        logSecurityEvent(db, {
          type: "rate_limit",
          outcome: "rejected",
          details: {
            route: "/auth/request-code",
            scope: [ipRateLimited && "ip", usernameRateLimited && "username"].filter(Boolean).join(","),
            usernameRef: securityHash(username),
            ipRef: securityHash(clientIp),
            blockedUntil,
          },
        });
        await writeJson(db);
        return send(res, 429, { error: "Слишком много запросов. Попробуйте позже." });
      }

      const user = db.users.find((item) => item.username?.toLowerCase() === username);
      // Намеренно отвечаем одинаково, чтобы не раскрывать, кто зарегистрирован.
      const genericOk = { ok: true, message: "Если такой пользователь запускал бота, код отправлен в Telegram." };
      if (!user || !user.telegramId || user.isBlocked) {
        logSecurityEvent(db, {
          type: "auth_code_request",
          outcome: "not_delivered",
          targetUserId: user?.id,
          details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp), blocked: Boolean(user?.isBlocked) },
        });
        await writeJson(db);
        return send(res, 200, genericOk);
      }

      // Удаляем прежние коды этого пользователя
      db.authCodes = db.authCodes.filter((item) => item.userId !== user.id);
      const code = generateAuthCode();
      db.authCodes.push({
        id: randomToken(8),
        userId: user.id,
        telegramId: String(user.telegramId),
        codeHash: authCodeHash(user.id, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
        createdAt: now(),
      });
      pushOutbox(
        db,
        user.telegramId,
        [
          "🔐 КОД ДЛЯ ВХОДА",
          "",
          `Ваш код: ${code}`,
          "⏳ Действует 10 минут.",
          "Код содержит латинские буквы и цифры.",
          "",
          "Если вы не запрашивали вход — просто игнорируйте.",
        ].join("\n"),
      );
      logSecurityEvent(db, {
        type: "auth_code_request",
        outcome: "delivered",
        targetUserId: user.id,
        details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp) },
      });
      await writeJson(db);
      return send(res, 200, genericOk);
    }

    // Шаг 2 веб-входа: проверить код, выдать сессию.
    if (method === "POST" && pathname === "/auth/verify-code") {
      const body = await parseBody(req);
      const username = String(body.username ?? "").trim().replace(/^@/, "").toLowerCase();
      const code = normalizeAuthCode(body.code);
      if (!username || !code) return send(res, 400, { error: "Укажите Telegram-ник и код" });
      const clientIp = clientIpFor(req);
      if (activeAuthIpBlock(db, clientIp)) {
        return send(res, 429, { error: "Слишком много попыток. Попробуйте позже." });
      }
      const ipRateLimited = isAuthRateLimited(`auth-code-verify:ip:${clientIp}`, AUTH_CODE_VERIFY_MAX_PER_IP, AUTH_CODE_VERIFY_WINDOW_MS);
      const usernameRateLimited = isAuthRateLimited(`auth-code-verify:username:${username}`, AUTH_CODE_VERIFY_MAX, AUTH_CODE_VERIFY_WINDOW_MS);
      if (ipRateLimited || usernameRateLimited) {
        const blockedUntil = ipRateLimited ? blockAuthIp(db, clientIp, "auth_code_verify_rate_limit") : undefined;
        logSecurityEvent(db, {
          type: "rate_limit",
          outcome: "rejected",
          details: {
            route: "/auth/verify-code",
            scope: [ipRateLimited && "ip", usernameRateLimited && "username"].filter(Boolean).join(","),
            usernameRef: securityHash(username),
            ipRef: securityHash(clientIp),
            blockedUntil,
          },
        });
        await writeJson(db);
        return send(res, 429, { error: "Слишком много попыток. Попробуйте позже." });
      }
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        return send(res, 400, { error: "Код должен состоять из 6 латинских букв и цифр" });
      }
      const user = db.users.find((item) => item.username?.toLowerCase() === username);
      const record = user ? db.authCodes.find((item) => item.userId === user.id) : undefined;
      if (!user || !record) {
        logSecurityEvent(db, {
          type: "auth_code_verify",
          outcome: "failed_no_record",
          targetUserId: user?.id,
          details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp) },
        });
        await writeJson(db);
      }
      if (!user || !record) return send(res, 400, { error: "Неверный код или он истёк" });

      if (new Date(record.expiresAt).getTime() < Date.now()) {
        db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
        logSecurityEvent(db, {
          type: "auth_code_verify",
          outcome: "expired",
          targetUserId: user.id,
          details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp) },
        });
        await writeJson(db);
        return send(res, 400, { error: "Код истёк. Запросите новый." });
      }
      if (record.attempts >= AUTH_CODE_MAX_ATTEMPTS) {
        db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
        logSecurityEvent(db, {
          type: "auth_code_verify",
          outcome: "locked",
          targetUserId: user.id,
          details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp) },
        });
        await writeJson(db);
        return send(res, 429, { error: "Слишком много попыток. Запросите новый код." });
      }
      if (!isAuthCodeMatch(record, user.id, code)) {
        record.attempts += 1;
        const attemptsRemaining = Math.max(0, AUTH_CODE_MAX_ATTEMPTS - record.attempts);
        if (attemptsRemaining === 0) {
          db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
          logSecurityEvent(db, {
            type: "auth_code_verify",
            outcome: "locked",
            targetUserId: user.id,
            details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp), attempts: record.attempts },
          });
          await writeJson(db);
          return send(res, 429, {
            error: "Слишком много неверных попыток. Запросите новый код.",
            attemptsRemaining: 0,
          });
        }
        logSecurityEvent(db, {
          type: "auth_code_verify",
          outcome: "failed_code",
          targetUserId: user.id,
          details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp), attempts: record.attempts, attemptsRemaining },
        });
        await writeJson(db);
        return send(res, 400, {
          error: `Неверный код. Осталось попыток: ${attemptsRemaining}.`,
          attemptsRemaining,
        });
      }

      // Успех: удаляем код, создаём сессию
      db.authCodes = db.authCodes.filter((item) => item.id !== record.id);
      const token = createSessionForUser(db, user);
      logSecurityEvent(db, {
        type: "auth_code_verify",
        outcome: "success",
        targetUserId: user.id,
        details: { usernameRef: securityHash(username), ipRef: securityHash(clientIp) },
      });
      await writeJson(db);
      return send(res, 200, { token, user });
    }

    // ===== АУТЕНТИФИКАЦИЯ =====
    if (method === "POST" && pathname === "/auth/dev-local") {
      if (!isLocalDevRequest(req)) return send(res, 404, { error: "Not found" });
      const localUser = db.users.find(
        (item) => item.telegramId === "local-dev" || item.username?.toLowerCase() === "local_user",
      );
      if (!localUser || localUser.isBlocked) return send(res, 404, { error: "Local user not found" });
      const token = createSessionForUser(db, localUser);
      logSecurityEvent(db, {
        type: "auth_dev_local",
        outcome: "success",
        targetUserId: localUser.id,
        details: { ipRef: securityHash(clientIpFor(req)) },
      });
      await writeJson(db);
      return send(res, 200, { token, user: localUser });
    }

    const auth = resolveAuth(req, db, url);
    if (db._dirty) {
      delete db._dirty;
      await writeJson(db);
    }
    if (!auth) return send(res, 401, { error: "Unauthorized" });
    res.metricAuthKind = auth.kind;
    if (auth.kind === "bot") {
      botRuntime.lastSeenAt = now();
      botRuntime.lastPath = normalizeMetricRoute(pathname);
      botRuntime.requestCount += 1;
    }

    if (auth.kind === "ai" && !(method === "GET" && /^\/projects\/[^/]+\/ai-context(?:\/changes)?$/.test(pathname))) {
      return send(res, 403, { error: "AI connector token is read-only" });
    }

    // Текущий пользователь
    if (method === "GET" && pathname === "/auth/me") return send(res, 200, auth.user ?? null);
    if (method === "POST" && pathname === "/auth/logout") {
      const header = parseAuthHeader(req);
      if (header?.scheme === "bearer") {
        if (revokeSessionByToken(db, header.value)) await writeJson(db);
      }
      return send(res, 200, { ok: true });
    }

    // Outbox для бота: забрать ожидающие сообщения и пометить отправленными
    if (method === "GET" && pathname === "/outbox/pending") {
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
      return send(res, 200, db.outbox.filter((item) => item.status === "pending"));
    }
    {
      const sentParams = route(method, pathname, { method: "POST", path: /^\/outbox\/(?<id>[^/]+)\/sent$/ });
      if (sentParams) {
        if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
        db.outbox = db.outbox.filter((item) => item.id !== sentParams.id);
        await writeJson(db);
        return send(res, 200, { ok: true });
      }
    }

    // ===== АВТОРИЗАЦИЯ ДОСТУПА К РЕСУРСАМ =====
    const denied = authorizeRequest(auth, method, pathname, db);
    if (denied) {
      if (denied.audit) {
        logSecurityEvent(db, {
          ...denied.audit,
          actorUserId: auth.user?.id,
          details: {
            ...denied.audit.details,
            method,
            route: normalizeMetricRoute(pathname),
            ipRef: securityHash(clientIpFor(req)),
          },
        });
        await writeJson(db);
      }
      return send(res, denied.status, { error: denied.error });
    }

    if (method === "GET" && pathname === "/projects") return send(res, 200, db.projects.filter((project) => !project.isDeleted));

    if (method === "GET" && pathname === "/link-preview") {
      const targetUrl = url.searchParams.get("url") ?? "";
      try {
        const preview = await fetchLinkPreview(targetUrl);
        return send(res, 200, preview);
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : "Invalid URL" });
      }
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
        responsibilityAreas: [],
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
      const project = findProjectById(db, params.projectId);
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
        logSecurityEvent(db, {
          type: "project_join_approve",
          actorUserId,
          projectId: project.id,
          targetUserId: user.id,
          details: { requestId: request.id },
        });
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
      const project = findProjectById(db, params.projectId);
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
      logSecurityEvent(db, {
        type: "project_join_reject",
        actorUserId,
        projectId: project.id,
        targetUserId: user?.id,
        details: { requestId: request.id },
      });
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)$/ });
    if (params) {
      const user = db.users.find((item) => item.id === params.id);
      return send(res, 200, userForResponse(auth, user));
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/avatar$/ });
    if (params) {
      const user = db.users.find((item) => String(item.id) === String(params.id));
      if (!user) return send(res, 404, { error: "User not found" });
      if (!canViewUserAvatar(auth, db, user)) return send(res, 403, { error: "Access denied" });
      const filePath = avatarFilePath(user.avatarFileName);
      if (!filePath || !user.avatarMimeType) return send(res, 404, { error: "Avatar not found" });
      try {
        const body = await fs.promises.readFile(filePath);
        return sendRaw(res, 200, body, user.avatarMimeType, { "Cache-Control": "private, max-age=86400" });
      } catch (error) {
        if (error?.code === "ENOENT") return send(res, 404, { error: "Avatar not found" });
        throw error;
      }
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/avatar-settings$/ });
    if (params) {
      const resolvedId = auth.kind === "user" ? String(auth.user.id) : String(params.id);
      const user = db.users.find((item) => String(item.id) === resolvedId);
      if (!user) return send(res, 404, { error: "User not found" });
      return send(res, 200, avatarSettingsForResponse(user));
    }

    params = route(method, pathname, { method: "POST", path: /^\/users\/(?<id>[^/]+)\/avatar\/telegram$/ });
    if (params) {
      const user = auth.kind === "user"
        ? db.users.find((item) => String(item.id) === String(auth.user.id))
        : db.users.find((item) => String(item.id) === String(params.id));
      if (!user) return send(res, 404, { error: "User not found" });
      if (auth.kind !== "bot" && String(user.id) !== String(auth.user.id)) return send(res, 403, { error: "Access denied" });

      user.avatarConsentAt = now();
      user.avatarMode = "telegram";
      const avatar = await fetchTelegramAvatarForUser(user);
      if (!avatar) {
        await clearUserAvatar(user, "telegram", "unavailable");
        await writeJson(db);
        return send(res, 200, ownUserProfile(user));
      }
      await saveUserAvatarBuffer(user, avatar.buffer, avatar.mimeType, "telegram");
      await writeJson(db);
      return send(res, 200, ownUserProfile(user));
    }

    params = route(method, pathname, { method: "POST", path: /^\/users\/(?<id>[^/]+)\/avatar\/manual$/ });
    if (params) {
      const body = await parseBody(req);
      const user = auth.kind === "user"
        ? db.users.find((item) => String(item.id) === String(auth.user.id))
        : db.users.find((item) => String(item.id) === String(params.id));
      if (!user) return send(res, 404, { error: "User not found" });
      if (auth.kind !== "bot" && String(user.id) !== String(auth.user.id)) return send(res, 403, { error: "Access denied" });
      const avatar = parseAvatarDataUrl(body.dataUrl);
      await saveUserAvatarBuffer(user, avatar.buffer, avatar.mimeType, "manual");
      await writeJson(db);
      return send(res, 200, ownUserProfile(user));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/users\/(?<id>[^/]+)\/avatar$/ });
    if (params) {
      const user = auth.kind === "user"
        ? db.users.find((item) => String(item.id) === String(auth.user.id))
        : db.users.find((item) => String(item.id) === String(params.id));
      if (!user) return send(res, 404, { error: "User not found" });
      if (auth.kind !== "bot" && String(user.id) !== String(auth.user.id)) return send(res, 403, { error: "Access denied" });
      await clearUserAvatar(user, "none", "disabled");
      await writeJson(db);
      return send(res, 200, ownUserProfile(user));
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/bot-preferences$/ });
    if (params) {
      const resolvedId = auth.kind === "user" ? String(auth.user.id) : String(params.id);
      const user = db.users.find((item) => String(item.id) === resolvedId);
      if (!user) return send(res, 404, { error: "User not found" });
      return send(res, 200, user.botPreferences ?? {});
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/users\/(?<id>[^/]+)\/bot-preferences$/ });
    if (params) {
      const body = await parseBody(req);
      const resolvedId = auth.kind === "user" ? String(auth.user.id) : String(params.id);
      const user = db.users.find((item) => String(item.id) === resolvedId);
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
      const user = db.users.find((item) => item.username?.toLowerCase() === username);
      return send(res, 200, userForResponse(auth, user));
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/projects$/ });
    if (params) {
      // Для обычного пользователя — всегда возвращаем проекты аутентифицированного юзера,
      // игнорируя id из URL (защита от подмены чужого id).
      const resolvedId = auth.kind === "user" ? String(auth.user.id) : String(params.id);
      const user = db.users.find((item) => String(item.id) === resolvedId);
      if (user?.isBlocked) return send(res, 403, { error: "User is blocked" });
      return send(
        res,
        200,
        db.projects.filter((project) => !project.isDeleted && project.members.some((member) => String(member.userId) === resolvedId)).map((project) => hydrateProject(db, project)),
      );
    }

    if (method === "GET" && pathname === "/system/access") {
      return send(res, 200, { isOwner: isSystemOwner(auth, db) });
    }

    // Полный сброс БД: удаляет всех пользователей, проекты и связанные данные.
    // Доступно только владельцу приложения или боту (внутренний токен).
    if (method === "POST" && pathname === "/system/reset") {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      const fresh = createDefaultDb();
      fresh.sessions = [];
      fresh.authCodes = [];
      fresh.outbox = [];
      logSecurityEvent(fresh, {
        type: "system_reset",
        actorUserId: auth.user?.id,
      });
      await writeJson(fresh);
      console.log("DATABASE RESET: all users, projects and accounts wiped");
      return send(res, 200, { ok: true, message: "Database has been reset" });
    }

    if (method === "GET" && pathname === "/system/stats") {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      return send(res, 200, createSystemStats(db));
    }

    if (method === "GET" && pathname === "/system/security-events") {
      if (!isSystemOwner(auth, db)) return send(res, 403, { error: "Forbidden" });
      const events = (db.securityEvents ?? []).map(publicSystemSecurityEvent);
      if (!wantsPaginatedResponse(url)) return send(res, 200, events);
      const { offset, limit } = paginationQuery(url, { defaultLimit: 100, maxLimit: 500 });
      return send(res, 200, {
        events: events.slice(offset, offset + limit),
        offset,
        limit,
        total: events.length,
        hasMore: offset + limit < events.length,
        summary: createSystemSecuritySummary(db),
      });
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
      logSecurityEvent(db, {
        type: "system_user_block",
        actorUserId: auth.user?.id,
        targetUserId: user.id,
        details: { reasonLength: user.blockReason.length },
      });
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
      logSecurityEvent(db, {
        type: "system_user_unblock",
        actorUserId: auth.user?.id,
        targetUserId: user.id,
      });
      await writeJson(db);
      return send(res, 200, publicSystemUser(user, db));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<projectId>[^/]+)\/join-requests$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.projectId);
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
    if (params) {
      const project = findProjectById(db, params.id);
      return send(res, 200, project && !project.isDeleted ? hydrateProject(db, project) : null);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/files$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      if (auth.kind !== "user") return send(res, 403, { error: "User access required" });
      const mode = url.searchParams.get("mode") === "node" ? "node" : "block";
      const permission = mode === "node" ? "createPage" : "updatePage";
      if (!hasProjectPermission(project, auth.user.id, permission)) {
        return send(res, 403, { error: `Permission denied: ${permission}` });
      }
      const record = await saveProjectFileFromRequest(
        req,
        params.id,
        auth.user.id,
        url.searchParams.get("fileName"),
      );
      db.projectFiles.push(record);
      await writeJson(db);
      return send(res, 201, projectFileForClient(record));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/files\/(?<fileId>[^/]+)\/content$/ });
    if (params) {
      const record = db.projectFiles.find(
        (item) => item.id === params.fileId && String(item.projectId) === String(params.id),
      );
      if (!record) return send(res, 404, { error: "File not found" });
      if (!(await sendProjectFileContent(res, record))) return send(res, 404, { error: "File content not found" });
      return;
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/files\/(?<fileId>[^/]+)$/ });
    if (params) {
      const record = db.projectFiles.find(
        (item) => item.id === params.fileId && String(item.projectId) === String(params.id),
      );
      return send(res, record ? 200 : 404, record ? projectFileForClient(record) : { error: "File not found" });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/files\/(?<fileId>[^/]+)$/ });
    if (params) {
      const record = db.projectFiles.find(
        (item) => item.id === params.fileId && String(item.projectId) === String(params.id),
      );
      if (!record) return send(res, 404, { error: "File not found" });
      if (isProjectFileReferenced(db, record.id)) return send(res, 409, { error: "File is used on a page" });
      await removeProjectFileRecord(db, record);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/export$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const options = normalizeExportOptions({
        format: url.searchParams.get("format"),
        scope: url.searchParams.get("scope"),
        targetId: url.searchParams.get("targetId"),
      });
      const targetError = validateExportTarget(db, project, options);
      if (targetError) return send(res, 400, { error: targetError });
      const file = createProjectExportFile(db, project, options);
      logSecurityEvent(db, {
        type: "project_export_download",
        actorUserId: auth.user?.id,
        projectId: project.id,
        details: { format: options.format, scope: options.scope, targetId: options.targetId, bytes: Buffer.byteLength(file.content, "utf8") },
      });
      await writeJson(db);
      return sendDownload(res, file);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/export\/telegram$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      const user = db.users.find((item) => String(item.id) === String(actorUserId));
      if (!user?.telegramId || String(user.telegramId).startsWith("local") || String(user.telegramId).startsWith("mock-")) {
        return send(res, 400, { error: "К аккаунту не привязан Telegram. Скачайте файл здесь." });
      }
      const options = normalizeExportOptions(body);
      const targetError = validateExportTarget(db, project, options);
      if (targetError) return send(res, 400, { error: targetError });
      const file = createProjectExportFile(db, project, options);
      pushOutbox(db, user.telegramId, `📦 Экспорт готов: ${file.fileName}`, {
        fileName: file.fileName,
        content: file.content,
        mimeType: file.mimeType,
        encoding: "utf8",
      });
      logSecurityEvent(db, {
        type: "project_export_telegram",
        actorUserId,
        projectId: project.id,
        targetUserId: user.id,
        details: { format: options.format, scope: options.scope, targetId: options.targetId, bytes: Buffer.byteLength(file.content, "utf8") },
      });
      await writeJson(db);
      return send(res, 200, {
        ok: true,
        fileName: file.fileName,
        message: "Файл отправится в Telegram-бота.",
      });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/invite-code$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.id);
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
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      project.inviteCode = createInviteCode(project.id);
      logSecurityEvent(db, {
        type: "project_invite_code_rotate",
        actorUserId,
        projectId: project.id,
      });
      await writeJson(db);
      return send(res, 200, { inviteCode: project.inviteCode });
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      applyProjectPatch(project, body);
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/responsibility-areas$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      project.responsibilityAreas = normalizeResponsibilityAreas(project.responsibilityAreas, project.id);
      return send(res, 200, project.responsibilityAreas);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/responsibility-areas$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      project.responsibilityAreas = normalizeResponsibilityAreas(project.responsibilityAreas, project.id);
      const area = normalizeResponsibilityArea(
        {
          id: `area_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          ...body,
        },
        project.id,
      );
      project.responsibilityAreas.push(area);
      project.updatedAt = now();
      await writeJson(db);
      return send(res, 201, area);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<projectId>[^/]+)\/responsibility-areas\/(?<areaId>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.projectId);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      project.responsibilityAreas = normalizeResponsibilityAreas(project.responsibilityAreas, project.id);
      const index = project.responsibilityAreas.findIndex((area) => String(area.id) === String(params.areaId));
      if (index === -1) return send(res, 404, { error: "Responsibility area not found" });
      const currentArea = project.responsibilityAreas[index];
      const canManageArea = canManageProjectAccess(project, actorUserId);
      const canWorkInArea = isProjectMemberRecord(project, actorUserId)
        && hasProjectPermission(project, actorUserId, "updatePage")
        && currentArea.ownerUserIds.some((userId) => String(userId) === String(actorUserId));
      if (!canManageArea && !canWorkInArea) return send(res, 403, { error: "Access denied" });
      const patch = canManageArea ? body : pickResponsibilityWorkspacePatch(body);
      if (!canManageArea && Object.keys(patch).length === 0) return send(res, 400, { error: "No editable fields" });
      project.responsibilityAreas[index] = normalizeResponsibilityArea(patch, project.id, currentArea);
      project.updatedAt = now();
      await writeJson(db);
      return send(res, 200, project.responsibilityAreas[index]);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<projectId>[^/]+)\/responsibility-areas\/(?<areaId>[^/]+)$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.projectId);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      project.responsibilityAreas = normalizeResponsibilityAreas(project.responsibilityAreas, project.id);
      const before = project.responsibilityAreas.length;
      project.responsibilityAreas = project.responsibilityAreas.filter((area) => String(area.id) !== String(params.areaId));
      if (project.responsibilityAreas.length === before) return send(res, 404, { error: "Responsibility area not found" });
      project.updatedAt = now();
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!isProjectOwner(project, actorUserId)) return send(res, 403, { error: "Only project owner can delete project" });
      project.isDeleted = true;
      project.deletedAt = now();
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    if (method === "GET" && pathname === "/projects-trash") {
      const deletedProjects = db.projects.filter((project) => {
        if (!project.isDeleted) return false;
        if (auth.kind === "bot") return true;
        return isProjectOwner(project, auth.user.id);
      });
      return send(res, 200, deletedProjects.map((project) => hydrateProject(db, project)));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/restore$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!isProjectOwner(project, actorUserId)) return send(res, 403, { error: "Only project owner can restore project" });
      project.isDeleted = false;
      delete project.deletedAt;
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/purge$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!isProjectOwner(project, actorUserId)) return send(res, 403, { error: "Only project owner can permanently delete project" });
      const projectTaskIds = new Set(db.tasks.filter((task) => task.projectId === params.id).map((task) => task.id));
      const projectFileRecords = db.projectFiles.filter((file) => String(file.projectId) === String(params.id));
      db.projects = db.projects.filter((item) => item.id !== params.id);
      db.columns = db.columns.filter((item) => item.projectId !== params.id);
      db.tasks = db.tasks.filter((item) => item.projectId !== params.id);
      db.subtasks = db.subtasks.filter((subtask) => db.tasks.some((task) => task.id === subtask.taskId));
      db.notifications = db.notifications.filter((notification) => !projectTaskIds.has(notification.entityId));
      for (const file of projectFileRecords) await removeProjectFileRecord(db, file);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/members$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      const users = project?.members.map((member) => db.users.find((user) => user.id === member.userId)).filter(Boolean) ?? [];
      return send(res, 200, users.map((user) => userForResponse(auth, user)).filter(Boolean));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/presence$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const timestamp = Date.now();
      return send(res, 200, (project.members ?? []).map((member) => {
        const presence = normalizeProjectMemberPresence(member.projectPresence, timestamp);
        return {
          userId: member.userId,
          lastSeenAt: presence.lastSeenAt,
          online: Object.values(presence.sessions).some((expiresAt) => new Date(expiresAt).getTime() > timestamp),
        };
      }));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/presence$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth);
      const member = (project.members ?? []).find((item) => String(item.userId) === String(actorUserId));
      if (!member) return send(res, 403, { error: "Access denied" });
      const sessionId = normalizePresenceSessionId(body.sessionId);
      if (!sessionId) return send(res, 400, { error: "sessionId is required" });
      const timestamp = Date.now();
      const presence = normalizeProjectMemberPresence(member.projectPresence, timestamp);
      presence.lastSeenAt = new Date(timestamp).toISOString();
      presence.sessions[sessionId] = new Date(timestamp + PROJECT_PRESENCE_ONLINE_MS).toISOString();
      presence.sessions = Object.fromEntries(
        Object.entries(presence.sessions)
          .sort(([, left], [, right]) => new Date(right).getTime() - new Date(left).getTime())
          .slice(0, PROJECT_PRESENCE_MAX_SESSIONS),
      );
      member.projectPresence = presence;
      await writeJson(db);
      return send(res, 200, { userId: member.userId, lastSeenAt: presence.lastSeenAt, online: true });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/presence$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth);
      const member = (project.members ?? []).find((item) => String(item.userId) === String(actorUserId));
      if (!member) return send(res, 403, { error: "Access denied" });
      const sessionId = normalizePresenceSessionId(body.sessionId);
      if (sessionId && member.projectPresence?.sessions) delete member.projectPresence.sessions[sessionId];
      await writeJson(db);
      return send(res, 200, { ok: true });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/members$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      const username = String(body.username ?? "").replace(/^@/, "").trim();
      let user = db.users.find((item) => item.username === username);
      if (!user) {
        user = { id: idFor(db.users), telegramId: `mock-${username}`, username, firstName: username };
        db.users.push(user);
      }
      if (!project.members.some((member) => member.userId === user.id)) {
        project.members.push({ id: idFor(project.members), projectId: project.id, userId: user.id, role: "editor" });
        logSecurityEvent(db, {
          type: "project_member_add",
          actorUserId,
          projectId: project.id,
          targetUserId: user.id,
        });
      }
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      const member = project.members.find((item) => String(item.id) === String(params.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      if (isProjectOwner(project, member.userId)) return send(res, 400, { error: "Project owner cannot be removed" });
      project.members = project.members.filter((member) => String(member.id) !== String(params.memberId));
      logSecurityEvent(db, {
        type: "project_member_remove",
        actorUserId,
        projectId: project.id,
        targetUserId: member.userId,
      });
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)\/admin$/ });
    if (params) {
      const body = await parseBody(req);
      const actorUserId = actorFor(auth, body.actorUserId);
      const project = findProjectById(db, params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!isProjectOwner(project, actorUserId)) return send(res, 403, { error: "Only project owner can manage admins" });
      const member = project.members.find((item) => String(item.id) === String(params.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      if (isProjectOwner(project, member.userId)) return send(res, 400, { error: "Owner already has admin access" });
      member.role = body.enabled ? "admin" : "editor";
      logSecurityEvent(db, {
        type: "project_member_admin_toggle",
        actorUserId,
        projectId: project.id,
        targetUserId: member.userId,
        details: { enabled: Boolean(body.enabled) },
      });
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)\/role$/ });
    if (params) {
      const body = await parseBody(req);
      const actorUserId = actorFor(auth, body.actorUserId);
      const project = findProjectById(db, params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      const member = project.members.find((item) => String(item.id) === String(params.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      if (isProjectOwner(project, member.userId)) return send(res, 400, { error: "Owner role cannot be changed" });
      const nextRole = normalizeProjectRole(body.role);
      if (!nextRole || nextRole === "owner") return send(res, 400, { error: "Unsupported role" });
      const currentRole = projectRoleName(project, member.userId);
      if ((nextRole === "admin" || currentRole === "admin") && !isProjectOwner(project, actorUserId)) {
        return send(res, 403, { error: "Only project owner can manage admins" });
      }
      member.role = nextRole;
      member.updatedAt = now();
      logSecurityEvent(db, {
        type: "project_member_role_change",
        actorUserId,
        projectId: project.id,
        targetUserId: member.userId,
        details: { fromRole: currentRole, toRole: nextRole },
      });
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)\/admin-notes$/ });
    if (params) {
      const actorUserId = actorFor(auth, url.searchParams.get("actorUserId"));
      const project = findProjectById(db, params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      const member = project.members.find((item) => String(item.id) === String(params.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      return send(res, 200, { notes: String(member.adminNotes ?? "") });
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<projectId>[^/]+)\/members\/(?<memberId>[^/]+)\/admin-notes$/ });
    if (params) {
      const body = await parseBody(req);
      const actorUserId = actorFor(auth, body.actorUserId);
      const project = findProjectById(db, params.projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
      const member = project.members.find((item) => String(item.id) === String(params.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      member.adminNotes = String(body.notes ?? "").slice(0, 5000);
      member.updatedAt = now();
      await writeJson(db);
      return send(res, 200, { notes: member.adminNotes });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/leave$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (isProjectOwner(project, actorUserId)) {
        return send(res, 400, { error: "Owner cannot leave. Transfer ownership first." });
      }
      if (!project.members.some((member) => String(member.userId) === String(actorUserId))) {
        return send(res, 404, { error: "Member not found" });
      }
      project.members = project.members.filter((member) => String(member.userId) !== String(actorUserId));
      logSecurityEvent(db, {
        type: "project_member_leave",
        actorUserId,
        projectId: project.id,
        targetUserId: actorUserId,
      });
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/transfer-ownership$/ });
    if (params) {
      const body = await parseBody(req);
      const project = findProjectById(db, params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!isProjectOwner(project, actorFor(auth, body.actorUserId))) {
        return send(res, 403, { error: "Only project owner can transfer ownership" });
      }
      const member = project.members.find((item) => String(item.id) === String(body.memberId));
      if (!member) return send(res, 404, { error: "Member not found" });
      project.ownerId = member.userId;
      project.members = project.members.map((item) => ({
        ...item,
        role: item.userId === member.userId ? "owner" : item.role === "owner" ? "admin" : item.role,
      }));
      logSecurityEvent(db, {
        type: "project_ownership_transfer",
        actorUserId: actorFor(auth, body.actorUserId),
        projectId: project.id,
        targetUserId: member.userId,
      });
      await writeJson(db);
      return send(res, 200, hydrateProject(db, project));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/columns$/ });
    if (params) {
      const pageId = url.searchParams.get("pageId") ?? undefined;
      const allBoards = url.searchParams.get("allBoards") === "1";
      const created = allBoards ? false : ensureBoardColumns(db, params.id, pageId);
      if (created) await writeJson(db);
      return send(res, 200, db.columns
        .filter((column) => column.projectId === params.id && (allBoards || sameBoard(column.pageId, pageId)))
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
      syncBoardTaskCompletionStates(db, column.projectId, column.pageId);
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
      syncBoardTaskCompletionStates(db, column.projectId, column.pageId);
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
      syncBoardTaskCompletionStates(db, params.id, body.pageId);
      await writeJson(db);
      return send(res, 200, db.columns.filter((column) => column.projectId === params.id && sameBoard(column.pageId, body.pageId)).sort((a, b) => a.position - b.position));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/tasks$/ });
    if (params) {
      const archived = url.searchParams.get("archived") === "1";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      const pageId = url.searchParams.get("pageId") ?? undefined;
      const allBoards = url.searchParams.get("allBoards") === "1";
      if (archived && !includeArchived) {
        const purged = purgeExpiredArchivedTasks(db, params.id);
        if (purged > 0) await writeJson(db);
      }
      const tasks = db.tasks
        .filter((task) => task.projectId === params.id && (allBoards || sameBoard(task.pageId, pageId)) && (includeArchived || Boolean(task.isArchived) === archived))
        .sort((a, b) => a.position - b.position)
        .map((task) => hydrateTask(db, task));
      return sendPaginatedOrArray(res, url, tasks, { key: "tasks", defaultLimit: 100, maxLimit: 500 });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/blocks$/ });
    if (params) {
      const blocks = db.blocks.filter((block) => block.projectId === params.id);
      return sendPaginatedOrArray(res, url, blocks, { key: "blocks", defaultLimit: 100, maxLimit: 500 });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/search$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const q = String(url.searchParams.get("q") ?? "").trim();
      const limit = numberQuery(url.searchParams.get("limit"), 20, 1, 50);
      return send(res, 200, buildProjectSearchResults(db, project, q, limit));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/mentions$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const userId = auth.kind === "user" ? auth.user.id : url.searchParams.get("userId");
      if (!userId) return send(res, 400, { error: "userId is required" });
      return send(res, 200, buildProjectMentions(db, project, userId));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/admin-summary$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const days = numberQuery(url.searchParams.get("days"), 7, 1, 90);
      return send(res, 200, buildProjectAdminSummary(db, project, days));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/ai-tokens$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const tokens = (db.aiConnectorTokens ?? [])
        .filter((token) => String(token.projectId) === String(project.id))
        .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
        .map(publicAiConnectorToken);
      return send(res, 200, tokens);
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/ai-access-events$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const limit = numberQuery(url.searchParams.get("limit"), 50, 1, 200);
      const events = (db.aiConnectorAccessEvents ?? [])
        .filter((event) => String(event.projectId) === String(project.id))
        .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
        .slice(0, limit)
        .map(publicAiConnectorAccessEvent);
      return send(res, 200, events);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/ai-tokens$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const body = await parseBody(req);
      const created = createAiConnectorToken(db, project.id, auth.user.id, body);
      logSecurityEvent(db, {
        type: "ai_connector_token_create",
        actorUserId: auth.user.id,
        projectId: project.id,
        details: { tokenId: created.record.id, expiresAt: created.record.expiresAt },
      });
      await writeJson(db);
      return send(res, 201, { token: created.token, tokenRecord: publicAiConnectorToken(created.record) });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<projectId>[^/]+)\/ai-tokens\/(?<tokenId>[^/]+)$/ });
    if (params) {
      const project = findProjectById(db, params.projectId);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const tokenRecord = (db.aiConnectorTokens ?? []).find(
        (token) => String(token.projectId) === String(project.id) && String(token.id) === String(params.tokenId),
      );
      if (!tokenRecord) return send(res, 404, { error: "Token not found" });
      if (!tokenRecord.revokedAt) {
        tokenRecord.revokedAt = now();
        tokenRecord.revokedByUserId = auth.user.id;
        logSecurityEvent(db, {
          type: "ai_connector_token_revoke",
          actorUserId: auth.user.id,
          projectId: project.id,
          details: { tokenId: tokenRecord.id },
        });
        await writeJson(db);
      }
      return send(res, 200, publicAiConnectorToken(tokenRecord));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/ai-context\/changes$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const since = url.searchParams.get("since");
      if (!since) return send(res, 400, { error: "since is required" });
      const scope = url.searchParams.get("scope") === "full" ? "full" : "summary";
      const options = {
        scope,
        includeBlocks: url.searchParams.get("includeBlocks") === "1",
        includeArchived: url.searchParams.get("includeArchived") === "1",
        includeTasks: booleanQuery(url.searchParams.get("includeTasks"), true),
        includeWorkspace: booleanQuery(url.searchParams.get("includeWorkspace"), true),
        includeCalendar: booleanQuery(url.searchParams.get("includeCalendar"), true),
        includeReminders: booleanQuery(url.searchParams.get("includeReminders"), true),
        includeInbox: booleanQuery(url.searchParams.get("includeInbox"), true),
        includeResponsibility: booleanQuery(url.searchParams.get("includeResponsibility"), true),
        includeActivity: booleanQuery(url.searchParams.get("includeActivity"), true),
        maxTasks: numberQuery(url.searchParams.get("maxTasks"), scope === "full" ? 1000 : 300, 1, 2000),
        maxBlocks: numberQuery(url.searchParams.get("maxBlocks"), scope === "full" ? 1000 : 300, 1, 2000),
      };
      const effectiveOptions = auth.kind === "ai" ? applyAiConnectorAccessPolicy(options, auth.token) : options;
      const context = buildProjectAiChanges(db, project, effectiveOptions, since);
      if (auth.kind === "ai") {
        logAiConnectorAccessEvent(db, {
          projectId: project.id,
          tokenRecord: auth.token,
          req,
          options: effectiveOptions,
          context,
          toolName: normalizeAiConnectorToolName(url.searchParams.get("tool")) ?? "get_project_changes",
        });
        await writeJson(db);
      }
      return send(res, 200, context);
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/ai-context$/ });
    if (params) {
      const project = findProjectById(db, params.id);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const scope = url.searchParams.get("scope") === "full" ? "full" : "summary";
      const includeBlocks = url.searchParams.get("includeBlocks") === "1";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      const includeTasks = booleanQuery(url.searchParams.get("includeTasks"), true);
      const includeWorkspace = booleanQuery(url.searchParams.get("includeWorkspace"), true);
      const includeCalendar = booleanQuery(url.searchParams.get("includeCalendar"), true);
      const includeReminders = booleanQuery(url.searchParams.get("includeReminders"), true);
      const includeInbox = booleanQuery(url.searchParams.get("includeInbox"), true);
      const includeResponsibility = booleanQuery(url.searchParams.get("includeResponsibility"), true);
      const includeActivity = booleanQuery(url.searchParams.get("includeActivity"), true);
      const maxTasks = numberQuery(url.searchParams.get("maxTasks"), scope === "full" ? 1000 : 300, 1, 2000);
      const maxBlocks = numberQuery(url.searchParams.get("maxBlocks"), scope === "full" ? 1000 : 300, 1, 2000);
      const toolName = normalizeAiConnectorToolName(url.searchParams.get("tool"));
      const options = {
        scope,
        includeBlocks,
        includeArchived,
        includeTasks,
        includeWorkspace,
        includeCalendar,
        includeReminders,
        includeInbox,
        includeResponsibility,
        includeActivity,
        maxTasks,
        maxBlocks,
      };
      const effectiveOptions = auth.kind === "ai" ? applyAiConnectorAccessPolicy(options, auth.token) : options;
      const context = buildProjectAiContext(db, project, effectiveOptions);
      if (auth.kind === "ai") {
        logAiConnectorAccessEvent(db, {
          projectId: project.id,
          tokenRecord: auth.token,
          req,
          options: effectiveOptions,
          context,
          toolName,
        });
        await writeJson(db);
      }
      return send(res, 200, context);
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<projectId>[^/]+)\/external-calendar-connections$/ });
    if (params) {
      const project = findProjectById(db, params.projectId);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const connections = (db.externalCalendarConnections ?? [])
        .filter((connection) => String(connection.projectId) === String(project.id))
        .map(publicExternalCalendarConnection)
        .sort((left, right) => left.name.localeCompare(right.name, "ru"));
      return send(res, 200, connections);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/external-calendar-connections\/yandex$/ });
    if (params) {
      if (!externalCalendarCredentialsKey()) {
        return send(res, 503, { error: "External calendar encryption is not configured" });
      }
      const project = findProjectById(db, params.projectId);
      if (!project || project.isDeleted) return send(res, 404, { error: "Project not found" });
      const body = await parseBody(req);
      const feedUrl = String(body.feedUrl ?? "").trim();
      try {
        await normalizeYandexCalendarUrl(feedUrl);
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : "Invalid calendar URL" });
      }
      const createdAt = now();
      const connectionId = `external_calendar_${crypto.randomUUID()}`;
      const calendarId = `calendar_external_${crypto.randomUUID()}`;
      const name = String(body.name ?? "Яндекс Календарь").trim().slice(0, 80) || "Яндекс Календарь";
      const color = normalizeHexColor(body.color, "#FFCC00");
      const connection = {
        id: connectionId,
        provider: "yandex",
        projectId: project.id,
        ownerUserId: String(auth.user.id),
        calendarId,
        name,
        color,
        encryptedFeedUrl: encryptExternalCalendarValue(feedUrl),
        enabled: true,
        syncIntervalMinutes: 15,
        lastSyncStatus: "pending",
        importedEvents: 0,
        createdAt,
        updatedAt: createdAt,
      };
      db.externalCalendarConnections.push(connection);
      db.calendars.push({
        id: calendarId,
        type: "PROJECT",
        projectId: project.id,
        sourceType: "external",
        connectionId,
        readOnly: true,
        name,
        color,
        ownerUserId: String(auth.user.id),
        createdAt,
        updatedAt: createdAt,
      });
      try {
        await syncExternalCalendarConnection(db, connection);
      } catch (error) {
        db.externalCalendarConnections = db.externalCalendarConnections.filter((item) => item.id !== connectionId);
        db.calendars = db.calendars.filter((item) => item.id !== calendarId);
        return send(res, 400, { error: error instanceof Error ? error.message : "Calendar sync failed" });
      }
      await writeJson(db);
      return send(res, 201, publicExternalCalendarConnection(connection));
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<projectId>[^/]+)\/external-calendar-connections\/(?<id>[^/]+)$/ });
    if (params) {
      const connection = db.externalCalendarConnections.find(
        (item) => item.id === params.id && String(item.projectId) === String(params.projectId),
      );
      if (!connection) return send(res, 404, { error: "External calendar not found" });
      const body = await parseBody(req);
      const calendar = db.calendars.find((item) => String(item.id) === String(connection.calendarId));
      if (body.enabled !== undefined) connection.enabled = Boolean(body.enabled);
      if (body.name !== undefined) connection.name = String(body.name).trim().slice(0, 80) || connection.name;
      if (body.color !== undefined) connection.color = normalizeHexColor(body.color, connection.color);
      connection.updatedAt = now();
      if (calendar) {
        calendar.name = connection.name;
        calendar.color = connection.color;
        calendar.updatedAt = connection.updatedAt;
        for (const event of db.calendarEvents.filter((item) => String(item.calendarId) === String(calendar.id))) {
          event.color = calendar.color;
          event.categoryLabel = calendar.name;
          event.updatedAt = connection.updatedAt;
        }
      }
      await writeJson(db);
      return send(res, 200, publicExternalCalendarConnection(connection));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<projectId>[^/]+)\/external-calendar-connections\/(?<id>[^/]+)\/sync$/ });
    if (params) {
      const connection = db.externalCalendarConnections.find(
        (item) => item.id === params.id && String(item.projectId) === String(params.projectId),
      );
      if (!connection) return send(res, 404, { error: "External calendar not found" });
      try {
        const result = await syncExternalCalendarConnection(db, connection);
        await writeJson(db);
        return send(res, 200, result);
      } catch (error) {
        await writeJson(db);
        return send(res, 502, { error: error instanceof Error ? error.message : "Calendar sync failed" });
      }
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<projectId>[^/]+)\/external-calendar-connections\/(?<id>[^/]+)$/ });
    if (params) {
      const connection = db.externalCalendarConnections.find(
        (item) => item.id === params.id && String(item.projectId) === String(params.projectId),
      );
      if (!connection) return send(res, 404, { error: "External calendar not found" });
      db.externalCalendarConnections = db.externalCalendarConnections.filter((item) => item.id !== connection.id);
      db.calendarEvents = db.calendarEvents.filter((item) => String(item.calendarId) !== String(connection.calendarId));
      db.calendars = db.calendars.filter((item) => String(item.id) !== String(connection.calendarId));
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    if (method === "GET" && pathname === "/me/external-calendar-connections") {
      const connections = (db.externalCalendarConnections ?? [])
        .filter((connection) => !connection.projectId && String(connection.ownerUserId) === String(auth.user.id))
        .map(publicExternalCalendarConnection)
        .sort((left, right) => left.name.localeCompare(right.name, "ru"));
      return send(res, 200, connections);
    }

    if (method === "POST" && pathname === "/me/external-calendar-connections/yandex") {
      if (!externalCalendarCredentialsKey()) {
        return send(res, 503, { error: "External calendar encryption is not configured" });
      }
      const body = await parseBody(req);
      const feedUrl = String(body.feedUrl ?? "").trim();
      try {
        await normalizeYandexCalendarUrl(feedUrl);
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : "Invalid calendar URL" });
      }
      const createdAt = now();
      const connectionId = `external_calendar_${crypto.randomUUID()}`;
      const calendarId = `calendar_external_${crypto.randomUUID()}`;
      const name = String(body.name ?? "Яндекс Календарь").trim().slice(0, 80) || "Яндекс Календарь";
      const color = normalizeHexColor(body.color, "#FFCC00");
      const connection = {
        id: connectionId,
        provider: "yandex",
        ownerUserId: String(auth.user.id),
        calendarId,
        name,
        color,
        encryptedFeedUrl: encryptExternalCalendarValue(feedUrl),
        enabled: true,
        syncIntervalMinutes: 15,
        lastSyncStatus: "pending",
        importedEvents: 0,
        createdAt,
        updatedAt: createdAt,
      };
      db.externalCalendarConnections.push(connection);
      db.calendars.push({
        id: calendarId,
        type: "PERSONAL",
        sourceType: "external",
        connectionId,
        readOnly: true,
        name,
        color,
        ownerUserId: String(auth.user.id),
        createdAt,
        updatedAt: createdAt,
      });
      try {
        await syncExternalCalendarConnection(db, connection);
      } catch (error) {
        db.externalCalendarConnections = db.externalCalendarConnections.filter((item) => item.id !== connectionId);
        db.calendars = db.calendars.filter((item) => item.id !== calendarId);
        return send(res, 400, { error: error instanceof Error ? error.message : "Calendar sync failed" });
      }
      await writeJson(db);
      return send(res, 201, publicExternalCalendarConnection(connection));
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/me\/external-calendar-connections\/(?<id>[^/]+)$/ });
    if (params) {
      const connection = db.externalCalendarConnections.find(
        (item) => !item.projectId && item.id === params.id && String(item.ownerUserId) === String(auth.user.id),
      );
      if (!connection) return send(res, 404, { error: "External calendar not found" });
      const body = await parseBody(req);
      const calendar = db.calendars.find((item) => String(item.id) === String(connection.calendarId));
      if (body.enabled !== undefined) connection.enabled = Boolean(body.enabled);
      if (body.name !== undefined) connection.name = String(body.name).trim().slice(0, 80) || connection.name;
      if (body.color !== undefined) connection.color = normalizeHexColor(body.color, connection.color);
      connection.updatedAt = now();
      if (calendar) {
        calendar.name = connection.name;
        calendar.color = connection.color;
        calendar.updatedAt = connection.updatedAt;
        for (const event of db.calendarEvents.filter((item) => String(item.calendarId) === String(calendar.id))) {
          event.color = calendar.color;
          event.categoryLabel = calendar.name;
          event.updatedAt = connection.updatedAt;
        }
      }
      await writeJson(db);
      return send(res, 200, publicExternalCalendarConnection(connection));
    }

    params = route(method, pathname, { method: "POST", path: /^\/me\/external-calendar-connections\/(?<id>[^/]+)\/sync$/ });
    if (params) {
      const connection = db.externalCalendarConnections.find(
        (item) => !item.projectId && item.id === params.id && String(item.ownerUserId) === String(auth.user.id),
      );
      if (!connection) return send(res, 404, { error: "External calendar not found" });
      try {
        const result = await syncExternalCalendarConnection(db, connection);
        await writeJson(db);
        return send(res, 200, result);
      } catch (error) {
        await writeJson(db);
        return send(res, 502, { error: error instanceof Error ? error.message : "Calendar sync failed" });
      }
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/me\/external-calendar-connections\/(?<id>[^/]+)$/ });
    if (params) {
      const connection = db.externalCalendarConnections.find(
        (item) => !item.projectId && item.id === params.id && String(item.ownerUserId) === String(auth.user.id),
      );
      if (!connection) return send(res, 404, { error: "External calendar not found" });
      db.externalCalendarConnections = db.externalCalendarConnections.filter((item) => item.id !== connection.id);
      db.calendarEvents = db.calendarEvents.filter((item) => String(item.calendarId) !== String(connection.calendarId));
      db.calendars = db.calendars.filter((item) => String(item.id) !== String(connection.calendarId));
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    if (method === "GET" && pathname === "/me/calendars") {
      const calendars = accessibleCalendarsForUser(db, auth.user.id)
        .map((calendar) => calendarWithUserPermissions(db, auth.user.id, calendar))
        .sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name, "ru") : left.type === "PERSONAL" ? -1 : 1);
      return send(res, 200, calendars);
    }

    if (method === "GET" && pathname === "/me/calendar-events") {
      const range = calendarRangeFromUrl(url);
      if (range.error) return send(res, 400, { error: range.error });
      const calendars = accessibleCalendarsForUser(db, auth.user.id);
      const accessibleIds = new Set(calendars.map((calendar) => String(calendar.id)));
      const selectedIds = requestedCalendarIds(url);
      const enabledIds = selectedIds.size > 0
        ? new Set([...selectedIds].filter((id) => accessibleIds.has(id)))
        : accessibleIds;
      const events = db.calendarEvents
        .filter((event) => enabledIds.has(String(event.calendarId)))
        .filter((event) => canUserReadCalendarEvent(db, auth.user.id, event))
        .filter((event) => calendarEventOverlapsRange(event, range))
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
      return sendPaginatedOrArray(res, url, events, { key: "events", defaultLimit: 250, maxLimit: 1000 });
    }

    if (method === "GET" && pathname === "/me/task-deadlines") {
      const range = calendarRangeFromUrl(url);
      if (range.error) return send(res, 400, { error: range.error });
      const projectIdFilter = url.searchParams.get("projectId");
      const accessibleProjectIds = new Set(
        db.projects
          .filter((project) => !project.isDeleted)
          .filter((project) => isProjectMemberRecord(project, auth.user.id))
          .filter((project) => hasProjectPermission(project, auth.user.id, "viewCalendar"))
          .filter((project) => !projectIdFilter || String(project.id) === String(projectIdFilter))
          .map((project) => String(project.id)),
      );
      const deadlines = db.tasks
        .filter((task) => accessibleProjectIds.has(String(task.projectId)))
        .filter((task) => !task.isArchived && !isTaskInFinalColumn(db, task))
        .filter((task) => {
          const deadline = task.deadlineAt ? new Date(task.deadlineAt).getTime() : Number.NaN;
          return Number.isFinite(deadline) && deadline >= range.from && deadline < range.to;
        })
        .map((task) => {
          const project = findProjectById(db, task.projectId);
          return {
            ...hydrateTask(db, task),
            project: project ? { id: project.id, title: project.title, icon: project.icon } : undefined,
          };
        })
        .sort((left, right) => new Date(left.deadlineAt).getTime() - new Date(right.deadlineAt).getTime());
      return sendPaginatedOrArray(res, url, deadlines, { key: "tasks", defaultLimit: 250, maxLimit: 1000 });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/calendar$/ });
    if (params) {
      const calendar = projectCalendarFor(db, params.id);
      if (!calendar) return send(res, 404, { error: "Calendar not found" });
      return send(res, 200, calendarWithUserPermissions(db, auth.user.id, calendar));
    }

    params = route(method, pathname, { method: "POST", path: /^\/calendars\/(?<id>[^/]+)\/categories$/ });
    if (params) {
      const calendar = db.calendars.find((item) => String(item.id) === String(params.id));
      const denied = calendarCategoryManagePermissionError(db, auth.user.id, calendar);
      if (denied) return send(res, denied.status, { error: denied.error });
      const body = await parseBody(req);
      const label = String(body.label ?? "").trim().slice(0, 80);
      if (!label) return send(res, 400, { error: "Category label is required" });
      const categories = calendarCategoriesFor(db, calendar);
      const allCategoryLabels = [...Object.values(BASE_CALENDAR_CATEGORIES), ...categories];
      if (allCategoryLabels.some((category) => category.label.localeCompare(label, "ru", { sensitivity: "accent" }) === 0)) {
        return send(res, 409, { error: "Category with this label already exists" });
      }
      const category = {
        id: `category_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        label,
        color: normalizeHexColor(body.color, "#64748B"),
        type: "custom",
        createdAt: now(),
      };
      if (calendar.type === "PERSONAL") {
        calendar.categories = [...normalizeCalendarCategories(calendar.categories), category];
        calendar.updatedAt = now();
      } else {
        const project = findProjectById(db, calendar.projectId);
        project.calendarCategories = [...normalizeCalendarCategories(project.calendarCategories), category];
        project.updatedAt = now();
      }
      await writeJson(db);
      return send(res, 201, category);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/calendars\/(?<id>[^/]+)\/categories\/(?<categoryId>[^/]+)$/ });
    if (params) {
      const calendar = db.calendars.find((item) => String(item.id) === String(params.id));
      const denied = calendarCategoryManagePermissionError(db, auth.user.id, calendar);
      if (denied) return send(res, denied.status, { error: denied.error });
      const body = await parseBody(req);
      const categories = calendarCategoriesFor(db, calendar);
      const existing = categories.find((category) => String(category.id) === String(params.categoryId));
      const base = BASE_CALENDAR_CATEGORIES[params.categoryId];
      if (!existing && !base) return send(res, 404, { error: "Category not found" });
      const updated = {
        ...(base ?? {}),
        ...(existing ?? {}),
        id: params.categoryId,
        label: String(existing?.label ?? base?.label ?? body.label ?? "").trim().slice(0, 80),
        color: normalizeHexColor(body.color, existing?.color ?? base?.color ?? "#64748B"),
        type: normalizeCalendarEventType(existing?.type ?? base?.type ?? body.type),
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      setCalendarCategories(db, calendar, [
        ...categories.filter((category) => String(category.id) !== String(params.categoryId)),
        updated,
      ]);
      for (const event of db.calendarEvents.filter((item) => String(item.calendarId) === String(calendar.id) && String(item.categoryId) === String(updated.id))) {
        event.color = updated.color;
        event.categoryLabel = updated.label;
        event.type = updated.type;
        event.updatedAt = now();
      }
      await writeJson(db);
      return send(res, 200, updated);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/calendars\/(?<id>[^/]+)\/categories\/(?<categoryId>[^/]+)$/ });
    if (params) {
      const calendar = db.calendars.find((item) => String(item.id) === String(params.id));
      const denied = calendarCategoryManagePermissionError(db, auth.user.id, calendar);
      if (denied) return send(res, denied.status, { error: denied.error });
      if (BASE_CALENDAR_CATEGORIES[params.categoryId]) {
        return send(res, 400, { error: "Base categories cannot be deleted" });
      }
      const categories = calendarCategoriesFor(db, calendar);
      if (!categories.some((category) => String(category.id) === String(params.categoryId))) {
        return send(res, 404, { error: "Category not found" });
      }
      setCalendarCategories(db, calendar, categories.filter((category) => String(category.id) !== String(params.categoryId)));
      const fallback = calendarCategoryById(db, calendar, "base:meeting") ?? BASE_CALENDAR_CATEGORIES["base:meeting"];
      let reassignedEvents = 0;
      for (const event of db.calendarEvents.filter((item) => String(item.calendarId) === String(calendar.id) && String(item.categoryId) === String(params.categoryId))) {
        event.categoryId = "base:meeting";
        event.categoryLabel = fallback.label;
        event.type = fallback.type;
        event.color = fallback.color;
        event.updatedAt = now();
        reassignedEvents += 1;
      }
      await writeJson(db);
      return send(res, 200, { success: true, reassignedEvents });
    }

    params = route(method, pathname, { method: "POST", path: /^\/calendars\/(?<id>[^/]+)\/events$/ });
    if (params) {
      const calendar = db.calendars.find((item) => String(item.id) === String(params.id));
      const denied = calendarCreatePermissionError(db, auth.user.id, calendar);
      if (denied) return send(res, denied.status, { error: denied.error });
      const body = await parseBody(req);
      const created = createCalendarEventRecord(db, calendar, body, auth.user.id);
      if (created.error) return send(res, 400, { error: created.error });
      db.calendarEvents.push(created.event);
      await writeJson(db);
      return send(res, 201, created.event);
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/calendar-events$/ });
    if (params) {
      return send(res, 200, db.calendarEvents
        .filter((event) => event.projectId === params.id)
        .filter((event) => auth.kind !== "user" || canUserReadCalendarEvent(db, auth.user.id, event))
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/calendar-events$/ });
    if (params) {
      const body = await parseBody(req);
      const calendar = projectCalendarFor(db, params.id);
      if (!calendar) return send(res, 404, { error: "Calendar not found" });
      const created = createCalendarEventRecord(db, calendar, body, auth.user.id);
      if (created.error) return send(res, 400, { error: created.error });
      db.calendarEvents.push(created.event);
      await writeJson(db);
      return send(res, 201, created.event);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/calendar-events\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const event = db.calendarEvents.find((item) => item.id === params.id);
      if (!event) return send(res, 404, { error: "Calendar event not found" });
      const updated = applyCalendarEventPatch(db, event, body);
      if (updated.error) return send(res, 400, { error: updated.error });
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
      const projectTemplates = db.templates.filter((item) => item.projectId === params.id);
      const rawTitle = String(body.title || "Новый шаблон").trim() || "Новый шаблон";
      const template = {
        id: `template_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId: params.id,
        title: getUniqueTitle(rawTitle, projectTemplates.map((item) => item.title)),
        icon: String(body.icon || "📄").trim() || "📄",
        description: body.description ? String(body.description) : "",
        order: projectTemplates.length,
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
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const createdAt = now();
      const scheduleType = body.scheduleType === "recurring" ? "recurring" : "once";
      const defaultReminderUserId = auth.kind === "user" ? auth.user.id : body.creatorUserId ?? body.targetUserId;
      if (!defaultReminderUserId) return send(res, 400, { error: "creatorUserId is required" });
      const creatorUserId = actorFor(auth, body.creatorUserId ?? defaultReminderUserId);
      const creatorDenied = projectActorPermissionError(project, creatorUserId, "manageReminders");
      if (creatorDenied) return send(res, creatorDenied.status, { error: creatorDenied.error });
      const targetDenied = projectMemberTargetError(project, body.targetUserId ?? creatorUserId, "Target user");
      if (targetDenied) return send(res, targetDenied.status, { error: targetDenied.error });
      const reminder = {
        id: `reminder_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId: params.id,
        creatorUserId,
        targetUserId: asRef(body.targetUserId ?? creatorUserId),
        sourceType: normalizeReminderSourceType(body.sourceType),
        sourceId: body.sourceId ? String(body.sourceId) : undefined,
        title: String(body.title || "Новое напоминание").trim(),
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
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
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
      const project = db.projects.find((item) => String(item.id) === String(reminder.projectId));
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorDenied = botActorPermissionError(auth, project, body.actorUserId ?? body.creatorUserId, "manageReminders");
      if (actorDenied) return send(res, actorDenied.status, { error: actorDenied.error });
      const targetDenied = projectMemberTargetError(project, body.targetUserId, "Target user");
      if (targetDenied) return send(res, targetDenied.status, { error: targetDenied.error });
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
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
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
      if (!canUseLegacySpaceEndpoint(auth, project, url)) {
        return send(res, 410, {
          error: "Legacy full /space endpoint is disabled for regular clients. Use /space/meta, /space/tree, /space/nodes and /space/pages/:pageId/blocks.",
        });
      }
      return send(res, 200, await ensureProjectSpace(db, params.id, project.title));
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/space\/meta$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      return send(res, 200, {
        collapsedIds: space.collapsedIds ?? [],
        recentPages: space.recentPages ?? [],
        dailyNotes: space.dailyNotes ?? {},
      });
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)\/space\/meta$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      if (Array.isArray(body.collapsedIds)) space.collapsedIds = body.collapsedIds.map(String);
      if (Array.isArray(body.recentPages)) space.recentPages = body.recentPages.map(String).slice(0, 20);
      if (body.dailyNotes && typeof body.dailyNotes === "object" && !Array.isArray(body.dailyNotes)) {
        space.dailyNotes = Object.fromEntries(
          Object.entries(body.dailyNotes).map(([date, pageId]) => [String(date), String(pageId)]),
        );
      }
      await writeJson(db);
      return send(res, 200, {
        collapsedIds: space.collapsedIds ?? [],
        recentPages: space.recentPages ?? [],
        dailyNotes: space.dailyNotes ?? {},
      });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/space\/tree$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const parentId = normalizeParentQuery(url.searchParams.get("parentId"));
      const includeDeleted = url.searchParams.get("includeDeleted") === "1";
      const nodes = (space.nodes ?? [])
        .filter((node) => String(node.projectId) === String(params.id))
        .filter((node) => includeDeleted || !node.isDeleted)
        .filter((node) => (node.parentId ?? null) === parentId)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      return send(res, 200, {
        projectId: params.id,
        parentId,
        nodes,
      });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const includeDeleted = url.searchParams.get("includeDeleted") === "1";
      const nodes = (space.nodes ?? [])
        .filter((node) => String(node.projectId) === String(params.id))
        .filter((node) => includeDeleted || !node.isDeleted)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      return send(res, 200, { projectId: params.id, nodes });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes\/(?<nodeId>[^/]+)$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const node = (space.nodes ?? []).find((item) => item.id === params.nodeId && String(item.projectId) === String(params.id));
      if (!node || node.isDeleted) return send(res, 404, { error: "Node not found" });
      return send(res, 200, node);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorDenied = botActorPermissionError(auth, project, body.actorUserId ?? body.properties?.author, "createPage");
      if (actorDenied) return send(res, actorDenied.status, { error: actorDenied.error });
      const space = await ensureProjectSpace(db, params.id, project.title);
      space.nodes ??= [];
      space.blocks ??= [];

      const type = normalizePageNodeType(body.type);
      const parentId = body.parentId === undefined || body.parentId === null || body.parentId === "" ? null : String(body.parentId);
      if (parentId) {
        const parent = space.nodes.find((node) => node.id === parentId && String(node.projectId) === String(params.id));
        if (!parent || parent.isDeleted || parent.type !== "folder") {
          return send(res, 400, { error: "Parent folder not found" });
        }
      }

      const siblings = space.nodes.filter((node) => !node.isDeleted && (node.parentId ?? null) === parentId);
      const createdAt = now();
      const requestedId = typeof body.id === "string" ? body.id.trim() : "";
      const canUseRequestedId =
        requestedId &&
        /^[a-zA-Z0-9_-]+$/.test(requestedId) &&
        !space.nodes.some((item) => item.id === requestedId);

      const node = {
        id: canUseRequestedId ? requestedId : makePageNodeId(type),
        projectId: params.id,
        parentId,
        type,
        title: getUniqueTitle(
          String(body.title || defaultPageNodeTitle(type)).trim() || defaultPageNodeTitle(type),
          siblings.map((sibling) => sibling.title),
        ),
        icon: String(body.icon || defaultPageNodeIcon(type)),
        order: Number.isFinite(Number(body.order)) ? Math.max(0, Math.min(Number(body.order), siblings.length)) : siblings.length,
        isPinned: Boolean(body.isPinned),
        pinnedOrder: body.pinnedOrder,
        properties: body.properties,
        createdAt,
        updatedAt: createdAt,
      };

      for (const sibling of siblings) {
        if ((Number(sibling.order) || 0) >= node.order) sibling.order = (Number(sibling.order) || 0) + 1;
      }
      space.nodes.push(node);
      if (type === "page") {
        const initialBlocks = Array.isArray(body.initialBlocks) ? body.initialBlocks : [];
        if (initialBlocks.length > 0) {
          for (const [index, item] of initialBlocks.entries()) {
            const blockType = normalizeBlockType(item?.type);
            const requestedBlockId = typeof item?.id === "string" ? item.id.trim() : "";
            const canUseRequestedBlockId =
              requestedBlockId &&
              /^[a-zA-Z0-9_-]+$/.test(requestedBlockId) &&
              !space.blocks.some((block) => block.id === requestedBlockId);
            space.blocks.push({
              id: canUseRequestedBlockId ? requestedBlockId : makeBlockId(),
              pageId: node.id,
              type: blockType,
              content: Object.prototype.hasOwnProperty.call(item ?? {}, "content")
                ? item.content
                : defaultBlockContent(blockType),
              order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
              createdAt,
              updatedAt: createdAt,
            });
          }
          reorderPageBlocks(space, node.id);
        } else {
          const initialBlockId = typeof body.initialBlockId === "string" ? body.initialBlockId.trim() : "";
          space.blocks.push(createInitialPageBlock(node.id, initialBlockId));
        }
      }
      db.blocks = syncBlocksFromSpaces(db.spaces);
      await writeJson(db);
      return send(res, 201, node);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes\/(?<nodeId>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const node = (space.nodes ?? []).find((item) => item.id === params.nodeId && String(item.projectId) === String(params.id));
      if (!node || node.isDeleted) return send(res, 404, { error: "Node not found" });

      if (Object.prototype.hasOwnProperty.call(body, "title")) {
        const title = String(body.title ?? "").trim();
        if (!title) return send(res, 400, { error: "Title is required" });
        node.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(body, "icon")) node.icon = String(body.icon || defaultPageNodeIcon(node.type));
      if (Object.prototype.hasOwnProperty.call(body, "properties")) {
        node.properties = { ...(node.properties ?? {}), ...(body.properties ?? {}) };
      }
      if (Object.prototype.hasOwnProperty.call(body, "isPinned")) {
        node.isPinned = Boolean(body.isPinned);
        node.pinnedOrder = node.isPinned ? body.pinnedOrder ?? node.pinnedOrder : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(body, "pinnedOrder")) node.pinnedOrder = body.pinnedOrder;
      node.updatedAt = now();
      await writeJson(db);
      return send(res, 200, node);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes\/(?<nodeId>[^/]+)\/move$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const node = (space.nodes ?? []).find((item) => item.id === params.nodeId && String(item.projectId) === String(params.id));
      if (!node || node.isDeleted) return send(res, 404, { error: "Node not found" });

      const previousParentId = node.parentId ?? null;
      const parentId = body.parentId === undefined || body.parentId === null || body.parentId === "" ? null : String(body.parentId);
      if (parentId === node.id || isSpaceDescendant(space.nodes ?? [], parentId, node.id)) {
        return send(res, 400, { error: "Cannot move node into itself" });
      }
      if (parentId) {
        const parent = space.nodes.find((item) => item.id === parentId && String(item.projectId) === String(params.id));
        if (!parent || parent.isDeleted || parent.type !== "folder") {
          return send(res, 400, { error: "Parent folder not found" });
        }
      }

      const targetSiblings = space.nodes
        .filter((item) => !item.isDeleted && item.id !== node.id && (item.parentId ?? null) === parentId)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const order = Number.isFinite(Number(body.order)) ? Math.max(0, Math.min(Math.floor(Number(body.order)), targetSiblings.length)) : targetSiblings.length;
      targetSiblings.splice(order, 0, node);
      targetSiblings.forEach((item, index) => {
        item.order = index;
      });
      node.parentId = parentId;
      node.updatedAt = now();
      if (previousParentId !== parentId) reorderSpaceSiblings(space, previousParentId);
      await writeJson(db);
      return send(res, 200, node);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes\/(?<nodeId>[^/]+)\/trash$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const node = (space.nodes ?? []).find((item) => item.id === params.nodeId && String(item.projectId) === String(params.id));
      if (!node || node.isDeleted) return send(res, 404, { error: "Node not found" });
      const deletedIds = collectSpaceDescendantIds(space.nodes ?? [], node.id);
      deletedIds.add(node.id);
      const deletedAt = now();
      for (const item of space.nodes) {
        if (!deletedIds.has(item.id)) continue;
        item.isDeleted = true;
        item.deletedAt = deletedAt;
        item.isPinned = false;
        item.pinnedOrder = undefined;
        item.updatedAt = deletedAt;
      }
      reorderSpaceSiblings(space, node.parentId ?? null);
      await writeJson(db);
      return send(res, 200, { success: true, deletedIds: [...deletedIds] });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes\/(?<nodeId>[^/]+)\/restore$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const node = (space.nodes ?? []).find((item) => item.id === params.nodeId && String(item.projectId) === String(params.id));
      if (!node) return send(res, 404, { error: "Node not found" });
      const restoredIds = collectSpaceDescendantIds(space.nodes ?? [], node.id);
      restoredIds.add(node.id);
      for (const item of space.nodes) {
        if (!restoredIds.has(item.id)) continue;
        const parentDeleted = item.parentId ? space.nodes.find((parent) => parent.id === item.parentId)?.isDeleted : false;
        item.parentId = parentDeleted ? null : item.parentId ?? null;
        item.isDeleted = false;
        item.deletedAt = undefined;
        item.updatedAt = now();
      }
      reorderSpaceSiblings(space, node.parentId ?? null);
      await writeJson(db);
      return send(res, 200, { success: true, restoredIds: [...restoredIds] });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/space\/nodes\/(?<nodeId>[^/]+)$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const node = (space.nodes ?? []).find((item) => item.id === params.nodeId && String(item.projectId) === String(params.id));
      if (!node) return send(res, 404, { error: "Node not found" });
      const purgedIds = collectSpaceDescendantIds(space.nodes ?? [], node.id);
      purgedIds.add(node.id);
      const parentId = node.parentId ?? null;
      const purgedFileIds = (space.blocks ?? [])
        .filter((block) => purgedIds.has(block.pageId) && block.type === "file")
        .map((block) => block.content?.fileId);
      space.nodes = (space.nodes ?? []).filter((item) => !purgedIds.has(item.id));
      space.blocks = (space.blocks ?? []).filter((block) => !purgedIds.has(block.pageId));
      space.recentPages = (space.recentPages ?? []).filter((id) => !purgedIds.has(id));
      for (const [date, pageId] of Object.entries(space.dailyNotes ?? {})) {
        if (purgedIds.has(pageId)) delete space.dailyNotes?.[date];
      }
      reorderSpaceSiblings(space, parentId);
      await removeUnreferencedProjectFiles(db, purgedFileIds);
      db.blocks = syncBlocksFromSpaces(db.spaces);
      await writeJson(db);
      return send(res, 200, { success: true, purgedIds: [...purgedIds] });
    }

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/space\/pages\/(?<pageId>[^/]+)\/blocks$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const page = (space.nodes ?? []).find((item) => item.id === params.pageId && String(item.projectId) === String(params.id));
      if (!page || page.isDeleted) return send(res, 404, { error: "Page not found" });
      const offset = numberQuery(url.searchParams.get("offset"), 0, 0, 1000000);
      const limit = numberQuery(url.searchParams.get("limit"), 100, 1, 500);
      const allBlocks = (space.blocks ?? [])
        .filter((block) => block.pageId === params.pageId)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      return send(res, 200, {
        projectId: params.id,
        pageId: params.pageId,
        offset,
        limit,
        total: allBlocks.length,
        blocks: allBlocks.slice(offset, offset + limit),
      });
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/space\/pages\/(?<pageId>[^/]+)\/blocks$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const page = findSpacePage(space, params.id, params.pageId);
      if (!page) return send(res, 404, { error: "Page not found" });
      space.blocks ??= [];

      const pageBlocks = space.blocks
        .filter((block) => block.pageId === params.pageId)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const requestedId = typeof body.id === "string" ? body.id.trim() : "";
      const canUseRequestedId =
        requestedId &&
        /^[a-zA-Z0-9_-]+$/.test(requestedId) &&
        !space.blocks.some((item) => item.id === requestedId);
      const type = normalizeBlockType(body.type);
      const order = Number.isFinite(Number(body.order))
        ? Math.max(0, Math.min(Math.floor(Number(body.order)), pageBlocks.length))
        : pageBlocks.length;
      const createdAt = now();
      const block = {
        id: canUseRequestedId ? requestedId : makeBlockId(),
        pageId: params.pageId,
        type,
        content: Object.prototype.hasOwnProperty.call(body, "content") ? body.content : defaultBlockContent(type),
        order,
        createdAt,
        updatedAt: createdAt,
      };
      for (const item of pageBlocks) {
        if ((Number(item.order) || 0) >= order) item.order = (Number(item.order) || 0) + 1;
      }
      space.blocks.push(block);
      db.blocks = syncBlocksFromSpaces(db.spaces);
      createMentionNotificationSignals(db, project, block, page, auth.user?.id);
      await writeJson(db);
      return send(res, 201, block);
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)\/space\/blocks\/(?<blockId>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const block = findSpaceBlock(space, params.blockId);
      if (!block) return send(res, 404, { error: "Block not found" });
      const page = findSpacePage(space, params.id, block.pageId);
      if (!page) return send(res, 404, { error: "Page not found" });

      if (Object.prototype.hasOwnProperty.call(body, "type")) block.type = normalizeBlockType(body.type);
      if (Object.prototype.hasOwnProperty.call(body, "content")) block.content = body.content;
      block.updatedAt = now();
      db.blocks = syncBlocksFromSpaces(db.spaces);
      createMentionNotificationSignals(db, project, block, page, auth.user?.id);
      await writeJson(db);
      return send(res, 200, block);
    }

    params = route(method, pathname, { method: "POST", path: /^\/projects\/(?<id>[^/]+)\/space\/blocks\/(?<blockId>[^/]+)\/move$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const block = findSpaceBlock(space, params.blockId);
      if (!block) return send(res, 404, { error: "Block not found" });
      if (!findSpacePage(space, params.id, block.pageId)) return send(res, 404, { error: "Page not found" });

      const pageBlocks = (space.blocks ?? [])
        .filter((item) => item.pageId === block.pageId && item.id !== block.id)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const order = Number.isFinite(Number(body.order))
        ? Math.max(0, Math.min(Math.floor(Number(body.order)), pageBlocks.length))
        : pageBlocks.length;
      pageBlocks.splice(order, 0, block);
      pageBlocks.forEach((item, index) => {
        item.order = index;
      });
      block.updatedAt = now();
      db.blocks = syncBlocksFromSpaces(db.spaces);
      await writeJson(db);
      return send(res, 200, block);
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/space\/blocks\/(?<blockId>[^/]+)$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const space = await ensureProjectSpace(db, params.id, project.title);
      const block = findSpaceBlock(space, params.blockId);
      if (!block) return send(res, 404, { error: "Block not found" });
      if (!findSpacePage(space, params.id, block.pageId)) return send(res, 404, { error: "Page not found" });

      const pageId = block.pageId;
      const removedFileId = block.type === "file" ? block.content?.fileId : undefined;
      space.blocks = (space.blocks ?? []).filter((item) => item.id !== block.id);
      reorderPageBlocks(space, pageId);
      await removeUnreferencedProjectFiles(db, [removedFileId]);
      db.blocks = syncBlocksFromSpaces(db.spaces);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "PUT", path: /^\/projects\/(?<id>[^/]+)\/space$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      if (!canUseLegacySpaceEndpoint(auth, project, url)) {
        return send(res, 410, {
          error: "Legacy full /space write is disabled for regular clients. Use granular workspace endpoints.",
        });
      }
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
      const resolvedId = auth.kind === "user" ? String(auth.user.id) : String(params.id);
      const tasks = db.tasks
        .filter((task) => String(task.assigneeId) === resolvedId && isTaskActiveForUserList(db, task))
        .map((task) => {
          const hydrated = hydrateTask(db, task);
          const project = db.projects.find((item) => String(item.id) === String(task.projectId));
          return {
            ...hydrated,
            project: project
              ? { id: project.id, title: project.title, icon: project.icon }
              : undefined,
          };
        });
      return sendPaginatedOrArray(res, url, tasks, { key: "tasks", defaultLimit: 100, maxLimit: 500 });
    }

    params = route(method, pathname, { method: "GET", path: /^\/users\/(?<id>[^/]+)\/task-progress$/ });
    if (params) {
      const resolvedId = auth.kind === "user" ? String(auth.user.id) : String(params.id);
      const days = clampWholeNumber(url.searchParams.get("days"), 1, 31, 7);
      return send(res, 200, buildUserTaskProgress(db, resolvedId, days));
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
      const project = db.projects.find((item) => String(item.id) === projectId);
      if (!project) return send(res, 404, { error: "Project not found" });
      const creatorId = actorFor(auth, body.creatorId ?? body.actorUserId);
      const creatorDenied = projectActorPermissionError(project, creatorId, "createTask");
      if (creatorDenied) return send(res, creatorDenied.status, { error: creatorDenied.error });
      const assigneeDenied = projectMemberTargetError(project, body.assigneeId, "Assignee");
      if (assigneeDenied) return send(res, assigneeDenied.status, { error: assigneeDenied.error });
      const pageId = body.pageId ? String(body.pageId) : undefined;
      const firstColumn = db.columns
        .filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId) && !column.isHidden)
        .sort((a, b) => a.position - b.position)[0];
      const columnId = String(body.columnId ?? firstColumn?.id ?? "");
      const targetColumn = db.columns.find((column) => column.id === columnId);
      if (!targetColumn || targetColumn.projectId !== projectId || !sameBoard(targetColumn.pageId, pageId) || targetColumn.isHidden) {
        return send(res, 400, { error: "Column not found" });
      }
      const siblings = db.tasks.filter((task) => task.columnId === columnId && !task.isArchived);
      const task = {
        id: idFor(db.tasks),
        projectId,
        pageId: targetColumn.pageId,
        columnId: targetColumn.id,
        creatorId,
        assigneeId: body.assigneeId !== undefined ? String(body.assigneeId) : undefined,
        title: body.title || "Новая задача",
        description: body.description,
        priority: body.priority ?? "MEDIUM",
        deadlineAt: body.deadlineAt,
        scheduledAt: body.scheduledAt,
        importanceScore: normalizeTaskImportanceScore(body.importanceScore),
        isBlocking: Boolean(body.isBlocking),
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
      createTaskAdminAttentionSignal(db, task);
      await writeJson(db);
      return send(res, 201, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/tasks\/(?<id>[^/]+)$/ });
    if (params) {
      const body = await parseBody(req);
      const task = db.tasks.find((item) => item.id === params.id);
      if (!task) return send(res, 404, { error: "Task not found" });
      const project = db.projects.find((item) => String(item.id) === String(task.projectId));
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorDenied = botActorPermissionError(auth, project, body.actorUserId ?? body.creatorId, "updateTask");
      if (actorDenied) return send(res, actorDenied.status, { error: actorDenied.error });
      const assigneeDenied = projectMemberTargetError(project, body.assigneeId, "Assignee");
      if (assigneeDenied) return send(res, assigneeDenied.status, { error: assigneeDenied.error });
      const previousColumnId = task.columnId;
      const previousArchived = Boolean(task.isArchived);
      const previousAssigneeId = task.assigneeId;
      const wasDeferred = Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now());
      Object.assign(task, normalizeTaskPatch(body), { updatedAt: now() });
      updateTaskCompletionState(db, task, previousColumnId, previousArchived);
      const assigneeChanged =
        Object.prototype.hasOwnProperty.call(body, "assigneeId") &&
        Boolean(task.assigneeId) &&
        String(task.assigneeId) !== String(previousAssigneeId ?? "");
      const activatedFromDeferred = wasDeferred && isTaskActiveForKanbanNotifications(db, task);
      createTaskNotificationSignals(db, task, { includeAssignment: assigneeChanged || activatedFromDeferred });
      createTaskAdminAttentionSignal(db, task);
      await writeJson(db);
      return send(res, 200, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "POST", path: /^\/tasks\/(?<id>[^/]+)\/move$/ });
    if (params) {
      const body = await parseBody(req);
      const task = db.tasks.find((item) => item.id === params.id);
      if (!task) return send(res, 404, { error: "Task not found" });
      const targetColumn = db.columns.find((column) => column.id === String(body.columnId));
      if (!targetColumn) return send(res, 404, { error: "Column not found" });
      if (targetColumn.projectId !== task.projectId || !sameBoard(targetColumn.pageId, task.pageId)) {
        return send(res, 400, { error: "Column belongs to another board" });
      }
      const previousColumnId = task.columnId;
      const targetTasks = db.tasks
        .filter((item) => item.columnId === targetColumn.id && item.id !== task.id && !item.isArchived)
        .sort((a, b) => a.position - b.position);
      const requestedPosition = Number(body.position);
      const insertIndex = Math.max(
        0,
        Math.min(Number.isFinite(requestedPosition) ? requestedPosition : targetTasks.length, targetTasks.length),
      );
      task.projectId = targetColumn.projectId;
      task.pageId = targetColumn.pageId;
      task.columnId = targetColumn.id;
      task.position = insertIndex;
      task.updatedAt = now();
      updateTaskCompletionState(db, task, previousColumnId, Boolean(task.isArchived));
      targetTasks.splice(insertIndex, 0, task);
      for (let index = 0; index < targetTasks.length; index += 1) {
        targetTasks[index].position = index;
      }
      if (previousColumnId !== task.columnId) {
        normalizeTaskPositions(db, previousColumnId);
      }
      createTaskAdminAttentionSignal(db, task);
      await writeJson(db);
      return send(res, 200, hydrateTask(db, task));
    }

    params = route(method, pathname, { method: "POST", path: /^\/columns\/(?<id>[^/]+)\/tasks\/reorder$/ });
    if (params) {
      const body = await parseBody(req);
      const targetColumn = db.columns.find((column) => column.id === params.id);
      if (!targetColumn) return send(res, 404, { error: "Column not found" });
      if (!Array.isArray(body.orderedIds)) return send(res, 400, { error: "orderedIds must be an array" });
      const ordered = body.orderedIds.map(String);
      const orderedSet = new Set(ordered);
      const invalidTask = db.tasks.find(
        (task) => orderedSet.has(task.id) && (task.projectId !== targetColumn.projectId || !sameBoard(task.pageId, targetColumn.pageId)),
      );
      if (invalidTask) return send(res, 400, { error: "Column belongs to another board" });
      db.tasks = db.tasks.map((task) => {
        const position = ordered.indexOf(task.id);
        if (position === -1) return task;
        const nextTask = {
          ...task,
          projectId: targetColumn.projectId,
          pageId: targetColumn.pageId,
          columnId: targetColumn.id,
          position,
          updatedAt: now(),
        };
        updateTaskCompletionState(db, nextTask, task.columnId, Boolean(task.isArchived));
        return nextTask;
      });
      normalizeTaskPositions(db, targetColumn.id);
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
      db.notifications = db.notifications.filter((notification) => notification.entityId !== params.id);
      await writeJson(db);
      return send(res, 200, { success: true });
    }

    params = route(method, pathname, { method: "DELETE", path: /^\/projects\/(?<id>[^/]+)\/archive$/ });
    if (params) {
      const archivedIds = new Set(db.tasks.filter((task) => task.projectId === params.id && task.isArchived).map((task) => task.id));
      db.tasks = db.tasks.filter((task) => !archivedIds.has(task.id));
      db.subtasks = db.subtasks.filter((subtask) => !archivedIds.has(subtask.taskId));
      db.notifications = db.notifications.filter((notification) => !archivedIds.has(notification.entityId));
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
      return send(res, 200, mergeSettings(project.botSettings ?? defaultBotSettings, {}));
    }

    params = route(method, pathname, { method: "PATCH", path: /^\/projects\/(?<id>[^/]+)\/bot-settings$/ });
    if (params) {
      const body = await parseBody(req);
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const actorUserId = actorFor(auth, body.actorUserId);
      if (auth.kind !== "bot" && !canManageProjectAccess(project, actorUserId)) return send(res, 403, { error: "Access denied" });
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
      return sendPaginatedOrArray(res, url, events, { key: "events", defaultLimit: 100, maxLimit: 500 });
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

    params = route(method, pathname, { method: "GET", path: /^\/projects\/(?<id>[^/]+)\/inbox-summary$/ });
    if (params) {
      const project = db.projects.find((item) => item.id === params.id);
      if (!project) return send(res, 404, { error: "Project not found" });
      const userId = actorFor(auth, url.searchParams.get("userId"));
      const readAt = parseTime(url.searchParams.get("readAt")) ?? 0;
      return send(res, 200, buildInboxUnreadSummary(db, project, userId, readAt));
    }

    params = route(method, pathname, { method: "POST", path: /^\/notifications$/ });
    if (params) {
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
      const body = await parseBody(req);
      const event = { ...body, id: idFor(db.notifications), status: "pending" };
      db.notifications.push(event);
      await writeJson(db);
      return send(res, 201, event);
    }

    if (method === "GET" && pathname === "/notifications/pending") {
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
      const before = url.searchParams.get("before") ?? now();
      const time = new Date(before).getTime();
      const notifications = db.notifications.filter((item) => item.status === "pending" && new Date(item.sendAt).getTime() <= time && !isNotificationSuppressed(db, item));
      return sendPaginatedOrArray(res, url, notifications, { key: "notifications", defaultLimit: 100, maxLimit: 500 });
    }

    params = route(method, pathname, { method: "GET", path: /^\/notifications\/exists$/ });
    if (params) {
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
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
      if (auth.kind !== "bot") return send(res, 403, { error: "Bot access required" });
      const body = await parseBody(req);
      const item = db.notifications.find((notification) => notification.id === params.id);
      if (!item) return send(res, 404, { error: "Notification not found" });
      Object.assign(item, body);
      await writeJson(db);
      return send(res, 200, item);
    }

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return send(res, error.status, { error: error.message });
    }
    return send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
}

function mergeSettings(current, patch) {
  const base = {
    ...defaultBotSettings,
    ...current,
    taskSignificance: {
      ...defaultBotSettings.taskSignificance,
      ...current?.taskSignificance,
      priorityBonus: {
        ...defaultBotSettings.taskSignificance.priorityBonus,
        ...current?.taskSignificance?.priorityBonus,
      },
    },
    reports: {
      weekly: {
        ...defaultBotSettings.reports.weekly,
        ...current?.reports?.weekly,
        sections: {
          ...defaultBotSettings.reports.weekly.sections,
          ...current?.reports?.weekly?.sections,
        },
      },
      overdue: {
        ...defaultBotSettings.reports.overdue,
        ...current?.reports?.overdue,
        sections: {
          ...defaultBotSettings.reports.overdue.sections,
          ...current?.reports?.overdue?.sections,
        },
      },
    },
  };
  return {
    ...base,
    ...patch,
    taskSignificance: {
      ...base.taskSignificance,
      ...patch.taskSignificance,
      priorityBonus: {
        ...base.taskSignificance.priorityBonus,
        ...patch.taskSignificance?.priorityBonus,
      },
    },
    reports: {
      weekly: {
        ...base.reports.weekly,
        ...patch.reports?.weekly,
        sections: {
          ...base.reports.weekly.sections,
          ...patch.reports?.weekly?.sections,
        },
      },
      overdue: {
        ...base.reports.overdue,
        ...patch.reports?.overdue,
        sections: {
          ...base.reports.overdue.sections,
          ...patch.reports?.overdue?.sections,
        },
      },
    },
  };
}

function purgeExpiredArchivedTasks(db, projectId) {
  const project = db.projects.find((item) => item.id === projectId);
  const settings = mergeSettings(project?.botSettings ?? defaultBotSettings, {});
  const maxAgeMs = archiveCleanupMaxAgeMs(settings.archiveCleanupMode);
  if (!maxAgeMs) return 0;

  const minTime = Date.now() - maxAgeMs;
  const expiredIds = new Set(
    db.tasks
      .filter((task) => task.projectId === projectId && task.isArchived)
      .filter((task) => {
        const archivedAt = task.archivedAt ?? task.completedAt ?? task.updatedAt ?? task.createdAt;
        return archivedAt && new Date(archivedAt).getTime() < minTime;
      })
      .map((task) => task.id),
  );
  if (expiredIds.size === 0) return 0;

  db.tasks = db.tasks.filter((task) => !expiredIds.has(task.id));
  db.subtasks = db.subtasks.filter((subtask) => !expiredIds.has(subtask.taskId));
  return expiredIds.size;
}

function archiveCleanupMaxAgeMs(mode) {
  if (mode === "2weeks") return 14 * 24 * 3600000;
  if (mode === "1month") return 30 * 24 * 3600000;
  if (mode === "3months") return 90 * 24 * 3600000;
  return 0;
}

function asRef(value) {
  return value === undefined || value === null || value === "" ? value : String(value);
}

function findProjectById(db, projectId) {
  const id = asRef(projectId);
  return db.projects.find((project) => String(project.id) === String(id));
}

function normalizeDatabaseIds(db) {
  let repaired = 0;
  db.users = db.users.map((user) => ({ ...user, id: asRef(user.id) }));
  db.projects = db.projects.map((project) => ({
    ...project,
    id: asRef(project.id),
    ownerId: asRef(project.ownerId),
    calendarCategories: normalizeCalendarCategories(project.calendarCategories),
    responsibilityAreas: normalizeResponsibilityAreas(project.responsibilityAreas, project.id),
    members: (project.members ?? []).map((member) => {
      const userId = asRef(member.userId);
      const rawMemberId = asRef(member.id);
      const hasUsableMemberId = rawMemberId && rawMemberId !== "undefined" && rawMemberId !== "null";
      const memberId = hasUsableMemberId ? rawMemberId : userId ? `member_${asRef(project.id)}_${userId}` : undefined;
      if (!hasUsableMemberId && memberId) repaired += 1;
      return {
        ...member,
        id: memberId,
        projectId: asRef(member.projectId) || asRef(project.id),
        userId,
      };
    }),
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
  repaired += repairIncompleteTasks(db);
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
  db.calendars = (db.calendars ?? []).map((calendar) => ({
    ...calendar,
    id: asRef(calendar.id) || (calendar.type === "PERSONAL" ? personalCalendarId(calendar.ownerUserId) : projectCalendarId(calendar.projectId)),
    type: calendar.type === "PERSONAL" ? "PERSONAL" : "PROJECT",
    ownerUserId: asRef(calendar.ownerUserId),
    projectId: asRef(calendar.projectId),
    name: String(calendar.name || (calendar.type === "PERSONAL" ? "Личный" : "Календарь")),
    color: normalizeHexColor(calendar.color),
    categories: calendar.type === "PERSONAL" ? normalizeCalendarCategories(calendar.categories) : [],
  }));
  db.externalCalendarConnections = (db.externalCalendarConnections ?? []).map((connection) => ({
    ...connection,
    id: asRef(connection.id),
    ownerUserId: asRef(connection.ownerUserId),
    calendarId: asRef(connection.calendarId),
    provider: connection.provider === "yandex" ? "yandex" : "ical",
    enabled: connection.enabled !== false,
    syncIntervalMinutes: Math.max(5, Number(connection.syncIntervalMinutes ?? 15)),
  }));
  db.calendarEvents = db.calendarEvents.map((event) => ({
    ...event,
    id: asRef(event.id),
    projectId: asRef(event.projectId),
    calendarId: asRef(event.calendarId),
    ownerUserId: asRef(event.ownerUserId),
    createdByUserId: asRef(event.createdByUserId),
    sourceId: asRef(event.sourceId),
    categoryId: asRef(event.categoryId),
    categoryLabel: event.categoryLabel ? String(event.categoryLabel) : "",
    participantUserIds: Array.isArray(event.participantUserIds) ? event.participantUserIds.map(String) : [],
    type: normalizeCalendarEventType(event.type),
    visibility: event.visibility === "selected" ? "selected" : event.visibility === "private" ? "private" : "project",
    notification: normalizeStoredCalendarNotification(event.notification, event.startsAt),
  }));
  repaired += ensureCalendarRecords(db);
  return repaired;
}

function normalizeTaskPatch(patch) {
  const next = {};
  const allowedFields = [
    "title",
    "description",
    "priority",
    "deadlineAt",
    "scheduledAt",
    "importanceScore",
    "isBlocking",
    "colorLabel",
    "isRepeating",
    "assigneeId",
    "linkedPageIds",
  ];
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "assigneeId")) {
    next.assigneeId = patch.assigneeId !== undefined && patch.assigneeId !== null ? asRef(patch.assigneeId) : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "linkedPageIds")) {
    next.linkedPageIds = Array.isArray(patch.linkedPageIds) ? patch.linkedPageIds.map(String) : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "importanceScore")) {
    next.importanceScore = normalizeTaskImportanceScore(patch.importanceScore);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "isBlocking")) {
    next.isBlocking = Boolean(patch.isBlocking);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "isRepeating")) {
    next.isRepeating = Boolean(patch.isRepeating);
  }
  return next;
}

function normalizeTaskImportanceScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
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

function publicUserProfile(user) {
  if (!user) return undefined;
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    avatarUrl: avatarPublicPath(user),
    avatarMode: user.avatarMode ?? "none",
    avatarStatus: user.avatarStatus ?? (user.avatarFileName ? "ready" : "disabled"),
    avatarUpdatedAt: user.avatarUpdatedAt,
  };
}

function ownUserProfile(user) {
  if (!user) return null;
  return {
    ...publicUserProfile(user),
    telegramId: user.telegramId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function avatarSettingsForResponse(user) {
  return {
    avatarMode: user.avatarMode ?? "none",
    avatarStatus: user.avatarStatus ?? (user.avatarFileName ? "ready" : "disabled"),
    avatarUrl: avatarPublicPath(user),
    avatarUpdatedAt: user.avatarUpdatedAt,
    avatarConsentAt: user.avatarConsentAt,
    maxBytes: USER_AVATAR_MAX_BYTES,
    allowedMimeTypes: [...USER_AVATAR_ALLOWED_MIME_TYPES],
  };
}

function userForResponse(auth, user) {
  if (!user) return null;
  return auth?.kind === "bot" ? user : publicUserProfile(user);
}

function hydrateProject(db, project) {
  if (!project) return undefined;
  const {
    inviteCode: _inviteCode,
    botSettings: _botSettings,
    joinRequests: _joinRequests,
    ...safeProject
  } = project;
  return {
    ...safeProject,
    columns: db.columns.filter((column) => column.projectId === project.id).sort((a, b) => a.position - b.position),
    members: (project.members ?? []).map((member) => {
      const { adminNotes: _adminNotes, projectPresence: _projectPresence, ...safeMember } = member;
      return {
        ...safeMember,
        user: publicUserProfile(db.users.find((user) => user.id === member.userId)),
        role: {
          name: projectRoleName(project, member.userId),
          permissions: projectRolePermissions(projectRoleName(project, member.userId)),
        },
      };
    }),
    _count: {
      tasks: db.tasks.filter((task) => task.projectId === project.id && !task.isArchived).length,
    },
  };
}

function hydrateTask(db, task) {
  return {
    ...task,
    assignee: task.assigneeId ? publicUserProfile(db.users.find((user) => user.id === task.assigneeId)) : undefined,
    subtasks: db.subtasks.filter((subtask) => subtask.taskId === task.id).sort((a, b) => a.position - b.position),
    tags: task.tags ?? [],
  };
}

function resolveAiWorkspaceSelection(nodes, options = {}) {
  const mode = normalizeAiConnectorWorkspaceAccessMode(options.workspaceAccessMode);
  const requestedNodeIds = normalizeAiConnectorWorkspaceNodeIds(options.workspaceNodeIds);
  const activeNodes = nodes.filter((node) => !node.isDeleted);
  const nodesById = new Map(activeNodes.map((node) => [String(node.id), node]));
  const childrenByParentId = new Map();
  for (const node of activeNodes) {
    const parentId = node.parentId == null ? null : String(node.parentId);
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(String(node.id));
    childrenByParentId.set(parentId, children);
  }

  const expandDescendants = (seedIds) => {
    const expanded = new Set(seedIds.filter((id) => nodesById.has(id)));
    const queue = [...expanded];
    while (queue.length) {
      const currentId = queue.shift();
      for (const childId of childrenByParentId.get(currentId) ?? []) {
        if (expanded.has(childId)) continue;
        expanded.add(childId);
        queue.push(childId);
      }
    }
    return expanded;
  };

  const allNodeIds = new Set(nodesById.keys());
  if (mode === "all") {
    return { mode, requestedNodeIds: [], contentNodeIds: allNodeIds, visibleNodeIds: allNodeIds };
  }

  if (mode === "exclude") {
    const excludedNodeIds = expandDescendants(requestedNodeIds);
    const contentNodeIds = new Set([...allNodeIds].filter((id) => !excludedNodeIds.has(id)));
    return { mode, requestedNodeIds, contentNodeIds, visibleNodeIds: contentNodeIds };
  }

  const contentNodeIds = expandDescendants(requestedNodeIds);
  const visibleNodeIds = new Set(contentNodeIds);
  for (const nodeId of contentNodeIds) {
    let parentId = nodesById.get(nodeId)?.parentId;
    while (parentId != null && nodesById.has(String(parentId))) {
      visibleNodeIds.add(String(parentId));
      parentId = nodesById.get(String(parentId))?.parentId;
    }
  }
  return { mode, requestedNodeIds, contentNodeIds, visibleNodeIds };
}

function buildProjectAiContext(db, project, options = {}) {
  const scope = options.scope === "full" ? "full" : "summary";
  const includeTasks = options.includeTasks !== false;
  const includeWorkspace = options.includeWorkspace !== false;
  const includeCalendar = options.includeCalendar !== false;
  const includeReminders = options.includeReminders !== false;
  const includeInbox = options.includeInbox !== false;
  const includeResponsibility = options.includeResponsibility !== false;
  const includeActivity = options.includeActivity !== false;
  const includeArchived = Boolean(options.includeArchived);
  const includeBlocks = includeWorkspace && Boolean(options.includeBlocks);
  const maxTasks = Math.max(1, Math.min(2000, Number(options.maxTasks) || (scope === "full" ? 1000 : 300)));
  const maxBlocks = Math.max(1, Math.min(2000, Number(options.maxBlocks) || (scope === "full" ? 1000 : 300)));
  const projectId = String(project.id);
  const nowMs = Date.now();
  const space = db.spaces?.[project.id] ?? db.spaces?.[projectId];
  const rawNodes = space?.nodes ?? project.pages ?? [];
  const workspaceSelection = resolveAiWorkspaceSelection(rawNodes, options);
  const restrictToWorkspaceSelection = workspaceSelection.mode !== "all";
  const isPageAllowed = (pageId) => !restrictToWorkspaceSelection
    || (pageId != null && workspaceSelection.contentNodeIds.has(String(pageId)));
  const columns = includeTasks ? (db.columns ?? [])
    .filter((column) => String(column.projectId) === projectId)
    .filter((column) => isPageAllowed(column.pageId))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((column) => ({
      id: column.id,
      pageId: column.pageId,
      title: column.title,
      position: column.position,
      isArchive: Boolean(column.isArchive),
      isHidden: Boolean(column.isHidden),
    })) : [];
  const projectTasks = includeTasks ? (db.tasks ?? [])
    .filter((task) => String(task.projectId) === projectId)
    .filter((task) => isPageAllowed(task.pageId))
    .filter((task) => includeArchived || !task.isArchived)
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()) : [];
  const taskSummary = projectTasks.reduce((summary, task) => {
    const status = getTaskAiStatus(db, task, nowMs);
    if (status.state === "completed") summary.completedTasks += 1;
    if (status.state === "deferred") summary.deferredTasks += 1;
    if (status.state === "active") summary.activeTasks += 1;
    if (status.isOverdue) summary.overdueTasks += 1;
    return summary;
  }, {
    activeTasks: 0,
    completedTasks: 0,
    deferredTasks: 0,
    overdueTasks: 0,
  });
  const tasks = projectTasks.slice(0, maxTasks).map((task) => compactTaskForAiContext(db, task, nowMs));
  const allowedTaskIds = new Set(projectTasks.map((task) => String(task.id)));
  const nodes = includeWorkspace ? rawNodes
    .filter((node) => !node.isDeleted)
    .filter((node) => workspaceSelection.visibleNodeIds.has(String(node.id)))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((node) => ({
      id: node.id,
      parentId: node.parentId ?? null,
      type: node.type,
      title: node.title,
      icon: node.icon,
      position: node.position,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    })) : [];
  const projectBlocks = (db.blocks ?? [])
    .filter((block) => String(block.projectId) === projectId)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const allBlocks = projectBlocks.filter((block) => isPageAllowed(block.pageId));
  const blocks = includeBlocks ? allBlocks.slice(0, maxBlocks).map(compactBlockForAiContext) : [];
  const fileReferences = new Map();
  for (const block of allBlocks) {
    if (block.type !== "file" || !block.content?.fileId) continue;
    fileReferences.set(String(block.content.fileId), {
      pageId: block.pageId,
      blockId: block.id,
      caption: clipAiText(block.content.caption, 500),
    });
  }
  const files = includeWorkspace ? (db.projectFiles ?? [])
    .filter((file) => String(file.projectId) === projectId && fileReferences.has(String(file.id)))
    .map((file) => ({
      ...projectFileForClient(file),
      ...fileReferences.get(String(file.id)),
    })) : [];
  const calendarEvents = includeCalendar ? (db.calendarEvents ?? [])
    .filter((event) => String(event.projectId) === projectId)
    .sort((a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime())
    .map(compactCalendarEventForAiContext) : [];
  const reminders = includeReminders ? (db.reminders ?? [])
    .filter((reminder) => String(reminder.projectId) === projectId)
    .sort((a, b) => new Date(a.remindAt ?? a.createdAt ?? 0).getTime() - new Date(b.remindAt ?? b.createdAt ?? 0).getTime())
    .slice(0, scope === "full" ? 500 : 100)
    .map(compactReminderForAiContext) : [];
  const inboxRootIds = new Set(rawNodes
    .filter((node) => !node.isDeleted && node.type === "folder" && String(node.title).trim().toLowerCase() === "inbox")
    .map((node) => String(node.id)));
  const inboxItems = includeInbox ? rawNodes
    .filter((node) => !node.isDeleted && inboxRootIds.has(String(node.parentId)))
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    .slice(0, scope === "full" ? 500 : 100)
    .map((node) => compactInboxItemForAiContext(node, projectBlocks, scope)) : [];
  const activity = includeActivity ? (db.activity ?? [])
    .filter((event) => String(event.projectId) === projectId)
    .filter((event) => {
      if (!restrictToWorkspaceSelection) return true;
      const taskId = event.taskId ?? (event.entityType === "task" ? event.entityId : undefined);
      const pageId = event.pageId ?? (["page", "kanban", "table", "file"].includes(event.entityType) ? event.entityId : undefined);
      if (!taskId && !pageId) return true;
      return (pageId && isPageAllowed(pageId)) || (taskId && allowedTaskIds.has(String(taskId)));
    })
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, scope === "full" ? 300 : 80)
    .map(compactActivityForAiContext) : [];
  const responsibilityAreas = includeResponsibility
    ? normalizeResponsibilityAreas(project.responsibilityAreas, project.id).map((area) => ({
      id: area.id,
      title: area.title,
      description: area.description ?? "",
      notes: clipAiText(area.notes ?? "", scope === "full" ? 10000 : 2500),
      planItems: (area.planItems ?? []).slice(0, scope === "full" ? 300 : 60),
      ownerUserIds: area.ownerUserIds ?? [],
      linkedPageIds: (area.linkedPageIds ?? []).filter(isPageAllowed),
      linkedKanbanBoardIds: (area.linkedKanbanBoardIds ?? []).filter(isPageAllowed),
      linkedTaskIds: (area.linkedTaskIds ?? []).filter((taskId) => !restrictToWorkspaceSelection || allowedTaskIds.has(String(taskId))),
      createdAt: area.createdAt,
      updatedAt: area.updatedAt,
    }))
    : [];

  return {
    kind: "noto_project_ai_context",
    version: 3,
    generatedAt: now(),
    scope,
    limits: {
      tasksReturned: tasks.length,
      tasksTotal: projectTasks.length,
      blocksReturned: blocks.length,
      blocksTotal: allBlocks.length,
      blocksIncluded: includeBlocks,
      archivedTasksIncluded: includeArchived,
      workspaceAccess: {
        mode: workspaceSelection.mode,
        selectedNodeIds: workspaceSelection.requestedNodeIds,
        visibleNodes: nodes.length,
      },
      sectionsIncluded: {
        tasks: includeTasks,
        workspace: includeWorkspace,
        calendar: includeCalendar,
        reminders: includeReminders,
        inbox: includeInbox,
        responsibility: includeResponsibility,
        activity: includeActivity,
      },
    },
    project: {
      id: project.id,
      title: project.title,
      description: project.description ?? "",
      ownerId: project.ownerId,
      aiToneStyle: project.aiToneStyle,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    members: (project.members ?? []).map((member) => ({
      id: member.id,
      userId: member.userId,
      role: projectRoleName(project, member.userId),
      user: compactUserForAiContext(db.users.find((user) => String(user.id) === String(member.userId))),
    })),
    summary: {
      activeTasks: taskSummary.activeTasks,
      completedTasks: taskSummary.completedTasks,
      deferredTasks: taskSummary.deferredTasks,
      overdueTasks: taskSummary.overdueTasks,
      calendarEvents: calendarEvents.length,
      reminders: reminders.length,
      inboxItems: inboxItems.length,
      pages: nodes.filter((node) => node.type === "page").length,
      folders: nodes.filter((node) => node.type === "folder").length,
      kanbanBoards: nodes.filter((node) => node.type === "kanban").length,
    },
    columns,
    tasks,
    calendarEvents,
    reminders,
    inboxItems,
    responsibilityAreas,
    workspace: {
      nodes,
      blocks,
      files,
    },
    activity,
  };
}

function buildProjectAiChanges(db, project, options = {}, sinceValue) {
  const sinceMs = new Date(sinceValue).getTime();
  if (!Number.isFinite(sinceMs)) throw new RequestBodyError(400, "Valid since date is required");
  const generatedAt = now();
  const context = buildProjectAiContext(db, project, options);
  const changedAtOrAfter = (value) => {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(timestamp) && timestamp >= sinceMs;
  };
  const tasks = context.tasks ?? [];
  const nodes = context.workspace?.nodes ?? [];
  const blocks = context.workspace?.blocks ?? [];
  const files = context.workspace?.files ?? [];
  const calendarEvents = context.calendarEvents ?? [];
  const reminders = context.reminders ?? [];
  const inboxItems = context.inboxItems ?? [];
  const responsibilityAreas = context.responsibilityAreas ?? [];
  const completedTasks = tasks.filter((task) => task.state === "completed"
    && changedAtOrAfter(task.completedAt ?? task.archivedAt ?? task.updatedAt));
  const completedTaskIds = new Set(completedTasks.map((task) => String(task.id)));
  const newTasks = tasks.filter((task) => changedAtOrAfter(task.createdAt));
  const newTaskIds = new Set(newTasks.map((task) => String(task.id)));
  const changedTasks = tasks.filter((task) => changedAtOrAfter(task.updatedAt)
    && !newTaskIds.has(String(task.id))
    && !completedTaskIds.has(String(task.id)));
  const newPages = nodes.filter((node) => changedAtOrAfter(node.createdAt));
  const newPageIds = new Set(newPages.map((node) => String(node.id)));
  const changedPages = nodes.filter((node) => changedAtOrAfter(node.updatedAt) && !newPageIds.has(String(node.id)));
  const changedBlocks = blocks.filter((block) => changedAtOrAfter(block.updatedAt ?? block.createdAt));
  const newFiles = files.filter((file) => changedAtOrAfter(file.createdAt));
  const newCalendarEvents = calendarEvents.filter((event) => changedAtOrAfter(event.createdAt));
  const newCalendarEventIds = new Set(newCalendarEvents.map((event) => String(event.id)));
  const changedCalendarEvents = calendarEvents.filter((event) => changedAtOrAfter(event.updatedAt)
    && !newCalendarEventIds.has(String(event.id)));
  const newReminders = reminders.filter((reminder) => changedAtOrAfter(reminder.createdAt));
  const newReminderIds = new Set(newReminders.map((reminder) => String(reminder.id)));
  const changedReminders = reminders.filter((reminder) => changedAtOrAfter(reminder.updatedAt ?? reminder.sentAt)
    && !newReminderIds.has(String(reminder.id)));
  const newInboxItems = inboxItems.filter((item) => changedAtOrAfter(item.createdAt));
  const newInboxItemIds = new Set(newInboxItems.map((item) => String(item.id)));
  const changedInboxItems = inboxItems.filter((item) => changedAtOrAfter(item.updatedAt)
    && !newInboxItemIds.has(String(item.id)));
  const changedResponsibilityAreas = responsibilityAreas.filter((area) => changedAtOrAfter(area.updatedAt ?? area.createdAt));
  const recentActivity = (context.activity ?? []).filter((event) => changedAtOrAfter(event.createdAt));

  return {
    kind: "noto_project_ai_changes",
    version: 2,
    projectId: project.id,
    since: new Date(sinceMs).toISOString(),
    generatedAt,
    access: context.limits?.workspaceAccess,
    summaryDiff: {
      newTasks: newTasks.length,
      changedTasks: changedTasks.length,
      completedTasks: completedTasks.length,
      newPages: newPages.length,
      changedPages: changedPages.length,
      changedBlocks: changedBlocks.length,
      newFiles: newFiles.length,
      newCalendarEvents: newCalendarEvents.length,
      changedCalendarEvents: changedCalendarEvents.length,
      newReminders: newReminders.length,
      changedReminders: changedReminders.length,
      newInboxItems: newInboxItems.length,
      changedInboxItems: changedInboxItems.length,
      changedResponsibilityAreas: changedResponsibilityAreas.length,
      recentActivity: recentActivity.length,
    },
    newTasks,
    changedTasks,
    completedTasks,
    newPages,
    changedPages,
    changedBlocks,
    changedResponsibilityAreas,
    newFiles,
    newCalendarEvents,
    changedCalendarEvents,
    newReminders,
    changedReminders,
    newInboxItems,
    changedInboxItems,
    recentActivity,
    limits: {
      ...context.limits,
      tasksReturned: newTasks.length + changedTasks.length + completedTasks.length,
      blocksReturned: changedBlocks.length,
    },
  };
}

function compactUserForAiContext(user) {
  const profile = publicUserProfile(user);
  if (!profile) return null;
  return {
    id: profile.id,
    username: profile.username,
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarUrl: profile.avatarUrl,
  };
}

function getTaskAiStatus(db, task, nowMs) {
  const completed = Boolean(task.isArchived || task.completedAt || isTaskInFinalColumn(db, task));
  const deferredUntil = task.scheduledAt ? new Date(task.scheduledAt).getTime() : 0;
  const deferred = !completed && Number.isFinite(deferredUntil) && deferredUntil > nowMs;
  const deadlineMs = task.deadlineAt ? new Date(task.deadlineAt).getTime() : 0;
  const isOverdue = !completed && Number.isFinite(deadlineMs) && deadlineMs > 0 && deadlineMs < nowMs;
  return {
    state: completed ? "completed" : deferred ? "deferred" : "active",
    isOverdue,
  };
}

function compactTaskForAiContext(db, task, nowMs) {
  const status = getTaskAiStatus(db, task, nowMs);
  return {
    id: task.id,
    pageId: task.pageId,
    columnId: task.columnId,
    title: task.title,
    description: clipAiText(task.description, 1200),
    priority: task.priority,
    deadlineAt: task.deadlineAt,
    scheduledAt: task.scheduledAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    archivedAt: task.archivedAt,
    state: status.state,
    isOverdue: status.isOverdue,
    importanceScore: task.importanceScore,
    isBlocking: Boolean(task.isBlocking),
    assigneeId: task.assigneeId,
    assignee: task.assigneeId ? compactUserForAiContext(db.users.find((user) => String(user.id) === String(task.assigneeId))) : null,
    tags: normalizeAiTags(task.tags),
    linkedPageIds: task.linkedPageIds ?? [],
    subtasks: (db.subtasks ?? [])
      .filter((subtask) => String(subtask.taskId) === String(task.id))
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .slice(0, 25)
      .map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        isCompleted: Boolean(subtask.isCompleted),
        position: subtask.position,
      })),
  };
}

function compactBlockForAiContext(block) {
  return {
    id: block.id,
    projectId: block.projectId,
    pageId: block.pageId,
    type: block.type,
    content: clipAiText(block.content, 2000),
    props: compactAiJson(block.props, 3000),
    position: block.position,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

function compactCalendarEventForAiContext(event) {
  return {
    id: event.id,
    title: event.title,
    description: clipAiText(event.description, 1200),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: Boolean(event.allDay),
    type: event.type,
    categoryId: event.categoryId,
    categoryLabel: event.categoryLabel,
    participantUserIds: event.participantUserIds ?? [],
    location: event.location,
    link: event.link,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function compactReminderForAiContext(reminder) {
  return {
    id: reminder.id,
    title: reminder.title,
    text: clipAiText(reminder.text ?? reminder.description, 1000),
    remindAt: reminder.remindAt,
    targetUserId: reminder.targetUserId,
    status: reminder.status,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
    sentAt: reminder.sentAt,
  };
}

function compactInboxItemForAiContext(node, projectBlocks, scope) {
  const blocks = projectBlocks
    .filter((block) => String(block.pageId) === String(node.id))
    .slice(0, scope === "full" ? 100 : 25)
    .map(compactBlockForAiContext);
  const latestTimestamp = [node.updatedAt, node.createdAt, ...blocks.map((block) => block.updatedAt ?? block.createdAt)]
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  return {
    id: node.id,
    title: node.title,
    icon: node.icon,
    type: node.type,
    authorUserId: node.properties?.author,
    blocks,
    createdAt: node.createdAt,
    updatedAt: Number.isFinite(latestTimestamp) ? new Date(latestTimestamp).toISOString() : node.updatedAt ?? node.createdAt,
  };
}

function compactActivityForAiContext(event) {
  return {
    id: event.id,
    type: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    actorUserId: event.actorUserId,
    targetUserId: event.targetUserId,
    taskId: event.taskId,
    pageId: event.pageId,
    createdAt: event.createdAt,
    summary: clipAiText(event.summary ?? event.title ?? event.text, 700),
  };
}

function normalizeAiTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => typeof tag === "string" ? tag : tag?.name ?? tag?.title ?? tag?.label)
    .filter(Boolean)
    .slice(0, 20);
}

function clipAiText(value, maxLength) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function compactAiJson(value, maxLength) {
  if (value === undefined || value === null) return undefined;
  const text = clipAiText(value, maxLength);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function canManageProjectAccess(project, userId) {
  return hasProjectPermission(project, userId, "manageMembers");
}

function canUseLegacySpaceEndpoint(auth, project, url) {
  const explicitExport = url.searchParams.get("export") === "1" || url.searchParams.get("legacy") === "1";
  return explicitExport && canManageProjectAccess(project, actorFor(auth, url.searchParams.get("actorUserId")));
}

function isProjectOwner(project, userId) {
  const uid = asRef(userId);
  return Boolean(uid && String(project.ownerId) === uid);
}

function projectRoleName(project, userId) {
  const uid = asRef(userId);
  if (!uid) return "viewer";
  if (isProjectOwner(project, uid)) return "owner";
  const member = (project.members ?? []).find((item) => String(item.userId) === uid);
  if (!member) return "viewer";
  const role = typeof member?.role === "string" ? member.role : member?.role?.name;
  return normalizeProjectRole(role, "editor");
}

function projectRolePermissions(roleName) {
  return { ...(PROJECT_ROLE_PERMISSIONS[roleName] ?? PROJECT_ROLE_PERMISSIONS.viewer) };
}

function hasProjectPermission(project, userId, permission) {
  const permissions = projectRolePermissions(projectRoleName(project, userId));
  return Boolean(permissions[permission]);
}

function calendarEventMutationPermissionError(auth, method, pathname, db) {
  if (auth.kind !== "user" || (method !== "PATCH" && method !== "DELETE")) return undefined;
  const match = pathname.match(/^\/calendar-events\/([^/]+)$/);
  if (!match) return undefined;
  const event = db.calendarEvents.find((item) => String(item.id) === String(match[1]));
  if (!event) return undefined;
  const calendar = db.calendars.find((item) => String(item.id) === String(event.calendarId));
  const userId = String(auth.user.id);

  if (event.readOnly || calendar?.readOnly || calendar?.sourceType === "external") {
    return { status: 409, error: "External calendar events are read-only" };
  }

  if (calendar?.type === "PERSONAL" || (!event.projectId && event.visibility === "private")) {
    const ownerUserId = String(calendar?.ownerUserId ?? event.ownerUserId ?? "");
    return ownerUserId === userId ? undefined : { status: 403, error: "Access denied" };
  }

  const project = findProjectById(db, event.projectId ?? calendar?.projectId);
  if (!project || !isProjectMemberRecord(project, userId)) return { status: 403, error: "Access denied" };
  const isOwn = [event.ownerUserId, event.createdByUserId].some((value) => String(value ?? "") === userId);
  const ownPermission = method === "PATCH" ? "editOwnCalendarEvents" : "deleteOwnCalendarEvents";
  const allPermission = method === "PATCH" ? "editAllCalendarEvents" : "deleteAllCalendarEvents";
  if (hasProjectPermission(project, userId, allPermission)) return undefined;
  if (isOwn && hasProjectPermission(project, userId, ownPermission)) return undefined;
  return { status: 403, error: `Permission denied: ${isOwn ? ownPermission : allPermission}` };
}

function projectCalendarFor(db, projectId) {
  return db.calendars.find(
    (calendar) => calendar.type === "PROJECT" && String(calendar.projectId) === String(projectId),
  );
}

function accessibleCalendarsForUser(db, userId) {
  const uid = String(userId);
  return db.calendars.filter((calendar) => {
    if (calendar.type === "PERSONAL") return String(calendar.ownerUserId) === uid;
    const project = findProjectById(db, calendar.projectId);
    return Boolean(project && !project.isDeleted && isProjectMemberRecord(project, uid) && hasProjectPermission(project, uid, "viewCalendar"));
  });
}

function calendarWithUserPermissions(db, userId, calendar) {
  if (calendar.sourceType === "external" || calendar.readOnly) {
    const project = calendar.projectId ? findProjectById(db, calendar.projectId) : undefined;
    return {
      ...calendar,
      categories: [],
      permissions: {
        create: false,
        editOwn: false,
        editAll: false,
        deleteOwn: false,
        deleteAll: false,
        manage: calendar.type === "PERSONAL"
          ? String(calendar.ownerUserId) === String(userId)
          : Boolean(project && hasProjectPermission(project, userId, "manageCalendar")),
      },
    };
  }
  if (calendar.type === "PERSONAL") {
    return {
      ...calendar,
      categories: calendarCategoriesFor(db, calendar),
      permissions: {
        create: true,
        editOwn: true,
        editAll: true,
        deleteOwn: true,
        deleteAll: true,
        manage: true,
      },
    };
  }
  const project = findProjectById(db, calendar.projectId);
  return {
    ...calendar,
    categories: calendarCategoriesFor(db, calendar),
    permissions: {
      create: Boolean(project && hasProjectPermission(project, userId, "createCalendarEvents")),
      editOwn: Boolean(project && hasProjectPermission(project, userId, "editOwnCalendarEvents")),
      editAll: Boolean(project && hasProjectPermission(project, userId, "editAllCalendarEvents")),
      deleteOwn: Boolean(project && hasProjectPermission(project, userId, "deleteOwnCalendarEvents")),
      deleteAll: Boolean(project && hasProjectPermission(project, userId, "deleteAllCalendarEvents")),
      manage: Boolean(project && hasProjectPermission(project, userId, "manageCalendar")),
    },
  };
}

function calendarCategoriesFor(db, calendar) {
  if (!calendar) return [];
  if (calendar.type === "PERSONAL") return normalizeCalendarCategories(calendar.categories);
  const project = findProjectById(db, calendar.projectId);
  return normalizeCalendarCategories(project?.calendarCategories);
}

function setCalendarCategories(db, calendar, categories) {
  const normalized = normalizeCalendarCategories(categories);
  if (calendar.type === "PERSONAL") {
    calendar.categories = normalized;
    calendar.updatedAt = now();
    return;
  }
  const project = findProjectById(db, calendar.projectId);
  if (!project) return;
  project.calendarCategories = normalized;
  project.updatedAt = now();
}

function calendarCategoryById(db, calendar, categoryId) {
  const id = asRef(categoryId);
  if (!id) return undefined;
  return calendarCategoriesFor(db, calendar).find((category) => String(category.id) === id)
    ?? BASE_CALENDAR_CATEGORIES[id];
}

function calendarCategoryManagePermissionError(db, userId, calendar) {
  const uid = String(userId);
  if (!calendar) return { status: 404, error: "Calendar not found" };
  if (calendar.sourceType === "external" || calendar.readOnly) return { status: 409, error: "External calendars are read-only" };
  if (calendar.type === "PERSONAL") {
    return String(calendar.ownerUserId) === uid ? undefined : { status: 403, error: "Access denied" };
  }
  const project = findProjectById(db, calendar.projectId);
  if (!project || project.isDeleted) return { status: 404, error: "Project not found" };
  if (!isProjectMemberRecord(project, uid)) return { status: 403, error: "Access denied" };
  if (!hasProjectPermission(project, uid, "editAllCalendarEvents")) {
    return { status: 403, error: "Permission denied: editAllCalendarEvents" };
  }
  return undefined;
}

function canUserReadCalendarEvent(db, userId, event) {
  const uid = String(userId);
  const calendar = db.calendars.find((item) => String(item.id) === String(event.calendarId));
  if (calendar?.type === "PERSONAL" || (!event.projectId && event.visibility === "private")) {
    return String(calendar?.ownerUserId ?? event.ownerUserId) === uid;
  }
  const project = findProjectById(db, event.projectId ?? calendar?.projectId);
  if (!project || project.isDeleted || !isProjectMemberRecord(project, uid) || !hasProjectPermission(project, uid, "viewCalendar")) return false;
  if (event.visibility !== "selected") return true;
  return (
    String(event.ownerUserId ?? "") === uid ||
    String(event.createdByUserId ?? "") === uid ||
    (event.participantUserIds ?? []).some((id) => String(id) === uid) ||
    hasProjectPermission(project, uid, "editAllCalendarEvents")
  );
}

function calendarCreatePermissionError(db, userId, calendar) {
  const uid = String(userId);
  if (!calendar) return { status: 404, error: "Calendar not found" };
  if (calendar.sourceType === "external" || calendar.readOnly) return { status: 409, error: "External calendars are read-only" };
  if (calendar.type === "PERSONAL") {
    return String(calendar.ownerUserId) === uid ? undefined : { status: 403, error: "Access denied" };
  }
  const project = findProjectById(db, calendar.projectId);
  if (!project || project.isDeleted) return { status: 404, error: "Project not found" };
  if (!isProjectMemberRecord(project, uid)) return { status: 403, error: "Access denied" };
  if (!hasProjectPermission(project, uid, "createCalendarEvents")) {
    return { status: 403, error: "Permission denied: createCalendarEvents" };
  }
  return undefined;
}

function isProjectMemberRecord(project, userId) {
  const uid = asRef(userId);
  if (!project || !uid) return false;
  return String(project.ownerId) === uid || (project.members ?? []).some((member) => String(member.userId) === uid);
}

function projectActorPermissionError(project, userId, permission) {
  const uid = asRef(userId);
  if (!uid) return { status: 400, error: "actorUserId is required" };
  if (!isProjectMemberRecord(project, uid)) return { status: 403, error: "Access denied" };
  if (!hasProjectPermission(project, uid, permission)) return { status: 403, error: `Permission denied: ${permission}` };
  return undefined;
}

function botActorPermissionError(auth, project, userId, permission) {
  if (auth.kind !== "bot") return undefined;
  return projectActorPermissionError(project, userId, permission);
}

function projectMemberTargetError(project, userId, label = "User") {
  const uid = asRef(userId);
  if (!uid) return undefined;
  if (!isProjectMemberRecord(project, uid)) return { status: 400, error: `${label} is not a project member` };
  return undefined;
}

function normalizeProjectRole(value, fallback = undefined) {
  const role = String(value ?? "").trim().toLowerCase();
  return PROJECT_ROLE_PERMISSIONS[role] ? role : fallback;
}

function applyProjectPatch(project, body) {
  const allowedFields = [
    "title",
    "description",
    "aiToneStyle",
    "calendarCategories",
    "icon",
    "emoji",
  ];
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      project[field] = body[field];
    }
  }
  project.updatedAt = now();
}

function buildInboxUnreadSummary(db, project, userId, readAt) {
  const uid = asRef(userId);
  const user = db.users.find((item) => String(item.id) === uid);
  const member = (project.members ?? []).find((item) => String(item.userId) === uid);
  const nowTime = Date.now();
  const mentionKeys = buildUserMentionKeys(user);
  const tasks = db.tasks.filter((task) => task.projectId === project.id);
  const activeTasks = tasks.filter((task) => isTaskActiveForUserList(db, task));
  const projectActivity = db.activity.filter((event) => event.projectId === project.id);

  const unreadAssignedTasks = activeTasks.filter((task) => {
    if (String(task.assigneeId ?? "") !== uid) return false;
    const assignedEvent = projectActivity.find(
      (event) => event.type === "task_assign" && event.entityId === task.id,
    );
    const notificationTime = Math.max(
      parseTime(task.createdAt) ?? 0,
      assignedEvent ? parseTime(assignedEvent.createdAt) ?? 0 : 0,
    );
    return notificationTime > readAt;
  });

  const unreadTaskMentions = mentionKeys.length
    ? activeTasks.filter((task) => {
        const updatedAt = parseTime(task.updatedAt ?? task.createdAt) ?? 0;
        if (updatedAt <= readAt) return false;
        const subtasksText = db.subtasks
          .filter((subtask) => subtask.taskId === task.id)
          .map((subtask) => subtask.title)
          .join(" ");
        const text = `${task.title} ${task.description ?? ""} ${subtasksText}`.toLowerCase();
        return mentionKeys.some((mention) => text.includes(mention));
      })
    : [];

  const nodes = db.spaces?.[project.id]?.nodes ?? [];
  const blocks = db.blocks.filter((block) => block.projectId === project.id);
  const unreadPageMentions = mentionKeys.length
    ? blocks.filter((block) => {
        const node = nodes.find((item) => item.id === block.pageId);
        if (!node || node.isDeleted) return false;
        if ((parseTime(block.updatedAt) ?? 0) <= readAt) return false;
        return mentionKeys.some((mention) => blockContentToSearchText(block.content).toLowerCase().includes(mention));
      })
    : [];

  const unreadDeadlineTasks = activeTasks.filter((task) => {
    if (String(task.assigneeId ?? "") !== uid || !task.deadlineAt) return false;
    const deadlineTime = parseTime(task.deadlineAt);
    if (!deadlineTime) return false;
    const diffHours = (deadlineTime - nowTime) / 3600000;
    if (diffHours < 0 || diffHours > 72) return false;
    const notificationTime = Math.max(parseTime(task.createdAt) ?? 0, deadlineTime - 72 * 3600000);
    return notificationTime > readAt;
  });

  const unreadJoinRequests = canManageProjectAccess(project, uid)
    ? db.joinRequests.filter(
        (request) => request.projectId === project.id && request.status === "pending" && (parseTime(request.createdAt) ?? 0) > readAt,
      )
    : [];

  const mineCount = unreadAssignedTasks.length + unreadTaskMentions.length + unreadPageMentions.length + unreadDeadlineTasks.length;
  const generalCount = unreadJoinRequests.length;
  const count = mineCount + generalCount;
  return { count, mineCount, generalCount, hasUnread: count > 0 };
}

function buildUserMentionKeys(user) {
  return [user?.username, user?.firstName, user?.lastName]
    .filter(Boolean)
    .map((value) => `@${String(value).replace(/^@/, "").toLowerCase()}`);
}

function buildProjectMentions(db, project, userId) {
  const uid = asRef(userId);
  const user = db.users.find((item) => String(item.id) === uid);
  const mentionKeys = buildUserMentionKeys(user);
  if (mentionKeys.length === 0) return [];

  const nodes = db.spaces?.[project.id]?.nodes ?? [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const items = [];
  const addItem = (item) => {
    const text = String(item.text ?? "");
    if (!text || !mentionKeys.some((mention) => text.toLowerCase().includes(mention))) return;
    items.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: text.slice(0, 160),
      pageId: item.pageId,
      taskId: item.taskId,
      updatedAt: item.updatedAt,
    });
  };

  for (const block of db.blocks.filter((block) => block.projectId === project.id)) {
    const node = nodesById.get(block.pageId);
    if (!node || node.isDeleted) continue;
    addItem({
      id: `page-block-${block.id}`,
      kind: "page",
      title: node.title || "Page",
      text: blockContentToSearchText(block.content),
      pageId: node.id,
      updatedAt: block.updatedAt ?? block.createdAt,
    });
  }

  for (const task of db.tasks.filter((task) => task.projectId === project.id)) {
    const subtasks = db.subtasks.filter((subtask) => subtask.taskId === task.id);
    addItem({
      id: `task-${task.id}`,
      kind: "task",
      title: task.title || "Task",
      text: `${task.title ?? ""} ${task.description ?? ""} ${subtasks.map((subtask) => subtask.title).join(" ")}`,
      pageId: task.pageId,
      taskId: task.id,
      updatedAt: task.updatedAt ?? task.createdAt,
    });
  }

  return items
    .sort((a, b) => (parseTime(b.updatedAt) ?? 0) - (parseTime(a.updatedAt) ?? 0))
    .slice(0, 50);
}

function buildProjectAdminSummary(db, project, days = 7) {
  const nowTime = Date.now();
  const since = nowTime - days * 24 * 3600000;
  const tasks = db.tasks.filter((task) => task.projectId === project.id);
  const projectActivity = db.activity.filter((event) => event.projectId === project.id);
  const nodes = db.spaces?.[project.id]?.nodes ?? [];
  const blocks = db.blocks.filter((block) => block.projectId === project.id);

  const newTasks = tasks.filter((task) => (parseTime(task.createdAt) ?? 0) >= since);
  const closedTasks = tasks.filter((task) => {
    if (!isTaskInFinalColumn(db, task) && !task.isArchived && !task.completedAt) return false;
    const completedAt = parseTime(task.completedAt ?? task.archivedAt ?? task.updatedAt);
    return Boolean(completedAt && completedAt >= since);
  });
  const newOverdueTasks = tasks.filter((task) => {
    if (!task.deadlineAt || task.isArchived || task.completedAt || isTaskInFinalColumn(db, task)) return false;
    const deadline = parseTime(task.deadlineAt);
    return Boolean(deadline && deadline < nowTime && deadline >= since);
  });
  const activePeople = [...new Set(
    projectActivity
      .filter((event) => (parseTime(event.createdAt) ?? 0) >= since)
      .map((event) => event.userName)
      .filter(Boolean),
  )];
  const updatedPageIds = new Set(
    blocks
      .filter((block) => (parseTime(block.updatedAt) ?? 0) >= since)
      .map((block) => block.pageId),
  );
  const updatedPages = nodes.filter((node) => {
    if (node.isDeleted) return false;
    return updatedPageIds.has(node.id) || (parseTime(node.updatedAt) ?? 0) >= since;
  });
  const staleTasks = tasks.filter((task) => {
    if (task.isArchived || task.completedAt || isTaskInFinalColumn(db, task)) return false;
    if (task.scheduledAt && (parseTime(task.scheduledAt) ?? 0) > nowTime) return false;
    const changedAt = parseTime(task.updatedAt ?? task.createdAt) ?? nowTime;
    return nowTime - changedAt > days * 24 * 3600000;
  });
  const highlights = [
    `${newTasks.length} new tasks in ${days} days.`,
    `${closedTasks.length} completed or archived tasks.`,
    `${updatedPages.length} updated pages.`,
    `${staleTasks.length} tasks without movement for more than ${days} days.`,
  ];

  const compactTask = (task) => ({
    id: task.id,
    title: task.title,
    pageId: task.pageId,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  });
  const compactPage = (node) => ({
    id: node.id,
    title: node.title,
    icon: node.icon,
    updatedAt: node.updatedAt,
  });

  return {
    days,
    newTasks: newTasks.map(compactTask),
    closedTasks: closedTasks.map(compactTask),
    newOverdueTasks: newOverdueTasks.map(compactTask),
    activePeople,
    updatedPages: updatedPages.map(compactPage),
    staleTasks: staleTasks.map(compactTask),
    highlights,
  };
}

function parseTime(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function blockContentToSearchText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content.text === "string") return content.text;
  if (typeof content.title === "string") return content.title;
  if (Array.isArray(content.rows)) return content.rows.flat().join(" ");
  return JSON.stringify(content);
}

function buildProjectSearchResults(db, project, query, limit) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];

  const nodes = db.spaces?.[project.id]?.nodes ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usersById = new Map(db.users.map((user) => [String(user.id), user]));
  const results = [];
  const add = (item) => {
    if (results.length < limit) results.push(item);
  };
  const matches = (...parts) => parts.some((part) => String(part ?? "").toLowerCase().includes(q));
  const nodeKindLabel = (node) => {
    if (node?.type === "folder") return "Папка";
    if (node?.type === "kanban") return "Kanban-доска";
    return "Страница";
  };

  for (const node of nodes) {
    if (results.length >= limit) break;
    if (node.isDeleted || !matches(node.title, node.icon, node.type)) continue;
    add({
      id: node.id,
      kind: node.type,
      title: node.title,
      subtitle: nodeKindLabel(node),
      icon: node.icon,
      pageId: node.id,
      updatedAt: node.updatedAt,
    });
  }

  for (const block of db.blocks.filter((item) => item.projectId === project.id)) {
    if (results.length >= limit) break;
    const page = nodeById.get(block.pageId);
    if (page?.isDeleted) continue;
    const text = blockContentToSearchText(block.content);
    if (!matches(text, block.type)) continue;
    add({
      id: block.id,
      kind: "block",
      title: text.slice(0, 80) || block.type,
      subtitle: page ? `${page.icon ?? ""} ${page.title}`.trim() : "Блок",
      icon: "▦",
      pageId: block.pageId,
      blockId: block.id,
      updatedAt: block.updatedAt,
    });
  }

  for (const task of db.tasks.filter((item) => item.projectId === project.id)) {
    if (results.length >= limit) break;
    const page = task.pageId ? nodeById.get(task.pageId) : undefined;
    const assignee = task.assigneeId ? usersById.get(String(task.assigneeId)) : undefined;
    const subtasksText = db.subtasks
      .filter((subtask) => subtask.taskId === task.id)
      .map((subtask) => subtask.title)
      .join(" ");
    if (!matches(task.title, task.description, task.priority, assignee?.username, assignee?.firstName, subtasksText)) continue;
    add({
      id: task.id,
      kind: "task",
      title: task.title,
      subtitle: `${page ? `${page.icon ?? ""} ${page.title}`.trim() : "Kanban"}${task.isArchived ? " · Архив" : ""}`,
      icon: "☑",
      pageId: task.pageId,
      taskId: task.id,
      updatedAt: task.updatedAt ?? task.createdAt,
    });
  }

  for (const subtask of db.subtasks) {
    if (results.length >= limit) break;
    const task = db.tasks.find((item) => item.id === subtask.taskId && item.projectId === project.id);
    if (!task || !matches(subtask.title)) continue;
    add({
      id: subtask.id,
      kind: "subtask",
      title: subtask.title,
      subtitle: `Подзадача · ${task.title}`,
      icon: "☐",
      pageId: task.pageId,
      taskId: task.id,
      updatedAt: subtask.completedAt ?? task.updatedAt ?? task.createdAt,
    });
  }

  for (const member of project.members ?? []) {
    if (results.length >= limit) break;
    const user = usersById.get(String(member.userId));
    if (!user || !matches(user.username, user.firstName, user.lastName, member.role)) continue;
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || `User ${user.id}`;
    add({
      id: user.id,
      kind: "member",
      title: displayName,
      subtitle: user.username ? `@${user.username} · ${member.role}` : member.role,
      icon: "👤",
      updatedAt: user.updatedAt ?? user.createdAt,
    });
  }

  return results;
}

// В production владелец приложения определяется ТОЛЬКО по telegramId аутентифицированного пользователя.
// Локальный обход требует двух явных dev-флагов и никогда не работает в production.
function isSystemOwner(auth, db) {
  const isLocalDevOwner =
    !isProductionRuntime() &&
    process.env.LOCAL_DEV_LOGIN === "1" &&
    process.env.LOCAL_DEV_SYSTEM_OWNER === "1" &&
    auth.kind === "user" &&
    auth.user?.telegramId === "local-dev";
  if (isLocalDevOwner) return true;
  if (!APP_OWNER_TELEGRAM_IDS.size) return false;
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

function normalizePresenceSessionId(value) {
  const sessionId = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(sessionId) ? sessionId : "";
}

function normalizeProjectMemberPresence(value, timestamp = Date.now()) {
  const sessions = Object.fromEntries(
    Object.entries(value?.sessions ?? {}).filter(([, expiresAt]) => new Date(expiresAt).getTime() > timestamp),
  );
  return {
    lastSeenAt: value?.lastSeenAt,
    sessions,
  };
}

function isProjectMember(db, projectId, userId) {
  const project = db.projects.find((item) => String(item.id) === String(projectId));
  if (!project) return true; // проект не найден — пусть эндпоинт вернёт 404
  return isProjectMemberRecord(project, userId);
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

  m = pathname.match(/^\/calendars\/([^/]+)(?:\/|$)/);
  if (m) return db.calendars.find((calendar) => calendar.id === m[1])?.projectId;

  m = pathname.match(/^\/reminders\/([^/]+)(?:\/|$)/);
  if (m) {
    if (m[1] === "due") return null;
    return db.reminders.find((reminder) => reminder.id === m[1])?.projectId;
  }

  return null;
}

// Центральный guard доступа. Бот — сервисный клиент только для явно разрешённых маршрутов.
// Пользователь ограничен своими данными и проектами.
function authorizeRequest(auth, method, pathname, db) {
  if (auth.kind === "bot") {
    return isBotServiceRoute(method, pathname) ? undefined : { status: 403, error: "Bot route is not allowed" };
  }
  if (auth.kind === "ai") {
    const match = pathname.match(/^\/projects\/([^/]+)\/ai-context(?:\/changes)?$/);
    if (method === "GET" && match && String(match[1]) === String(auth.token.projectId)) return undefined;
    return { status: 403, error: "AI connector token is read-only" };
  }
  const userId = String(auth.user.id);

  if (isBotOnlyRoute(method, pathname)) return { status: 403, error: "Bot access required" };

  // Личные маршруты — только про себя (сравниваем строки чтобы избежать number vs string)
  // Пользовательские маршруты /users/:id/(projects|assigned-tasks|bot-preferences)
  // сами подставляют id из токена (см. эндпоинты), поэтому подмена id безопасна.
  const selfScoped = pathname.match(/^\/users\/([^/]+)\/(projects|assigned-tasks|task-progress|bot-preferences)$/);
  if (selfScoped) return undefined;

  // Список всех проектов и outbox — только для бота
  if (method === "GET" && pathname === "/projects") return { status: 403, error: "Access denied" };
  if (pathname.startsWith("/outbox")) return { status: 403, error: "Access denied" };

  const calendarMutationDenied = calendarEventMutationPermissionError(auth, method, pathname, db);
  if (calendarMutationDenied) return calendarMutationDenied;

  // Системная админка — только владелец приложения
  if (pathname.startsWith("/system/")) {
    if (!isSystemOwner(auth, db)) return { status: 403, error: "Forbidden" };
    return undefined;
  }

  // Проектно-ограниченные маршруты — нужно быть участником проекта
  const projectId = resolveProjectIdFromPath(pathname, db);
  if (projectId && !isProjectMember(db, projectId, userId)) {
    return {
      status: 403,
      error: "Access denied",
      audit: {
        type: "project_access_denied",
        outcome: "rejected",
        projectId,
        details: { reason: "not_project_member" },
      },
    };
  }

  if (projectId) {
    const project = findProjectById(db, projectId);
    const permission = requiredProjectPermissionForRequest(method, pathname);
    if (project && permission && !hasProjectPermission(project, userId, permission)) {
      return { status: 403, error: `Permission denied: ${permission}` };
    }
  }
  return undefined;
}

function requiredProjectPermissionForRequest(method, pathname) {
  if (method === "GET") {
    if (/^\/projects\/[^/]+\/presence$/.test(pathname)) return "manageMembers";
    if (/^\/projects\/[^/]+\/admin-summary$/.test(pathname)) return "viewAnalytics";
    if (/^\/projects\/[^/]+\/activity$/.test(pathname)) return "viewAnalytics";
    if (/^\/projects\/[^/]+\/ai-context(?:\/changes)?$/.test(pathname)) return "exportProject";
    if (/^\/projects\/[^/]+\/ai-tokens$/.test(pathname)) return "manageProject";
    if (/^\/projects\/[^/]+\/ai-access-events$/.test(pathname)) return "manageProject";
    if (/^\/projects\/[^/]+\/export$/.test(pathname)) return "exportProject";
    if (/^\/projects\/[^/]+\/bot-settings$/.test(pathname)) return "manageBot";
    if (/^\/projects\/[^/]+\/external-calendar-connections$/.test(pathname)) return "viewCalendar";
    if (/^\/projects\/[^/]+\/(?:calendar|calendar-events)$/.test(pathname)) return "viewCalendar";
    return undefined;
  }

  if (method === "PATCH" && /^\/projects\/[^/]+$/.test(pathname)) return "manageProject";
  if (/^\/projects\/[^/]+\/ai-tokens(?:\/[^/]+)?$/.test(pathname)) return "manageProject";
  if (/^\/projects\/[^/]+\/external-calendar-connections(?:\/yandex|\/[^/]+(?:\/sync)?)?$/.test(pathname)) return "manageCalendar";
  if (/^\/projects\/[^/]+\/export\/telegram$/.test(pathname)) return "exportProject";
  if (/^\/projects\/[^/]+\/invite-code(?:\/rotate)?$/.test(pathname)) return "manageMembers";
  if (/^\/projects\/[^/]+\/join-requests(?:\/[^/]+\/(?:approve|reject))?$/.test(pathname)) return "manageMembers";
  if (/^\/projects\/[^/]+\/members(?:\/[^/]+(?:\/(?:admin|admin-notes|role))?)?$/.test(pathname)) return "manageMembers";
  if (/^\/projects\/[^/]+\/transfer-ownership$/.test(pathname)) return "manageProject";
  if (/^\/projects\/[^/]+\/responsibility-areas(?:\/[^/]+)?$/.test(pathname)) {
    return method === "PATCH" ? undefined : "manageProject";
  }
  if (method === "POST" && /^\/projects\/[^/]+\/files$/.test(pathname)) return undefined;
  if (method === "DELETE" && /^\/projects\/[^/]+\/files\/[^/]+$/.test(pathname)) return "updatePage";

  if (/^\/projects\/[^/]+\/columns(?:\/reorder)?$/.test(pathname)) return "manageColumns";
  if (/^\/columns\/[^/]+$/.test(pathname)) return "manageColumns";

  if (method === "POST" && pathname === "/tasks") return "createTask";
  if (method === "PATCH" && /^\/tasks\/[^/]+$/.test(pathname)) return "updateTask";
  if (/^\/tasks\/[^/]+\/move$/.test(pathname)) return "moveTask";
  if (/^\/columns\/[^/]+\/tasks\/reorder$/.test(pathname)) return "moveTask";
  if (/^\/tasks\/[^/]+\/archive$/.test(pathname)) return "updateTask";
  if (method === "DELETE" && /^\/tasks\/[^/]+$/.test(pathname)) return "deleteTask";
  if (method === "DELETE" && /^\/projects\/[^/]+\/archive$/.test(pathname)) return "deleteTask";
  if (/^\/tasks\/[^/]+\/subtasks(?:\/[^/]+(?:\/toggle)?)?$/.test(pathname)) return "updateTask";

  if (method === "POST" && /^\/projects\/[^/]+\/space\/nodes$/.test(pathname)) return "createPage";
  if (/^\/projects\/[^/]+\/space\/nodes\/[^/]+\/(?:trash|restore)$/.test(pathname)) return "deletePage";
  if (method === "DELETE" && /^\/projects\/[^/]+\/space\/nodes\/[^/]+$/.test(pathname)) return "deletePage";
  if (/^\/projects\/[^/]+\/space\/nodes\/[^/]+(?:\/move)?$/.test(pathname)) return "updatePage";
  if (method === "POST" && /^\/projects\/[^/]+\/space\/pages\/[^/]+\/blocks$/.test(pathname)) return "updatePage";
  if (/^\/projects\/[^/]+\/space\/blocks\/[^/]+(?:\/move)?$/.test(pathname)) return "updatePage";

  if (/^\/projects\/[^/]+\/templates(?:\/reorder|\/[^/]+)?$/.test(pathname)) return "manageTemplates";
  if (method === "POST" && /^\/projects\/[^/]+\/calendar-events$/.test(pathname)) return "createCalendarEvents";
  if (method === "POST" && /^\/calendars\/[^/]+\/events$/.test(pathname)) return "createCalendarEvents";
  if (/^\/projects\/[^/]+\/reminders$/.test(pathname)) return "manageReminders";
  if (/^\/reminders\/[^/]+(?:\/sent)?$/.test(pathname)) return "manageReminders";
  if (/^\/projects\/[^/]+\/bot-settings$/.test(pathname)) return "manageBot";
  if (method === "POST" && /^\/projects\/[^/]+\/activity$/.test(pathname)) return "updateTask";

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
  const currentTime = Date.now();
  const ownerUsers = db.users.filter((user) => user.telegramId && APP_OWNER_TELEGRAM_IDS.has(String(user.telegramId)));

  return {
    generatedAt: now(),
    owner: {
      configured: APP_OWNER_TELEGRAM_IDS.size > 0,
      telegramIds: [...APP_OWNER_TELEGRAM_IDS],
      users: ownerUsers.map((user) => ({
        id: user.id,
        telegramId: String(user.telegramId),
        username: user.username ?? "",
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
      })),
    },
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
    services: createSystemServices(db, currentTime),
    performance: createPerformanceStats(currentTime),
    storage: createStorageStats(db, database),
    server: createServerStats(),
    bot: createBotStats(db, currentTime),
    users: createSystemUserExport(db).slice(0, 200),
    recentUsers: [...db.users]
      .sort((a, b) => new Date(b.createdAt ?? b.updatedAt ?? 0).getTime() - new Date(a.createdAt ?? a.updatedAt ?? 0).getTime())
      .slice(0, 20)
      .map((user) => publicSystemUser(user, db)),
  };
}

function publicSystemSecurityEvent(event) {
  return {
    id: event.id,
    type: event.type,
    actorUserId: event.actorUserId,
    projectReference: event.projectId ? createSystemProjectReference(event.projectId) : undefined,
    targetUserId: event.targetUserId,
    outcome: event.outcome,
    details: sanitizeSecurityDetails(event.details),
    createdAt: event.createdAt,
  };
}

function isFailedLoginEvent(event) {
  if (event.type === "auth_code_request") return event.outcome === "not_delivered";
  return event.type === "auth_code_verify" && event.outcome !== "success";
}

function securityCountsForWindow(events, since) {
  const recent = events.filter((event) => new Date(event.createdAt ?? 0).getTime() >= since);
  return {
    failedLogins: recent.filter(isFailedLoginEvent).length,
    rateLimitHits: recent.filter((event) => event.type === "rate_limit").length,
    foreignProjectAccessAttempts: recent.filter((event) => event.type === "project_access_denied").length,
    ipBlocks: recent.filter((event) => event.type === "auth_ip_block").length,
  };
}

function activeSecurityIpBlocks(events, currentTime) {
  const seen = new Set();
  const active = [];
  for (const event of events) {
    if (event.type !== "auth_ip_block") continue;
    const reference = String(event.details?.ipRef ?? "");
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    const blockedUntil = String(event.details?.blockedUntil ?? "");
    if (new Date(blockedUntil).getTime() <= currentTime) continue;
    active.push({
      reference,
      blockedUntil,
      reason: String(event.details?.reason ?? "auth_rate_limit"),
      createdAt: event.createdAt,
    });
  }
  return active;
}

function createSystemSecuritySummary(db) {
  const currentTime = Date.now();
  const events = db.securityEvents ?? [];
  return {
    generatedAt: now(),
    windows: {
      "24h": securityCountsForWindow(events, currentTime - 24 * 3600000),
      "7d": securityCountsForWindow(events, currentTime - 7 * 24 * 3600000),
    },
    blocked: {
      ips: activeSecurityIpBlocks(events, currentTime),
      users: db.users
        .filter((user) => user.isBlocked)
        .map((user) => ({
          id: user.id,
          username: user.username ?? "",
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          blockedAt: user.blockedAt ?? "",
        })),
    },
  };
}

function normalizeMetricRoute(pathname) {
  return String(pathname ?? "/")
    .replace(/\/(projects|tasks|columns|users|reminders|notifications|outbox|calendars|calendar-events|templates|blocks)\/[^/]+/g, "/$1/:id")
    .replace(/\/nodes\/[^/]+/g, "/nodes/:id")
    .replace(/\/pages\/[^/]+/g, "/pages/:id")
    .replace(/\/files\/[^/]+/g, "/files/:id")
    .replace(/\/tokens\/[^/]+/g, "/tokens/:id");
}

function recordRequestMetric(metric) {
  requestMetrics.push({
    ...metric,
    route: normalizeMetricRoute(metric.pathname),
    createdAt: Date.now(),
  });
  if (requestMetrics.length > REQUEST_METRIC_LIMIT) {
    requestMetrics.splice(0, requestMetrics.length - REQUEST_METRIC_LIMIT);
  }
  if (metric.authKind === "bot") botRuntime.lastStatus = metric.statusCode;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarizeRequestMetrics(metrics, windowMs) {
  const durations = metrics.map((item) => item.durationMs);
  const totalResponseBytes = metrics.reduce((sum, item) => sum + item.responseBytes, 0);
  const routeGroups = new Map();
  for (const item of metrics) {
    const key = `${item.method} ${item.route}`;
    const group = routeGroups.get(key) ?? { route: key, durations: [], requests: 0, errors: 0 };
    group.durations.push(item.durationMs);
    group.requests += 1;
    if (item.statusCode >= 500) group.errors += 1;
    routeGroups.set(key, group);
  }
  const slowRoutes = [...routeGroups.values()]
    .map((group) => ({
      route: group.route,
      requests: group.requests,
      errors: group.errors,
      averageMs: Number((group.durations.reduce((sum, value) => sum + value, 0) / group.durations.length).toFixed(1)),
      p95Ms: Number(percentile(group.durations, 0.95).toFixed(1)),
      maxMs: Number(Math.max(...group.durations).toFixed(1)),
    }))
    .sort((left, right) => right.p95Ms - left.p95Ms)
    .slice(0, 10);
  return {
    requests: metrics.length,
    errors: metrics.filter((item) => item.statusCode >= 500).length,
    rejected: metrics.filter((item) => item.statusCode >= 400 && item.statusCode < 500).length,
    requestsPerMinute: Number((metrics.length / Math.max(1, windowMs / 60000)).toFixed(2)),
    averageMs: durations.length ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1)) : 0,
    p50Ms: Number(percentile(durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
    p99Ms: Number(percentile(durations, 0.99).toFixed(1)),
    responseBytes: totalResponseBytes,
    slowRoutes,
  };
}

function createPerformanceStats(currentTime) {
  const windows = [
    ["15m", 15 * 60_000],
    ["1h", 60 * 60_000],
    ["24h", 24 * 60 * 60_000],
  ];
  return {
    since: new Date(PROCESS_STARTED_AT).toISOString(),
    retainedRequests: requestMetrics.length,
    windows: Object.fromEntries(windows.map(([key, windowMs]) => {
      const observedWindowMs = Math.min(windowMs, Math.max(60_000, currentTime - PROCESS_STARTED_AT));
      return [
        key,
        summarizeRequestMetrics(requestMetrics.filter((item) => currentTime - item.createdAt <= windowMs), observedWindowMs),
      ];
    })),
  };
}

function createSystemServices(db, currentTime) {
  const botAgeMs = botRuntime.lastSeenAt ? currentTime - new Date(botRuntime.lastSeenAt).getTime() : undefined;
  const activeMcpTokens = (db.aiConnectorTokens ?? []).filter((token) => !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > currentTime));
  return [
    { id: "api", label: "Workspace API", status: "online", detail: `uptime ${formatDurationCompact(process.uptime() * 1000)}` },
    { id: "database", label: "База данных", status: "online", detail: String(process.env.WORKSPACE_STORAGE ?? "sqlite") },
    { id: "files", label: "Файловое хранилище", status: "online", detail: fileStorage.kind },
    {
      id: "bot",
      label: "Telegram-бот",
      status: !INTERNAL_API_TOKEN || !TELEGRAM_BOT_TOKEN ? "not_configured" : botAgeMs === undefined ? "unknown" : botAgeMs <= 120_000 ? "online" : botAgeMs <= 600_000 ? "stale" : "offline",
      detail: botRuntime.lastSeenAt ? `последний запрос ${botRuntime.lastSeenAt}` : "запросов после запуска API не было",
    },
    { id: "mcp", label: "AI Connector", status: activeMcpTokens.length ? "online" : "idle", detail: `активных токенов: ${activeMcpTokens.length}` },
  ];
}

function createServerStats() {
  const memory = process.memoryUsage();
  const cpu = os.cpus();
  const appDataDir = resolveAppDataDir();
  let disk;
  try {
    const stat = fs.statfsSync(appDataDir);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    disk = {
      label: "Том данных приложения",
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      usagePercent: totalBytes ? Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1)) : 0,
    };
  } catch {
    disk = undefined;
  }
  const cpuUsage = process.cpuUsage();
  return {
    startedAt: new Date(PROCESS_STARTED_AT).toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV ?? "development",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    pid: process.pid,
    eventLoopLagMs,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      hostTotalBytes: os.totalmem(),
      hostFreeBytes: os.freemem(),
    },
    cpu: {
      cores: cpu.length,
      model: cpu[0]?.model ?? "unknown",
      loadAverage: os.loadavg(),
      processUserMs: Number((cpuUsage.user / 1000).toFixed(1)),
      processSystemMs: Number((cpuUsage.system / 1000).toFixed(1)),
    },
    disk,
    databaseWrite: {
      dirty: dbDirty,
      flushPending: Boolean(dbFlushPromise || dbFlushTimer),
    },
  };
}

function getProjectDataBytes(db, project) {
  const projectId = String(project.id);
  const space = db.spaces?.[project.id] ?? db.spaces?.[projectId];
  const payload = {
    project,
    space,
    columns: db.columns.filter((item) => String(item.projectId) === projectId),
    tasks: db.tasks.filter((item) => String(item.projectId) === projectId),
    subtasks: db.subtasks.filter((item) => String(item.projectId) === projectId),
    reminders: db.reminders.filter((item) => String(item.projectId) === projectId),
    calendars: db.calendars.filter((item) => String(item.projectId) === projectId),
    calendarEvents: db.calendarEvents.filter((item) => String(item.projectId) === projectId),
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function createStorageStats(db, database) {
  const fileBytes = (db.projectFiles ?? []).reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const collectionNames = ["users", "projects", "columns", "tasks", "subtasks", "blocks", "templates", "reminders", "calendars", "calendarEvents", "activity", "securityEvents", "notifications", "joinRequests", "projectFiles", "outbox", "sessions", "aiConnectorTokens", "aiConnectorAccessEvents"];
  const topProjects = db.projects
    .map((project) => {
      const projectId = String(project.id);
      const projectFileBytes = (db.projectFiles ?? []).filter((file) => String(file.projectId) === projectId).reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      const dataBytes = getProjectDataBytes(db, project);
      return {
        reference: createSystemProjectReference(projectId),
        dataBytes,
        fileBytes: projectFileBytes,
        totalBytes: dataBytes + projectFileBytes,
        tasks: db.tasks.filter((task) => String(task.projectId) === projectId).length,
        files: (db.projectFiles ?? []).filter((file) => String(file.projectId) === projectId).length,
      };
    })
    .sort((left, right) => right.totalBytes - left.totalBytes)
    .slice(0, 10);
  return {
    provider: fileStorage.kind,
    databaseBytes: database.jsonStateBytes,
    databaseFilesBytes: database.files.reduce((sum, file) => sum + file.bytes, 0),
    projectFileBytes: fileBytes,
    projectFiles: (db.projectFiles ?? []).length,
    collections: collectionNames.map((name) => ({ name, count: Array.isArray(db[name]) ? db[name].length : Object.keys(db[name] ?? {}).length })),
    topProjects,
  };
}

function createSystemProjectReference(projectId) {
  const digest = crypto
    .createHmac("sha256", SYSTEM_STATS_PSEUDONYM_SECRET)
    .update(`system-project:${String(projectId)}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `P-${digest}`;
}

function createBotStats(db, currentTime) {
  const lastSeenTime = botRuntime.lastSeenAt ? new Date(botRuntime.lastSeenAt).getTime() : 0;
  const status = !INTERNAL_API_TOKEN || !TELEGRAM_BOT_TOKEN
    ? "not_configured"
    : !lastSeenTime
      ? "unknown"
      : currentTime - lastSeenTime <= 120_000
        ? "online"
        : currentTime - lastSeenTime <= 600_000
          ? "stale"
          : "offline";
  const dueNotifications = (db.notifications ?? []).filter((item) => item.status === "pending" && new Date(item.sendAt ?? 0).getTime() <= currentTime);
  const dueReminders = (db.reminders ?? []).filter((item) => item.status === "active" && item.nextRunAt && new Date(item.nextRunAt).getTime() <= currentTime);
  return {
    status,
    configured: Boolean(INTERNAL_API_TOKEN && TELEGRAM_BOT_TOKEN),
    tokenConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    internalApiTokenConfigured: Boolean(INTERNAL_API_TOKEN),
    lastSeenAt: botRuntime.lastSeenAt,
    lastPath: botRuntime.lastPath,
    lastStatus: botRuntime.lastStatus,
    requestsSinceApiStart: botRuntime.requestCount,
    apiRequests1h: requestMetrics.filter((item) => item.authKind === "bot" && currentTime - item.createdAt <= 3_600_000).length,
    outbox: {
      pending: (db.outbox ?? []).filter((item) => item.status === "pending").length,
      total: (db.outbox ?? []).length,
    },
    notifications: {
      total: (db.notifications ?? []).length,
      pending: (db.notifications ?? []).filter((item) => item.status === "pending").length,
      due: dueNotifications.length,
      sent: (db.notifications ?? []).filter((item) => item.status === "sent").length,
      failed: (db.notifications ?? []).filter((item) => item.status === "failed").length,
    },
    reminders: {
      total: (db.reminders ?? []).length,
      active: (db.reminders ?? []).filter((item) => item.status === "active").length,
      due: dueReminders.length,
      telegramEnabled: (db.reminders ?? []).filter((item) => item.status === "active" && item.channels?.telegramBot !== false).length,
      sent24h: (db.reminders ?? []).filter((item) => item.lastSentAt && currentTime - new Date(item.lastSentAt).getTime() <= 86_400_000).length,
    },
    projects: {
      total: db.projects.length,
      deadlineNotificationsEnabled: db.projects.filter((project) => mergeSettings(project.botSettings ?? defaultBotSettings, {}).taskDeadlineNotificationsEnabled).length,
      mentionNotificationsEnabled: db.projects.filter((project) => mergeSettings(project.botSettings ?? defaultBotSettings, {}).mentionNotificationsEnabled).length,
      dutyNotificationsEnabled: db.projects.filter((project) => mergeSettings(project.botSettings ?? defaultBotSettings, {}).dutyNotificationsEnabled).length,
    },
  };
}

function formatDurationCompact(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
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
    calendars: db.calendars,
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
      files.push({ path: path.basename(file), bytes: stat.size });
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

function createTaskNotificationSignals(db, task, options = {}) {
  if (!task.assigneeId) return;
  if (!isTaskActiveForKanbanNotifications(db, task)) return;
  const project = db.projects.find((item) => item.id === task.projectId);
  if (!project) return;
  const settings = mergeSettings(project.botSettings ?? defaultBotSettings, {});
  if (!settings.taskDeadlineNotificationsEnabled) return;
  const includeAssignment = options.includeAssignment !== false;

  for (const point of (settings.kanbanReminderPoints ?? []).filter((item) => item.enabled)) {
    if (point.kind === "on_assign" && includeAssignment) {
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

function createMentionNotificationSignals(db, project, block, page, actorUserId) {
  const settings = mergeSettings(project.botSettings ?? defaultBotSettings, {});
  if (!settings.mentionNotificationsEnabled) return;

  const text = blockContentToSearchText(block.content);
  if (!text.includes("@")) return;

  db.notifications ??= [];
  const textLower = text.toLowerCase();
  const memberIds = new Set(
    [project.ownerId, ...(project.members ?? []).map((member) => member.userId)]
      .filter(Boolean)
      .map((value) => String(value)),
  );
  const actorId = actorUserId === undefined || actorUserId === null ? "" : String(actorUserId);
  const entityType = block.type === "simple_table" ? "table" : "block";

  for (const user of db.users.filter((item) => memberIds.has(String(item.id)))) {
    if (actorId && String(user.id) === actorId) continue;
    const mentionKeys = buildUserMentionKeys(user);
    if (!mentionKeys.length || !mentionKeys.some((mention) => textLower.includes(mention))) continue;

    const alreadyExists = db.notifications.some(
      (item) =>
        item.type === "mention" &&
        item.entityType === entityType &&
        item.entityId === block.id &&
        String(item.userId) === String(user.id),
    );
    if (alreadyExists) continue;

    db.notifications.push({
      id: idFor(db.notifications),
      projectId: project.id,
      userId: user.id,
      type: "mention",
      entityType,
      entityId: block.id,
      sendAt: now(),
      status: "pending",
      payload: {
        title: page?.title || "Рабочее пространство",
        text,
        pageId: block.pageId,
        blockId: block.id,
        blockType: block.type,
      },
    });
  }
}

function createUniqueTaskNotification(db, task, type, userId, sendAt, project) {
  const alreadyExists = db.notifications.some(
    (item) =>
      item.type === type &&
      item.entityType === "task" &&
      item.entityId === task.id &&
      item.userId === userId &&
      (type === "task_assigned" || item.sendAt === sendAt),
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

function createTaskAdminAttentionSignal(db, task) {
  if (!isTaskActiveForKanbanNotifications(db, task)) return;
  const project = db.projects.find((item) => item.id === task.projectId);
  if (!project) return;
  const settings = mergeSettings(project.botSettings ?? defaultBotSettings, {});
  if (!settings.smartAdminNotificationsEnabled) return;
  const significanceSettings = settings.taskSignificance ?? defaultBotSettings.taskSignificance;
  const score = calculateTaskSignificanceScore(task, significanceSettings);
  if (score < Number(significanceSettings.criticalThreshold ?? defaultBotSettings.taskSignificance.criticalThreshold)) return;

  const recipients = adminRecipientIds(project);
  for (const userId of recipients) {
    const alreadyExists = db.notifications.some(
      (item) =>
        item.type === "task_admin_attention" &&
        item.entityType === "task" &&
        item.entityId === task.id &&
        String(item.userId) === String(userId),
    );
    if (alreadyExists) continue;
    db.notifications.push({
      id: idFor(db.notifications),
      projectId: task.projectId,
      userId,
      type: "task_admin_attention",
      entityType: "task",
      entityId: task.id,
      sendAt: now(),
      status: "pending",
      payload: {
        title: "Критичная задача требует внимания",
        text: `${task.title} · существенность ${score}/10`,
        score,
        task: hydrateTask(db, task),
        projectTitle: project.title,
      },
    });
  }
}

function adminRecipientIds(project) {
  const recipients = new Set([project.ownerId]);
  for (const member of project.members ?? []) {
    const roleName = typeof member.role === "string" ? member.role : member.role?.name;
    if (String(member.userId) === String(project.ownerId) || roleName === "admin" || roleName === "owner") {
      recipients.add(member.userId);
    }
  }
  return [...recipients].filter(Boolean);
}

function calculateTaskSignificanceScore(task, settings = defaultBotSettings.taskSignificance) {
  const normalized = normalizeTaskSignificanceSettings(settings);
  const importance = normalizeTaskImportanceScore(task.importanceScore);
  let overdueBonus = 0;
  if (task.deadlineAt) {
    const overdueHours = (Date.now() - new Date(task.deadlineAt).getTime()) / 3600000;
    if (overdueHours > normalized.longOverdueHours) overdueBonus = normalized.longOverdueBonus;
    else if (overdueHours > 0) overdueBonus = normalized.overdueBonus;
  }
  const blockingBonus = task.isBlocking ? normalized.blockingBonus : 0;
  return Math.max(1, Math.min(10, importance + normalized.priorityBonus[task.priority] + overdueBonus + blockingBonus));
}

function normalizeTaskSignificanceSettings(settings = {}) {
  const base = defaultBotSettings.taskSignificance;
  const priorityBonus = {
    ...base.priorityBonus,
    ...settings.priorityBonus,
  };
  return {
    priorityBonus: {
      LOW: clampWholeNumber(priorityBonus.LOW, 0, 5, 0),
      MEDIUM: clampWholeNumber(priorityBonus.MEDIUM, 0, 5, 0),
      HIGH: clampWholeNumber(priorityBonus.HIGH, 0, 5, 1),
      CRITICAL: clampWholeNumber(priorityBonus.CRITICAL, 0, 5, 2),
    },
    overdueBonus: clampWholeNumber(settings.overdueBonus, 0, 5, 1),
    longOverdueBonus: clampWholeNumber(settings.longOverdueBonus, 0, 5, 2),
    longOverdueHours: clampWholeNumber(settings.longOverdueHours, 1, 24 * 30, 72),
    blockingBonus: clampWholeNumber(settings.blockingBonus, 0, 5, 2),
    attentionThreshold: clampWholeNumber(settings.attentionThreshold, 1, 10, 6),
    criticalThreshold: clampWholeNumber(settings.criticalThreshold, 1, 10, 8),
  };
}

function clampWholeNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function notificationTypeForOffset(offsetMinutes) {
  if (Number(offsetMinutes) === 15 * 60) return "task_deadline_15h";
  if (Number(offsetMinutes) === 2 * 60) return "task_deadline_2h";
  return `task_deadline_${Number(offsetMinutes)}m`;
}

function isNotificationSuppressed(db, notification) {
  const type = String(notification.type ?? "");
  const project = db.projects.find((item) => item.id === notification.projectId);
  const settings = mergeSettings(project?.botSettings ?? defaultBotSettings, {});

  if (type === "mention") return !settings.mentionNotificationsEnabled;
  if (type === "duty_reminder") return !settings.dutyNotificationsEnabled;
  if (type === "task_admin_attention") {
    const task = db.tasks.find((item) => item.id === notification.entityId);
    return !settings.smartAdminNotificationsEnabled || !task || !isTaskActiveForKanbanNotifications(db, task);
  }
  if (!type.startsWith("task_")) return false;

  if (!settings.taskDeadlineNotificationsEnabled) return true;
  if (!isEnabledTaskNotificationType(settings, type)) return true;

  const task = db.tasks.find((item) => item.id === notification.entityId);
  if (!task) return true;
  return !isTaskActiveForKanbanNotifications(db, task);
}

function isTaskActiveForKanbanNotifications(db, task) {
  if (task.isArchived || task.completedAt || isTaskInFinalColumn(db, task)) return false;
  if (task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now()) return false;
  return true;
}

function isEnabledTaskNotificationType(settings, type) {
  const points = (settings.kanbanReminderPoints ?? []).filter((item) => item.enabled);
  if (type === "task_assigned") return points.some((point) => point.kind === "on_assign");
  if (type === "task_deadline_now" || type === "task_overdue") return points.some((point) => point.kind === "at_deadline");
  const offset = notificationOffsetFromType(type);
  if (!offset) return true;
  return points.some((point) => point.kind === "before_deadline" && Number(point.offsetMinutes) === offset);
}

function notificationOffsetFromType(type) {
  if (type === "task_deadline_15h") return 15 * 60;
  if (type === "task_deadline_2h") return 2 * 60;
  const match = /^task_deadline_(\d+)m$/.exec(type);
  return match ? Number(match[1]) : undefined;
}

function isTaskActiveForUserList(db, task) {
  if (task.isArchived || task.completedAt || isTaskInFinalColumn(db, task)) return false;
  if (task.scheduledAt && new Date(task.scheduledAt).getTime() > Date.now()) return false;
  return true;
}

function buildUserTaskProgress(db, userId, days) {
  const nowTime = Date.now();
  const since = nowTime - days * 24 * 60 * 60 * 1000;
  const assigned = db.tasks.filter((task) => String(task.assigneeId) === String(userId));
  const active = assigned.filter((task) => isTaskActiveForUserList(db, task));
  const completed = assigned.filter((task) => {
    if (!task.isArchived && !task.completedAt && !isTaskInFinalColumn(db, task)) return false;
    const completedTime = parseTime(task.completedAt ?? task.archivedAt);
    return Boolean(completedTime && completedTime >= since && completedTime <= nowTime);
  });
  const created = assigned.filter((task) => {
    const createdTime = parseTime(task.createdAt);
    return Boolean(createdTime && createdTime >= since && createdTime <= nowTime);
  });
  const overdue = active.filter((task) => {
    const deadlineTime = parseTime(task.deadlineAt);
    return Boolean(deadlineTime && deadlineTime < nowTime);
  });
  const total = completed.length + active.length;

  return {
    days,
    since: new Date(since).toISOString(),
    until: new Date(nowTime).toISOString(),
    completed: completed.length,
    total,
    percent: total > 0 ? Math.round((completed.length / total) * 100) : 0,
    created: created.length,
    active: active.length,
    overdue: overdue.length,
  };
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

function syncBoardTaskCompletionStates(db, projectId, pageId) {
  const finalColumn = db.columns
    .filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId) && !column.isArchive && !column.isHidden)
    .sort((a, b) => a.position - b.position)
    .at(-1);
  if (!finalColumn) return;

  const completedAt = now();
  for (const task of db.tasks) {
    if (task.projectId !== projectId || !sameBoard(task.pageId, pageId) || task.isArchived) continue;
    if (task.columnId === finalColumn.id) {
      task.completedAt ??= completedAt;
    } else {
      task.completedAt = undefined;
    }
  }
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
  const allowed = new Set(["meeting", "service", "deadline", "duty", "event", "birthday", "custom"]);
  return allowed.has(value) ? value : "event";
}

const BASE_CALENDAR_CATEGORIES = {
  "base:meeting": { id: "base:meeting", label: "Встреча", color: "#3B82F6", type: "meeting" },
  "base:deadline": { id: "base:deadline", label: "Дедлайн", color: "#EF4444", type: "deadline" },
  "base:birthday": { id: "base:birthday", label: "День рождения", color: "#EC4899", type: "birthday" },
};

const CALENDAR_COLORS = ["#3B82F6", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6", "#EF4444", "#6366F1"];

function projectCalendarId(projectId) {
  return `calendar_project_${asRef(projectId)}`;
}

function personalCalendarId(userId) {
  return `calendar_personal_${asRef(userId)}`;
}

function stableCalendarColor(value) {
  const text = String(value ?? "");
  const hash = [...text].reduce((total, character) => total + character.charCodeAt(0), 0);
  return CALENDAR_COLORS[hash % CALENDAR_COLORS.length];
}

function ensureCalendarRecords(db) {
  db.calendars ??= [];
  let changed = 0;
  const timestamp = now();

  for (const user of db.users ?? []) {
    const ownerUserId = asRef(user.id);
    if (!ownerUserId) continue;
    let calendar = db.calendars.find(
      (item) => item.type === "PERSONAL" && item.sourceType !== "external" && String(item.ownerUserId) === ownerUserId,
    );
    if (!calendar) {
      calendar = {
        id: personalCalendarId(ownerUserId),
        type: "PERSONAL",
        name: "Личный",
        color: stableCalendarColor(`personal:${ownerUserId}`),
        ownerUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.calendars.push(calendar);
      changed += 1;
    }
  }

  for (const project of db.projects ?? []) {
    const projectId = asRef(project.id);
    if (!projectId) continue;
    let calendar = db.calendars.find(
      (item) => item.type === "PROJECT" && String(item.projectId) === projectId,
    );
    if (!calendar) {
      calendar = {
        id: projectCalendarId(projectId),
        type: "PROJECT",
        name: String(project.title || "Проект"),
        color: stableCalendarColor(`project:${projectId}`),
        projectId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.calendars.push(calendar);
      changed += 1;
    } else if (calendar.name !== String(project.title || "Проект")) {
      calendar.name = String(project.title || "Проект");
      calendar.updatedAt = timestamp;
      changed += 1;
    }
  }

  for (const event of db.calendarEvents ?? []) {
    const project = event.projectId ? findProjectById(db, event.projectId) : undefined;
    const calendar = event.calendarId
      ? db.calendars.find((item) => String(item.id) === String(event.calendarId))
      : project
        ? db.calendars.find((item) => item.type === "PROJECT" && String(item.projectId) === String(project.id))
        : db.calendars.find(
            (item) => item.type === "PERSONAL"
              && item.sourceType !== "external"
              && String(item.ownerUserId) === String(event.ownerUserId),
          );
    if (calendar && String(event.calendarId ?? "") !== String(calendar.id)) {
      event.calendarId = calendar.id;
      changed += 1;
    }
    const fallbackOwnerId = asRef(event.createdByUserId ?? event.ownerUserId ?? calendar?.ownerUserId ?? project?.ownerId);
    if (fallbackOwnerId && !event.createdByUserId) {
      event.createdByUserId = fallbackOwnerId;
      changed += 1;
    }
    if (fallbackOwnerId && !event.ownerUserId) {
      event.ownerUserId = fallbackOwnerId;
      changed += 1;
    }
    const expectedVisibility = calendar?.type === "PERSONAL"
      ? "private"
      : event.visibility === "selected" ? "selected" : "project";
    if (event.visibility !== expectedVisibility) {
      event.visibility = expectedVisibility;
      changed += 1;
    }
  }

  return changed;
}

function externalCalendarCredentialsKey() {
  const secret = EXTERNAL_CALENDAR_CREDENTIALS_SECRET
    || (!isProductionRuntime() ? INTERNAL_API_TOKEN || `local-calendar:${resolveAppDataDir()}:${os.hostname()}` : "");
  return secret ? crypto.createHash("sha256").update(secret).digest() : undefined;
}

function encryptExternalCalendarValue(value) {
  const key = externalCalendarCredentialsKey();
  if (!key) throw new Error("EXTERNAL_CALENDAR_CREDENTIALS_SECRET is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptExternalCalendarValue(value) {
  const key = externalCalendarCredentialsKey();
  if (!key) throw new Error("EXTERNAL_CALENDAR_CREDENTIALS_SECRET is not configured");
  const [version, ivValue, tagValue, encryptedValue] = String(value ?? "").split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted calendar credential");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function publicExternalCalendarConnection(connection) {
  return {
    id: connection.id,
    provider: connection.provider,
    projectId: connection.projectId,
    name: connection.name,
    color: connection.color,
    calendarId: connection.calendarId,
    enabled: connection.enabled !== false,
    syncIntervalMinutes: connection.syncIntervalMinutes,
    lastSyncAt: connection.lastSyncAt,
    lastSyncStatus: connection.lastSyncStatus ?? "pending",
    lastSyncError: connection.lastSyncError,
    importedEvents: Number(connection.importedEvents ?? 0),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

async function normalizeYandexCalendarUrl(value) {
  const rawValue = String(value ?? "").trim();
  if (/^<iframe\b/i.test(rawValue)) throw new Error(YANDEX_ICAL_LINK_HINT);
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("Некорректная iCal-ссылка");
  }
  if (parsed.protocol !== "https:") throw new Error("Ссылка календаря должна использовать HTTPS");
  if (parsed.username || parsed.password) throw new Error("Логин и пароль нельзя передавать внутри ссылки");
  const hostname = normalizePreviewHostname(parsed.hostname);
  if (!YANDEX_CALENDAR_HOSTS.has(hostname)) throw new Error("Разрешены только ссылки экспорта Яндекс Календаря");
  const pathname = parsed.pathname.toLowerCase();
  const isEmbedLink = pathname.includes("/embed/") || parsed.searchParams.has("layer_ids");
  if (isEmbedLink) throw new Error(YANDEX_ICAL_LINK_HINT);
  const isIcalExport = pathname.endsWith(".ics") || pathname.includes("/export/ics");
  if (!isIcalExport) throw new Error(YANDEX_ICAL_LINK_HINT);
  const addresses = await resolvePreviewAddresses(hostname);
  if (!addresses.length || addresses.some((address) => isBlockedPreviewAddress(address.address))) {
    throw new Error("Адрес календаря недоступен");
  }
  return parsed;
}

async function fetchYandexCalendarText(targetUrl, redirects = 0) {
  const parsed = await normalizeYandexCalendarUrl(targetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_CALENDAR_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "NotoTimeCalendarSync/1.0",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 3) throw new Error("Слишком много перенаправлений календаря");
      const location = response.headers.get("location");
      if (!location) throw new Error("Некорректное перенаправление календаря");
      return fetchYandexCalendarText(new URL(location, parsed).toString(), redirects + 1);
    }
    if (!response.ok) throw new Error(`Яндекс Календарь ответил кодом ${response.status}`);
    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("text/html")) throw new Error(YANDEX_ICAL_LINK_HINT);
    return readLimitedResponseText(response, EXTERNAL_CALENDAR_MAX_BYTES);
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedResponseText(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Файл календаря слишком большой");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Файл календаря слишком большой");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function parseExternalCalendarEvents(icsText) {
  if (!String(icsText).includes("BEGIN:VCALENDAR")) throw new Error(YANDEX_ICAL_LINK_HINT);
  const parsed = await ical.async.parseICS(icsText);
  const windowStart = new Date(Date.now() - 366 * 24 * 3600000);
  const windowEnd = new Date(Date.now() + 2 * 366 * 24 * 3600000);
  const results = [];
  for (const item of Object.values(parsed)) {
    if (item?.type !== "VEVENT" || !(item.start instanceof Date)) continue;
    if (item.rrule?.between) {
      const occurrences = item.rrule.between(windowStart, windowEnd, true).slice(0, 1000);
      const duration = item.end instanceof Date ? Math.max(0, item.end.getTime() - item.start.getTime()) : 3600000;
      for (const occurrence of occurrences) {
        results.push(externalCalendarOccurrence(item, occurrence, new Date(occurrence.getTime() + duration)));
      }
    } else {
      results.push(externalCalendarOccurrence(item, item.start, item.end instanceof Date ? item.end : undefined));
    }
    if (results.length >= 5000) break;
  }
  return results;
}

function externalCalendarOccurrence(item, start, end) {
  const uid = String(item.uid ?? crypto.createHash("sha256").update(`${item.summary}:${start.toISOString()}`).digest("hex"));
  const recurrenceKey = item.rrule ? `:${start.toISOString()}` : "";
  const allDay = Boolean(item.datetype === "date" || item.start?.dateOnly);
  return {
    externalUid: `${uid}${recurrenceKey}`,
    title: String(item.summary ?? "Событие").trim() || "Событие",
    description: String(item.description ?? ""),
    location: String(item.location ?? ""),
    startsAt: start.toISOString(),
    endsAt: end?.toISOString(),
    allDay,
    link: typeof item.url === "string" ? item.url : item.url?.toString?.() ?? "",
  };
}

async function syncExternalCalendarConnection(db, connection) {
  if (connection.enabled === false) return publicExternalCalendarConnection(connection);
  const syncStartedAt = now();
  try {
    const feedUrl = decryptExternalCalendarValue(connection.encryptedFeedUrl);
    const icsText = await fetchYandexCalendarText(feedUrl);
    const imported = await parseExternalCalendarEvents(icsText);
    const calendar = db.calendars.find((item) => String(item.id) === String(connection.calendarId));
    if (!calendar) throw new Error("Связанный календарь не найден");
    const sourcePrefix = `${connection.id}:`;
    const importedSourceIds = new Set();
    for (const item of imported) {
      const sourceId = `${sourcePrefix}${item.externalUid}`;
      importedSourceIds.add(sourceId);
      const existing = db.calendarEvents.find((event) => event.sourceType === "external" && event.sourceId === sourceId);
      const values = {
        calendarId: calendar.id,
        projectId: connection.projectId,
        ownerUserId: connection.ownerUserId,
        createdByUserId: connection.ownerUserId,
        title: item.title,
        description: item.description,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        allDay: item.allDay,
        type: "event",
        color: calendar.color,
        categoryLabel: connection.name,
        visibility: connection.projectId ? "project" : "private",
        participantUserIds: [],
        location: item.location,
        link: item.link,
        sourceType: "external",
        sourceId,
        readOnly: true,
        notification: { enabled: false },
        updatedAt: syncStartedAt,
      };
      if (existing) Object.assign(existing, values);
      else db.calendarEvents.push({ id: `external_event_${crypto.randomUUID()}`, ...values, createdAt: syncStartedAt });
    }
    db.calendarEvents = db.calendarEvents.filter((event) => (
      event.sourceType !== "external" || !String(event.sourceId ?? "").startsWith(sourcePrefix) || importedSourceIds.has(event.sourceId)
    ));
    Object.assign(connection, {
      lastSyncAt: syncStartedAt,
      lastSyncStatus: "success",
      lastSyncError: undefined,
      importedEvents: imported.length,
      updatedAt: syncStartedAt,
    });
  } catch (error) {
    Object.assign(connection, {
      lastSyncAt: syncStartedAt,
      lastSyncStatus: "error",
      lastSyncError: String(error instanceof Error ? error.message : error).slice(0, 300),
      updatedAt: syncStartedAt,
    });
    throw error;
  }
  return publicExternalCalendarConnection(connection);
}

async function runExternalCalendarSyncTick() {
  if (externalCalendarSyncRunning) return;
  externalCalendarSyncRunning = true;
  try {
    const db = await readJson();
    const currentTime = Date.now();
    const due = (db.externalCalendarConnections ?? []).filter((connection) => {
      if (connection.enabled === false) return false;
      const lastSync = new Date(connection.lastSyncAt ?? 0).getTime();
      return !Number.isFinite(lastSync) || currentTime - lastSync >= Number(connection.syncIntervalMinutes ?? 15) * 60_000;
    });
    for (const connection of due.slice(0, 20)) {
      try {
        await syncExternalCalendarConnection(db, connection);
      } catch (error) {
        console.error(`External calendar sync failed (${connection.id})`, error instanceof Error ? error.message : error);
      }
    }
    if (due.length) await writeJson(db);
  } finally {
    externalCalendarSyncRunning = false;
  }
}

function validCalendarDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function normalizeCalendarEventNotification(value, startsAt) {
  const enabled = Boolean(value?.enabled);
  if (!enabled) return { notification: { enabled: false } };
  const remindAt = validCalendarDate(value?.remindAt);
  if (!remindAt) return { error: "Notification time is required" };
  if (new Date(remindAt).getTime() > new Date(startsAt).getTime()) {
    return { error: "Notification time must not be after event start" };
  }
  return { notification: { enabled: true, remindAt } };
}

function resetCalendarNotificationDelivery(notification) {
  if (!notification?.enabled) return { enabled: false };
  return {
    enabled: true,
    remindAt: notification.remindAt,
    deliveryStatus: "pending",
    deliveryAttempts: 0,
  };
}

function normalizeStoredCalendarNotification(value, startsAt) {
  const normalized = normalizeCalendarEventNotification(value, startsAt).notification;
  if (!normalized?.enabled) return { enabled: false };
  const status = ["pending", "retry", "sent", "failed", "disabled", "missed"].includes(value?.deliveryStatus)
    ? value.deliveryStatus
    : "pending";
  return {
    ...normalized,
    deliveryStatus: status,
    deliveryAttempts: Math.max(0, Number(value?.deliveryAttempts ?? 0)),
    ...(validCalendarDate(value?.sentAt) ? { sentAt: validCalendarDate(value.sentAt) } : {}),
    ...(validCalendarDate(value?.nextAttemptAt) ? { nextAttemptAt: validCalendarDate(value.nextAttemptAt) } : {}),
    ...(validCalendarDate(value?.deliveryCompletedAt) ? { deliveryCompletedAt: validCalendarDate(value.deliveryCompletedAt) } : {}),
    ...(value?.deliveryError ? { deliveryError: String(value.deliveryError).slice(0, 300) } : {}),
  };
}

function normalizeCalendarParticipantIds(project, values) {
  if (!project || !Array.isArray(values)) return [];
  const memberIds = new Set([
    String(project.ownerId),
    ...(project.members ?? []).map((member) => String(member.userId)),
  ]);
  return [...new Set(values.map(String).filter((id) => memberIds.has(id)))];
}

function createCalendarEventRecord(db, calendar, body, creatorUserId) {
  const parsedStart = body.startsAt ? validCalendarDate(body.startsAt) : undefined;
  if (body.startsAt && !parsedStart) return { error: "Invalid event start date" };
  const startsAt = parsedStart ?? now();
  const endsAt = body.endsAt ? validCalendarDate(body.endsAt) : undefined;
  if (body.endsAt && !endsAt) return { error: "Invalid event end date" };
  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    return { error: "Event end must not be before start" };
  }
  const normalizedNotification = normalizeCalendarEventNotification(body.notification, startsAt);
  if (normalizedNotification.error) return normalizedNotification;
  const project = calendar.type === "PROJECT" ? findProjectById(db, calendar.projectId) : undefined;
  const createdAt = now();
  const creatorId = asRef(creatorUserId);
  const visibility = calendar.type === "PERSONAL" ? "private" : body.visibility === "selected" ? "selected" : "project";
  const categoryId = body.categoryId ? String(body.categoryId) : undefined;
  const category = calendarCategoryById(db, calendar, categoryId);
  return {
    event: {
      id: `event_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      calendarId: calendar.id,
      projectId: project?.id,
      ownerUserId: creatorId,
      createdByUserId: creatorId,
      title: String(body.title || "Новое событие").trim() || "Новое событие",
      description: body.description ? String(body.description) : "",
      startsAt,
      endsAt,
      allDay: Boolean(body.allDay),
      type: category?.type ?? normalizeCalendarEventType(body.type),
      color: category?.color ?? normalizeHexColor(body.color, calendar.color),
      categoryId,
      categoryLabel: category?.label ?? (body.categoryLabel ? String(body.categoryLabel) : ""),
      visibility,
      participantUserIds: calendar.type === "PROJECT"
        ? normalizeCalendarParticipantIds(project, body.participantUserIds)
        : [],
      location: body.location ? String(body.location) : "",
      link: body.link ? String(body.link) : "",
      sourceType: body.sourceType ? String(body.sourceType) : "manual",
      sourceId: body.sourceId ? String(body.sourceId) : undefined,
      notification: resetCalendarNotificationDelivery(normalizedNotification.notification),
      createdAt,
      updatedAt: createdAt,
    },
  };
}

function applyCalendarEventPatch(db, event, body) {
  const calendar = db.calendars.find((item) => String(item.id) === String(event.calendarId));
  const project = event.projectId ? findProjectById(db, event.projectId) : undefined;
  const startsAt = body.startsAt !== undefined ? validCalendarDate(body.startsAt) : event.startsAt;
  const endsAt = body.endsAt !== undefined ? (body.endsAt ? validCalendarDate(body.endsAt) : undefined) : event.endsAt;
  if (!startsAt || (body.endsAt && !endsAt)) return { error: "Invalid event date" };
  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    return { error: "Event end must not be before start" };
  }
  const normalizedNotification = normalizeCalendarEventNotification(
    body.notification !== undefined ? body.notification : event.notification,
    startsAt,
  );
  if (normalizedNotification.error) return normalizedNotification;
  const deliveryMustReset = body.notification !== undefined
    || body.startsAt !== undefined
    || body.title !== undefined
    || body.location !== undefined
    || body.description !== undefined;
  const notification = deliveryMustReset
    ? resetCalendarNotificationDelivery(normalizedNotification.notification)
    : event.notification;
  const categoryId = body.categoryId !== undefined ? (body.categoryId ? String(body.categoryId) : undefined) : event.categoryId;
  const category = calendarCategoryById(db, calendar, categoryId);
  Object.assign(event, {
    title: body.title !== undefined ? String(body.title).trim() || event.title : event.title,
    description: body.description !== undefined ? String(body.description) : event.description,
    startsAt,
    endsAt,
    allDay: body.allDay !== undefined ? Boolean(body.allDay) : event.allDay,
    type: category?.type ?? (body.type !== undefined ? normalizeCalendarEventType(body.type) : event.type),
    color: category?.color ?? (body.color !== undefined ? normalizeHexColor(body.color, event.color) : event.color),
    categoryId,
    categoryLabel: category?.label ?? (body.categoryLabel !== undefined ? String(body.categoryLabel) : event.categoryLabel),
    visibility: calendar?.type === "PERSONAL"
      ? "private"
      : body.visibility === "selected" ? "selected" : body.visibility === "project" ? "project" : event.visibility,
    participantUserIds: body.participantUserIds !== undefined
      ? normalizeCalendarParticipantIds(project, body.participantUserIds)
      : event.participantUserIds,
    location: body.location !== undefined ? String(body.location) : event.location,
    link: body.link !== undefined ? String(body.link) : event.link,
    notification,
    updatedAt: now(),
  });
  return { event };
}

function calendarRangeFromUrl(url) {
  const from = validCalendarDate(url.searchParams.get("from"));
  const to = validCalendarDate(url.searchParams.get("to"));
  if (!from || !to) return { error: "Valid from and to parameters are required" };
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  if (toTime <= fromTime) return { error: "Calendar range end must be after start" };
  if (toTime - fromTime > 370 * 24 * 3600000) return { error: "Calendar range must not exceed 370 days" };
  return { from: fromTime, to: toTime };
}

function calendarEventOverlapsRange(event, range) {
  const start = new Date(event.startsAt).getTime();
  const end = event.endsAt ? new Date(event.endsAt).getTime() : start;
  return Number.isFinite(start) && start < range.to && end >= range.from;
}

function requestedCalendarIds(url) {
  return new Set(
    url.searchParams.getAll("calendarIds")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizeCalendarCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories
    .filter((category) => category && category.label)
    .map((category) => ({
      id: asRef(category.id) || `category_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      label: String(category.label).trim().slice(0, 80),
      color: normalizeHexColor(category.color, "#64748B"),
      type: normalizeCalendarEventType(category.type),
      createdAt: category.createdAt ? String(category.createdAt) : now(),
      updatedAt: category.updatedAt ? String(category.updatedAt) : undefined,
    }));
}

function normalizeStringList(values, max = 200) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(asRef).filter(Boolean))].slice(0, max);
}

function normalizeHexColor(value, fallback = "#3B82F6") {
  const color = String(value ?? "").trim();
  return /^#[0-9A-F]{6}$/i.test(color) ? color : fallback;
}

function normalizeResponsibilityArea(input = {}, projectId, existing = {}) {
  const title = String(input.title ?? existing.title ?? "Новая зона").trim().slice(0, 120) || "Новая зона";
  const createdAt = existing.createdAt ? String(existing.createdAt) : input.createdAt ? String(input.createdAt) : now();
  return {
    id: asRef(existing.id ?? input.id) || `area_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    projectId: asRef(projectId),
    title,
    description: String(input.description ?? existing.description ?? "").slice(0, 2000),
    ownerUserIds: normalizeStringList(input.ownerUserIds ?? existing.ownerUserIds, 100),
    color: normalizeHexColor(input.color ?? existing.color),
    icon: String(input.icon ?? existing.icon ?? "📌").trim().slice(0, 8) || "📌",
    linkedPageIds: normalizeStringList(input.linkedPageIds ?? existing.linkedPageIds, 500),
    linkedKanbanBoardIds: normalizeStringList(input.linkedKanbanBoardIds ?? existing.linkedKanbanBoardIds, 200),
    linkedTaskIds: normalizeStringList(input.linkedTaskIds ?? existing.linkedTaskIds, 1000),
    notes: String(input.notes ?? existing.notes ?? "").slice(0, 30000),
    planItems: normalizeResponsibilityPlanItems(input.planItems ?? existing.planItems),
    createdAt,
    updatedAt: input === existing && existing.updatedAt ? String(existing.updatedAt) : now(),
  };
}

function normalizeResponsibilityPlanItems(items) {
  if (!Array.isArray(items)) return [];
  const timestamp = now();
  return items
    .filter((item) => item && String(item.title ?? "").trim())
    .slice(0, 300)
    .map((item) => {
      const dueDate = String(item.dueDate ?? "").trim();
      return {
        id: asRef(item.id) || `plan_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        title: String(item.title).trim().slice(0, 500),
        completed: Boolean(item.completed),
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : "",
        createdAt: item.createdAt ? String(item.createdAt) : timestamp,
        updatedAt: timestamp,
      };
    });
}

function pickResponsibilityWorkspacePatch(input = {}) {
  const patch = {};
  for (const key of ["description", "notes", "planItems", "linkedPageIds", "linkedKanbanBoardIds", "linkedTaskIds"]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key];
  }
  return patch;
}

function normalizeResponsibilityAreas(areas, projectId) {
  if (!Array.isArray(areas)) return [];
  return areas
    .filter((area) => area && area.title)
    .map((area) => normalizeResponsibilityArea(area, projectId, area))
    .slice(0, 200);
}

async function fetchLinkPreview(targetUrl) {
  const parsed = await normalizePublicPreviewUrl(targetUrl);
  const fallback = {
    url: parsed.toString(),
    title: parsed.hostname.replace(/^www\./, ""),
    siteName: parsed.hostname.replace(/^www\./, ""),
    favicon: `${parsed.origin}/favicon.ico`,
  };

  try {
    const response = await fetchPreviewResponse(parsed);
    if (!response) return fallback;
    if (!response.ok) return fallback;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return fallback;
    const html = await readPreviewText(response);
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

async function normalizePublicPreviewUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(String(targetUrl ?? "").trim());
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https links are supported");
  }

  parsed.username = "";
  parsed.password = "";
  const hostname = normalizePreviewHostname(parsed.hostname);
  if (!hostname || isBlockedPreviewHostname(hostname)) {
    throw new Error("This link host is not allowed");
  }

  const addresses = await resolvePreviewAddresses(hostname);
  if (!addresses.length || addresses.some((address) => isBlockedPreviewAddress(address.address))) {
    throw new Error("This link resolves to a private address");
  }

  return parsed;
}

async function fetchPreviewResponse(url, redirectCount = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "TelegramWorkspacePreview/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= LINK_PREVIEW_MAX_REDIRECTS) return undefined;
      const location = response.headers.get("location");
      if (!location) return undefined;
      const nextUrl = await normalizePublicPreviewUrl(new URL(location, url).toString());
      return fetchPreviewResponse(nextUrl, redirectCount + 1);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePreviewAddresses(hostname) {
  if (isIpv4Address(hostname) || hostname.includes(":")) return [{ address: hostname }];
  try {
    return await dns.lookup(hostname, { all: true });
  } catch {
    return [];
  }
}

function normalizePreviewHostname(hostname) {
  return String(hostname ?? "").trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isBlockedPreviewHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    /^\d+$/.test(hostname)
  );
}

function isBlockedPreviewAddress(address) {
  const normalized = normalizePreviewHostname(address);
  if (isPrivateIpv4Address(normalized)) return true;
  if (normalized.includes(":")) return isPrivateIpv6Address(normalized);
  return false;
}

function isIpv4Address(value) {
  const parts = String(value).split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateIpv4Address(value) {
  if (!isIpv4Address(value)) return false;
  const [a, b] = value.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6Address(value) {
  const address = value.toLowerCase();
  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:") ||
    address.startsWith("::ffff:0.") ||
    address.startsWith("::ffff:10.") ||
    address.startsWith("::ffff:127.") ||
    address.startsWith("::ffff:169.254.") ||
    address.startsWith("::ffff:192.168.")
  );
}

async function readPreviewText(response) {
  if (!response.body?.getReader) return (await response.text()).slice(0, LINK_PREVIEW_MAX_BODY_BYTES);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let total = 0;

  while (total < LINK_PREVIEW_MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const next = value.slice(0, Math.max(0, LINK_PREVIEW_MAX_BODY_BYTES - total));
    chunks.push(decoder.decode(next, { stream: true }));
    total += next.byteLength;
    if (next.byteLength < value.byteLength) break;
  }

  chunks.push(decoder.decode());
  try {
    await reader.cancel();
  } catch {
    // The stream may already be closed.
  }
  return chunks.join("");
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

async function runCalendarNotificationTick() {
  if (!TELEGRAM_BOT_TOKEN || calendarNotificationTickRunning) return;
  calendarNotificationTickRunning = true;
  try {
    const db = await readJson();
    const currentTime = Date.now();
    const dueEvents = (db.calendarEvents ?? [])
      .filter((event) => {
        const notification = event.notification;
        if (!notification?.enabled || !notification.remindAt) return false;
        if (["sent", "disabled", "failed", "missed"].includes(notification.deliveryStatus)) return false;
        const remindAt = new Date(notification.remindAt).getTime();
        const nextAttemptAt = notification.nextAttemptAt ? new Date(notification.nextAttemptAt).getTime() : 0;
        return Number.isFinite(remindAt) && remindAt <= currentTime && nextAttemptAt <= currentTime;
      })
      .sort((left, right) => new Date(left.notification.remindAt).getTime() - new Date(right.notification.remindAt).getTime())
      .slice(0, CALENDAR_NOTIFICATION_BATCH_SIZE);

    let changed = false;
    for (const event of dueEvents) {
      const notification = event.notification;
      const startsAt = new Date(event.startsAt).getTime();
      if (Number.isFinite(startsAt) && currentTime > startsAt + CALENDAR_NOTIFICATION_STALE_AFTER_MS) {
        Object.assign(notification, {
          deliveryStatus: "missed",
          deliveryError: "Notification expired before delivery",
          deliveryCompletedAt: now(),
        });
        changed = true;
        continue;
      }
      const owner = db.users.find((user) => String(user.id) === String(event.ownerUserId));
      if (!owner || owner.isBlocked || !isDeliverableTelegramId(owner.telegramId)) {
        Object.assign(notification, {
          deliveryStatus: "failed",
          deliveryError: "Telegram account is unavailable",
          deliveryCompletedAt: now(),
        });
        changed = true;
        continue;
      }
      if (owner.botPreferences?.calendarNotificationsEnabled === false) {
        Object.assign(notification, {
          deliveryStatus: "disabled",
          deliveryCompletedAt: now(),
        });
        changed = true;
        continue;
      }

      try {
        await telegramBotApi("sendMessage", calendarTelegramMessage(db, event, owner));
        Object.assign(notification, {
          deliveryStatus: "sent",
          sentAt: now(),
          deliveryCompletedAt: now(),
          deliveryError: undefined,
          nextAttemptAt: undefined,
        });
      } catch (error) {
        const attempts = Number(notification.deliveryAttempts ?? 0) + 1;
        const terminal = attempts >= CALENDAR_NOTIFICATION_MAX_ATTEMPTS;
        Object.assign(notification, {
          deliveryStatus: terminal ? "failed" : "retry",
          deliveryAttempts: attempts,
          deliveryError: String(error instanceof Error ? error.message : error).slice(0, 300),
          nextAttemptAt: terminal
            ? undefined
            : new Date(currentTime + CALENDAR_NOTIFICATION_RETRY_MS * Math.min(attempts, 10)).toISOString(),
          deliveryCompletedAt: terminal ? now() : undefined,
        });
      }
      changed = true;
    }
    if (changed) {
      await writeJson(db);
      await flushDbNow();
    }
  } catch (error) {
    console.error("Calendar notification tick failed", error instanceof Error ? error.message : error);
  } finally {
    calendarNotificationTickRunning = false;
  }
}

function isDeliverableTelegramId(value) {
  const telegramId = String(value ?? "").trim();
  return /^\d+$/.test(telegramId) && !telegramId.startsWith("0");
}

function calendarTelegramMessage(db, event, owner) {
  const calendar = db.calendars.find((item) => String(item.id) === String(event.calendarId));
  const project = event.projectId ? findProjectById(db, event.projectId) : undefined;
  const parts = [
    "🔔 <b>Напоминание о событии</b>",
    `<b>${escapeTelegramHtml(event.title)}</b>`,
    `🕒 ${escapeTelegramHtml(formatCalendarTelegramRange(event))}`,
  ];
  if (calendar?.type === "PROJECT" && project?.title) parts.push(`📁 ${escapeTelegramHtml(project.title)}`);
  if (event.location) parts.push(`📍 ${escapeTelegramHtml(event.location)}`);
  if (event.description) parts.push(`\n${escapeTelegramHtml(String(event.description).slice(0, 700))}`);
  const body = {
    chat_id: Number(owner.telegramId),
    text: parts.join("\n"),
    parse_mode: "HTML",
  };
  const targetPath = event.projectId ? `/project/${event.projectId}/calendar` : "/my-calendar";
  if (/^https:\/\//i.test(TELEGRAM_WEB_APP_URL)) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "Открыть календарь", web_app: { url: `${TELEGRAM_WEB_APP_URL}${targetPath}` } }]],
    };
  }
  return body;
}

function formatCalendarTelegramRange(event) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : undefined;
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(event.allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
  });
  return end ? `${formatter.format(start)} - ${formatter.format(end)}` : formatter.format(start);
}

function escapeTelegramHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
}

// ===== Автоматические резервные копии базы (двойная защита поверх постоянного тома) =====
async function makeBackup() {
  try {
    const backupDir = dataRepository.paths?.backupDir;
    if (!backupDir) return;
    const db = await readJson();
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `backup_${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(db, null, 2), "utf8");

    // Храним последние 30 копий, остальные удаляем
    const files = fs.readdirSync(backupDir)
      .filter((name) => name.startsWith("backup_") && name.endsWith(".json"))
      .sort();
    const excess = files.length - 30;
    for (let i = 0; i < excess; i += 1) {
      fs.rmSync(path.join(backupDir, files[i]), { force: true });
    }
    console.log(`Backup saved: ${file}`);
  } catch (error) {
    console.error("Backup failed", error instanceof Error ? error.message : error);
  }
}

validateProductionSecurityConfig();
await readJson();

const calendarNotificationTimer = setInterval(() => {
  void runCalendarNotificationTick();
}, CALENDAR_NOTIFICATION_INTERVAL_MS);
calendarNotificationTimer.unref?.();
setTimeout(() => void runCalendarNotificationTick(), 2_000).unref?.();

const externalCalendarSyncTimer = setInterval(() => {
  void runExternalCalendarSyncTick();
}, EXTERNAL_CALENDAR_SYNC_INTERVAL_MS);
externalCalendarSyncTimer.unref?.();
setTimeout(() => void runExternalCalendarSyncTick(), 30_000).unref?.();

http.createServer(handle).listen(PORT, "0.0.0.0", () => {
  console.log(`Telegram Workspace API listening on http://127.0.0.1:${PORT}`);
  console.log(`APP_DATA_DIR: ${process.env.APP_DATA_DIR ?? "(default)"}`);
  console.log(`APP_OWNER_TELEGRAM_IDS: ${[...APP_OWNER_TELEGRAM_IDS].join(",") || "(none)"}`);
  // Бэкап при старте и каждые 6 часов
  setTimeout(makeBackup, 10_000);
  setInterval(makeBackup, 6 * 3600 * 1000);
});
