const EXPORT_FORMATS = new Set(["markdown", "json", "html", "pdf", "excel", "backup"]);
const EXPORT_SCOPES = new Set(["project", "branch", "page", "kanban"]);

export function normalizeExportOptions(input = {}) {
  const requestedFormat = String(input.format || "").toLowerCase();
  const requestedScope = String(input.scope || "").toLowerCase();
  return {
    format: EXPORT_FORMATS.has(requestedFormat) ? requestedFormat : "markdown",
    scope: EXPORT_SCOPES.has(requestedScope) ? requestedScope : "project",
    targetId: input.targetId ? String(input.targetId) : "",
  };
}

export function validateExportTarget(db, project, options) {
  if (options.scope === "project") return "";
  if (!options.targetId) return "Не выбран объект для экспорта";

  const nodes = getProjectNodes(db, project.id, true);
  const target = nodes.find((node) => String(node.id) === String(options.targetId));
  if (!target) return "Объект экспорта не найден";
  if (options.scope === "kanban" && target.type !== "kanban") return "Выбранная страница не является Kanban-доской";
  if (options.scope === "branch" && target.type !== "folder") return "Для ветви нужно выбрать папку";
  if (options.scope === "page" && target.type !== "page") return "Для страницы нужно выбрать обычную страницу";
  return "";
}

export function createProjectExportFile(db, project, inputOptions = {}) {
  const options = normalizeExportOptions(inputOptions);
  const payload = buildProjectExportPayload(db, project, options);
  const baseName = safeFileName(`${project.title || "project"}-${options.scope}-${dateStamp()}`);

  if (options.format === "json") {
    return {
      fileName: `${baseName}.json`,
      mimeType: "application/json; charset=utf-8",
      content: JSON.stringify(payload, null, 2),
    };
  }

  if (options.format === "backup") {
    return {
      fileName: `${baseName}-backup.json`,
      mimeType: "application/json; charset=utf-8",
      content: JSON.stringify({ ...payload, exportKind: "backup", restoreHint: "Project-level backup" }, null, 2),
    };
  }

  if (options.format === "html" || options.format === "pdf") {
    return {
      fileName: options.format === "pdf" ? `${baseName}-print.html` : `${baseName}.html`,
      mimeType: "text/html; charset=utf-8",
      content: renderHtml(payload, { printable: options.format === "pdf" }),
    };
  }

  if (options.format === "excel") {
    return {
      fileName: `${baseName}.csv`,
      mimeType: "text/csv; charset=utf-8",
      content: renderCsv(payload),
    };
  }

  return {
    fileName: `${baseName}.md`,
    mimeType: "text/markdown; charset=utf-8",
    content: renderMarkdown(payload),
  };
}

export function contentDisposition(fileName) {
  const fallback = String(fileName).replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function buildProjectExportPayload(db, project, options) {
  const projectId = String(project.id);
  const includeDeleted = options.format === "backup";
  const nodes = getProjectNodes(db, projectId, includeDeleted);
  const scopedNodeIds = getScopedNodeIds(nodes, options);
  const scopedNodes = scopedNodeIds ? nodes.filter((node) => scopedNodeIds.has(String(node.id))) : nodes;
  const pageIds = new Set(scopedNodes.map((node) => String(node.id)));
  const blocks = getProjectBlocks(db, projectId, includeDeleted).filter((block) => pageIds.has(String(block.pageId)));
  const columns = getProjectColumns(db, projectId, includeDeleted).filter((column) =>
    includeBoardScopedItem(column, scopedNodeIds, options.scope),
  );
  const tasks = getProjectTasks(db, projectId, includeDeleted).filter((task) =>
    includeBoardScopedItem(task, scopedNodeIds, options.scope),
  );
  const taskIds = new Set(tasks.map((task) => String(task.id)));

  return {
    schemaVersion: 1,
    exportKind: options.format === "backup" ? "backup" : "export",
    exportedAt: new Date().toISOString(),
    scope: options.scope,
    targetId: options.targetId || null,
    project: exportProject(project, db),
    pages: scopedNodes.sort(byOrderThenTitle),
    blocks: blocks.sort(byOrderThenCreatedAt),
    kanban: {
      columns: columns.sort(byOrderThenTitle),
      tasks: tasks.sort(byOrderThenCreatedAt),
      subtasks: (db.subtasks || []).filter((subtask) => taskIds.has(String(subtask.taskId))).sort(byOrderThenCreatedAt),
    },
    tables: blocks.filter((block) => block.type === "simple_table").map((block) => tableExport(block, scopedNodes)),
    calendarEvents: (db.calendarEvents || [])
      .filter((event) => String(event.projectId) === projectId)
      .filter((event) => includeEvent(event, scopedNodeIds, options.scope))
      .sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || ""))),
    reminders: (db.reminders || [])
      .filter((reminder) => String(reminder.projectId) === projectId)
      .filter((reminder) => includeEvent(reminder, scopedNodeIds, options.scope))
      .sort((a, b) => String(a.nextRunAt || a.createdAt || "").localeCompare(String(b.nextRunAt || b.createdAt || ""))),
    activity: (db.activity || [])
      .filter((event) => String(event.projectId) === projectId)
      .slice(-500),
  };
}

