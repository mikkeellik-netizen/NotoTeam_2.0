import { activityApi } from '../api/activity';
import { readDb } from '../api/mockDb';
import { tasksApi } from '../api/tasks';
import { usePageStore } from '../store/pageStore';
import type { ActivityEvent, Block, PageNode, Project, ProjectMember, Subtask, Task, Column } from '../types';

export type ExportFormat = 'markdown' | 'json' | 'pdf' | 'html';
export type ExportScope = 'project' | 'branch' | 'page' | 'kanban';

export type ExportResult = {
  fileName: string;
  content: string;
  mimeType: string;
};

export interface ProjectExportPayload {
  schemaVersion: number;
  exportedAt: string;
  project: Project;
  members: ProjectMember[];
  pages: PageNode[];
  blocks: Block[];
  columns: Column[];
  tasks: Task[];
  subtasks: Subtask[];
  activity: ActivityEvent[];
  settings: {
    archiveCleanupMode: string;
    activityRetentionDays: number;
  };
}

export function getProjectExportTargets(project: Project) {
  usePageStore.getState().loadProjectSpace(String(project.id), project.title);
  const pageState = usePageStore.getState();
  const nodes = pageState.nodes.filter((node) => node.projectId === String(project.id) && !node.isDeleted);

  return {
    branches: nodes.filter((node) => node.type === 'folder'),
    pages: nodes.filter((node) => node.type === 'page'),
    kanbanPages: nodes.filter((node) => node.type === 'kanban'),
  };
}

export function createProjectExport(
  project: Project,
  options: { format: ExportFormat; scope?: ExportScope; targetId?: string },
): ExportResult {
  const payload = buildProjectExportPayload(project, {
    scope: options.scope,
    targetId: options.targetId,
  });
  const baseName = `${safeFileName(project.title)}-export`;

  if (options.format === 'json') {
    return {
      fileName: `${baseName}.json`,
      content: JSON.stringify(payload, null, 2),
      mimeType: 'application/json;charset=utf-8',
    };
  }

  if (options.format === 'html') {
    return {
      fileName: `${baseName}.html`,
      content: renderProjectHtml(payload),
      mimeType: 'text/html;charset=utf-8',
    };
  }

  if (options.format === 'pdf') {
    return {
      fileName: `${baseName}.html`,
      content: renderProjectHtml(payload, true),
      mimeType: 'text/html;charset=utf-8',
    };
  }

  return {
    fileName: `${baseName}.md`,
    content: renderProjectMarkdown(payload),
    mimeType: 'text/markdown;charset=utf-8',
  };
}

export function downloadExportResult(result: ExportResult) {
  downloadFile(result.fileName, result.content, result.mimeType);
}

export function openPrintableExport(result: ExportResult, pdfFileName: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    downloadExportResult(result);
    return;
  }
  printWindow.document.open();
  printWindow.document.write(result.content);
  printWindow.document.close();
  printWindow.document.title = pdfFileName;
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

export function exportLabel(format: ExportFormat) {
  if (format === 'json') return 'JSON';
  if (format === 'pdf') return 'PDF';
  if (format === 'html') return 'HTML';
  return 'Markdown';
}

function buildProjectExportPayload(project: Project, options?: { scope?: ExportScope; targetId?: string }): ProjectExportPayload {
  usePageStore.getState().loadProjectSpace(String(project.id), project.title);
  const pageState = usePageStore.getState();
  const db = readDb();
  const allPages = pageState.nodes.filter((node) => node.projectId === String(project.id));
  const scopedPageIds = getScopedPageIds(allPages, options);
  const pages = scopedPageIds ? allPages.filter((node) => scopedPageIds.has(node.id)) : allPages;
  const pageIds = new Set(pages.map((node) => node.id));
  const tasks = db.tasks.filter((task) => {
    if (task.projectId !== project.id) return false;
    if (!scopedPageIds) return true;
    return task.pageId ? scopedPageIds.has(task.pageId) : options?.scope === 'project';
  });
  const taskIds = new Set(tasks.map((task) => task.id));

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    project,
    members: project.members ?? [],
    pages,
    blocks: pageState.blocks.filter((block) => pageIds.has(block.pageId)),
    columns: db.columns.filter((column) => {
      if (column.projectId !== project.id) return false;
      if (!scopedPageIds) return true;
      return column.pageId ? scopedPageIds.has(column.pageId) : options?.scope === 'project';
    }),
    tasks,
    subtasks: db.subtasks.filter((subtask) => taskIds.has(subtask.taskId)),
    activity: activityApi.list(project.id),
    settings: {
      archiveCleanupMode: tasksApi.getArchiveCleanupMode(),
      activityRetentionDays: activityApi.getRetentionDays(project.id),
    },
  };
}

