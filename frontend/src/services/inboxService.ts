import { activityApi } from '../api/activity';
import { readDb } from '../api/mockDb';
import { usePageStore } from '../store/pageStore';
import type { Project } from '../types';

const READ_KEY = 'workspace-inbox-read-at-v1';
const CURRENT_USER_ID = 1;

export function markInboxRead(projectId: number) {
  const readMap = readInboxMap();
  readMap[String(projectId)] = new Date().toISOString();
  localStorage.setItem(READ_KEY, JSON.stringify(readMap));
  window.dispatchEvent(new CustomEvent('workspace-inbox-read', { detail: { projectId } }));
}

export function getInboxReadAt(projectId: number) {
  return new Date(readInboxMap()[String(projectId)] ?? 0).getTime();
}

export function getInboxUnreadSummary(projectId: number, project?: Project | null) {
  const readAt = getInboxReadAt(projectId);
  const now = Date.now();
  const db = readDb();
  const pageState = usePageStore.getState();
  const events = activityApi.list(projectId);
  const activeTasks = db.tasks.filter((task) => task.projectId === projectId && !task.isArchived);
  const me = project?.members?.find((member) => member.userId === CURRENT_USER_ID);
  const mentionKeys = [me?.user?.username, me?.user?.firstName]
    .filter(Boolean)
    .map((value) => `@${String(value).toLowerCase()}`);

  const unreadAssignedTasks = activeTasks.filter((task) => {
    if (!isAssignedToCurrentUser(task)) return false;
    const assignedEvent = events.find(
      (event) => event.type === 'task_assign' && event.entityId === String(task.id),
    );
    const notificationTime = Math.max(
      new Date(task.createdAt).getTime(),
      assignedEvent ? new Date(assignedEvent.createdAt).getTime() : 0,
    );
    return notificationTime > readAt;
  });
  const unreadTaskMentions = mentionKeys.length
    ? activeTasks.filter((task) => {
        const updatedAt = new Date(task.updatedAt ?? task.createdAt).getTime();
        if (updatedAt <= readAt) return false;
        const subtasksText = db.subtasks.filter((subtask) => subtask.taskId === task.id).map((subtask) => subtask.title).join(' ');
        const text = `${task.title} ${task.description ?? ''} ${subtasksText}`.toLowerCase();
        return mentionKeys.some((mention) => text.includes(mention));
      })
    : [];
  const unreadPageMentions = mentionKeys.length
    ? pageState.blocks.filter((block) => {
        const node = pageState.nodes.find((item) => item.id === block.pageId);
        if (!node || node.projectId !== String(projectId) || node.isDeleted) return false;
        if (new Date(block.updatedAt).getTime() <= readAt) return false;
        const text = blockToSearchText(block.content).toLowerCase();
        return mentionKeys.some((mention) => text.includes(mention));
      })
    : [];
  const unreadDeadlineTasks = activeTasks.filter((task) => {
    if (!isAssignedToCurrentUser(task)) return false;
    if (isTaskInFinalColumn(task, db.columns)) return false;
    if (!task.deadlineAt) return false;
    const deadlineTime = new Date(task.deadlineAt).getTime();
    const diffHours = (deadlineTime - now) / 3600000;
    if (diffHours < 0 || diffHours > 72) return false;
    const notificationTime = Math.max(new Date(task.createdAt).getTime(), deadlineTime - 72 * 3600000);
    return notificationTime > readAt;
  });
  const unreadJoinRequests = events.filter((event) => {
    if (new Date(event.createdAt).getTime() <= readAt) return false;
    return event.context === 'Доступ по коду' || event.title.toLowerCase().includes('заявка');
  });

  const count =
    unreadAssignedTasks.length +
    unreadTaskMentions.length +
    unreadPageMentions.length +
    unreadDeadlineTasks.length +
    unreadJoinRequests.length;

  return {
    count,
    hasUnread: count > 0,
  };
}

function isAssignedToCurrentUser(task: { assigneeId?: number; assignee?: { id?: number } }) {
  return task.assigneeId === CURRENT_USER_ID || task.assignee?.id === CURRENT_USER_ID;
}

function isTaskInFinalColumn(
  task: { columnId: number; pageId?: string },
  columns: Array<{ id: number; projectId: number; pageId?: string; position: number; isHidden: boolean }>,
) {
  const boardColumns = columns
    .filter((column) => column.projectId === columns.find((item) => item.id === task.columnId)?.projectId)
    .filter((column) => sameBoard(column.pageId, task.pageId) && !column.isHidden)
    .sort((a, b) => a.position - b.position);
  const finalColumn = boardColumns[boardColumns.length - 1];
  return Boolean(finalColumn && task.columnId === finalColumn.id);
}

function sameBoard(itemPageId: string | undefined, pageId: string | undefined) {
  return pageId ? itemPageId === pageId : !itemPageId;
}

function readInboxMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function blockToSearchText(content: any) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.title === 'string') return content.title;
  if (Array.isArray(content.rows)) return content.rows.flat().join(' ');
  return '';
}
