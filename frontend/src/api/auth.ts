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
};
