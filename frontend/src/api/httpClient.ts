const API_URL = (import.meta.env.VITE_WORKSPACE_API_URL as string | undefined)?.trim();

export const isWorkspaceApiConfigured = Boolean(API_URL);
export const workspaceApiUrl = API_URL ?? '';
export const useWorkspaceBackend = true;

const AUTH_TOKEN_STORAGE_KEY = 'workspaceAuthToken';

// Заголовок Authorization для всех запросов:
//   "tma <initData>"   — Telegram Mini App
//   "Bearer <token>"   — веб-сессия
let authHeader: string | undefined;

export function setAuthHeader(value: string | undefined) {
  authHeader = value;
}

export function setSessionToken(token: string | undefined) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    authHeader = `Bearer ${token}`;
  } else {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    authHeader = undefined;
  }
}

export function getStoredSessionToken(): string | undefined {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? undefined;
}

// Токен сессии можно передать в query (?token=) для прямых ссылок на скачивание файлов.
export function withSessionTokenQuery(url: string): string {
  const token = getStoredSessionToken();
  if (!token) return url;
  return url + (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
}

export async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!isWorkspaceApiConfigured) throw new Error('VITE_WORKSPACE_API_URL is not configured');

  const headers: Record<string, string> = {};
  if (options.body) headers['Content-Type'] = 'application/json';
  if (authHeader) headers['Authorization'] = authHeader;

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Workspace API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export function normalizeNumberId<T extends Record<string, any>>(item: T): T {
  return {
    ...item,
    id: Number(item.id),
    projectId: item.projectId !== undefined ? Number(item.projectId) : item.projectId,
    ownerId: item.ownerId !== undefined ? Number(item.ownerId) : item.ownerId,
    columnId: item.columnId !== undefined ? Number(item.columnId) : item.columnId,
    taskId: item.taskId !== undefined ? Number(item.taskId) : item.taskId,
    assigneeId: item.assigneeId !== undefined ? Number(item.assigneeId) : item.assigneeId,
    creatorId: item.creatorId !== undefined ? Number(item.creatorId) : item.creatorId,
  };
}

export function normalizeArray<T extends Record<string, any>>(items: T[]): T[] {
  return items.map((item) => normalizeNumberId(item));
}
