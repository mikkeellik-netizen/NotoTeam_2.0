import { apiRequest, workspaceApiUrl } from './httpClient';

export type AiContextScope = 'summary' | 'full';

export interface AiContextExportOptions {
  scope?: AiContextScope;
  includeTasks?: boolean;
  includeWorkspace?: boolean;
  includeCalendar?: boolean;
  includeReminders?: boolean;
  includeInbox?: boolean;
  includeResponsibility?: boolean;
  includeActivity?: boolean;
  includeBlocks?: boolean;
  includeArchived?: boolean;
  workspaceAccessMode?: 'all' | 'include' | 'exclude';
  workspaceNodeIds?: string[];
  maxTasks?: number;
  maxBlocks?: number;
}

export interface AiConnectorToken {
  id: string;
  projectId: string | number;
  name: string;
  createdByUserId: string | number;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedByUserId?: string | number;
  useCount: number;
  isActive: boolean;
  accessPolicy?: AiContextExportOptions;
}

export interface AiConnectorAccessEvent {
  id: string;
  projectId: string | number;
  tokenId?: string;
  tokenName?: string;
  toolName?: string;
  status: 'success' | 'error';
  scope?: AiContextScope;
  sections?: Record<string, boolean>;
  maxTasks?: number;
  maxBlocks?: number;
  tasksReturned?: number;
  tasksTotal?: number;
  blocksReturned?: number;
  blocksTotal?: number;
  error?: string;
  createdAt: string;
}

export interface AiConnectorConnectionResult {
  apiUrl: string;
  latencyMs: number;
  healthTime?: string;
  context: Record<string, unknown>;
}

function setBooleanQuery(params: URLSearchParams, key: string, value: boolean | undefined, defaultValue: boolean) {
  if (value === undefined || value === defaultValue) return;
  params.set(key, value ? '1' : '0');
}

function buildAiContextQuery(options: AiContextExportOptions = {}) {
  const params = new URLSearchParams();
  params.set('scope', options.scope ?? 'summary');
  setBooleanQuery(params, 'includeTasks', options.includeTasks, true);
  setBooleanQuery(params, 'includeWorkspace', options.includeWorkspace, true);
  setBooleanQuery(params, 'includeCalendar', options.includeCalendar, true);
  setBooleanQuery(params, 'includeReminders', options.includeReminders, true);
  setBooleanQuery(params, 'includeInbox', options.includeInbox, true);
  setBooleanQuery(params, 'includeResponsibility', options.includeResponsibility, true);
  setBooleanQuery(params, 'includeActivity', options.includeActivity, true);
  if (options.includeBlocks) params.set('includeBlocks', '1');
  if (options.includeArchived) params.set('includeArchived', '1');
  if (options.maxTasks) params.set('maxTasks', String(options.maxTasks));
  if (options.maxBlocks) params.set('maxBlocks', String(options.maxBlocks));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function normalizeAiConnectorApiUrl(value: string) {
  const raw = value.trim().replace(/\/+$/, '');
  if (!raw) throw new Error('Укажите публичный URL backend API');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Некорректный URL backend API');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Backend API должен использовать http:// или https://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Не добавляйте логин или пароль в URL backend API');
  }
  return raw;
}

async function readError(response: Response) {
  const text = await response.text();
  return text || response.statusText || 'Unknown error';
}

export const aiConnectorApi = {
  getProjectContext(projectId: number | string, options: AiContextExportOptions = {}) {
    return apiRequest<Record<string, unknown>>(
      `/projects/${encodeURIComponent(String(projectId))}/ai-context${buildAiContextQuery(options)}`,
    );
  },
  getProjectChanges(projectId: number | string, since: string, options: AiContextExportOptions = {}) {
    const query = buildAiContextQuery(options);
    const separator = query ? '&' : '?';
    return apiRequest<Record<string, unknown>>(
      `/projects/${encodeURIComponent(String(projectId))}/ai-context/changes${query}${separator}since=${encodeURIComponent(since)}`,
    );
  },
  async testConnection(input: {
    apiUrl: string;
    projectId: number | string;
    token: string;
    options?: AiContextExportOptions;
  }): Promise<AiConnectorConnectionResult> {
    const apiUrl = normalizeAiConnectorApiUrl(input.apiUrl);
    if (!input.token.trim()) throw new Error('Сначала создайте AI-токен');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const startedAt = performance.now();
    try {
      const healthResponse = await fetch(`${apiUrl}/health`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!healthResponse.ok) {
        throw new Error(`Backend API ${healthResponse.status}: ${await readError(healthResponse)}`);
      }
      const health = await healthResponse.json() as { time?: string };
      const options = input.options ?? {};
      const query = buildAiContextQuery(options);
      const separator = query ? '&' : '?';
      const contextResponse = await fetch(
        `${apiUrl}/projects/${encodeURIComponent(String(input.projectId))}/ai-context${query}${separator}tool=admin_connection_test`,
        {
          headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/json' },
          signal: controller.signal,
        },
      );
      if (!contextResponse.ok) {
        throw new Error(`AI Connector ${contextResponse.status}: ${await readError(contextResponse)}`);
      }
      return {
        apiUrl,
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        healthTime: health.time,
        context: await contextResponse.json() as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Backend API не ответил за 12 секунд');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  },
  listTokens(projectId: number | string) {
    return apiRequest<AiConnectorToken[]>(`/projects/${encodeURIComponent(String(projectId))}/ai-tokens`);
  },
  listAccessEvents(projectId: number | string, limit = 50) {
    return apiRequest<AiConnectorAccessEvent[]>(
      `/projects/${encodeURIComponent(String(projectId))}/ai-access-events?limit=${encodeURIComponent(String(limit))}`,
    );
  },
  createToken(projectId: number | string, input: { name?: string; expiresInDays?: number; accessPolicy?: AiContextExportOptions }) {
    return apiRequest<{ token: string; tokenRecord: AiConnectorToken }>(
      `/projects/${encodeURIComponent(String(projectId))}/ai-tokens`,
      { method: 'POST', body: input },
    );
  },
  revokeToken(projectId: number | string, tokenId: string) {
    return apiRequest<AiConnectorToken>(
      `/projects/${encodeURIComponent(String(projectId))}/ai-tokens/${encodeURIComponent(tokenId)}`,
      { method: 'DELETE' },
    );
  },
};
