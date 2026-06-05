import { create } from 'zustand';
import { projectsApi } from '../api/projects';
import type { Project, Column } from '../types';
import { useAuthStore } from './authStore';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  columns: Column[];
  isLoading: boolean;

  fetchProjects: () => Promise<void>;
  fetchProject: (id: number) => Promise<void>;
  createProject: (data: { title: string; description?: string }) => Promise<Project>;
  updateProject: (id: number, data: Partial<Project>) => Promise<void>;
  removeProject: (id: number) => Promise<void>;
  restoreProject: (id: number) => Promise<void>;
  fetchColumns: (projectId: number, pageId?: string) => Promise<void>;
  createColumn: (projectId: number, title: string, pageId?: string) => Promise<void>;
  updateColumn: (id: number, data: { title?: string }) => Promise<void>;
  deleteColumn: (id: number) => Promise<void>;
  reorderColumns: (projectId: number, orderedIds: number[], pageId?: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  columns: [],
  isLoading: false,

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      const userId = useAuthStore.getState().user?.id;
      const projects = await projectsApi.getAll(userId);
      set({ projects });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchProject: async (id) => {
    set({ isLoading: true });
    try {
      const project = await projectsApi.getOne(id);
      set({ currentProject: project });
    } finally {
      set({ isLoading: false });
    }
  },

  createProject: async (data) => {
    const ownerId = useAuthStore.getState().user?.id;
    const project = await projectsApi.create({ ...data, ownerId });
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  updateProject: async (id, data) => {
    const updated = await projectsApi.update(id, data);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? updated : p)),
      currentProject: s.currentProject?.id === id ? updated : s.currentProject,
    }));
  },

  removeProject: async (id) => {
    await projectsApi.remove(id);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },

  restoreProject: async (id) => {
    const project = await projectsApi.restore(id);
    set((s) => ({ projects: [...s.projects.filter((p) => p.id !== id), project] }));
  },

  fetchColumns: async (projectId, pageId) => {
    const columns = await projectsApi.getColumns(projectId, pageId);
    set({ columns });
  },

  createColumn: async (projectId, title, pageId) => {
    const column = await projectsApi.createColumn(projectId, title, pageId);
    set((s) => ({ columns: [...s.columns, column] }));
  },

  updateColumn: async (id, data) => {
    const column = await projectsApi.updateColumn(id, data);
    set((s) => ({
      columns: s.columns.map((item) => (item.id === id ? column : item)),
      currentProject: s.currentProject
        ? {
            ...s.currentProject,
            columns: (s.currentProject.columns ?? []).map((item) => (item.id === id ? column : item)),
          }
        : s.currentProject,
    }));
  },

  deleteColumn: async (id) => {
    const columns = await projectsApi.deleteColumn(id);
    set((s) => ({
      columns,
      currentProject: s.currentProject ? { ...s.currentProject, columns } : s.currentProject,
    }));
  },

  reorderColumns: async (projectId, orderedIds, pageId) => {
    const columns = await projectsApi.reorderColumns(projectId, orderedIds, pageId);
    set({ columns });
  },
}));
