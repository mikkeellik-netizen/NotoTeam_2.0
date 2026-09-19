import { create } from 'zustand';
import type { User } from '../types';
import { authApi } from '../api/auth';
import {
  setAuthHeader,
  setSessionToken,
  getStoredSessionToken,
  isInsideTelegram,
} from '../api/httpClient';

interface AuthState {
  user: User | null;
  isAuthed: boolean;
  isLoading: boolean;
  /** Запущено ли приложение внутри Telegram (Mini App) */
  inTelegram: boolean;
  error: string | null;
  /** true, если в браузере нужно показать форму входа по коду */
  needsWebLogin: boolean;
  init: () => Promise<void>;
  requestCode: (username: string) => Promise<{ ok: boolean; message: string }>;
  verifyCode: (username: string, code: string) => Promise<void>;
  loginLocalDev: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

function getTelegramInitData(): string | undefined {
  const initData = window.Telegram?.WebApp?.initData;
  return initData && initData.length > 0 ? initData : undefined;
}

let authMutationVersion = 0;
let verifyCodeInFlight = false;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthed: false,
  isLoading: true,
  inTelegram: Boolean(getTelegramInitData()),
  error: null,
  needsWebLogin: false,

  // Определяет способ авторизации при запуске приложения
  init: async () => {
    const startedAtVersion = authMutationVersion;
    const isStale = () => startedAtVersion !== authMutationVersion;
    set({ isLoading: true, error: null });

    // Внутри Telegram удаляем сохранённый веб-токен — он мог остаться
    // от другого аккаунта и привести к утечке данных между пользователями.
    if (isInsideTelegram()) {
      setSessionToken(undefined);
    }

    const initData = getTelegramInitData();

    // 1) Telegram Mini App — авторизация автоматическая по подписанному initData
    if (initData) {
      setAuthHeader(`tma ${initData}`);
      try {
        const user = await authApi.me();
        if (isStale()) return;

        // Проверяем: если пользователь сменился (переключение аккаунта в Telegram),
        // перезагружаем страницу чтобы гарантированно сбросить все кэшированные данные.
        const prevUser = useAuthStore.getState().user;
        if (prevUser && String(prevUser.id) !== String(user.id)) {
          window.location.reload();
          return;
        }

        set({ user, isAuthed: true, isLoading: false, inTelegram: true, needsWebLogin: false });
      } catch (error) {
        if (isStale()) return;
        set({
          user: null,
          isAuthed: false,
          isLoading: false,
          inTelegram: true,
          error: error instanceof Error ? error.message : 'Не удалось авторизоваться через Telegram',
        });
      }
      return;
    }

    // 2) Браузер с сохранённой сессией
    const token = getStoredSessionToken();
    if (token) {
      setAuthHeader(`Bearer ${token}`);
      try {
        const user = await authApi.me();
        if (isStale()) return;
        set({ user, isAuthed: true, isLoading: false, inTelegram: false, needsWebLogin: false });
        return;
      } catch {
        if (isStale()) return;
        // токен истёк/недействителен — очищаем и показываем форму входа
        setSessionToken(undefined);
      }
    }

    // 3) Браузер без сессии — нужна форма входа по коду
    if (isStale()) return;
    set({ user: null, isAuthed: false, isLoading: false, inTelegram: false, needsWebLogin: true });
  },

  requestCode: async (username: string) => {
    return authApi.requestCode(username);
  },

  verifyCode: async (username: string, code: string) => {
    if (verifyCodeInFlight) return;
    verifyCodeInFlight = true;
    const loginVersion = ++authMutationVersion;
    set({ isLoading: true, error: null });
    try {
      const { token, user } = await authApi.verifyCode(username, code);
      if (loginVersion !== authMutationVersion) return;
      setSessionToken(token);
      authMutationVersion += 1;
      set({ user, isAuthed: true, isLoading: false, inTelegram: false, needsWebLogin: false, error: null });
    } catch (error) {
      if (loginVersion !== authMutationVersion) return;
      set({ isLoading: false, error: error instanceof Error ? error.message : 'Не удалось войти' });
      throw error;
    } finally {
      verifyCodeInFlight = false;
    }
  },

  loginLocalDev: async () => {
    const loginVersion = ++authMutationVersion;
    set({ isLoading: true, error: null });
    try {
      const { token, user } = await authApi.loginLocalDev();
      if (loginVersion !== authMutationVersion) return;
      setSessionToken(token);
      authMutationVersion += 1;
      set({ user, isAuthed: true, isLoading: false, inTelegram: false, needsWebLogin: false, error: null });
    } catch (error) {
      if (loginVersion !== authMutationVersion) return;
      set({ isLoading: false, error: error instanceof Error ? error.message : 'Local login failed' });
      throw error;
    }
  },

  logout: async () => {
    authMutationVersion += 1;
    try {
      await authApi.logout();
    } catch {
      // игнорируем ошибки сети при выходе
    }
    authMutationVersion += 1;
    setSessionToken(undefined);
    set({ user: null, isAuthed: false, isLoading: false, needsWebLogin: true });
  },

  setUser: (user: User) => {
    set({ user, isAuthed: true, isLoading: false });
  },
}));
