import { DEFAULT_TASK_SIGNIFICANCE_SETTINGS } from '../types';
import type { ArchiveCleanupMode, ProjectBotSettings } from '../types';
import { apiRequest } from './httpClient';

export const defaultProjectBotSettings: ProjectBotSettings = {
  timezone: 'Europe/Moscow',
  archiveCleanupMode: 'never',
  taskDeadlineNotificationsEnabled: true,
  mentionNotificationsEnabled: true,
  dutyNotificationsEnabled: true,
  smartAdminNotificationsEnabled: true,
  kanbanReminderTone: 'soft',
  taskSignificance: DEFAULT_TASK_SIGNIFICANCE_SETTINGS,
  kanbanReminderPoints: [
    { id: 'on_assign', enabled: true, kind: 'on_assign', label: 'Новая задача' },
    { id: 'before_15h', enabled: true, kind: 'before_deadline', offsetMinutes: 900, label: 'За 15 часов' },
    { id: 'before_2h', enabled: true, kind: 'before_deadline', offsetMinutes: 120, label: 'За 2 часа' },
    { id: 'at_deadline', enabled: true, kind: 'at_deadline', label: 'В момент дедлайна' },
  ],
  reports: {
    weekly: {
      enabled: true,
      recipientUserIds: [],
      weekdays: [2],
      time: '19:00',
      skipEmpty: true,
      sendOnlyIfChanged: false,
      sections: {
        createdTasks: true,
        completedTasks: true,
        overdueTasks: true,
        approachingDeadlines: true,
        inactiveUsers: true,
        userActivity: true,
        kanbanMovement: true,
        mentions: true,
        recommendations: true,
      },
    },
    overdue: {
      enabled: true,
      recipientUserIds: [],
      weekdays: [4],
      time: '20:00',
      skipEmpty: true,
      sendOnlyIfChanged: true,
      sections: {
        createdTasks: false,
        completedTasks: false,
        overdueTasks: true,
        approachingDeadlines: false,
        inactiveUsers: false,
        userActivity: false,
        kanbanMovement: false,
        mentions: false,
        recommendations: true,
      },
    },
  },
};

export const botSettingsApi = {
  enabled: true,

  async get(projectId: number) {
    return apiRequest<ProjectBotSettings>(`/projects/${projectId}/bot-settings`);
  },

  async update(projectId: number, settings: ProjectBotSettings) {
    return apiRequest<ProjectBotSettings>(`/projects/${projectId}/bot-settings`, {
      method: 'PATCH',
      body: settings,
    });
  },

  async getArchiveCleanupMode(projectId: number): Promise<ArchiveCleanupMode> {
    const settings = await this.get(projectId);
    return settings.archiveCleanupMode ?? 'never';
  },

  async setArchiveCleanupMode(projectId: number, mode: ArchiveCleanupMode): Promise<ArchiveCleanupMode> {
    const current = await this.get(projectId);
    const saved = await this.update(projectId, { ...current, archiveCleanupMode: mode });
    return saved.archiveCleanupMode ?? mode;
  },
};
