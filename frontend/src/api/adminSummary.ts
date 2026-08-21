import { apiRequest } from './httpClient';

export interface AdminChangeSummary {
  days: number;
  newTasks: Array<{ id: string; title: string; pageId?: string; updatedAt?: string; completedAt?: string }>;
  closedTasks: Array<{ id: string; title: string; pageId?: string; updatedAt?: string; completedAt?: string }>;
  newOverdueTasks: Array<{ id: string; title: string; pageId?: string; updatedAt?: string }>;
  activePeople: string[];
  updatedPages: Array<{ id: string; title: string; icon?: string; updatedAt?: string }>;
  staleTasks: Array<{ id: string; title: string; pageId?: string; updatedAt?: string }>;
  highlights: string[];
}

export const adminSummaryApi = {
  get(projectId: string | number, days = 7): Promise<AdminChangeSummary> {
    return apiRequest<AdminChangeSummary>(`/projects/${projectId}/admin-summary?days=${days}`);
  },
};
