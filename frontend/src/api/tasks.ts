import type { Subtask, Task } from '../types';
import { activityApi } from './activity';
import { apiRequest, normalizeArray, normalizeNumberId } from './httpClient';

export type { ArchiveCleanupMode } from '../types';

export interface UserTaskProgress {
  days: number;
  since: string;
  until: string;
  completed: number;
  total: number;
  percent: number;
  created: number;
  active: number;
  overdue: number;
}

export const tasksApi = {
  async getByProject(projectId: number, pageId?: string, includeArchived = false): Promise<Task[]> {
    const params = new URLSearchParams();
    if (pageId) params.set('pageId', pageId);
    if (includeArchived) {
      params.set('allBoards', '1');
      params.set('includeArchived', '1');
    }
    const query = params.toString() ? `?${params}` : '';
    return normalizeArray(await apiRequest<Task[]>(`/projects/${projectId}/tasks${query}`));
  },

  async getAllProjectTasks(projectId: number): Promise<Task[]> {
    return normalizeArray(await apiRequest<Task[]>(`/projects/${projectId}/tasks?allBoards=1`));
  },

  async getArchived(projectId: number, pageId?: string): Promise<Task[]> {
    const pageQuery = pageId ? `&pageId=${encodeURIComponent(pageId)}` : '';
    return normalizeArray(await apiRequest<Task[]>(`/projects/${projectId}/tasks?archived=1${pageQuery}`));
  },

  async clearArchive(projectId: number): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/projects/${projectId}/archive`, { method: 'DELETE' });
  },

  async getOne(taskId: number): Promise<Task> {
    return normalizeNumberId(await apiRequest<Task>(`/tasks/${taskId}`));
  },

  async create(projectId: number, data: Partial<Task>): Promise<Task> {
    const task = normalizeNumberId(await apiRequest<Task>('/tasks', {
      method: 'POST',
      body: { ...data, projectId },
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
  },

  async update(id: number, data: Partial<Task>): Promise<Task> {
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
  },

  async move(id: number, columnId: number, position = 0): Promise<Task> {
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
  },

  async reorder(columnId: number, orderedIds: number[]): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/columns/${columnId}/tasks/reorder`, {
      method: 'POST',
      body: { orderedIds },
    });
  },

  async archive(id: number): Promise<Task> {
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
  },

  async remove(id: number): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/tasks/${id}`, { method: 'DELETE' });
  },

  async getMyTasks(userId: number | string) {
    const encodedUserId = encodeURIComponent(String(userId));
    const [activeResponse, stats] = await Promise.all([
      apiRequest<Task[]>(`/users/${encodedUserId}/assigned-tasks`),
      apiRequest<UserTaskProgress>(`/users/${encodedUserId}/task-progress?days=7`),
    ]);
    const active = normalizeArray(activeResponse);
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
    return { red, yellow, green, noDate, stats };
  },

  async createSubtask(taskId: number, title: string): Promise<Subtask> {
    return normalizeNumberId(await apiRequest<Subtask>(`/tasks/${taskId}/subtasks`, { method: 'POST', body: { title } }));
  },

  async toggleSubtask(taskId: number, subtaskId: number): Promise<{ subtask: Subtask; allCompleted: boolean }> {
    const result = await apiRequest<{ subtask: Subtask; allCompleted: boolean }>(
      `/tasks/${taskId}/subtasks/${subtaskId}/toggle`,
      { method: 'POST' },
    );
    return { ...result, subtask: normalizeNumberId(result.subtask) };
  },

  async updateSubtask(taskId: number, subtaskId: number, title: string): Promise<Subtask> {
    return normalizeNumberId(await apiRequest<Subtask>(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'PATCH', body: { title } }));
  },

  async deleteSubtask(taskId: number, subtaskId: number): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' });
  },
};
