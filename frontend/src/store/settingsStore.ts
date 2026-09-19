import { create } from 'zustand';

type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageCode = 'ru' | 'en' | 'es' | 'de' | 'fr';

interface SettingsState {
  displayName: string;
  theme: ThemeMode;
  language: LanguageCode;
  loadSettings: () => void;
  setDisplayName: (name: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (language: LanguageCode) => void;
}

const STORAGE_KEY = 'notion-lite-user-settings-v1';

export const useSettingsStore = create<SettingsState>((set, get) => ({
  displayName: 'Local User',
  theme: 'system',
  language: 'ru',

  loadSettings: () => {
    const stored = readSettings();
    set(stored);
    applyTheme(stored.theme);
  },

  setDisplayName: (displayName) => {
    set({ displayName });
    writeSettings({ displayName, theme: get().theme, language: get().language });
  },

  setTheme: (theme) => {
    set({ theme });
    writeSettings({ displayName: get().displayName, theme, language: get().language });
    applyTheme(theme);
  },

  setLanguage: (language) => {
    set({ language });
    writeSettings({ displayName: get().displayName, theme: get().theme, language });
  },
}));

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      displayName: stored.displayName ?? 'Local User',
      theme: stored.theme ?? 'system',
      language: stored.language ?? 'ru',
    } as Pick<SettingsState, 'displayName' | 'theme' | 'language'>;
  } catch {
    return { displayName: 'Local User', theme: 'system' as ThemeMode, language: 'ru' as LanguageCode };
  }
}

function writeSettings(settings: { displayName: string; theme: ThemeMode; language: LanguageCode }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function applyTheme(theme: ThemeMode) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  const root = document.documentElement;

  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';

  root.style.setProperty('--tg-theme-bg-color', dark ? '#0f172a' : '#ffffff');
  root.style.setProperty('--tg-theme-text-color', dark ? '#e5e7eb' : '#111827');
  root.style.setProperty('--tg-theme-hint-color', dark ? '#94a3b8' : '#6b7280');
  root.style.setProperty('--tg-theme-link-color', dark ? '#60a5fa' : '#2481cc');
  root.style.setProperty('--tg-theme-button-color', dark ? '#3b82f6' : '#2481cc');
  root.style.setProperty('--tg-theme-button-text-color', '#ffffff');
  root.style.setProperty('--tg-theme-secondary-bg-color', dark ? '#1e293b' : '#f3f4f6');
}
