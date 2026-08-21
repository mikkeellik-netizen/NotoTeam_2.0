import { apiRequest } from './httpClient';

export type WorkspaceSearchResultKind = 'page' | 'folder' | 'kanban' | 'block' | 'task' | 'subtask' | 'member';

export interface WorkspaceSearchResult {
  id: string | number;
  kind: WorkspaceSearchResultKind;
  title: string;
  subtitle?: string;
  icon?: string;
  pageId?: string;
  blockId?: string;
  taskId?: string | number;
  updatedAt?: string;
}

export const searchApi = {
  list(projectId: string, query: string, limit = 20) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return apiRequest<WorkspaceSearchResult[]>(`/projects/${projectId}/search?${params.toString()}`);
  },
};
