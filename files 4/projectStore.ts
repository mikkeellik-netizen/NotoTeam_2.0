import { create } from 'zustand';
import { projectsApi } from '../api/projects';
import type { Project, Column } from '../types';

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
  fetchColumns: (projectId: number) => Promise<void>;
  createColumn: (projectId: number, title: string) => Promise<void>;
  reorderColumns: (projectId: number, orderedIds: number[]) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  columns: [],
  isLoading: false,

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      const projects = await projectsApi.getAll();
      set({ projects });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchProject: async (id) => {
    set({ isLoading: true });
    try {
      const project = await projectsApi.getOne(id);
      set({ currentProject: project, columns: project.columns || [] });
    } finally {
      set({ isLoading: false });
    }
  },

  createProject: async (data) => {
    const project = await projectsApi.create(data);
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

  fetchColumns: async (projectId) => {
    const columns = await projectsApi.getColumns(projectId);
    set({ columns });
  },

  createColumn: async (projectId, title) => {
    const column = await projectsApi.createColumn(projectId, title);
    set((s) => ({ columns: [...s.columns, column] }));
  },

  reorderColumns: async (projectId, orderedIds) => {
    const columns = await projectsApi.reorderColumns(projectId, orderedIds);
    set({ columns });
  },
}));
