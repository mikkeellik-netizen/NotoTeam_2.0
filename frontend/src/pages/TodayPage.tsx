import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { calendarApi } from '../api/calendar';
import { tasksApi, type UserTaskProgress } from '../api/tasks';
import { useAuthStore } from '../store/authStore';
import type { Calendar, CalendarEvent, Task } from '../types';

type TodayData = {
  tasks: Task[];
  events: CalendarEvent[];
  calendars: Calendar[];
  stats: UserTaskProgress;
};

export default function TodayPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.id);
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    const dayStart = startOfDay(new Date());
    const weekEnd = new Date(dayStart.getTime() + 8 * 24 * 3600000);
    try {
      const [taskGroups, events, calendars] = await Promise.all([
        tasksApi.getMyTasks(userId),
        calendarApi.listMine({ from: dayStart.toISOString(), to: weekEnd.toISOString() }),
        calendarApi.listCalendars(),
      ]);
      setData({
        tasks: [...taskGroups.red, ...taskGroups.yellow, ...taskGroups.green, ...taskGroups.noDate],
        events,
        calendars,
        stats: taskGroups.stats,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить данные дня');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const dayStart = useMemo(() => startOfDay(new Date()), []);
  const dayEnd = useMemo(() => new Date(dayStart.getTime() + 24 * 3600000), [dayStart]);
  const calendarById = useMemo(() => new Map((data?.calendars ?? []).map((item) => [item.id, item])), [data?.calendars]);
  const dueToday = useMemo(() => (data?.tasks ?? []).filter((task) => isWithin(task.deadlineAt, dayStart, dayEnd)), [data?.tasks, dayEnd, dayStart]);
  const overdue = useMemo(() => (data?.tasks ?? []).filter((task) => task.deadlineAt && new Date(task.deadlineAt) < dayStart), [data?.tasks, dayStart]);
  const todayEvents = useMemo(() => (data?.events ?? []).filter((event) => eventOverlapsDay(event, dayStart, dayEnd)), [data?.events, dayEnd, dayStart]);
  const upcoming = useMemo(() => (data?.tasks ?? [])
    .filter((task) => task.deadlineAt && new Date(task.deadlineAt) >= dayEnd)
    .sort((left, right) => new Date(left.deadlineAt!).getTime() - new Date(right.deadlineAt!).getTime())
    .slice(0, 5), [data?.tasks, dayEnd]);

  const openTask = (task: Task) => {
    const target = task.pageId
      ? `/project/${task.projectId}/workspace/page/${task.pageId}`
      : `/project/${task.projectId}/workspace`;
    navigate(`${target}?taskId=${task.id}&returnTo=${encodeURIComponent('/today')}`);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <header className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button type="button" onClick={() => navigate('/')} className="h-9 w-9 text-xl text-[var(--tg-theme-link-color)]" aria-label="Назад">←</button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold">Сегодня</h1>
          <p className="truncate text-xs capitalize text-[var(--tg-theme-hint-color)]">{formatLongDate(new Date())}</p>
        </div>
        <button type="button" onClick={() => void load()} className="h-9 w-9 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] text-lg" aria-label="Обновить">↻</button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-20"><div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" /></div>
        ) : error ? (
          <div className="rounded-[8px] border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            <section className="grid grid-cols-3 divide-x divide-[var(--tg-theme-secondary-bg-color)] border-y border-[var(--tg-theme-secondary-bg-color)] py-3 text-center">
              <TodayMetric value={dueToday.length} label="На сегодня" color="#3B82F6" />
              <TodayMetric value={todayEvents.length} label="События" color="#8B5CF6" />
              <TodayMetric value={overdue.length} label="Просрочено" color={overdue.length ? '#EF4444' : '#22C55E'} />
            </section>

            <TodaySection title="Расписание" actionLabel="Календарь" onAction={() => navigate('/my-calendar')} empty="На сегодня событий нет">
              {todayEvents.map((event) => {
                const calendar = calendarById.get(event.calendarId);
                return (
                  <button key={event.id} type="button" onClick={() => navigate('/my-calendar')} className="flex w-full items-start gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] py-3 text-left last:border-0">
                    <span className="w-12 shrink-0 text-xs font-semibold text-[var(--tg-theme-hint-color)]">{event.allDay ? 'Весь день' : formatTime(event.startsAt)}</span>
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar?.color ?? event.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{event.title}</span>
                      <span className="block truncate text-xs text-[var(--tg-theme-hint-color)]">{calendar?.name}{event.location ? ` · ${event.location}` : ''}</span>
                    </span>
                  </button>
                );
              })}
            </TodaySection>

            <TodaySection title="Задачи на сегодня" actionLabel="Все задачи" onAction={() => navigate('/my-tasks')} empty="Задач с дедлайном на сегодня нет">
              {dueToday.map((task) => <TodayTask key={task.id} task={task} onOpen={() => openTask(task)} />)}
            </TodaySection>

            {overdue.length > 0 && (
              <TodaySection title="Требуют внимания" tone="danger">
                {overdue.map((task) => <TodayTask key={task.id} task={task} onOpen={() => openTask(task)} overdue />)}
              </TodaySection>
            )}

            <TodaySection title="Следующие 7 дней" empty="Ближайших дедлайнов нет">
              {upcoming.map((task) => <TodayTask key={task.id} task={task} onOpen={() => openTask(task)} />)}
            </TodaySection>

            <section className="flex items-center justify-between border-t border-[var(--tg-theme-secondary-bg-color)] py-3 text-xs text-[var(--tg-theme-hint-color)]">
              <span>За 7 дней выполнено: {data?.stats.completed ?? 0}</span>
              <span>Активных: {data?.stats.active ?? 0}</span>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function TodayMetric({ value, label, color }: { value: number; label: string; color: string }) {
  return <div><div className="text-xl font-bold" style={{ color }}>{value}</div><div className="mt-0.5 text-[11px] text-[var(--tg-theme-hint-color)]">{label}</div></div>;
}

function TodaySection({ title, children, actionLabel, onAction, empty, tone }: { title: string; children?: ReactNode; actionLabel?: string; onAction?: () => void; empty?: string; tone?: 'danger' }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className={`text-sm font-bold ${tone === 'danger' ? 'text-red-500' : ''}`}>{title}</h2>
        {actionLabel && <button type="button" onClick={onAction} className="text-xs font-semibold text-[var(--tg-theme-link-color)]">{actionLabel} →</button>}
      </div>
      <div className="border-t border-[var(--tg-theme-secondary-bg-color)]">
        {hasChildren ? children : <p className="py-4 text-sm text-[var(--tg-theme-hint-color)]">{empty}</p>}
      </div>
    </section>
  );
}

function TodayTask({ task, onOpen, overdue }: { task: Task; onOpen: () => void; overdue?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] py-3 text-left last:border-0">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${overdue ? 'bg-red-500' : 'bg-[var(--tg-theme-link-color)]'}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{task.title}</span>
        <span className="block truncate text-xs text-[var(--tg-theme-hint-color)]">{task.project?.title ?? 'Проект'}{task.deadlineAt ? ` · ${formatDeadline(task.deadlineAt)}` : ''}</span>
      </span>
      <span className="text-[var(--tg-theme-hint-color)]">›</span>
    </button>
  );
}

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isWithin(value: string | undefined, from: Date, to: Date) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime() && time < to.getTime();
}

function eventOverlapsDay(event: CalendarEvent, from: Date, to: Date) {
  const start = new Date(event.startsAt).getTime();
  const end = event.endsAt ? new Date(event.endsAt).getTime() : start;
  return start < to.getTime() && end >= from.getTime();
}

function formatLongDate(value: Date) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
