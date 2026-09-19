import type { FileBlockContent, ProjectFileRecord } from '../types';
import { getEffectiveAuthHeader, isWorkspaceApiConfigured, workspaceApiUrl } from './httpClient';

export const PROJECT_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const PROJECT_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm';

export type ProjectFileUploadMode = 'node' | 'block';

export function uploadProjectFile(
  projectId: string | number,
  file: File,
  mode: ProjectFileUploadMode,
  onProgress?: (percent: number) => void,
): Promise<ProjectFileRecord> {
  if (!isWorkspaceApiConfigured) return Promise.reject(new Error('Workspace API не настроен'));

  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ fileName: file.name, mode });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${workspaceApiUrl}/projects/${encodeURIComponent(String(projectId))}/files?${query}`);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    const auth = getEffectiveAuthHeader();
    if (auth) xhr.setRequestHeader('Authorization', auth);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Не удалось загрузить файл. Проверьте соединение.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(xhr.response as ProjectFileRecord);
        return;
      }
      const payload = xhr.response && typeof xhr.response === 'object'
        ? xhr.response as { error?: string }
        : undefined;
      reject(new Error(payload?.error || `Ошибка загрузки (${xhr.status})`));
    };
    xhr.send(file);
  });
}

export async function fetchProjectFileBlob(projectId: string | number, fileId: string): Promise<Blob> {
  if (!isWorkspaceApiConfigured) throw new Error('Workspace API не настроен');
  const headers: Record<string, string> = {};
  const auth = getEffectiveAuthHeader();
  if (auth) headers.Authorization = auth;
  const response = await fetch(
    `${workspaceApiUrl}/projects/${encodeURIComponent(String(projectId))}/files/${encodeURIComponent(fileId)}/content`,
    { headers },
  );
  if (!response.ok) throw new Error(`Не удалось получить файл (${response.status})`);
  return response.blob();
}

export async function deleteProjectFile(projectId: string | number, fileId: string): Promise<void> {
  if (!isWorkspaceApiConfigured) throw new Error('Workspace API не настроен');
  const headers: Record<string, string> = {};
  const auth = getEffectiveAuthHeader();
  if (auth) headers.Authorization = auth;
  const response = await fetch(
    `${workspaceApiUrl}/projects/${encodeURIComponent(String(projectId))}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE', headers },
  );
  if (!response.ok && response.status !== 404) throw new Error(`Не удалось удалить файл (${response.status})`);
}

export function projectFileToBlockContent(file: ProjectFileRecord): FileBlockContent {
  return {
    fileId: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    category: file.category,
    size: file.size,
  };
}

export function projectFileIcon(file: Pick<ProjectFileRecord, 'category' | 'mimeType'>) {
  if (file.category === 'image') return '🖼️';
  if (file.category === 'audio') return '🎵';
  if (file.mimeType === 'application/pdf') return '📕';
  return '📘';
}
