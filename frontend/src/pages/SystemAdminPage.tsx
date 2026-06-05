import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { systemApi, type SystemStats, type SystemUserRow } from '../api/system';
import { useAuthStore } from '../store/authStore';

export default function SystemAdminPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [blockCandidate, setBlockCandidate] = useState<SystemUserRow | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);

  const refresh = () => {
    if (!currentUser?.id) return Promise.resolve();
    setLoading(true);
    return systemApi.stats(currentUser.id)
      .then((data) => {
        setStats(data);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Нет доступа'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!currentUser?.id) return;
    refresh();
  }, [currentUser?.id]);

  const users = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = stats?.users ?? [];
    if (!normalized) return rows;
    return rows.filter((user) =>
      [user.id, user.telegramId, user.username, user.firstName, user.lastName]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, stats?.users]);

  const blockedUsers = useMemo(() => stats?.users.filter((user) => user.isBlocked) ?? [], [stats?.users]);

  const download = (format: 'csv' | 'json') => {
    if (!currentUser?.id) return;
    const link = document.createElement('a');
    link.href = systemApi.exportUrl(currentUser.id, format);
    link.download = `workspace-users.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const confirmBlockUser = async () => {
    if (!currentUser?.id || !blockCandidate) return;
    setIsBlocking(true);
    try {
      await systemApi.blockUser(currentUser.id, blockCandidate.id);
      setBlockCandidate(null);
      await refresh();
    } finally {
      setIsBlocking(false);
    }
  };

  const unblockUser = async (user: SystemUserRow) => {
    if (!currentUser?.id) return;
    await systemApi.unblockUser(currentUser.id, user.id);
    await refresh();
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <header className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-4">
        <button
          onClick={() => navigate('/')}
          className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-lg text-[var(--tg-theme-link-color)]"
          aria-label="Назад"
        >
          ←
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">Системная панель</h1>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">Только владелец приложения</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" />
          </div>
        ) : error ? (
          <section className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-5">
            <h2 className="font-bold text-red-400">Нет доступа</h2>
            <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
              Эта панель доступна только системному владельцу, заданному в backend `.env`.
            </p>
          </section>
        ) : stats ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              <Metric label="Пользователи" value={stats.totals.users} />
              <Metric label="Заблокированы" value={stats.totals.blockedUsers ?? 0} tone="danger" />
              <Metric label="Проекты" value={stats.totals.projects} />
              <Metric label="Участий" value={stats.totals.projectMembers} />
              <Metric label="Задачи" value={stats.totals.tasks} />
              <Metric label="Завершено" value={stats.totals.completedTasks} />
              <Metric label="Страницы" value={stats.totals.pages} />
              <Metric label="Блоки" value={stats.totals.blocks} />
            </section>

            <section className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">Общий объем данных</h2>
                  <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">
                    Все проекты: {formatBytes(stats.totals.projectDataBytes ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                    Storage: {stats.database.storage} · состояние базы: {formatBytes(stats.database.jsonStateBytes)}
                  </p>
                </div>
                <button
                  onClick={() => refresh()}
                  className="h-9 w-9 rounded-full bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-link-color)]"
                  aria-label="Обновить"
                >
                  ↻
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {stats.database.files.map((file) => (
                  <div key={file.path} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs">
                    <p className="truncate text-[var(--tg-theme-text-color)]">{file.path}</p>
                    <p className="text-[var(--tg-theme-hint-color)]">{formatBytes(file.bytes)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
              <h2 className="font-bold">Экспорт пользователей</h2>
              <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">
                Выгрузка содержит ID, Telegram ID, username, даты, объем данных, статус блокировки и статистику задач.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => download('csv')}
                  className="rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)]"
                >
                  Скачать CSV
                </button>
                <button
                  onClick={() => download('json')}
                  className="rounded-[12px] bg-[var(--tg-theme-bg-color)] py-3 font-semibold text-[var(--tg-theme-text-color)]"
                >
                  Скачать JSON
                </button>
              </div>
            </section>

            {blockedUsers.length > 0 && (
              <section className="rounded-[14px] border border-red-500/30 bg-red-500/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-bold text-red-300">Черный список</h2>
                  <span className="text-xs text-red-200">{blockedUsers.length}</span>
                </div>
                <div className="space-y-2">
                  {blockedUsers.map((user) => (
                    <UserRow
                      key={`blocked-${user.id}`}
                      user={user}
                      onBlock={setBlockCandidate}
                      onUnblock={unblockUser}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-bold">Все участники</h2>
                <span className="text-xs text-[var(--tg-theme-hint-color)]">{users.length}</span>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по id, нику или имени"
                className="mb-3 w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-4 py-3 text-sm outline-none placeholder:text-[var(--tg-theme-hint-color)]"
              />
              <div className="space-y-2">
                {users.map((user) => (
                  <UserRow key={user.id} user={user} onBlock={setBlockCandidate} onUnblock={unblockUser} />
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </main>

      {blockCandidate && (
        <ConfirmBlockModal
          user={blockCandidate}
          isBusy={isBlocking}
          onCancel={() => setBlockCandidate(null)}
          onConfirm={confirmBlockUser}
        />
      )}
    </div>
  );
}

function ConfirmBlockModal({
  user,
  isBusy,
  onCancel,
  onConfirm,
}: {
  user: SystemUserRow;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || user.telegramId;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/55 px-4 pb-4 sm:items-center sm:justify-center sm:pb-0">
      <section className="w-full max-w-md rounded-[18px] bg-[var(--tg-theme-secondary-bg-color)] p-5 shadow-2xl">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-2xl text-red-300">
          !
        </div>
        <h2 className="text-lg font-bold">Заблокировать пользователя?</h2>
        <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
          {displayName} потеряет доступ к программе и Telegram-боту. Его данные останутся в базе, а доступ можно будет восстановить из черного списка.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-[12px] bg-[var(--tg-theme-bg-color)] py-3 font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={isBusy}
            className="rounded-[12px] bg-red-500 py-3 font-semibold text-white disabled:opacity-60"
          >
            {isBusy ? 'Блокирую...' : 'Заблокировать'}
          </button>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className={`rounded-[14px] p-4 ${tone === 'danger' ? 'bg-red-500/10' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}>
      <p className={`text-2xl font-bold ${tone === 'danger' ? 'text-red-300' : ''}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function UserRow({
  user,
  onBlock,
  onUnblock,
}: {
  user: SystemUserRow;
  onBlock: (user: SystemUserRow) => void;
  onUnblock: (user: SystemUserRow) => void;
}) {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || user.telegramId;
  const createdAt = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : 'не указана';
  return (
    <div className={`rounded-[12px] p-3 ${user.isBlocked ? 'bg-red-500/10' : 'bg-[var(--tg-theme-bg-color)]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{displayName}</p>
            {user.isBlocked && <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-200">заблокирован</span>}
          </div>
          <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">
            id {user.id} · tg {user.telegramId} · @{user.username || '-'}
          </p>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Регистрация: {createdAt}</p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs">
          {user.projectsCount} пр.
        </span>
      </div>

      <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-2">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span>Память</span>
          <span>{formatBytes(user.storageBytes)} / {user.storageLimitMb} MB</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--tg-theme-bg-color)]">
          <div
            className={`h-full rounded-full ${user.storageUsagePercent > 90 ? 'bg-red-400' : 'bg-[var(--tg-theme-button-color)]'}`}
            style={{ width: `${Math.max(1, Math.min(100, user.storageUsagePercent))}%` }}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <MiniStat label="активные" value={user.activeAssignedTasksCount} />
        <MiniStat label="завершено" value={user.completedAssignedTasksCount} />
        <MiniStat label="создал" value={user.createdTasksCount} />
      </div>

      <div className="mt-3">
        {user.isBlocked ? (
          <button
            onClick={() => onUnblock(user)}
            className="w-full rounded-[12px] bg-green-500/20 py-2 text-sm font-semibold text-green-200"
          >
            Восстановить доступ
          </button>
        ) : (
          <button
            onClick={() => onBlock(user)}
            className="w-full rounded-[12px] bg-red-500/20 py-2 text-sm font-semibold text-red-200"
          >
            Заблокировать доступ
          </button>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] py-2">
      <p className="font-bold">{value}</p>
      <p className="text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex <= 1 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
