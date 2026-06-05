import type { ActivityEvent, ActivityEventType } from '../types';
import { apiRequest, useWorkspaceBackend } from './httpClient';

const STORAGE_KEY = 'notion-lite-activity-v1';
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
    if (useWorkspaceBackend) return backendActivityCache.get(projectId) ?? [];

    purgeExpired(projectId);
    return readActivity()
      .filter((event) => event.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async load(projectId: number): Promise<ActivityEvent[]> {
    if (!useWorkspaceBackend) return this.list(projectId);
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
    if (!useWorkspaceBackend) purgeExpired(projectId);
  },

  log(input: ActivityInput) {
    purgeExpired(input.projectId);
    const event: ActivityEvent = {
      id: `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      projectId: input.projectId,
      userId: input.userId ?? 1,
      userName: input.userName ?? 'Local',
      type: input.type,
      title: input.title,
      details: input.details,
      entityType: input.entityType,
      entityId: input.entityId,
      context: input.context,
      createdAt: new Date().toISOString(),
    };
    if (useWorkspaceBackend) {
      backendActivityCache.set(input.projectId, [event, ...(backendActivityCache.get(input.projectId) ?? [])].slice(0, 500));
      void apiRequest(`/projects/${input.projectId}/activity`, { method: 'POST', body: event }).catch(() => undefined);
    } else {
      const events = readActivity();
      writeActivity([event, ...events].slice(0, 500));
    }
    window.dispatchEvent(new CustomEvent('workspace-activity-updated', { detail: { projectId: input.projectId } }));
    return event;
  },
};

function purgeExpired(projectId: number) {
  if (useWorkspaceBackend) return;

  const retentionDays = activityApi.getRetentionDays(projectId);
  const minTime = Date.now() - retentionDays * 24 * 3600000;
  const events = readActivity();
  const next = events.filter((event) => {
    if (event.projectId !== projectId) return true;
    return new Date(event.createdAt).getTime() >= minTime;
  });
  if (next.length !== events.length) writeActivity(next);
}

function readActivity(): ActivityEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeActivity(events: ActivityEvent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function readRetentionSettings(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(RETENTION_KEY) ?? '{}');
  } catch {
    return {};
  }
}
