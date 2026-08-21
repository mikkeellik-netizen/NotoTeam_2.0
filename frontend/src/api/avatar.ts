import type { User } from '../types';
import { apiRequest, getEffectiveAuthHeader, normalizeNumberId, workspaceApiUrl } from './httpClient';

export interface AvatarSettings {
  avatarMode: 'none' | 'telegram' | 'manual';
  avatarStatus: 'disabled' | 'ready' | 'unavailable' | 'error';
  avatarUrl?: string;
  avatarUpdatedAt?: string;
  avatarConsentAt?: string;
  maxBytes: number;
  allowedMimeTypes: string[];
}

export const avatarApi = {
  settings(userId: number | string) {
    return apiRequest<AvatarSettings>(`/users/${encodeURIComponent(String(userId))}/avatar-settings`);
  },

  async useTelegram(userId: number | string) {
    return normalizeNumberId(await apiRequest<User>(`/users/${encodeURIComponent(String(userId))}/avatar/telegram`, {
      method: 'POST',
      body: {},
    }));
  },

  async uploadManual(userId: number | string, dataUrl: string) {
    return normalizeNumberId(await apiRequest<User>(`/users/${encodeURIComponent(String(userId))}/avatar/manual`, {
      method: 'POST',
      body: { dataUrl },
    }));
  },

  async disable(userId: number | string) {
    return normalizeNumberId(await apiRequest<User>(`/users/${encodeURIComponent(String(userId))}/avatar`, {
      method: 'DELETE',
      body: {},
    }));
  },

  async fetchObjectUrl(userId: number | string): Promise<string | undefined> {
    const headers: Record<string, string> = {};
    const auth = getEffectiveAuthHeader();
    if (auth) headers.Authorization = auth;
    const response = await fetch(`${workspaceApiUrl}/users/${encodeURIComponent(String(userId))}/avatar`, { headers });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Avatar API ${response.status}`);
    return URL.createObjectURL(await response.blob());
  },
};
