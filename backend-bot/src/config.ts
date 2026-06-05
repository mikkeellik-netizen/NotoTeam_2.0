import fs from "node:fs";
import path from "node:path";

export interface BotConfig {
  botToken: string;
  webAppUrl: string;
  workspaceApiUrl: string;
  mode: "polling" | "webhook";
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

  return {
    botToken,
    webAppUrl: env.WEBAPP_URL ?? "http://127.0.0.1:5174",
    workspaceApiUrl,
    mode: env.BOT_MODE === "webhook" ? "webhook" : "polling",
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
