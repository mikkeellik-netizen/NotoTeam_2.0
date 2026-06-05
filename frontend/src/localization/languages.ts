import type { LanguageCode } from '../store/settingsStore';

export interface LanguageOption {
  code: LanguageCode;
  shortLabel: string;
  label: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'ru', shortLabel: 'RU', label: 'Русский' },
  { code: 'en', shortLabel: 'EN', label: 'English' },
  { code: 'es', shortLabel: 'ES', label: 'Español' },
  { code: 'de', shortLabel: 'DE', label: 'Deutsch' },
  { code: 'fr', shortLabel: 'FR', label: 'Français' },
];
