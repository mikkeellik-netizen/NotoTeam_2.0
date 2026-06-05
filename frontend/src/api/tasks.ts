import type { Priority, Subtask, Task } from '../types';
import { activityApi } from './activity';
import { apiRequest, normalizeArray, normalizeNumberId, useWorkspaceBackend } from './httpClient';
import { hydrateTask, nextId, readDb, refreshProjectCounts, writeDb } from './mockDb';

export type ArchiveCleanupMode = 'never' | '2weeks' | '1month' | '3months';

const ARCHIVE_CLEANUP_KEY = 'kanban-archive-cleanup-mode-v1';

export const tasksApi = {
  async getByProject(projectId: number, pageId?: string): Promise<Task[]> {
    if (useWorkspaceBackend) {
      const query = pageId ? `?pageId=${encodeURIComponent(pageId)}` : '';
      return normalizeArray(await apiRequest<Task[]>(`/projects/${projectId}/tasks${query}`));
    }
    const db = readDb();
    purgeExpiredArchivedTasks(db);
    return db.tasks
      .filter((task) => task.projectId === projectId && sameBoard(task.pageId, pageId) && !task.isArchived)
      .sort((a, b) => a.position - b.position)
      .map((task) => hydrateTask(db, task));
  },

  async getAllProjectTasks(projectId: number): Promise<Task[]> {
    if (useWorkspaceBackend) {
      return normalizeArray(await apiRequest<Task[]>(`/projects/${projectId}/tasks?allBoards=1`));
    }
    const db = readDb();
    purgeExpiredArchivedTasks(db);
    return db.tasks
      .filter((task) => task.projectId === projectId && !task.isArchived)
      .sort((a, b) => a.position - b.position)
      .map((task) => hydrateTask(db, task));
  },

  async getArchived(projectId: number, pageId?: string): Promise<Task[]> {
    if (useWorkspaceBackend) {
      const pageQuery = pageId ? `&pageId=${encodeURIComponent(pageId)}` : '';
      return normalizeArray(await apiRequest<Task[]>(`/projects/${projectId}/tasks?archived=1${pageQuery}`));
    }
    const db = readDb();
    purgeExpiredArchivedTasks(db);
    writeDb(db);
    return db.tasks
      .filter((task) => task.projectId === projectId && sameBoard(task.pageId, pageId) && task.isArchived)
      .sort((a, b) => new Date(b.archivedAt ?? b.createdAt).getTime() - new Date(a.archivedAt ?? a.createdAt).getTime())
      .map((task) => hydrateTask(db, task));
  },

  async clearArchive(projectId: number): Promise<{ success: true }> {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/projects/${projectId}/archive`, { method: 'DELETE' });
    }
    const db = readDb();
    const archivedIds = new Set(
      db.tasks
        .filter((task) => task.projectId === projectId && task.isArchived)
        .map((task) => task.id),
    );
    db.tasks = db.tasks.filter((task) => !archivedIds.has(task.id));
    db.subtasks = db.subtasks.filter((subtask) => !archivedIds.has(subtask.taskId));
    refreshProjectCounts(db);
    writeDb(db);
    return { success: true };
  },

  getArchiveCleanupMode(): ArchiveCleanupMode {
    return (localStorage.getItem(ARCHIVE_CLEANUP_KEY) as ArchiveCleanupMode | null) ?? 'never';
  },

  setArchiveCleanupMode(mode: ArchiveCleanupMode) {
    localStorage.setItem(ARCHIVE_CLEANUP_KEY, mode);
  },

  async getOne(taskId: number): Promise<Task> {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Task>(`/tasks/${taskId}`));
    }
    const db = readDb();
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('Task not found');
    return hydrateTask(db, task);
  },

  async create(projectId: number, data: Partial<Task>): Promise<Task> {
    if (useWorkspaceBackend) {
      const task = normalizeNumberId(await apiRequest<Task>('/tasks', {
        method: 'POST',
        body: { ...data, projectId, creatorId: 1 },
      }));
      activityApi.log({
        projectId,
        type: 'task_create',
        title: `Создал задачу «${task.title}»`,
        entityType: 'task',
        entityId: String(task.id),
        context: 'Kanban',
      });
      return task;
    }
    const db = readDb();
    const columnId = data.columnId ?? db.columns.find((column) => column.projectId === projectId && sameBoard(column.pageId, data.pageId) && column.isDefault)?.id;
    if (!columnId) throw new Error('Column not found');
    const siblings = db.tasks.filter((task) => task.columnId === columnId && !task.isArchived);
    const task: Task = {
      id: nextId(db.tasks),
      projectId,
      pageId: data.pageId,
      columnId,
      title: data.title || 'Новая задача',
      description: data.description,
      priority: (data.priority as Priority) ?? 'MEDIUM',
      deadlineAt: data.deadlineAt,
      scheduledAt: data.scheduledAt,
      assigneeId: data.assigneeId ?? data.assignee?.id,
      colorLabel: data.colorLabel,
      isRepeating: false,
      position: siblings.length,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignee: data.assignee,
      subtasks: [],
      tags: [],
    };
    db.tasks.push(task);
    refreshProjectCounts(db);
    writeDb(db);
    activityApi.log({
      projectId,
      type: 'task_create',
      title: `Создал задачу «${task.title}»`,
      details: task.assignee ? `Исполнитель: ${task.assignee.firstName ?? task.assignee.username}` : 'Без исполнителя',
      entityType: 'task',
      entityId: String(task.id),
      context: 'Kanban',
    });
    return hydrateTask(db, task);
  },

  async update(id: number, data: Partial<Task>): Promise<Task> {
    if (useWorkspaceBackend) {
      const updated = normalizeNumberId(await apiRequest<Task>(`/tasks/${id}`, { method: 'PATCH', body: data }));
      activityApi.log({
        projectId: updated.projectId,
        type: data.assigneeId !== undefined ? 'task_assign' : 'task_update',
        title: `Изменил задачу «${updated.title}»`,
        entityType: 'task',
        entityId: String(updated.id),
        context: 'Карточка задачи',
      });
      return updated;
    }
    const db = readDb();
    const previous = db.tasks.find((task) => task.id === id);
    db.tasks = db.tasks.map((task) => (task.id === id ? { ...task, ...data, updatedAt: new Date().toISOString() } : task));
    writeDb(db);
    const updated = db.tasks.find((task) => task.id === id);
    if (previous && updated) {
      const changes = getTaskChangeSummary(previous, updated);
      if (changes.length > 0) {
        activityApi.log({
          projectId: updated.projectId,
          type: changes.some((change) => change.startsWith('назначил')) ? 'task_assign' : 'task_update',
          title: `Изменил задачу «${updated.title}»`,
          details: changes.join('; '),
          entityType: 'task',
          entityId: String(updated.id),
          context: 'Карточка задачи',
        });
      }
    }
    return tasksApi.getOne(id);
  },

  async move(id: number, columnId: number, position = 0): Promise<Task> {
    if (useWorkspaceBackend) {
      const updated = normalizeNumberId(await apiRequest<Task>(`/tasks/${id}/move`, {
        method: 'POST',
        body: { columnId, position },
      }));
      activityApi.log({
        projectId: updated.projectId,
        type: 'task_move',
        title: `Переместил задачу «${updated.title}»`,
        entityType: 'task',
        entityId: String(updated.id),
        context: 'Kanban',
      });
      return updated;
    }
    const db = readDb();
    const previous = db.tasks.find((task) => task.id === id);
    const nextColumn = db.columns.find((column) => column.id === columnId);
    db.tasks = db.tasks.map((task) => (task.id === id ? { ...task, columnId, position, updatedAt: new Date().toISOString() } : task));
    normalizeColumnPositions(db, columnId);
    writeDb(db);
    const updated = db.tasks.find((task) => task.id === id);
    if (previous && updated && previous.columnId !== columnId) {
      activityApi.log({
        projectId: updated.projectId,
        type: 'task_move',
        title: `Переместил задачу «${updated.title}»`,
        details: `Колонка: ${nextColumn?.title ?? columnId}`,
        entityType: 'task',
        entityId: String(updated.id),
        context: 'Kanban',
      });
    }
    return tasksApi.getOne(id);
  },

  async reorder(columnId: number, orderedIds: number[]): Promise<{ success: true }> {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/columns/${columnId}/tasks/reorder`, {
        method: 'POST',
        body: { orderedIds },
      });
    }
    const db = readDb();
    db.tasks = db.tasks.map((task) => {
      const position = orderedIds.indexOf(task.id);
      return position !== -1 ? { ...task, columnId, position } : task;
    });
    writeDb(db);
    return { success: true };
  },

  async archive(id: number): Promise<Task> {
    if (useWorkspaceBackend) {
      const task = normalizeNumberId(await apiRequest<Task>(`/tasks/${id}/archive`, { method: 'POST' }));
      activityApi.log({
        projectId: task.projectId,
        type: 'task_complete',
        title: `Завершил задачу «${task.title}»`,
        entityType: 'task',
        entityId: String(task.id),
        context: 'Карточка задачи',
      });
      return task;
    }
    const db = readDb();
    const task = db.tasks.find((item) => item.id === id);
    db.tasks = db.tasks.map((task) =>
      task.id === id ? { ...task, isArchived: true, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Task : task,
    );
    refreshProjectCounts(db);
    writeDb(db);
    if (task) {
      activityApi.log({
        projectId: task.projectId,
        type: 'task_complete',
        title: `Завершил задачу «${task.title}»`,
        entityType: 'task',
        entityId: String(task.id),
        context: 'Карточка задачи',
      });
    }
    return tasksApi.getOne(id);
  },

  async remove(id: number): Promise<{ success: true }> {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/tasks/${id}`, { method: 'DELETE' });
    }
    const db = readDb();
    const task = db.tasks.find((item) => item.id === id);
    db.tasks = db.tasks.filter((task) => task.id !== id);
    db.subtasks = db.subtasks.filter((subtask) => subtask.taskId !== id);
    refreshProjectCounts(db);
    writeDb(db);
    if (task) {
      activityApi.log({
        projectId: task.projectId,
        type: 'task_delete',
        title: `Удалил задачу «${task.title}»`,
        entityType: 'task',
        entityId: String(task.id),
        context: 'Kanban',
      });
    }
    return { success: true };
  },

  async getMyTasks() {
    if (useWorkspaceBackend) {
      const active = normalizeArray(await apiRequest<Task[]>('/users/1/assigned-tasks'));
      const now = Date.now();
      const red: Task[] = [];
      const yellow: Task[] = [];
      const green: Task[] = [];
      const noDate: Task[] = [];
      for (const task of active) {
        if (!task.deadlineAt) noDate.push(task);
        else {
          const hours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
          if (hours < 12) red.push(task);
          else if (hours < 48) yellow.push(task);
          else green.push(task);
        }
      }
      return { red, yellow, green, noDate, stats: { completed: 0, total: active.length } };
    }
    const db = readDb();
    const active = db.tasks.filter((task) => !task.isArchived).map((task) => hydrateTask(db, task));
    const now = Date.now();
    const red: Task[] = [];
    const yellow: Task[] = [];
    const green: Task[] = [];
    const noDate: Task[] = [];

    for (const task of active) {
      if (!task.deadlineAt) {
        noDate.push(task);
        continue;
      }
      const hours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
      if (hours < 12) red.push(task);
      else if (hours < 48) yellow.push(task);
      else green.push(task);
    }

    return {
      red,
      yellow,
      green,
      noDate,
      stats: {
        completed: db.tasks.filter((task) => task.isArchived).length,
        total: db.tasks.length,
      },
    };
  },

  async createSubtask(taskId: number, title: string): Promise<Subtask> {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Subtask>(`/tasks/${taskId}/subtasks`, { method: 'POST', body: { title } }));
    }
    const db = readDb();
    const siblings = db.subtasks.filter((subtask) => subtask.taskId === taskId);
    const subtask: Subtask = {
      id: nextId(db.subtasks),
      taskId,
      title,
      isCompleted: false,
      position: siblings.length,
    };
    db.subtasks.push(subtask);
    writeDb(db);
    const task = db.tasks.find((item) => item.id === taskId);
    if (task) {
      activityApi.log({
        projectId: task.projectId,
        type: 'subtask_create',
        title: `Добавил подзадачу в «${task.title}»`,
        details: title,
        entityType: 'subtask',
        entityId: String(subtask.id),
        context: 'Карточка задачи',
      });
    }
    return subtask;
  },

  async toggleSubtask(taskId: number, subtaskId: number): Promise<{ subtask: Subtask; allCompleted: boolean }> {
    if (useWorkspaceBackend) {
      const result = await apiRequest<{ subtask: Subtask; allCompleted: boolean }>(`/tasks/${taskId}/subtasks/${subtaskId}/toggle`, { method: 'POST' });
      return { ...result, subtask: normalizeNumberId(result.subtask) };
    }
    const db = readDb();
    let updated: Subtask | null = null;
    db.subtasks = db.subtasks.map((subtask) => {
      if (subtask.id !== subtaskId) return subtask;
      updated = {
        ...subtask,
        isCompleted: !subtask.isCompleted,
        completedAt: !subtask.isCompleted ? new Date().toISOString() : undefined,
      };
      return updated;
    });
    if (!updated) throw new Error('Subtask not found');
    const updatedSubtask = updated as Subtask;
    const siblings = db.subtasks.filter((subtask) => subtask.taskId === taskId);
    writeDb(db);
    const task = db.tasks.find((item) => item.id === taskId);
    if (task) {
      activityApi.log({
        projectId: task.projectId,
        type: updatedSubtask.isCompleted ? 'subtask_complete' : 'subtask_update',
        title: `${updatedSubtask.isCompleted ? 'Завершил' : 'Вернул'} подзадачу в «${task.title}»`,
        details: updatedSubtask.title,
        entityType: 'subtask',
        entityId: String(updatedSubtask.id),
        context: 'Карточка задачи',
      });
    }
    return { subtask: updatedSubtask, allCompleted: siblings.every((subtask) => subtask.isCompleted) };
  },

  async updateSubtask(_taskId: number, subtaskId: number, title: string): Promise<Subtask> {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Subtask>(`/tasks/${_taskId}/subtasks/${subtaskId}`, { method: 'PATCH', body: { title } }));
    }
    const db = readDb();
    let updated: Subtask | null = null;
    db.subtasks = db.subtasks.map((subtask) => {
      if (subtask.id !== subtaskId) return subtask;
      updated = { ...subtask, title };
      return updated;
    });
    if (!updated) throw new Error('Subtask not found');
    writeDb(db);
    const task = db.tasks.find((item) => item.id === _taskId);
    if (task) {
      activityApi.log({
        projectId: task.projectId,
        type: 'subtask_update',
        title: `Изменил подзадачу в «${task.title}»`,
        details: title,
        entityType: 'subtask',
        entityId: String(subtaskId),
        context: 'Карточка задачи',
      });
    }
    return updated;
  },

  async deleteSubtask(_taskId: number, subtaskId: number): Promise<{ success: true }> {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/tasks/${_taskId}/subtasks/${subtaskId}`, { method: 'DELETE' });
    }
    const db = readDb();
    const task = db.tasks.find((item) => item.id === _taskId);
    const subtask = db.subtasks.find((item) => item.id === subtaskId);
    db.subtasks = db.subtasks.filter((subtask) => subtask.id !== subtaskId);
    writeDb(db);
    if (task && subtask) {
      activityApi.log({
        projectId: task.projectId,
        type: 'subtask_delete',
        title: `Удалил подзадачу из «${task.title}»`,
        details: subtask.title,
        entityType: 'subtask',
        entityId: String(subtaskId),
        context: 'Карточка задачи',
      });
    }
    return { success: true };
  },
};

