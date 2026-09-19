#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_TOOLS = [
  "list_projects",
  "get_project_context",
  "get_project_changes",
  "get_project_summary",
  "list_project_tasks",
  "list_project_calendar",
  "list_project_reminders",
  "list_project_inbox",
  "list_project_workspace",
  "search_project_context",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(scriptDir, "..", "src", "server.js");
const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

const pending = new Map();
const stderr = [];
let nextId = 1;

const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    rejectAll(new Error(`Invalid JSON-RPC response: ${error.message}`));
    return;
  }

  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);

  if (message.error) {
    waiter.reject(new Error(message.error.message || "JSON-RPC error"));
  } else {
    waiter.resolve(message.result);
  }
});

child.stderr.on("data", (chunk) => {
  stderr.push(String(chunk));
});

child.on("exit", (code, signal) => {
  if (pending.size) {
    rejectAll(new Error(`MCP server exited before response: code=${code ?? "null"} signal=${signal ?? "null"}`));
  }
});

try {
  const initialize = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "noto-ai-connector-smoke",
      version: "0.1.0",
    },
  });

  if (initialize.serverInfo?.name !== "noto-ai-connector") {
    throw new Error("Unexpected MCP server name");
  }

  const list = await rpc("tools/list", {});
  const toolNames = (list.tools ?? []).map((tool) => tool.name);
  const missing = REQUIRED_TOOLS.filter((name) => !toolNames.includes(name));
  if (missing.length) {
    throw new Error(`Missing MCP tools: ${missing.join(", ")}`);
  }

  console.log(`OK tools/list: ${toolNames.length} tools`);

  if (process.env.AI_CONNECTOR_AUTH_TOKEN && process.env.AI_CONNECTOR_PROJECT_ID) {
    const projectId = process.env.AI_CONNECTOR_PROJECT_ID;
    const summary = await callJsonTool("get_project_summary", { projectId });
    console.log(`OK get_project_summary: project=${summary.project?.id ?? "unknown"}`);

    const tasks = await callJsonTool("list_project_tasks", { projectId, maxTasks: 3 });
    console.log(`OK list_project_tasks: ${tasks.tasks?.length ?? 0} tasks`);

    const calendar = await callJsonTool("list_project_calendar", { projectId });
    console.log(`OK list_project_calendar: ${calendar.calendarEvents?.length ?? 0} events`);

    const reminders = await callJsonTool("list_project_reminders", { projectId });
    console.log(`OK list_project_reminders: ${reminders.reminders?.length ?? 0} reminders`);

    const inbox = await callJsonTool("list_project_inbox", { projectId });
    console.log(`OK list_project_inbox: ${inbox.inboxItems?.length ?? 0} items`);

    const workspace = await callJsonTool("list_project_workspace", { projectId, maxBlocks: 3 });
    console.log(`OK list_project_workspace: ${workspace.nodes?.length ?? 0} nodes`);

    const search = await callJsonTool("search_project_context", { projectId, query: "page", maxResults: 3 });
    console.log(`OK search_project_context: ${search.results?.length ?? 0} results`);

    const context = await callJsonTool("get_project_context", {
      projectId,
      includeTasks: true,
      includeWorkspace: false,
      includeCalendar: false,
      includeReminders: false,
      includeInbox: false,
      includeResponsibility: false,
      includeActivity: false,
      maxTasks: 2,
      maxBlocks: 1,
    });
    console.log(`OK get_project_context: scope=${context.scope ?? "unknown"}`);

    const changes = await callJsonTool("get_project_changes", {
      projectId,
      since: new Date(Date.now() - 24 * 3600000).toISOString(),
      maxTasks: 2,
      maxBlocks: 1,
    });
    console.log(`OK get_project_changes: changed=${Object.values(changes.summaryDiff ?? {}).reduce((sum, value) => sum + Number(value || 0), 0)}`);
  } else {
    console.log("SKIP real API tool calls: set AI_CONNECTOR_AUTH_TOKEN and AI_CONNECTOR_PROJECT_ID to test project access");
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  if (stderr.length) console.error(stderr.join("").trim());
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}

function rpc(method, params) {
  const id = nextId;
  nextId += 1;
  const payload = { jsonrpc: "2.0", id, method, params };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 8000);

    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

async function callJsonTool(name, args) {
  const result = await rpc("tools/call", {
    name,
    arguments: args,
  });
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`Tool ${name} returned no text content`);
  return JSON.parse(text);
}

function rejectAll(error) {
  for (const [id, waiter] of pending.entries()) {
    pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}
