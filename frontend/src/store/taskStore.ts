import { create } from 'zustand';
import { tasksApi } from '../api/tasks';
import type { Task, Column, Subtask } from '../types';

interface TaskState {
  tasks: Task[];           // все задачи текущего проекта
  selectedTask: Task | null;
  isLoading: boolean;

  fetchTasks: (projectId: number, pageId?: string) => Promise<void>;
  openTask: (taskId: number) => Promise<void>;
  closeTask: () => void;
  createTask: (projectId: number, data: Partial<Task>) => Promise<Task>;
  updateTask: (id: number, data: Partial<Task>) => Promise<void>;
  moveTask: (id: number, columnId: number, position?: number) => Promise<void>;
  reorderTasks: (columnId: number, orderedIds: number[]) => Promise<void>;
  archiveTask: (id: number) => Promise<void>;
  removeTask: (id: number) => Promise<void>;

  // Подзадачи
  createSubtask: (taskId: number, title: string) => Promise<Subtask>;
  toggleSubtask: (taskId: number, subtaskId: number) => Promise<void>;
  updateSubtask: (taskId: number, subtaskId: number, title: string) => Promise<void>;
  deleteSubtask: (taskId: number, subtaskId: number) => Promise<void>;

  // Утилиты
  getTasksByColumn: (columnId: number) => Task[];
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTask: null,
  isLoading: false,

  fetchTasks: async (projectId, pageId) => {
    set({ isLoading: true });
    try {
      const tasks = await tasksApi.getByProject(projectId, pageId);
      set({ tasks });
    } finally {
      set({ isLoading: false });
    }
  },

  openTask: async (taskId) => {
    const task = await tasksApi.getOne(taskId);
    set({ selectedTask: task });
  },

  closeTask: () => set({ selectedTask: null }),

  createTask: async (projectId, data) => {
    const task = await tasksApi.create(projectId, data);
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  updateTask: async (id, data) => {
    const updated = await tasksApi.update(id, data);
    set((s) => ({
      tasks: s.tasks.map((t) => (sameId(t.id, id) ? mergeTaskUpdate(t, updated) : t)),
      selectedTask: s.selectedTask && sameId(s.selectedTask.id, id) ? mergeTaskUpdate(s.selectedTask, updated) : s.selectedTask,
    }));
  },

  moveTask: async (id, columnId, position) => {
    const updated = await tasksApi.move(id, columnId, position);
    set((s) => ({
      tasks: updated.isArchived
        ? s.tasks.filter((t) => !sameId(t.id, id))
        : applyTaskMove(s.tasks, id, updated, columnId, position),
      selectedTask: s.selectedTask && sameId(s.selectedTask.id, id) ? mergeTaskUpdate(s.selectedTask, updated) : s.selectedTask,
    }));
  },

  reorderTasks: async (columnId, orderedIds) => {
    await tasksApi.reorder(columnId, orderedIds);
    // Обновляем позиции локально
    const order = new Map(orderedIds.map((id, index) => [String(id), index]));
    set((s) => ({
      tasks: s.tasks.map((t) => {
        const idx = order.get(String(t.id)) ?? -1;
        return idx !== -1 ? { ...t, position: idx, columnId } : t;
      }),
    }));
  },

  archiveTask: async (id) => {
    await tasksApi.archive(id);
    set((s) => ({ tasks: s.tasks.filter((t) => !sameId(t.id, id)) }));
  },

  removeTask: async (id) => {
    await tasksApi.remove(id);
    set((s) => ({ tasks: s.tasks.filter((t) => !sameId(t.id, id)) }));
  },

  // ─── Подзадачи ────────────────────────────────────────────
  createSubtask: async (taskId, title) => {
    const subtask = await tasksApi.createSubtask(taskId, title);
    set((s) => ({
      tasks: s.tasks.map((t) =>
        sameId(t.id, taskId) ? { ...t, subtasks: [...(t.subtasks ?? []), subtask] } : t,
      ),
      selectedTask: s.selectedTask && sameId(s.selectedTask.id, taskId)
        ? { ...s.selectedTask, subtasks: [...(s.selectedTask.subtasks ?? []), subtask] }
        : s.selectedTask,
    }));
    return subtask;
  },

  toggleSubtask: async (taskId, subtaskId) => {
    const { subtask } = await tasksApi.toggleSubtask(taskId, subtaskId);
    const updateSubtasks = (subtasks: Subtask[]) =>
      subtasks.map((s) => (sameId(s.id, subtaskId) ? subtask : s));

    set((s) => ({
      tasks: s.tasks.map((t) =>
        sameId(t.id, taskId) ? { ...t, subtasks: updateSubtasks(t.subtasks ?? []) } : t,
      ),
      selectedTask: s.selectedTask && sameId(s.selectedTask.id, taskId)
        ? { ...s.selectedTask, subtasks: updateSubtasks(s.selectedTask.subtasks ?? []) }
        : s.selectedTask,
    }));
  },

  updateSubtask: async (taskId, subtaskId, title) => {
    const updated = await tasksApi.updateSubtask(taskId, subtaskId, title);
    const updateSubtasks = (subtasks: Subtask[]) =>
      subtasks.map((s) => (sameId(s.id, subtaskId) ? updated : s));

    set((s) => ({
      tasks: s.tasks.map((t) =>
        sameId(t.id, taskId) ? { ...t, subtasks: updateSubtasks(t.subtasks ?? []) } : t,
      ),
      selectedTask: s.selectedTask && sameId(s.selectedTask.id, taskId)
        ? { ...s.selectedTask, subtasks: updateSubtasks(s.selectedTask.subtasks ?? []) }
        : s.selectedTask,
    }));
  },

  deleteSubtask: async (taskId, subtaskId) => {
    await tasksApi.deleteSubtask(taskId, subtaskId);
    set((s) => ({
      tasks: s.tasks.map((t) =>
        sameId(t.id, taskId)
          ? { ...t, subtasks: (t.subtasks ?? []).filter((sub) => !sameId(sub.id, subtaskId)) }
          : t,
      ),
      selectedTask: s.selectedTask && sameId(s.selectedTask.id, taskId)
        ? { ...s.selectedTask, subtasks: (s.selectedTask.subtasks ?? []).filter((sub) => !sameId(sub.id, subtaskId)) }
        : s.selectedTask,
    }));
  },

  getTasksByColumn: (columnId) =>
    get().tasks
      .filter((t) => sameId(t.columnId, columnId))
      .sort((a, b) => Number(a.position) - Number(b.position)),
}));

