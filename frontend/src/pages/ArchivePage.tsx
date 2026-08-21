import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tasksApi, type ArchiveCleanupMode } from '../api/tasks';
import { botSettingsApi } from '../api/botSettings';
import type { Task } from '../types';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';
import { getProjectPermissions } from '../utils/projectPermissions';

const CLEANUP_OPTIONS: Array<{ value: ArchiveCleanupMode; label: string }> = [
  { value: 'never', label: 'Не удалять' },
  { value: '2weeks', label: 'Удалять раз в две недели' },
  { value: '1month', label: 'Удалять раз в месяц' },
  { value: '3months', label: 'Удалять раз в три месяца' },
];

export default function ArchivePage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const currentProject = useProjectStore((state) => state.currentProject);
  const permissions = useMemo(
    () => getProjectPermissions(currentProject, currentUserId),
    [currentProject, currentUserId],
  );
  const canManageArchive = Boolean(permissions.deleteTask || permissions.manageProject);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cleanupMode, setCleanupMode] = useState<ArchiveCleanupMode>('never');
  const [confirmClear, setConfirmClear] = useState(false);

  const loadArchive = async () => {
    if (!pid) return;
    setTasks(await tasksApi.getArchived(pid));
  };

  useEffect(() => {
    loadArchive();
  }, [pid, cleanupMode]);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    botSettingsApi
      .getArchiveCleanupMode(pid)
      .then((mode) => {
        if (!cancelled) setCleanupMode(mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pid]);

  const updateCleanupMode = async (mode: ArchiveCleanupMode) => {
    if (!canManageArchive) return;
    setCleanupMode(mode);
    const savedMode = await botSettingsApi.setArchiveCleanupMode(pid, mode);
    setCleanupMode(savedMode);
  };

  const clearArchive = async () => {
    if (!canManageArchive) return;
    await tasksApi.clearArchive(pid);
    setConfirmClear(false);
    await loadArchive();
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)]">
      <div className="flex items-center gap-2 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button
          onClick={() => navigate(`/project/${projectId}/workspace`)}
          className="h-8 w-8 text-[var(--tg-theme-link-color)]"
          aria-label="Назад"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Архив</h1>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">{tasks.length} завершенных задач</p>
        </div>
      </div>

      <div className="space-y-4 overflow-y-auto px-4 py-4">
        {canManageArchive ? (
          <>
        <section className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <label className="mb-2 block text-sm font-semibold text-[var(--tg-theme-text-color)]">
            Автоочистка архива
          </label>
          <select
            value={cleanupMode}
            onChange={(event) => updateCleanupMode(event.target.value as ArchiveCleanupMode)}
            className="w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
          >
            {CLEANUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">
            Старые завершенные задачи будут удаляться автоматически при открытии архива.
          </p>
        </section>

        <button
          onClick={() => setConfirmClear(true)}
          disabled={tasks.length === 0}
          className="w-full rounded-[12px] bg-red-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Очистить архив
        </button>

          </>
        ) : (
          <section className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4 text-sm text-[var(--tg-theme-hint-color)]">
            Архив доступен для просмотра. Очистка и автоочистка доступны владельцу или администратору.
          </section>
        )}

        {tasks.length === 0 ? (
          <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color)]">
            В архиве пока нет завершенных задач.
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <article key={task.id} className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{task.title}</h2>
                    {task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">{task.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-1 text-xs font-medium text-green-400">
                    завершена
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">
                  В архиве с {new Date(task.archivedAt ?? task.createdAt).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setConfirmClear(false)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-bold text-[var(--tg-theme-text-color)]">Очистить архив?</h2>
            <p className="mb-4 text-sm text-[var(--tg-theme-hint-color)]">
              Все завершенные задачи в архиве будут удалены без восстановления.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button onClick={clearArchive} className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white">
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