function exportProject(project, db) {
  const {
    inviteCode: _inviteCode,
    botSettings: _botSettings,
    joinRequests: _joinRequests,
    ...safeProject
  } = project;
  return {
    ...safeProject,
    members: (project.members || []).map((member) => {
      const { adminNotes: _adminNotes, ...safeMember } = member;
      return {
        ...safeMember,
        user: publicUser((db.users || []).find((user) => String(user.id) === String(member.userId))),
      };
    }),
  };
}

function getProjectNodes(db, projectId, includeDeleted) {
  const space = db.spaces?.[String(projectId)] || { nodes: [] };
  return (space.nodes || [])
    .filter((node) => String(node.projectId) === String(projectId))
    .filter((node) => includeDeleted || !node.deletedAt);
}

function getProjectBlocks(db, projectId, includeDeleted) {
  const space = db.spaces?.[String(projectId)] || { blocks: [] };
  const byId = new Map();
  for (const block of [...(db.blocks || []), ...(space.blocks || [])]) {
    byId.set(String(block.id), block);
  }
  return [...byId.values()]
    .filter((block) => includeDeleted || !block.deletedAt)
    .filter((block) => !block.projectId || String(block.projectId) === String(projectId));
}

function getProjectColumns(db, projectId, includeDeleted) {
  return (db.columns || [])
    .filter((column) => String(column.projectId || "1") === String(projectId))
    .filter((column) => includeDeleted || !column.deletedAt);
}

function getProjectTasks(db, projectId, includeDeleted) {
  return (db.tasks || [])
    .filter((task) => String(task.projectId || "1") === String(projectId))
    .filter((task) => includeDeleted || !task.deletedAt);
}

function getScopedNodeIds(nodes, options) {
  if (options.scope === "project") return null;
  if (!options.targetId) return new Set();
  if (options.scope === "branch") {
    const ids = new Set([String(options.targetId)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (node.parentId && ids.has(String(node.parentId)) && !ids.has(String(node.id))) {
          ids.add(String(node.id));
          changed = true;
        }
      }
    }
    return ids;
  }
  return new Set([String(options.targetId)]);
}

function includeBoardScopedItem(item, scopedNodeIds, scope) {
  if (!scopedNodeIds) return true;
  const pageId = item.pageId || item.boardId;
  if (!pageId) return scope === "project";
  return scopedNodeIds.has(String(pageId));
}

function includeEvent(event, scopedNodeIds, scope) {
  if (!scopedNodeIds) return true;
  const pageId = event.pageId || event.sourcePageId || event.targetPageId;
  if (!pageId) return scope === "project";
  return scopedNodeIds.has(String(pageId));
}

