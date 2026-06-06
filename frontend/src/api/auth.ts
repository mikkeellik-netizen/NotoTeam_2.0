import type { User } from '../types';
import { apiRequest, normalizeNumberId } from './httpClient';

export interface TelegramUserInput {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  initData?: string;
}

export const authApi = {
  async loginWithTelegram(input: TelegramUserInput): Promise<User> {
    return normalizeNumberId(await apiRequest<User>('/telegram/users', {
      method: 'POST',
      body: input,
    }));
  },

  // Текущий пользователь по активному заголовку Authorization
  async me(): Promise<User> {
    return normalizeNumberId(await apiRequest<User>('/auth/me'));
  },

  // Шаг 1 веб-входа: запросить одноразовый код в Telegram
  async requestCode(username: string): Promise<{ ok: boolean; message: string }> {
    return apiRequest('/auth/request-code', { method: 'POST', body: { username } });
  },

  // Шаг 2 веб-входа: проверить код, получить сессионный токен
  async verifyCode(username: string, code: string): Promise<{ token: string; user: User }> {
    const result = await apiRequest<{ token: string; user: User }>('/auth/verify-code', {
      method: 'POST',
      body: { username, code },
    });
    return { token: result.token, user: normalizeNumberId(result.user) };
  },

  async logout(): Promise<void> {
    await apiRequest('/auth/logout', { method: 'POST' });
  },
};
