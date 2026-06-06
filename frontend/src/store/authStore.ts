import { create } from 'zustand';
import type { User } from '../types';
import { authApi, type TelegramUserInput } from '../api/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthed: boolean;
  isLoading: boolean;
  error: string | null;
  login: (initData?: string) => Promise<void>;
  logout: () => void;
}

const mockUser: User = {
  id: 1,
  telegramId: 'local-dev',
  username: 'local_user',
  firstName: 'Local',
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthed: false,
  isLoading: false,
  error: null,

  login: async (initData?: string) => {
    set({ isLoading: true, error: null });
    try {
      // Проверяем что приложение открыто в Telegram
      const isInTelegram = !!window.Telegram?.WebApp?.initData;
      if (!isInTelegram && !initData) {
        set({
          user: null,
          token: null,
          isAuthed: false,
          isLoading: false,
          error: 'Это приложение работает только внутри Telegram. Откройте его через бота.',
        });
        return;
      }

      const telegramUser = getTelegramUser(initData);
      if (!telegramUser) {
        set({
          user: null,
          token: null,
          isAuthed: false,
          isLoading: false,
          error: 'Не удалось получить данные Telegram. Откройте приложение через бота.',
        });
        return;
      }

      const user = await authApi.loginWithTelegram({ ...telegramUser, initData });
      set({ user, token: initData || 'dev-token', isAuthed: true, isLoading: false, error: null });
    } catch (error) {
      set({
        user: null,
        token: null,
        isAuthed: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Не удалось авторизоваться',
      });
    }
  },

  logout: () => set({ user: null, token: null, isAuthed: false, isLoading: false, error: null }),
}));

function getTelegramUser(initData?: string): TelegramUserInput | undefined {
  const unsafeUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (unsafeUser?.id) {
      return {
      telegramId: String(unsafeUser.id),
      username: unsafeUser.username,
      firstName: unsafeUser.first_name,
      lastName: unsafeUser.last_name,
      photoUrl: unsafeUser.photo_url,
    };
  }

  if (!initData) return undefined;

  try {
    const params = new URLSearchParams(initData);
    const rawUser = params.get('user');
    if (!rawUser) return undefined;
    const parsed = JSON.parse(rawUser);
    if (!parsed?.id) return undefined;
    return {
      telegramId: String(parsed.id),
      username: parsed.username,
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      photoUrl: parsed.photo_url,
    };
  } catch {
    return undefined;
  }
}
