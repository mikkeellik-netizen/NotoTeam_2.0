import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  systemApi,
  type SystemPerformanceWindow,
  type SystemSecurityEvent,
  type SystemSecuritySummary,
  type SystemStats,
  type SystemUserRow,
} from '../api/system';
import { useAuthStore } from '../store/authStore';

type SectionId = 'overview' | 'performance' | 'storage' | 'server' | 'bot' | 'users' | 'security';
type Status = SystemStats['services'][number]['status'];

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'performance', label: 'Производительность' },
  { id: 'storage', label: 'Хранилище' },
  { id: 'server', label: 'Сервер' },
  { id: 'bot', label: 'Telegram-бот' },
  { id: 'users', label: 'Пользователи' },
  { id: 'security', label: 'Безопасность' },
];

export default function SystemAdminPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);
  const [section, setSection] = useState<SectionId>('overview');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  const [blockCandidate, setBlockCandidate] = useState<SystemUserRow | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);
  const [securityEvents, setSecurityEvents] = useState<SystemSecurityEvent[]>([]);
  const [securitySummary, setSecuritySummary] = useState<SystemSecuritySummary | null>(null);
  const [securityTotal, setSecurityTotal] = useState(0);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [performanceWindow, setPerformanceWindow] = useState<'15m' | '1h' | '24h'>('1h');
  const isLocalDevPreview = currentUser?.telegramId === 'local-dev';

  const refresh = useCallback(async (quiet = false) => {
    if (!currentUser?.id) return;
    if (!quiet) setLoading(true);
    try {
      const data = await systemApi.stats(currentUser.id);
      setStats(data);
      setUpdatedAt(new Date());
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить системные данные');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [currentUser?.id]);

  const loadSecurityEvents = useCallback(async (offset = 0) => {
    if (!currentUser?.id) return;
    setSecurityLoading(true);
    try {
      const data = await systemApi.securityEvents(currentUser.id, { offset, limit: 50 });
      setSecurityEvents((items) => (offset > 0 ? [...items, ...data.events] : data.events));
      setSecurityTotal(data.total ?? data.events.length);
      setSecuritySummary(data.summary);
      setSecurityError('');
    } catch (requestError) {
      setSecurityError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить журнал');
    } finally {
      setSecurityLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (section === 'security' && securityEvents.length === 0) void loadSecurityEvents();
  }, [loadSecurityEvents, section, securityEvents.length]);

  const users = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = stats?.users ?? [];
    if (!normalized) return rows;
    return rows.filter((user) =>
      [user.id, user.telegramId, user.username, user.firstName, user.lastName].join(' ').toLowerCase().includes(normalized),
    );
  }, [query, stats?.users]);

  const frontend = useMemo(readFrontendMetrics, [updatedAt]);

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
      await refresh(true);
    } finally {
      setIsBlocking(false);
    }
  };

  const unblockUser = async (user: SystemUserRow) => {
    if (!currentUser?.id) return;
    await systemApi.unblockUser(currentUser.id, user.id);
    await refresh(true);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <header className="border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-lg text-[var(--tg-theme-link-color)]"
            aria-label="Назад"
            title="Назад"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">Системная панель</h1>
            <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">
              {isLocalDevPreview ? 'Локальный режим разработчика' : 'Владелец продукта · доступ по Telegram ID'}
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Автообновление 30 сек</p>
            <p className="text-xs">{updatedAt ? updatedAt.toLocaleTimeString('ru-RU') : '—'}</p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-lg text-[var(--tg-theme-link-color)] disabled:opacity-50"
            aria-label="Обновить"
            title="Обновить"
          >
            ↻
          </button>
        </div>
      </header>

      <nav className="border-b border-[var(--tg-theme-secondary-bg-color)] px-4">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto py-2">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                section === item.id
                  ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                  : 'text-[var(--tg-theme-hint-color)] hover:bg-[var(--tg-theme-secondary-bg-color)] hover:text-[var(--tg-theme-text-color)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-6xl">
          {loading && !stats ? (
            <Loading />
          ) : error && !stats ? (
            <AccessError message={error} />
          ) : stats ? (
            <>
              {error && <InlineError message={`Последнее обновление не удалось: ${error}`} />}
              {section === 'overview' && <Overview stats={stats} />}
              {section === 'performance' && (
                <Performance
                  stats={stats}
                  frontend={frontend}
                  activeWindow={performanceWindow}
                  onWindowChange={setPerformanceWindow}
                />
              )}
              {section === 'storage' && <Storage stats={stats} />}
              {section === 'server' && <Server stats={stats} />}
              {section === 'bot' && <Bot stats={stats} />}
              {section === 'users' && (
                <Users
                  users={users}
                  allUsers={stats.users}
                  query={query}
                  onQueryChange={setQuery}
                  onBlock={setBlockCandidate}
                  onUnblock={unblockUser}
                  onDownload={download}
                />
              )}
              {section === 'security' && (
                <SecurityEventsPanel
                  events={securityEvents}
                  summary={securitySummary}
                  total={securityTotal}
                  loading={securityLoading}
                  error={securityError}
                  onRefresh={() => loadSecurityEvents()}
                  onLoadMore={() => loadSecurityEvents(securityEvents.length)}
                />
              )}
            </>
          ) : null}
        </div>
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

function Overview({ stats }: { stats: SystemStats }) {
  const owner = stats.owner.users[0];
  return (
    <div className="space-y-5">
      <SectionHeading title="Состояние системы" subtitle="Ключевые сервисы и рабочая нагрузка" />
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {stats.services.map((service) => (
          <div key={service.id} className="rounded-lg border border-[var(--tg-theme-secondary-bg-color)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{service.label}</p>
              <StatusBadge status={service.status} />
            </div>
            <p className="mt-2 truncate text-xs text-[var(--tg-theme-hint-color)]" title={service.detail}>{service.detail}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 font-bold">Продукт</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Metric label="Пользователи" value={stats.totals.users} />
          <Metric label="Активны 30 дней" value={stats.totals.activeUsers30d} />
          <Metric label="Проекты" value={stats.totals.activeProjects} />
          <Metric label="Участники" value={stats.totals.projectMembers} />
          <Metric label="Активные задачи" value={stats.totals.activeTasks} />
          <Metric label="Страницы" value={stats.totals.pages} />
          <Metric label="Файлы" value={stats.storage.projectFiles} />
          <Metric label="Ошибки API 1ч" value={stats.performance.windows['1h'].errors} tone={stats.performance.windows['1h'].errors ? 'danger' : undefined} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="font-bold">Владелец продукта</h2>
          <p className="mt-3 text-sm font-semibold">{owner ? formatUserName(owner) : 'Аккаунт ещё не найден в базе'}</p>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
            Telegram ID: {stats.owner.telegramIds.join(', ') || 'не настроен'}
          </p>
          {owner?.username && <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">@{owner.username}</p>}
          <p className="mt-3 text-xs text-[var(--tg-theme-hint-color)]">
            Ник используется только для отображения. Проверка доступа выполняется по неизменяемому Telegram ID.
          </p>
        </div>
        <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="font-bold">Быстрая диагностика</h2>
          <KeyValue label="API p95 за час" value={`${stats.performance.windows['1h'].p95Ms} мс`} />
          <KeyValue label="Память процесса" value={formatBytes(stats.server.memory.rssBytes)} />
          <KeyValue label="Данные проектов" value={formatBytes(stats.totals.projectDataBytes)} />
          <KeyValue label="Очередь бота" value={`${stats.bot.outbox.pending + stats.bot.notifications.due + stats.bot.reminders.due}`} />
        </div>
      </section>
    </div>
  );
}

type FrontendMetrics = ReturnType<typeof readFrontendMetrics>;

function Performance({
  stats,
  frontend,
  activeWindow,
  onWindowChange,
}: {
  stats: SystemStats;
  frontend: FrontendMetrics;
  activeWindow: '15m' | '1h' | '24h';
  onWindowChange: (value: '15m' | '1h' | '24h') => void;
}) {
  const selected = stats.performance.windows[activeWindow];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading title="Производительность" subtitle={`Метрики API собираются с ${formatDateTime(stats.performance.since)}`} />
        <div className="flex rounded-md bg-[var(--tg-theme-secondary-bg-color)] p-1">
          {(['15m', '1h', '24h'] as const).map((windowId) => (
            <button
              key={windowId}
              onClick={() => onWindowChange(windowId)}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${activeWindow === windowId ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'text-[var(--tg-theme-hint-color)]'}`}
            >
              {windowId === '15m' ? '15 мин' : windowId === '1h' ? '1 час' : '24 часа'}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Metric label="Запросы" value={selected.requests} />
        <Metric label="В минуту" value={selected.requestsPerMinute} />
        <Metric label="Среднее" value={`${selected.averageMs} мс`} />
        <Metric label="p50" value={`${selected.p50Ms} мс`} />
        <Metric label="p95" value={`${selected.p95Ms} мс`} tone={selected.p95Ms > 1000 ? 'danger' : undefined} />
        <Metric label="p99" value={`${selected.p99Ms} мс`} />
        <Metric label="Ошибки 5xx" value={selected.errors} tone={selected.errors ? 'danger' : undefined} />
        <Metric label="Ответы" value={formatBytes(selected.responseBytes)} />
      </section>

      <section>
        <h2 className="mb-3 font-bold">Самые медленные маршруты</h2>
        {selected.slowRoutes.length ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--tg-theme-secondary-bg-color)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[var(--tg-theme-secondary-bg-color)] text-xs text-[var(--tg-theme-hint-color)]">
                <tr><th className="p-3">Маршрут</th><th className="p-3">Запросы</th><th className="p-3">Среднее</th><th className="p-3">p95</th><th className="p-3">Максимум</th><th className="p-3">Ошибки</th></tr>
              </thead>
              <tbody>
                {selected.slowRoutes.map((route) => (
                  <tr key={route.route} className="border-t border-[var(--tg-theme-secondary-bg-color)]">
                    <td className="p-3 font-mono text-xs">{route.route}</td><td className="p-3">{route.requests}</td><td className="p-3">{route.averageMs} мс</td><td className="p-3">{route.p95Ms} мс</td><td className="p-3">{route.maxMs} мс</td><td className="p-3">{route.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="Запросов в выбранном периоде пока нет" />}
      </section>

      <section>
        <h2 className="mb-3 font-bold">Текущий frontend</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Загрузка страницы" value={frontend.loadMs ? `${frontend.loadMs} мс` : 'в процессе'} />
          <Metric label="Передано" value={formatBytes(frontend.transferBytes)} />
          <Metric label="JS" value={formatBytes(frontend.scriptBytes)} />
          <Metric label="CSS" value={formatBytes(frontend.styleBytes)} />
        </div>
        <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">Размеры взяты из браузера для уже загруженных ресурсов этой сессии.</p>
      </section>
    </div>
  );
}

function Storage({ stats }: { stats: SystemStats }) {
  const totalKnown = stats.storage.databaseFilesBytes + stats.storage.projectFileBytes;
  return (
    <div className="space-y-5">
      <SectionHeading title="Хранилище" subtitle="Размеры БД, файлов и крупнейших проектов" />
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Физический размер БД" value={formatBytes(stats.storage.databaseFilesBytes)} />
        <Metric label="Состояние БД" value={formatBytes(stats.storage.databaseBytes)} />
        <Metric label="Файлы проектов" value={formatBytes(stats.storage.projectFileBytes)} />
        <Metric label="Учтено всего" value={formatBytes(totalKnown)} />
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <h2 className="mb-3 font-bold">Крупнейшие проекты</h2>
          <div className="space-y-2">
            {stats.storage.topProjects.map((project) => (
              <div key={project.reference} className="rounded-lg border border-[var(--tg-theme-secondary-bg-color)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">Проект {project.reference}</p>
                  <p className="shrink-0 text-sm font-bold">{formatBytes(project.totalBytes)}</p>
                </div>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                  Данные {formatBytes(project.dataBytes)} · файлы {formatBytes(project.fileBytes)} · задач {project.tasks} · файлов {project.files}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">
            Названия и внутренние ID проектов скрыты. Обезличенный код нужен только для сравнения объёма между обновлениями.
          </p>
        </div>
        <div>
          <h2 className="mb-3 font-bold">Коллекции</h2>
          <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <KeyValue label="Провайдер файлов" value={stats.storage.provider} />
            {stats.storage.collections.map((collection) => <KeyValue key={collection.name} label={collection.name} value={collection.count} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

function Server({ stats }: { stats: SystemStats }) {
  const server = stats.server;
  const hostUsed = server.memory.hostTotalBytes - server.memory.hostFreeBytes;
  return (
    <div className="space-y-5">
      <SectionHeading title="Сервер" subtitle={`Запущен ${formatDateTime(server.startedAt)} · uptime ${formatDuration(server.uptimeSeconds)}`} />
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="RAM процесса" value={formatBytes(server.memory.rssBytes)} />
        <Metric label="Heap Node.js" value={`${formatBytes(server.memory.heapUsedBytes)} / ${formatBytes(server.memory.heapTotalBytes)}`} />
        <Metric label="RAM сервера" value={`${formatBytes(hostUsed)} / ${formatBytes(server.memory.hostTotalBytes)}`} />
        <Metric label="Задержка event loop" value={`${server.eventLoopLagMs} мс`} tone={server.eventLoopLagMs > 200 ? 'danger' : undefined} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="font-bold">Среда выполнения</h2>
          <KeyValue label="Режим" value={server.environment} />
          <KeyValue label="Node.js" value={server.nodeVersion} />
          <KeyValue label="Платформа" value={`${server.platform} / ${server.architecture}`} />
          <KeyValue label="PID" value={server.pid} />
          <KeyValue label="Запись БД" value={server.databaseWrite.flushPending ? 'ожидает сохранения' : server.databaseWrite.dirty ? 'есть изменения' : 'сохранено'} />
        </div>
        <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="font-bold">Процессор и диск</h2>
          <KeyValue label="CPU" value={server.cpu.model} />
          <KeyValue label="Ядра" value={server.cpu.cores} />
          <KeyValue label="Load average" value={server.cpu.loadAverage.map((item) => item.toFixed(2)).join(' / ')} />
          {server.disk ? (
            <>
              <KeyValue label={server.disk.label} value={`${formatBytes(server.disk.usedBytes)} / ${formatBytes(server.disk.totalBytes)}`} />
              <UsageBar value={server.disk.usagePercent} danger={server.disk.usagePercent > 90} />
            </>
          ) : <p className="mt-3 text-xs text-[var(--tg-theme-hint-color)]">Метрики диска недоступны в этой среде.</p>}
        </div>
      </section>
    </div>
  );
}

function Bot({ stats }: { stats: SystemStats }) {
  const bot = stats.bot;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading title="Telegram-бот" subtitle="Работоспособность, очереди и настройки уведомлений" />
        <StatusBadge status={bot.status} />
      </div>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Запросы за час" value={bot.apiRequests1h} />
        <Metric label="Outbox ожидает" value={bot.outbox.pending} tone={bot.outbox.pending > 20 ? 'danger' : undefined} />
        <Metric label="Уведомления ожидают" value={bot.notifications.pending} />
        <Metric label="Уведомления просрочены" value={bot.notifications.due} tone={bot.notifications.due ? 'danger' : undefined} />
        <Metric label="Напоминания к отправке" value={bot.reminders.due} tone={bot.reminders.due ? 'danger' : undefined} />
        <Metric label="Ошибки отправки" value={bot.notifications.failed} tone={bot.notifications.failed ? 'danger' : undefined} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="font-bold">Подключение</h2>
          <KeyValue label="Telegram token" value={bot.tokenConfigured ? 'настроен' : 'не настроен'} />
          <KeyValue label="Внутренний API token" value={bot.internalApiTokenConfigured ? 'настроен' : 'не настроен'} />
          <KeyValue label="Последняя активность" value={bot.lastSeenAt ? formatDateTime(bot.lastSeenAt) : 'после запуска API не было'} />
          <KeyValue label="Последний маршрут" value={bot.lastPath ?? '—'} />
          <KeyValue label="Последний HTTP-статус" value={bot.lastStatus ?? '—'} />
        </div>
        <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="font-bold">Уведомления в проектах</h2>
          <KeyValue label="Дедлайны включены" value={`${bot.projects.deadlineNotificationsEnabled} / ${bot.projects.total}`} />
          <KeyValue label="Упоминания включены" value={`${bot.projects.mentionNotificationsEnabled} / ${bot.projects.total}`} />
          <KeyValue label="Дежурства включены" value={`${bot.projects.dutyNotificationsEnabled} / ${bot.projects.total}`} />
          <KeyValue label="Активные напоминания" value={bot.reminders.active} />
          <KeyValue label="С Telegram-каналом" value={bot.reminders.telegramEnabled} />
          <KeyValue label="Отправлено за 24 часа" value={bot.reminders.sent24h} />
        </div>
      </section>
      {bot.status === 'unknown' && (
        <InlineNotice text="Статус станет точным после первого обращения бота к API. Если очереди растут, а активности нет, проверьте контейнер бота и INTERNAL_API_TOKEN." />
      )}
    </div>
  );
}

function Users({
  users,
  allUsers,
  query,
  onQueryChange,
  onBlock,
  onUnblock,
  onDownload,
}: {
  users: SystemUserRow[];
  allUsers: SystemUserRow[];
  query: string;
  onQueryChange: (value: string) => void;
  onBlock: (user: SystemUserRow) => void;
  onUnblock: (user: SystemUserRow) => Promise<void>;
  onDownload: (format: 'csv' | 'json') => void;
}) {
  const blocked = allUsers.filter((user) => user.isBlocked).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading title="Пользователи" subtitle={`${allUsers.length} всего · ${blocked} заблокировано`} />
        <div className="flex gap-2">
          <button onClick={() => onDownload('csv')} className="rounded-md bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm font-semibold">CSV</button>
          <button onClick={() => onDownload('json')} className="rounded-md bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm font-semibold">JSON</button>
        </div>
      </div>
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Поиск по ID, нику или имени"
        className="w-full rounded-lg bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-sm outline-none placeholder:text-[var(--tg-theme-hint-color)]"
      />
      <div className="grid gap-2 lg:grid-cols-2">
        {users.map((user) => <UserRow key={user.id} user={user} onBlock={onBlock} onUnblock={onUnblock} />)}
      </div>
      {!users.length && <Empty text="Пользователи не найдены" />}
    </div>
  );
}

type SecurityCategory = 'all' | 'login' | 'rate_limit' | 'project_access' | 'blocks';

const SECURITY_FILTERS: Array<{ id: SecurityCategory; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'login', label: 'Вход' },
  { id: 'rate_limit', label: 'Rate limit' },
  { id: 'project_access', label: 'Чужие проекты' },
  { id: 'blocks', label: 'Блокировки' },
];

function SecurityEventsPanel({ events, summary, total, loading, error, onRefresh, onLoadMore }: {
  events: SystemSecurityEvent[];
  summary: SystemSecuritySummary | null;
  total: number;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
}) {
  const [period, setPeriod] = useState<'24h' | '7d'>('24h');
  const [category, setCategory] = useState<SecurityCategory>('all');
  const counts = summary?.windows[period];
  const filteredEvents = events.filter((event) => securityEventMatchesCategory(event, category));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading title="Безопасность" subtitle="Попытки входа, ограничения и нарушения границ доступа" />
        <div className="flex rounded-md bg-[var(--tg-theme-secondary-bg-color)] p-1">
          {(['24h', '7d'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${period === value ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'text-[var(--tg-theme-hint-color)]'}`}
            >
              {value === '24h' ? '24 часа' : '7 дней'}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Неудачные входы" value={counts?.failedLogins ?? 0} tone={counts?.failedLogins ? 'danger' : undefined} />
        <Metric label="Срабатывания rate limit" value={counts?.rateLimitHits ?? 0} tone={counts?.rateLimitHits ? 'danger' : undefined} />
        <Metric label="Заблокировано сейчас" value={(summary?.blocked.ips.length ?? 0) + (summary?.blocked.users.length ?? 0)} tone={(summary?.blocked.ips.length ?? 0) + (summary?.blocked.users.length ?? 0) ? 'danger' : undefined} />
        <Metric label="Доступ к чужим проектам" value={counts?.foreignProjectAccessAttempts ?? 0} tone={counts?.foreignProjectAccessAttempts ? 'danger' : undefined} />
      </section>

      <section className="grid gap-5 border-y border-[var(--tg-theme-secondary-bg-color)] py-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Заблокированные IP</h3>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Хранятся только обезличенные отпечатки, блокировка временная.</p>
          <div className="mt-3 space-y-2">
            {summary?.blocked.ips.map((item) => (
              <div key={item.reference} className="flex items-center justify-between gap-3 rounded-md bg-red-500/10 px-3 py-2 text-sm">
                <span className="font-mono text-xs">IP-{item.reference.slice(0, 8).toUpperCase()}</span>
                <span className="text-xs text-[var(--tg-theme-hint-color)]">до {formatDateTime(item.blockedUntil)}</span>
              </div>
            ))}
            {!summary?.blocked.ips.length && <p className="py-3 text-sm text-[var(--tg-theme-hint-color)]">Активных IP-блокировок нет</p>}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold">Заблокированные пользователи</h3>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Аккаунты, которым владелец продукта закрыл доступ.</p>
          <div className="mt-3 space-y-2">
            {summary?.blocked.users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3 rounded-md bg-red-500/10 px-3 py-2 text-sm">
                <span className="truncate font-medium">{formatUserName(user)}</span>
                <span className="shrink-0 text-xs text-[var(--tg-theme-hint-color)]">{user.blockedAt ? formatDateTime(user.blockedAt) : 'заблокирован'}</span>
              </div>
            ))}
            {!summary?.blocked.users.length && <p className="py-3 text-sm text-[var(--tg-theme-hint-color)]">Заблокированных пользователей нет</p>}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading title="Журнал событий" subtitle={`Загружено ${events.length} из ${total}`} />
          <button onClick={() => void onRefresh()} disabled={loading} className="rounded-md bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm font-semibold disabled:opacity-50">Обновить</button>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {SECURITY_FILTERS.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setCategory(filter.id)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${category === filter.id ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-hint-color)]'}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {error && <InlineError message={error} />}
        <div className="space-y-2">
          {filteredEvents.map((event) => <SecurityEventRow key={event.id} event={event} />)}
        </div>
        {!filteredEvents.length && <Empty text={loading ? 'Загрузка журнала...' : 'В этой категории событий пока нет'} />}
        {events.length < total && (
          <button onClick={() => void onLoadMore()} disabled={loading} className="w-full rounded-md bg-[var(--tg-theme-secondary-bg-color)] py-3 text-sm font-semibold disabled:opacity-50">
            {loading ? 'Загрузка...' : 'Показать ещё'}
          </button>
        )}
      </section>
    </div>
  );
}

const SECURITY_EVENT_LABELS: Record<string, string> = {
  auth_code_request: 'Запрос кода входа',
  auth_code_verify: 'Проверка кода входа',
  auth_dev_local: 'Локальный вход разработчика',
  rate_limit: 'Сработал rate limit',
  auth_ip_block: 'Временная блокировка IP',
  project_access_denied: 'Попытка доступа к чужому проекту',
  system_user_block: 'Блокировка пользователя',
  system_user_unblock: 'Восстановление доступа',
  system_reset: 'Сброс базы',
  project_export_download: 'Экспорт проекта',
  project_export_telegram: 'Экспорт в Telegram',
  project_invite_code_rotate: 'Новый код проекта',
  project_join_request_approve: 'Заявка одобрена',
  project_join_request_reject: 'Заявка отклонена',
  project_member_add: 'Добавлен участник',
  project_member_remove: 'Удалён участник',
  project_member_admin_toggle: 'Изменены права администратора',
  project_member_role_change: 'Изменена роль',
  project_member_leave: 'Участник вышел',
  project_ownership_transfer: 'Передача владельца',
};

const SECURITY_OUTCOME_LABELS: Record<string, string> = {
  success: 'Успешно',
  delivered: 'Отправлено',
  rejected: 'Отклонено',
  blocked: 'Заблокировано',
  not_delivered: 'Не отправлено',
  failed_no_record: 'Код не найден',
  failed_code: 'Неверный код',
  expired: 'Код истёк',
  locked: 'Попытки исчерпаны',
};

function securityEventMatchesCategory(event: SystemSecurityEvent, category: SecurityCategory) {
  if (category === 'all') return true;
  if (category === 'login') return event.type.startsWith('auth_code_') || event.type === 'auth_dev_local';
  if (category === 'rate_limit') return event.type === 'rate_limit';
  if (category === 'project_access') return event.type === 'project_access_denied';
  return event.type === 'auth_ip_block' || event.type === 'system_user_block' || event.type === 'system_user_unblock';
}

function SecurityEventRow({ event }: { event: SystemSecurityEvent }) {
  const isDanger = ['rate_limit', 'auth_ip_block', 'project_access_denied'].includes(event.type)
    || Boolean(event.outcome && !['success', 'delivered'].includes(event.outcome));
  const context = [
    event.actorUserId && `Пользователь ${event.actorUserId}`,
    event.targetUserId && `Аккаунт ${event.targetUserId}`,
    event.projectReference && `Проект ${event.projectReference}`,
    event.details.route && `${event.details.method ?? ''} ${event.details.route}`.trim(),
    event.details.scope && `Лимит: ${String(event.details.scope).replace('username', 'аккаунт').replace('ip', 'IP')}`,
    event.details.ipRef && `IP-${String(event.details.ipRef).slice(0, 8).toUpperCase()}`,
  ].filter(Boolean);
  return (
    <article className="rounded-lg border border-[var(--tg-theme-secondary-bg-color)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{SECURITY_EVENT_LABELS[event.type] ?? event.type}</p>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{formatDateTime(event.createdAt)}</p>
        </div>
        <span className={`rounded px-2 py-1 text-xs ${isDanger ? 'bg-red-500/15 text-red-300' : 'bg-green-500/15 text-green-300'}`}>{SECURITY_OUTCOME_LABELS[event.outcome] ?? event.outcome}</span>
      </div>
      <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">
        {context.join(' · ') || 'Системное событие'}
      </p>
    </article>
  );
}

function UserRow({ user, onBlock, onUnblock }: {
  user: SystemUserRow;
  onBlock: (user: SystemUserRow) => void;
  onUnblock: (user: SystemUserRow) => Promise<void>;
}) {
  return (
    <article className={`rounded-lg border p-3 ${user.isBlocked ? 'border-red-500/30 bg-red-500/10' : 'border-[var(--tg-theme-secondary-bg-color)]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{formatUserName(user)}</p>
          <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">ID {user.id} · TG {user.telegramId} · @{user.username || '—'}</p>
        </div>
        <button
          onClick={() => user.isBlocked ? void onUnblock(user) : onBlock(user)}
          className={`shrink-0 rounded-md px-3 py-2 text-xs font-semibold ${user.isBlocked ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}
        >
          {user.isBlocked ? 'Разблокировать' : 'Заблокировать'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        <MiniStat label="проекты" value={user.projectsCount} />
        <MiniStat label="активные" value={user.activeAssignedTasksCount} />
        <MiniStat label="готово" value={user.completedAssignedTasksCount} />
        <MiniStat label="данные" value={formatBytes(user.storageBytes)} />
      </div>
    </article>
  );
}

function ConfirmBlockModal({ user, isBusy, onCancel, onConfirm }: {
  user: SystemUserRow;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-4 sm:items-center sm:justify-center">
      <section className="w-full max-w-md rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-5 shadow-2xl">
        <h2 className="text-lg font-bold">Заблокировать пользователя?</h2>
        <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
          {formatUserName(user)} потеряет доступ к приложению и боту. Данные останутся в базе, доступ можно восстановить.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} disabled={isBusy} className="rounded-md bg-[var(--tg-theme-bg-color)] py-3 font-semibold disabled:opacity-50">Отмена</button>
          <button onClick={onConfirm} disabled={isBusy} className="rounded-md bg-red-500 py-3 font-semibold text-white disabled:opacity-50">{isBusy ? 'Блокировка...' : 'Заблокировать'}</button>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">{subtitle}</p></div>;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' }) {
  return (
    <div className={`min-w-0 rounded-lg p-3 ${tone === 'danger' ? 'bg-red-500/10' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}>
      <p className={`truncate text-lg font-bold ${tone === 'danger' ? 'text-red-300' : ''}`} title={String(value)}>{value}</p>
      <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-[var(--tg-theme-secondary-bg-color)] p-2"><p className="truncate font-bold">{value}</p><p className="truncate text-[var(--tg-theme-hint-color)]">{label}</p></div>;
}

function KeyValue({ label, value }: { label: string; value: string | number }) {
  return <div className="mt-3 flex items-start justify-between gap-4 border-t border-[var(--tg-theme-bg-color)] pt-3 text-sm"><span className="text-[var(--tg-theme-hint-color)]">{label}</span><span className="max-w-[60%] break-words text-right font-medium">{value}</span></div>;
}

function StatusBadge({ status }: { status: Status }) {
  const config: Record<Status, { label: string; classes: string }> = {
    online: { label: 'Работает', classes: 'bg-green-500/15 text-green-300' },
    idle: { label: 'Ожидает', classes: 'bg-blue-500/15 text-blue-300' },
    stale: { label: 'Нет связи', classes: 'bg-yellow-500/15 text-yellow-300' },
    unknown: { label: 'Нет данных', classes: 'bg-yellow-500/15 text-yellow-300' },
    offline: { label: 'Недоступен', classes: 'bg-red-500/15 text-red-300' },
    not_configured: { label: 'Не настроен', classes: 'bg-gray-500/15 text-[var(--tg-theme-hint-color)]' },
  };
  return <span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${config[status].classes}`}>{config[status].label}</span>;
}

function UsageBar({ value, danger }: { value: number; danger?: boolean }) {
  return <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--tg-theme-bg-color)]"><div className={`h-full ${danger ? 'bg-red-400' : 'bg-[var(--tg-theme-button-color)]'}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function Loading() {
  return <div className="flex justify-center py-16"><div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" /></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] px-4 py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">{text}</div>;
}

function InlineError({ message }: { message: string }) {
  return <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{message}</div>;
}

function InlineNotice({ text }: { text: string }) {
  return <div className="rounded-lg bg-blue-500/10 px-4 py-3 text-sm text-blue-200">{text}</div>;
}

function AccessError({ message }: { message: string }) {
  return (
    <section className="rounded-lg bg-[var(--tg-theme-secondary-bg-color)] p-5">
      <h2 className="font-bold text-red-300">Нет доступа</h2>
      <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">{message}</p>
      <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">Панель доступна только Telegram ID, указанным в APP_OWNER_TELEGRAM_IDS.</p>
    </section>
  );
}

function readFrontendMetrics() {
  if (typeof performance === 'undefined') return { loadMs: 0, transferBytes: 0, scriptBytes: 0, styleBytes: 0 };
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const bytesFor = (entry: PerformanceResourceTiming) => entry.transferSize || entry.encodedBodySize || 0;
  return {
    loadMs: navigation?.loadEventEnd ? Math.round(navigation.loadEventEnd - navigation.startTime) : 0,
    transferBytes: resources.reduce((sum, entry) => sum + bytesFor(entry), 0),
    scriptBytes: resources.filter((entry) => entry.initiatorType === 'script').reduce((sum, entry) => sum + bytesFor(entry), 0),
    styleBytes: resources.filter((entry) => entry.initiatorType === 'css' || entry.initiatorType === 'link').reduce((sum, entry) => sum + bytesFor(entry), 0),
  };
}

function formatUserName(user: { firstName?: string; lastName?: string; username?: string; telegramId?: string }) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : user.telegramId || 'Без имени');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ч ${minutes % 60} мин`;
  return `${Math.floor(hours / 24)} дн ${hours % 24} ч`;
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
  return `${value.toFixed(unitIndex <= 1 ? 1 : 2)} ${units[unitIndex]}`;
}
