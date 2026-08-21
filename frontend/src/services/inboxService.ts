import { apiRequest } from '../api/httpClient';

const READ_KEY = 'workspace-inbox-read-at-v1';

export interface InboxUnreadSummary {
  count: number;
  mineCount?: number;
  generalCount?: number;
  hasUnread: boolean;
}

export function markInboxRead(projectId: number) {
  const readMap = readInboxMap();
  readMap[String(projectId)] = new Date().toISOString();
  localStorage.setItem(READ_KEY, JSON.stringify(readMap));
  window.dispatchEvent(new CustomEvent('workspace-inbox-read', { detail: { projectId } }));
}

export function getInboxReadAt(projectId: number) {
  return new Date(readInboxMap()[String(projectId)] ?? 0).getTime();
}

export async function loadInboxUnreadSummary(projectId: number): Promise<InboxUnreadSummary> {
  const readAt = getInboxReadAt(projectId);
  return apiRequest<InboxUnreadSummary>(
    `/projects/${projectId}/inbox-summary?readAt=${encodeURIComponent(String(readAt))}`,
  );
}

function readInboxMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
  } catch {
    return {};
  }
}