function tableExport(block, nodes) {
  const page = nodes.find((node) => String(node.id) === String(block.pageId));
  return {
    id: block.id,
    pageId: block.pageId,
    pageTitle: page?.title || "Страница",
    ...normalizeTable(block.content),
  };
}

function renderMarkdown(payload) {
  const lines = [`# ${payload.project.title || "Проект"}`, "", `Экспорт: ${formatDateTime(payload.exportedAt)}`, ""];

  if (payload.pages.length) {
    lines.push("## Страницы", "");
    for (const node of sortTree(payload.pages)) {
      const prefix = "  ".repeat(node.level);
      lines.push(`${prefix}- ${node.icon || nodeIcon(node.type)} ${node.title || "Без названия"} (${node.type})`);
    }
    lines.push("");
  }

  for (const node of payload.pages.filter((item) => item.type === "page")) {
    const blocks = payload.blocks.filter((block) => String(block.pageId) === String(node.id));
    if (!blocks.length) continue;
    lines.push(`## ${node.icon || "📄"} ${node.title || "Страница"}`, "");
    for (const block of blocks) lines.push(...renderBlockMarkdown(block), "");
  }

  const kanbanText = renderKanbanMarkdown(payload);
  if (kanbanText.length) lines.push("## Kanban", "", ...kanbanText, "");

  const events = payload.calendarEvents || [];
  if (events.length) {
    lines.push("## Календарь", "");
    for (const event of events) {
      lines.push(`- ${event.title || "Событие"} · ${formatDateTime(event.startAt)}${event.category ? ` · ${event.category}` : ""}`);
      if (event.description) lines.push(`  ${event.description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderBlockMarkdown(block) {
  const text = blockText(block.content);
  switch (block.type) {
    case "heading_1":
      return [`# ${text}`];
    case "heading_2":
      return [`## ${text}`];
    case "heading_3":
      return [`### ${text}`];
    case "todo":
      return [`- [${block.content?.checked ? "x" : " "}] ${text}`];
    case "bulleted_list":
      return [`- ${text}`];
    case "numbered_list":
      return [`1. ${text}`];
    case "code":
      return ["```", text, "```"];
    case "link_to_page":
      return [`[${block.content?.displayText || "Ссылка"}](page:${block.content?.targetPageId || ""})`];
    case "kanban_embed":
      return [`[Kanban: ${block.content?.boardPageId || block.content?.pageId || ""}]`];
    case "simple_table":
      return renderTableMarkdown(block.content);
    default:
      return [text];
  }
}

function renderTableMarkdown(content) {
  const table = normalizeTable(content);
  const headers = table.columns.map((column) => column.title || "Столбец");
  const rows = table.rows.map((row) => headers.map((_, index) => cellText(row[index])));
  if (!headers.length) return ["[Пустая таблица]"];
  return [
    `| ${headers.map(markdownCell).join(" |")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" |")} |`),
  ];
}

function renderKanbanMarkdown(payload) {
  const lines = [];
  const pageById = new Map(payload.pages.map((node) => [String(node.id), node]));
  const boards = groupBy(payload.kanban.columns, (column) => String(column.pageId || "board"));
  const subtasksByTask = groupBy(payload.kanban.subtasks, (subtask) => String(subtask.taskId));

  for (const [boardId, columns] of boards) {
    const boardTitle = pageById.get(boardId)?.title || "Kanban-доска";
    lines.push(`### ${boardTitle}`, "");
    for (const column of columns.sort(byOrderThenTitle)) {
      lines.push(`#### ${column.title || column.name || "Колонка"}`);
      const tasks = payload.kanban.tasks.filter((task) => String(task.columnId) === String(column.id));
      if (!tasks.length) {
        lines.push("- Нет задач");
        continue;
      }
      for (const task of tasks) {
        const details = [task.assigneeName || task.assignee || "", task.deadline ? formatDateTime(task.deadline) : ""]
          .filter(Boolean)
          .join(" · ");
        lines.push(`- ${task.title || "Без названия"}${details ? ` (${details})` : ""}`);
        if (task.description) lines.push(`  ${task.description}`);
        for (const subtask of subtasksByTask.get(String(task.id)) || []) {
          lines.push(`  - [${subtask.done || subtask.completed ? "x" : " "}] ${subtask.title || subtask.text || ""}`);
        }
      }
      lines.push("");
    }
  }

  return lines;
}

function renderHtml(payload, { printable = false } = {}) {
  const markdown = renderMarkdown(payload);
  const body = markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith("#### ")) return `<h4>${escapeHtml(line.slice(5))}</h4>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (line.startsWith("| ")) return `<pre>${escapeHtml(line)}</pre>`;
      if (!line.trim()) return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.project.title || "Экспорт проекта")}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; margin: 32px; color: #111827; line-height: 1.5; }
    h1, h2, h3, h4 { margin: 24px 0 10px; }
    p, li, pre { font-size: 14px; }
    pre { white-space: pre-wrap; background: #f3f4f6; padding: 10px; border-radius: 8px; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
${body}
${printable ? "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>" : ""}
</body>
</html>`;
}

