import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useSettingsStore } from './store/settingsStore';
import LoginPage from './pages/LoginPage';
import { isWorkspaceApiConfigured } from './api/httpClient';
import ProjectAccessGate from './components/common/ProjectAccessGate';

const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const RemindersPage = lazy(() => import('./pages/RemindersPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ArchivePage = lazy(() => import('./pages/ArchivePage'));
const SystemAdminPage = lazy(() => import('./pages/SystemAdminPage'));

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
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/board/:projectId" element={<ProjectAccessGate><BoardPage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/workspace" element={<ProjectAccessGate><WorkspacePage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/workspace/page/:pageId" element={<ProjectAccessGate><WorkspacePage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/inbox" element={<ProjectAccessGate><InboxPage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/notifications" element={<ProjectAccessGate><NotificationsPage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/reminders" element={<ProjectAccessGate><RemindersPage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/calendar" element={<ProjectAccessGate><CalendarPage /></ProjectAccessGate>} />
          <Route path="/my-tasks" element={<MyTasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system-admin" element={<SystemAdminPage />} />
          <Route path="/project/:projectId/members" element={<ProjectAccessGate><MembersPage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/settings" element={<ProjectAccessGate><SettingsPage /></ProjectAccessGate>} />
          <Route path="/project/:projectId/archive" element={<ProjectAccessGate><ArchivePage /></ProjectAccessGate>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" />
        <p className="text-sm text-[var(--tg-theme-hint-color)]">Загрузка...</p>
      </div>
    </div>
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