function sameId(a: unknown, b: unknown) {
  return a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
}

function applyTaskMove(tasks: Task[], id: number, updated: Task, targetColumnId: number, position?: number): Task[] {
  const previous = tasks.find((task) => sameId(task.id, id));
  const movingTask = previous ? mergeTaskUpdate(previous, updated) : updated;
  const sourceColumnId = previous?.columnId ?? movingTask.columnId;
  const nextColumnId = updated.columnId ?? targetColumnId;
  const withoutMoving = tasks.filter((task) => !sameId(task.id, id));
  const targetTasks = withoutMoving
    .filter((task) => sameId(task.columnId, nextColumnId))
    .sort((a, b) => Number(a.position) - Number(b.position));
  const insertPosition = Math.max(
    0,
    Math.min(Number.isFinite(Number(position)) ? Number(position) : targetTasks.length, targetTasks.length),
  );
  const movedTask = { ...movingTask, columnId: nextColumnId, position: insertPosition };
  targetTasks.splice(insertPosition, 0, movedTask);

  const changed = new Map<string, Task>();
  targetTasks.forEach((task, index) => {
    changed.set(String(task.id), { ...task, columnId: nextColumnId, position: index });
  });

  if (!sameId(sourceColumnId, nextColumnId)) {
    withoutMoving
      .filter((task) => sameId(task.columnId, sourceColumnId))
      .sort((a, b) => Number(a.position) - Number(b.position))
      .forEach((task, index) => {
        changed.set(String(task.id), { ...task, position: index });
      });
  }

  return [...withoutMoving, movedTask].map((task) => changed.get(String(task.id)) ?? task);
}

function mergeTaskUpdate(previous: Task, updated: Task): Task {
  return {
    ...previous,
    ...updated,
    projectId: updated.projectId ?? previous.projectId,
    pageId: updated.pageId ?? previous.pageId,
    columnId: updated.columnId ?? previous.columnId,
    position: updated.position ?? previous.position,
    isArchived: updated.isArchived ?? previous.isArchived,
    createdAt: updated.createdAt ?? previous.createdAt,
  };
}
