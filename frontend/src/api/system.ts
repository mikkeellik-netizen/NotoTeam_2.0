import { apiRequest, workspaceApiUrl, withSessionTokenQuery } from './httpClient';

export type SystemUserRow = {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  isBlocked: boolean;
  blockedAt: string;
  storageBytes: number;
  storageMb: number;
  storageLimitBytes: number;
  storageLimitMb: number;
  storageUsagePercent: number;
  projectsCount: number;
  ownedProjectsCount: number;
  assignedTasksCount: number;
  activeAssignedTasksCount: number;
  completedAssignedTasksCount: number;
  createdTasksCount: number;
};

export type SystemStats = {
  generatedAt: string;
  owner: {
    configured: boolean;
    telegramIds: string[];
    users: Array<{ id: string; telegramId: string; username: string; firstName: string; lastName: string }>;
  };
  totals: Record<string, number>;
  database: {
    storage: string;
    jsonStateBytes: number;
    jsonStateMb: number;
    files: Array<{ path: string; bytes: number }>;
  };
  services: Array<{
    id: string;
    label: string;
    status: 'online' | 'offline' | 'stale' | 'unknown' | 'idle' | 'not_configured';
    detail: string;
  }>;
  performance: {
    since: string;
    retainedRequests: number;
    windows: Record<'15m' | '1h' | '24h', SystemPerformanceWindow>;
  };
  storage: {
    provider: string;
    databaseBytes: number;
    databaseFilesBytes: number;
    projectFileBytes: number;
    projectFiles: number;
    collections: Array<{ name: string; count: number }>;
    topProjects: Array<{
      reference: string;
      dataBytes: number;
      fileBytes: number;
      totalBytes: number;
      tasks: number;
      files: number;
    }>;
  };
  server: {
    startedAt: string;
    uptimeSeconds: number;
    environment: string;
    nodeVersion: string;
    platform: string;
    architecture: string;
    pid: number;
    eventLoopLagMs: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
      hostTotalBytes: number;
      hostFreeBytes: number;
    };
    cpu: {
      cores: number;
      model: string;
      loadAverage: number[];
      processUserMs: number;
      processSystemMs: number;
    };
    disk?: {
      label: string;
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usagePercent: number;
    };
    databaseWrite: { dirty: boolean; flushPending: boolean };
  };
  bot: {
    status: 'online' | 'offline' | 'stale' | 'unknown' | 'not_configured';
    configured: boolean;
    tokenConfigured: boolean;
    internalApiTokenConfigured: boolean;
    lastSeenAt?: string;
    lastPath?: string;
    lastStatus?: number;
    requestsSinceApiStart: number;
    apiRequests1h: number;
    outbox: { pending: number; total: number };
    notifications: { total: number; pending: number; due: number; sent: number; failed: number };
    reminders: { total: number; active: number; due: number; telegramEnabled: number; sent24h: number };
    projects: { total: number; deadlineNotificationsEnabled: number; mentionNotificationsEnabled: number; dutyNotificationsEnabled: number };
  };
  users: SystemUserRow[];
  recentUsers: SystemUserRow[];
};

export type SystemPerformanceWindow = {
  requests: number;
  errors: number;
  rejected: number;
  requestsPerMinute: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  responseBytes: number;
  slowRoutes: Array<{
    route: string;
    requests: number;
    errors: number;
    averageMs: number;
    p95Ms: number;
    maxMs: number;
  }>;
};

export type SystemSecurityEvent = {
  id: string;
  type: string;
  actorUserId?: string;
  projectReference?: string;
  targetUserId?: string;
  outcome: string;
  details: Record<string, string | number | boolean>;
  createdAt: string;
};

export type SystemSecuritySummary = {
  generatedAt: string;
  windows: Record<'24h' | '7d', {
    failedLogins: number;
    rateLimitHits: number;
    foreignProjectAccessAttempts: number;
    ipBlocks: number;
  }>;
  blocked: {
    ips: Array<{
      reference: string;
      blockedUntil: string;
      reason: string;
      createdAt: string;
    }>;
    users: Array<{
      id: string;
      username: string;
      firstName: string;
      lastName: string;
      blockedAt: string;
    }>;
  };
};

export type SystemSecurityEventsResponse = {
  events: SystemSecurityEvent[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  summary: SystemSecuritySummary;
};

function actorQuery(actorUserId: number | string) {
  return `actorUserId=${encodeURIComponent(String(actorUserId))}`;
}

export const systemApi = {
  access(actorUserId: number | string) {
    return apiRequest<{ isOwner: boolean }>(`/system/access?${actorQuery(actorUserId)}`);
  },

  stats(actorUserId: number | string) {
    return apiRequest<SystemStats>(`/system/stats?${actorQuery(actorUserId)}`);
  },

  securityEvents(actorUserId: number | string, params: { offset?: number; limit?: number } = {}) {
    const offset = Math.max(0, Number(params.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Number(params.limit ?? 50)));
    return apiRequest<SystemSecurityEventsResponse>(
      `/system/security-events?${actorQuery(actorUserId)}&paginated=1&offset=${offset}&limit=${limit}`,
    );
  },

  exportUrl(actorUserId: number | string, format: 'csv' | 'json') {
    // Скачивание идёт по прямой ссылке (без заголовка Authorization),
    // поэтому передаём сессионный токен через ?token=
    return withSessionTokenQuery(`${workspaceApiUrl}/system/users/export.${format}?${actorQuery(actorUserId)}`);
  },

  blockUser(actorUserId: number | string, userId: string) {
    return apiRequest<SystemUserRow>(`/system/users/${encodeURIComponent(userId)}/block?${actorQuery(actorUserId)}`, {
      method: 'POST',
      body: {},
    });
  },

  unblockUser(actorUserId: number | string, userId: string) {
    return apiRequest<SystemUserRow>(`/system/users/${encodeURIComponent(userId)}/unblock?${actorQuery(actorUserId)}`, {
      method: 'POST',
      body: {},
    });
  },
};