function getScopedPageIds(
  pages: Array<{ id: string; parentId: string | null }>,
  options?: { scope?: ExportScope; targetId?: string },
) {
  if (!options?.scope || options.scope === 'project' || !options.targetId) return null;
  const ids = new Set<string>([options.targetId]);

  if (options.scope === 'branch') {
    let changed = true;
    while (changed) {
      changed = false;
      for (const page of pages) {
        if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) {
          ids.add(page.id);
          changed = true;
        }
      }
    }
  }

  return ids;
}

function renderProjectMarkdown(payload: ProjectExportPayload) {
  const lines = [
    `# ${payload.project.title}`,
    '',
    payload.project.description ? payload.project.description : '',
    '',
    `Экспорт: ${new Date(payload.exportedAt).toLocaleString('ru-RU')}`,
    '',
    '## Участники',
    ...payload.members.map((member) => `- ${memberName(member)} (${member.role?.name ?? 'viewer'})`),
    '',
    '## Страницы',
  ];

  for (const page of payload.pages) {
    lines.push('', `${'#'.repeat(page.parentId ? 3 : 2)} ${page.icon} ${page.title}`, `Тип: ${page.type}`);
    const blocks = payload.blocks.filter((block) => block.pageId === page.id).sort((a, b) => a.order - b.order);
    for (const block of blocks) lines.push(renderBlockMarkdown(block));
  }

  lines.push('', '## Kanban');
  for (const column of [...payload.columns].sort((a, b) => a.position - b.position)) {
    const tasks = payload.tasks.filter((task) => task.columnId === column.id);
    lines.push('', `### ${column.title}`);
    if (tasks.length === 0) lines.push('- Нет задач');
    for (const task of tasks) {
      lines.push(`- ${task.title}${task.isArchived ? ' (архив)' : ''}`);
      if (task.description) lines.push(`  - ${task.description}`);
      for (const subtask of payload.subtasks.filter((item) => item.taskId === task.id)) {
        lines.push(`  - [${subtask.isCompleted ? 'x' : ' '}] ${subtask.title}`);
      }
    }
  }

  lines.push('', '## История');
  for (const event of payload.activity.slice(0, 100)) {
    lines.push(`- ${new Date(event.createdAt).toLocaleString('ru-RU')} · ${event.userName}: ${event.title}`);
  }

  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

function renderProjectHtml(payload: ProjectExportPayload, printable = false) {
  const markdown = renderProjectMarkdown(payload);
  const htmlBody = markdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith('### ')) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith('- ')) return `<p class="item">${escapeHtml(line)}</p>`;
      if (line.trim() === '') return '<div class="gap"></div>';
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.project.title)} · export</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; margin: 32px; color: #111827; line-height: 1.45; }
    h1, h2, h3 { margin: 22px 0 10px; }
    h1 { font-size: 30px; }
    h2 { font-size: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 17px; }
    p { margin: 6px 0; white-space: pre-wrap; }
    .item { margin-left: 14px; }
    .gap { height: 8px; }
    ${printable ? '@media print { body { margin: 18mm; } }' : ''}
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;
}

function renderBlockMarkdown(block: Block) {
  const content = block.content;
  const text = typeof content === 'string' ? content : content?.text ?? content?.title ?? '';
  if (block.type === 'heading_1') return `# ${text}`;
  if (block.type === 'heading_2') return `## ${text}`;
  if (block.type === 'heading_3') return `### ${text}`;
  if (block.type === 'todo') return `- [${content?.checked ? 'x' : ' '}] ${text}`;
  if (block.type === 'bulleted_list') return `- ${text}`;
  if (block.type === 'numbered_list') return `1. ${text}`;
  if (block.type === 'code') return `\`\`\`\n${text}\n\`\`\``;
  if (block.type === 'link_to_page') return `[[${content?.displayText ?? content?.targetPageId ?? 'Link to page'}]]`;
  if (block.type === 'kanban_embed') return '[Kanban embed]';
  if (block.type === 'simple_table') return '[Table]';
  return text || '';
}

function downloadFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string) {
  const fallback = 'project';
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return safe || fallback;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function memberName(member: ProjectMember) {
  return member.user?.firstName ?? member.user?.username ?? `ID ${member.userId}`;
}
