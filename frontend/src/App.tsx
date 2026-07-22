import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useSettingsStore } from './store/settingsStore';
import ProjectsPage from './pages/ProjectsPage';
import BoardPage from './pages/BoardPage';
import WorkspacePage from './pages/WorkspacePage';
import MyTasksPage from './pages/MyTasksPage';
import InboxPage from './pages/InboxPage';
import NotificationsPage from './pages/NotificationsPage';
import RemindersPage from './pages/RemindersPage';
import CalendarPage from './pages/CalendarPage';
import MembersPage from './pages/MembersPage';
import SettingsPage from './pages/SettingsPage';
import ArchivePage from './pages/ArchivePage';
import SystemAdminPage from './pages/SystemAdminPage';
import LoginPage from './pages/LoginPage';
import { isWorkspaceApiConfigured } from './api/httpClient';

export default function App() {
  const { init, isAuthed, isLoading, error, inTelegram } = useAuthStore();
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  useEffect(() => {
    loadSettings();
    init();

    // Отключаем вертикальный свайп-«закрыть», чтобы прокрутка не сворачивала приложение
    window.Telegram?.WebApp?.disableVerticalSwipes?.();

    // Когда приложение возвращается на передний план (в т.ч. при переключении
    // аккаунта Telegram), перепроверяем пользователя. init() обнаружит смену
    // и перезагрузит страницу для чистого состояния. visibilitychange —
    // стандартное DOM-событие, работает во всех клиентах.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void init();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadSettings, init]);

  if (!isWorkspaceApiConfigured) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--tg-theme-bg-color)] px-5">
        <div className="max-w-md rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-5 text-[var(--tg-theme-text-color)]">
          <h1 className="text-lg font-bold">Ошибка конфигурации</h1>
          <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
            Не задана обязательная переменная VITE_WORKSPACE_API_URL. Приложение больше не запускается в localStorage-режиме, чтобы рабочие данные не терялись при обновлениях.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3 text-xs">
            VITE_WORKSPACE_API_URL=http://127.0.0.1:8787
          </pre>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" />
          <p className="text-sm text-[var(--tg-theme-hint-color)]">Загрузка...</p>
        </div>
      </div>
    );
  }

  // В Telegram авторизация автоматическая — если не вышло, показываем ошибку с повтором
  if (!isAuthed && inTelegram) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--tg-theme-bg-color)] px-5">
        <div className="max-w-md rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-5 text-center text-[var(--tg-theme-text-color)]">
          <h1 className="text-lg font-bold">Не удалось войти</h1>
          <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">{error ?? 'Откройте приложение через бота.'}</p>
          <button
            onClick={() => init()}
            className="mt-4 rounded-[12px] bg-[var(--tg-theme-button-color)] px-5 py-3 font-semibold text-[var(--tg-theme-button-text-color)]"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  // В браузере без сессии — вход по Telegram-нику и коду
  if (!isAuthed) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <TelegramBackButton />
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/board/:projectId" element={<BoardPage />} />
        <Route path="/project/:projectId/workspace" element={<WorkspacePage />} />
        <Route path="/project/:projectId/workspace/page/:pageId" element={<WorkspacePage />} />
        <Route path="/project/:projectId/inbox" element={<InboxPage />} />
        <Route path="/project/:projectId/notifications" element={<NotificationsPage />} />
        <Route path="/project/:projectId/reminders" element={<RemindersPage />} />
        <Route path="/project/:projectId/calendar" element={<CalendarPage />} />
        <Route path="/my-tasks" element={<MyTasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/system-admin" element={<SystemAdminPage />} />
        <Route path="/project/:projectId/members" element={<MembersPage />} />
        <Route path="/project/:projectId/settings" element={<SettingsPage />} />
        <Route path="/project/:projectId/archive" element={<ArchivePage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

// Связывает системную кнопку/жест «Назад» на телефоне со встроенной кнопкой
// Telegram BackButton. Когда она видима, Android-свайп «назад» вызывает ЕЁ
// (переход назад внутри приложения), а не закрывает мини-приложение.
// На корневом экране кнопка скрыта — там «назад» закрывает приложение (это норма).
function TelegramBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return;

    const isRoot = location.pathname === '/';
    if (isRoot) {
      backButton.hide?.();
      return;
    }

    const handler = () => navigate(-1);
    backButton.show?.();
    backButton.onClick?.(handler);
    return () => {
      backButton.offClick?.(handler);
    };
  }, [location.pathname, navigate]);

  return null;
}
