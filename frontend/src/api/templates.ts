import type { Template } from '../types';
import { apiRequest } from './httpClient';

export const templatesApi = {
  async list(projectId: string): Promise<Template[]> {
    return apiRequest<Template[]>(`/projects/${projectId}/templates`);
  },

  async create(projectId: string, template: Omit<Template, 'id' | 'projectId' | 'isCustom' | 'createdAt' | 'updatedAt'>): Promise<Template> {
    return apiRequest<Template>(`/projects/${projectId}/templates`, {
      method: 'POST',
      body: template,
    });
  },

  async reorder(projectId: string, orderedIds: string[]): Promise<Template[]> {
    return apiRequest<Template[]>(`/projects/${projectId}/templates/reorder`, {
      method: 'POST',
      body: { orderedIds },
    });
  },

  async remove(projectId: string, templateId: string): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/projects/${projectId}/templates/${templateId}`, {
      method: 'DELETE',
    });
  },
};
