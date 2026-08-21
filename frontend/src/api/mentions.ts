import { apiRequest } from './httpClient';

export interface MentionFeedItem {
  id: string;
  kind: 'page' | 'task';
  title: string;
  subtitle?: string;
  pageId?: string;
  taskId?: string;
  updatedAt?: string;
}

export const mentionsApi = {
  list(projectId: string | number, userId?: string | number): Promise<MentionFeedItem[]> {
    const query = userId === undefined ? '' : `?userId=${encodeURIComponent(String(userId))}`;
    return apiRequest<MentionFeedItem[]>(`/projects/${projectId}/mentions${query}`);
  },
};
