import type { CalendarEvent } from '../types';
import { apiRequest } from './httpClient';

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>;

export const calendarApi = {
  async list(projectId: string): Promise<CalendarEvent[]> {
    return apiRequest<CalendarEvent[]>(`/projects/${projectId}/calendar-events`);
  },

  async create(projectId: string, event: Omit<CalendarEventInput, 'projectId'>): Promise<CalendarEvent> {
    return apiRequest<CalendarEvent>(`/projects/${projectId}/calendar-events`, {
      method: 'POST',
      body: event,
    });
  },

  async update(eventId: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
    return apiRequest<CalendarEvent>(`/calendar-events/${eventId}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  async remove(eventId: string): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/calendar-events/${eventId}`, {
      method: 'DELETE',
    });
  },
};
