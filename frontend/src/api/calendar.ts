import type { Calendar, CalendarCategory, CalendarEvent, ExternalCalendarConnection, Task } from '../types';
import { apiRequest } from './httpClient';

export type CalendarEventInput = Omit<
  CalendarEvent,
  'id' | 'calendarId' | 'projectId' | 'ownerUserId' | 'createdByUserId' | 'notification' | 'createdAt' | 'updatedAt'
> & { notification?: CalendarEvent['notification'] };

export interface CalendarRange {
  from: string;
  to: string;
  calendarIds?: string[];
}

export const calendarApi = {
  async list(projectId: string): Promise<CalendarEvent[]> {
    return apiRequest<CalendarEvent[]>(`/projects/${projectId}/calendar-events`);
  },

  async create(projectId: string, event: CalendarEventInput): Promise<CalendarEvent> {
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

  async listMine(range: CalendarRange): Promise<CalendarEvent[]> {
    const query = new URLSearchParams({ from: range.from, to: range.to });
    if (range.calendarIds?.length) query.set('calendarIds', range.calendarIds.join(','));
    return apiRequest<CalendarEvent[]>(`/me/calendar-events?${query.toString()}`);
  },

  async listCalendars(): Promise<Calendar[]> {
    return apiRequest<Calendar[]>('/me/calendars');
  },

  async listTaskDeadlines(range: CalendarRange & { projectId?: string }): Promise<Task[]> {
    const query = new URLSearchParams({ from: range.from, to: range.to });
    if (range.projectId) query.set('projectId', range.projectId);
    return apiRequest<Task[]>(`/me/task-deadlines?${query.toString()}`);
  },

  async getProjectCalendar(projectId: string): Promise<Calendar> {
    return apiRequest<Calendar>(`/projects/${projectId}/calendar`);
  },

  async createInCalendar(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent> {
    return apiRequest<CalendarEvent>(`/calendars/${calendarId}/events`, {
      method: 'POST',
      body: event,
    });
  },

  async createCategory(calendarId: string, category: Pick<CalendarCategory, 'label' | 'color'>): Promise<CalendarCategory> {
    return apiRequest<CalendarCategory>(`/calendars/${encodeURIComponent(calendarId)}/categories`, {
      method: 'POST',
      body: category,
    });
  },

  async updateCategory(calendarId: string, categoryId: string, patch: Pick<CalendarCategory, 'color'>): Promise<CalendarCategory> {
    return apiRequest<CalendarCategory>(`/calendars/${encodeURIComponent(calendarId)}/categories/${encodeURIComponent(categoryId)}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  async removeCategory(calendarId: string, categoryId: string): Promise<{ success: true; reassignedEvents: number }> {
    return apiRequest<{ success: true; reassignedEvents: number }>(`/calendars/${encodeURIComponent(calendarId)}/categories/${encodeURIComponent(categoryId)}`, {
      method: 'DELETE',
    });
  },

  async listExternalConnections(projectId?: string): Promise<ExternalCalendarConnection[]> {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/external-calendar-connections`
      : '/me/external-calendar-connections';
    return apiRequest<ExternalCalendarConnection[]>(path);
  },

  async connectYandexCalendar(input: { name: string; color: string; feedUrl: string }, projectId?: string): Promise<ExternalCalendarConnection> {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/external-calendar-connections/yandex`
      : '/me/external-calendar-connections/yandex';
    return apiRequest<ExternalCalendarConnection>(path, {
      method: 'POST',
      body: input,
    });
  },

  async updateExternalConnection(id: string, patch: Partial<Pick<ExternalCalendarConnection, 'name' | 'color' | 'enabled'>>, projectId?: string): Promise<ExternalCalendarConnection> {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/external-calendar-connections/${encodeURIComponent(id)}`
      : `/me/external-calendar-connections/${encodeURIComponent(id)}`;
    return apiRequest<ExternalCalendarConnection>(path, {
      method: 'PATCH',
      body: patch,
    });
  },

  async syncExternalConnection(id: string, projectId?: string): Promise<ExternalCalendarConnection> {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/external-calendar-connections/${encodeURIComponent(id)}/sync`
      : `/me/external-calendar-connections/${encodeURIComponent(id)}/sync`;
    return apiRequest<ExternalCalendarConnection>(path, {
      method: 'POST',
    });
  },

  async removeExternalConnection(id: string, projectId?: string): Promise<{ success: true }> {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/external-calendar-connections/${encodeURIComponent(id)}`
      : `/me/external-calendar-connections/${encodeURIComponent(id)}`;
    return apiRequest<{ success: true }>(path, {
      method: 'DELETE',
    });
  },
};