function purgeExpiredArchivedTasks(db: ReturnType<typeof readDb>) {
  const mode = tasksApi.getArchiveCleanupMode();
  const maxAgeMs = getArchiveMaxAgeMs(mode);
  if (!maxAgeMs) return;

  const now = Date.now();
  const expiredIds = new Set(
    db.tasks
      .filter((task) => task.isArchived && task.archivedAt && now - new Date(task.archivedAt).getTime() > maxAgeMs)
      .map((task) => task.id),
  );
  if (expiredIds.size === 0) return;
  db.tasks = db.tasks.filter((task) => !expiredIds.has(task.id));
  db.subtasks = db.subtasks.filter((subtask) => !expiredIds.has(subtask.taskId));
  refreshProjectCounts(db);
  writeDb(db);
}

function getArchiveMaxAgeMs(mode: ArchiveCleanupMode) {
  if (mode === '2weeks') return 14 * 24 * 3600000;
  if (mode === '1month') return 30 * 24 * 3600000;
  if (mode === '3months') return 90 * 24 * 3600000;
  return 0;
}

function getTaskChangeSummary(previous: Task, updated: Task) {
  const changes: string[] = [];
  if (previous.title !== updated.title) changes.push('изменил название');
  if ((previous.description ?? '') !== (updated.description ?? '')) changes.push('изменил описание');
  if (previous.priority !== updated.priority) changes.push(`поменял приоритет на ${updated.priority}`);
  if ((previous.deadlineAt ?? '') !== (updated.deadlineAt ?? '')) changes.push('изменил дедлайн');
  if ((previous.scheduledAt ?? '') !== (updated.scheduledAt ?? '')) changes.push('изменил отложенный старт');
  if ((previous.assigneeId ?? previous.assignee?.id ?? '') !== (updated.assigneeId ?? updated.assignee?.id ?? '')) changes.push('назначил исполнителя');
  if ((previous.colorLabel ?? '') !== (updated.colorLabel ?? '')) changes.push('изменил цветовую метку');
  if (JSON.stringify(previous.linkedPageIds ?? []) !== JSON.stringify(updated.linkedPageIds ?? [])) changes.push('изменил связанные страницы');
  return changes;
}

function normalizeColumnPositions(db: ReturnType<typeof readDb>, columnId: number) {
  const columnTasks = db.tasks
    .filter((task) => task.columnId === columnId && !task.isArchived)
    .sort((a, b) => a.position - b.position);
  db.tasks = db.tasks.map((task) => {
    const position = columnTasks.findIndex((item) => item.id === task.id);
    return position === -1 ? task : { ...task, position };
  });
}

function sameBoard(itemPageId: string | undefined, pageId: string | undefined) {
  return pageId ? itemPageId === pageId : !itemPageId;
}
