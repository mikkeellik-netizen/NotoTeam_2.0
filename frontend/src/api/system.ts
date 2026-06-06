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
  totals: Record<string, number>;
  database: {
    storage: string;
    jsonStateBytes: number;
    jsonStateMb: number;
    files: Array<{ path: string; bytes: number }>;
  };
  users: SystemUserRow[];
  recentUsers: SystemUserRow[];
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
