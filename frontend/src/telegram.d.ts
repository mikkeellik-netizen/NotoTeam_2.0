export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            username?: string;
            first_name?: string;
            last_name?: string;
            photo_url?: string;
          };
        };
        themeParams?: Record<string, string>;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}
