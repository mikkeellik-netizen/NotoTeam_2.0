const API_URL = (import.meta.env.VITE_WORKSPACE_API_URL as string | undefined)?.trim();

export const isWorkspaceApiConfigured = Boolean(API_URL);
export const workspaceApiUrl = API_URL ?? '';
export const useWorkspaceBackend = true;

export async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!isWorkspaceApiConfigured) throw new Error('VITE_WORKSPACE_API_URL is not configured');

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
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
