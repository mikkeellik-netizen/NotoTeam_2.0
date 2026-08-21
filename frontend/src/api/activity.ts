import type { ActivityEvent, ActivityEventType } from '../types';
import { apiRequest } from './httpClient';
import { useAuthStore } from '../store/authStore';

const RETENTION_KEY = 'notion-lite-activity-retention-v1';
const DEFAULT_RETENTION_DAYS = 7;
const backendActivityCache = new Map<number, ActivityEvent[]>();

interface ActivityInput {
  projectId: number;
  userId?: number;
  userName?: string;
  type: ActivityEventType;
  title: string;
  details?: string;
  entityType?: ActivityEvent['entityType'];
  entityId?: string;
  context?: string;
}

export const activityApi = {
  list(projectId: number): ActivityEvent[] {
    return backendActivityCache.get(projectId) ?? [];
  },

  async load(projectId: number): Promise<ActivityEvent[]> {
    const retentionDays = this.getRetentionDays(projectId);
    const events = await apiRequest<ActivityEvent[]>(
      `/projects/${projectId}/activity?retentionDays=${retentionDays}`,
    );
    const normalized = events.map((event) => ({ ...event, projectId: Number(event.projectId) }));
    backendActivityCache.set(projectId, normalized);
    return normalized;
  },

  getRetentionDays(projectId: number) {
    const settings = readRetentionSettings();
    return settings[String(projectId)] ?? DEFAULT_RETENTION_DAYS;
  },

  setRetentionDays(projectId: number, days: number) {
    const settings = readRetentionSettings();
    settings[String(projectId)] = days;
    localStorage.setItem(RETENTION_KEY, JSON.stringify(settings));
  },

  log(input: ActivityInput) {
    const currentUser = useAuthStore.getState().user;
    const currentUserName =
      [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ') ||
      currentUser?.username ||
      'Unknown';
    const event: ActivityEvent = {
      id: `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      projectId: input.projectId,
      userId: input.userId ?? Number(currentUser?.id ?? 0),
      userName: input.userName ?? currentUserName,
      type: input.type,
      title: input.title,
      details: input.details,
      entityType: input.entityType,
      entityId: input.entityId,
      context: input.context,
      createdAt: new Date().toISOString(),
    };
    backendActivityCache.set(input.projectId, [event, ...(backendActivityCache.get(input.projectId) ?? [])].slice(0, 500));
    void apiRequest(`/projects/${input.projectId}/activity`, { method: 'POST', body: event }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent('workspace-activity-updated', { detail: { projectId: input.projectId } }));
    return event;
  },
};

function readRetentionSettings(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(RETENTION_KEY) ?? '{}');
  } catch {
    return {};
  }
}
