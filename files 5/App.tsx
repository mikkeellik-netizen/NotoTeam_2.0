import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import ProjectsPage from './pages/ProjectsPage';
import BoardPage from './pages/BoardPage';
import WorkspacePage from './pages/WorkspacePage';
import MyTasksPage from './pages/MyTasksPage';
import MembersPage from './pages/MembersPage';
import SettingsPage from './pages/SettingsPage';
import ArchivePage from './pages/ArchivePage';

export default function App() {
  const { login, isAuthed } = useAuthStore();

  // Авторизация через Telegram initData при старте
  useEffect(() => {
    const initData = window.Telegram?.WebApp?.initData;
    if (initData) {
      login(initData);
    }
  }, []);

  if (!isAuthed) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--tg-theme-button-color)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[var(--tg-theme-hint-color)] text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/board/:projectId" element={<BoardPage />} />
        <Route path="/project/:projectId/workspace" element={<WorkspacePage />} />
        <Route path="/project/:projectId/workspace/page/:pageId" element={<WorkspacePage />} />
        <Route path="/my-tasks" element={<MyTasksPage />} />
        <Route path="/project/:projectId/members" element={<MembersPage />} />
        <Route path="/project/:projectId/settings" element={<SettingsPage />} />
        <Route path="/project/:projectId/archive" element={<ArchivePage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