function renderCsv(payload) {
  const rows = [["Проект", payload.project.title || "Проект"], ["Экспорт", formatDateTime(payload.exportedAt)], []];
  const tables = payload.tables || [];

  if (tables.length) {
    for (const table of tables) {
      rows.push([`Таблица: ${table.pageTitle}`]);
      rows.push(table.columns.map((column) => column.title || "Столбец"));
      for (const row of table.rows) rows.push(table.columns.map((_, index) => cellText(row[index])));
      rows.push([]);
    }
  } else {
    rows.push(["Задача", "Описание", "Колонка", "Исполнитель", "Дедлайн", "Архив"]);
    const columnById = new Map(payload.kanban.columns.map((column) => [String(column.id), column.title || column.name || "Колонка"]));
    for (const task of payload.kanban.tasks || []) {
      rows.push([
        task.title || "",
        task.description || "",
        columnById.get(String(task.columnId)) || "",
        task.assigneeName || task.assignee || "",
        task.deadline ? formatDateTime(task.deadline) : "",
        task.archivedAt ? "да" : "нет",
      ]);
    }
  }

  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

function normalizeTable(content = {}) {
  const rawColumns = Array.isArray(content.columns) ? content.columns : [];
  const rawRows = Array.isArray(content.rows) ? content.rows : [];
  const columns = rawColumns.length
    ? rawColumns.map((column, index) => ({
        id: column.id || `column_${index + 1}`,
        title: column.title || column.name || `Столбец ${index + 1}`,
        type: column.type || "text",
      }))
    : (rawRows[0] || []).map((value, index) => ({
        id: `column_${index + 1}`,
        title: cellText(value) || `Столбец ${index + 1}`,
        type: "text",
      }));
  const rows = rawColumns.length ? rawRows : rawRows.slice(1);
  return { columns, rows };
}

function blockText(content) {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  return content.text || content.title || content.displayText || content.url || "";
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(", ");
  if (typeof value === "object") return value.label || value.text || value.title || value.name || value.value || "";
  return String(value);
}

function markdownCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items || []) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return map;
}

function sortTree(nodes) {
  const byParent = groupBy(nodes, (node) => String(node.parentId || "root"));
  const result = [];
  const walk = (parentId, level) => {
    for (const node of (byParent.get(parentId) || []).sort(byOrderThenTitle)) {
      result.push({ ...node, level });
      walk(String(node.id), level + 1);
    }
  };
  walk("root", 0);
  return result;
}

function byOrderThenTitle(a, b) {
  return Number(a.order || 0) - Number(b.order || 0) || String(a.title || a.name || "").localeCompare(String(b.title || b.name || ""));
}

function byOrderThenCreatedAt(a, b) {
  return Number(a.order || 0) - Number(b.order || 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function nodeIcon(type) {
  if (type === "folder") return "📁";
  if (type === "kanban") return "📋";
  return "📄";
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeFileName(value) {
  const safe = String(value || "export")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
  return safe || "export";
}
