import type { Reminder } from '../types';
import { apiRequest } from './httpClient';

export interface ReminderInput {
  creatorUserId?: string;
  targetUserId: string;
  sourceType?: Reminder['sourceType'];
  sourceId?: string;
  title: string;
  description?: string;
  scheduleType: Reminder['scheduleType'];
  remindAt?: string;
  recurrence?: Reminder['recurrence'];
  channels?: Reminder['channels'];
}

export const remindersApi = {
  async list(projectId: string): Promise<Reminder[]> {
    return apiRequest<Reminder[]>(`/projects/${projectId}/reminders`);
  },

  async create(projectId: string, reminder: ReminderInput): Promise<Reminder> {
    return apiRequest<Reminder>(`/projects/${projectId}/reminders`, {
      method: 'POST',
      body: reminder,
    });
  },

  async update(reminderId: string, patch: Partial<Reminder>): Promise<Reminder> {
    return apiRequest<Reminder>(`/reminders/${reminderId}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  async remove(reminderId: string): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/reminders/${reminderId}`, {
      method: 'DELETE',
    });
  },

  async due(before = new Date().toISOString()): Promise<Reminder[]> {
    return apiRequest<Reminder[]>(`/reminders/due?before=${encodeURIComponent(before)}`);
  },
};
