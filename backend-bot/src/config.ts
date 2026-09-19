import fs from "node:fs";
import path from "node:path";
import { normalizeWebAppBaseUrl } from "./webAppLinks.js";
export interface BotConfig {
  botToken: string;
  webAppUrl: string;
  workspaceApiUrl: string;
  internalApiToken: string;
  mode: "polling" | "webhook";
  publicUrl?: string;
  webhookPath: string;
  timezone: "Europe/Moscow";
}

export function loadConfig(env = process.env): BotConfig {
  loadDotEnv(env);
  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("BOT_TOKEN is required");
  }

  const workspaceApiUrl = env.WORKSPACE_API_URL?.trim();
  if (!workspaceApiUrl) {
    throw new Error("WORKSPACE_API_URL is required so the bot uses the same backend data as the Mini App");
  }

  const internalApiToken = env.INTERNAL_API_TOKEN?.trim();
  if (!internalApiToken) {
    throw new Error("INTERNAL_API_TOKEN is required and must match backend-api INTERNAL_API_TOKEN");
  }

  // Render автоматически задаёт RENDER_EXTERNAL_URL — публичный https-адрес сервиса.
  // Можно переопределить через WEBHOOK_PUBLIC_URL, если хостинг другой.
  const publicUrl = (env.WEBHOOK_PUBLIC_URL ?? env.RENDER_EXTERNAL_URL)?.trim();
  const mode = env.BOT_MODE === "webhook" ? "webhook" : env.BOT_MODE === "polling" ? "polling" : publicUrl ? "webhook" : "polling";
  const requirePublicHttps = env.NODE_ENV === "production" || mode === "webhook";
  const rawWebAppUrl = env.WEBAPP_URL?.trim() || (requirePublicHttps ? "" : "http://127.0.0.1:5174");
  if (!rawWebAppUrl) {
    throw new Error("WEBAPP_URL is required in production and must point to the public Mini App domain");
  }
  const webAppUrl = normalizeWebAppBaseUrl(rawWebAppUrl, { requirePublicHttps });

  return {
    botToken,
    webAppUrl,
    workspaceApiUrl,
    internalApiToken,
    mode,
    publicUrl,
    webhookPath: `/telegram/webhook/${internalApiToken.slice(0, 24)}`,
    timezone: "Europe/Moscow",
  };
}

function loadDotEnv(env: NodeJS.ProcessEnv) {
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
    if (key && env[key] === undefined) env[key] = value;
  }
}
