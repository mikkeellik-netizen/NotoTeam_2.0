import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { remindersApi, type ReminderInput } from '../api/reminders';
import { useProjectStore } from '../store/projectStore';
import type { Reminder } from '../types';

const CURRENT_USER_ID = '1';
const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];

export default function RemindersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const { currentProject, fetchProject } = useProjectStore();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetUserId, setTargetUserId] = useState(CURRENT_USER_ID);
  const [scheduleMode, setScheduleMode] = useState<'once' | 'recurring' | 'dates'>('once');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [remindAt, setRemindAt] = useState(toLocalInputValue(new Date(Date.now() + 3600000)));
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [monthDay, setMonthDay] = useState(new Date().getDate());
  const [interval, setIntervalValue] = useState(1);
  const [datesDraft, setDatesDraft] = useState(toLocalInputValue(new Date(Date.now() + 3600000)));
  const [time, setTime] = useState('09:00');
  const [appChannel, setAppChannel] = useState(true);
  const [botChannel, setBotChannel] = useState(true);

  const members = currentProject?.members ?? [];
  const active = useMemo(() => reminders.filter((item) => item.status === 'active'), [reminders]);
  const paused = useMemo(() => reminders.filter((item) => item.status === 'paused'), [reminders]);
  const due = useMemo(
    () => active.filter((item) => item.nextRunAt && new Date(item.nextRunAt).getTime() <= Date.now()),
    [active],
  );

  useEffect(() => {
    if (!pid) return;
    fetchProject(pid);
  }, [fetchProject, pid]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    remindersApi.list(projectId).then(setReminders).finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (members.length && !members.some((member) => String(member.userId) === targetUserId)) {
      setTargetUserId(String(members[0].userId));
    }
  }, [members, targetUserId]);

  const refresh = async () => {
    if (!projectId) return;
    setReminders(await remindersApi.list(projectId));
  };

  const createReminder = async () => {
    if (!projectId || !title.trim() || saving) return;
    setSaving(true);
    try {
      const input: ReminderInput = {
        creatorUserId: CURRENT_USER_ID,
        targetUserId,
        sourceType: 'manual',
        title: title.trim(),
        description: description.trim(),
        scheduleType: scheduleMode === 'once' ? 'once' : 'recurring',
        channels: { app: appChannel, telegramBot: botChannel },
      };
      if (scheduleMode === 'once') {
        input.remindAt = new Date(remindAt).toISOString();
      } else if (scheduleMode === 'dates') {
        input.recurrence = {
          frequency: 'custom',
          time,
          dates: parseDateSet(datesDraft),
        };
      } else {
        input.recurrence = {
          frequency,
          weekdays: frequency === 'weekly' ? [weekday] : undefined,
          monthDay: frequency === 'monthly' ? monthDay : undefined,
          interval,
          time,
        };
      }
      const created = await remindersApi.create(projectId, input);
      setReminders((items) => [...items, created].sort(sortReminders));
      setTitle('');
      setDescription('');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (reminder: Reminder, status: Reminder['status']) => {
    const updated = await remindersApi.update(reminder.id, { status });
    setReminders((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  };

  const deleteReminder = async (reminder: Reminder) => {
    await remindersApi.remove(reminder.id);
    setReminders((items) => items.filter((item) => item.id !== reminder.id));
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <div className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button onClick={() => navigate(-1)} className="h-9 w-9 text-xl text-[var(--tg-theme-link-color)]" aria-label="Назад">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">⏰ Напоминания</h1>
          <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">
            {active.length} активных · {due.length} пора отправить
          </p>
        </div>
        <button onClick={refresh} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)]">↻</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-4 rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="mb-3 text-sm font-bold">Новое напоминание</h2>
          <div className="space-y-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например: заполнить статистику посещаемости"
              className="w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Описание для уведомления"
              className="h-20 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
            />
            <select
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              className="w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
            >
              {(members.length ? members : [{ userId: 1, user: { firstName: 'Local', username: 'local_user' } } as any]).map((member) => (
                <option key={member.userId} value={String(member.userId)}>
                  {member.user?.firstName ?? member.user?.username ?? `User ${member.userId}`}
                  {member.user?.username ? ` · @${member.user.username}` : ''}
                </option>
              ))}
            </select>

            <select
              value={scheduleMode}
              onChange={(event) => setScheduleMode(event.target.value as 'once' | 'recurring' | 'dates')}
              className="w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
            >
              <option value="once">Разовое напоминание</option>
              <option value="recurring">Периодичность</option>
              <option value="dates">Набор дат</option>
            </select>

            {scheduleMode === 'once' ? (
              <input
                type="datetime-local"
                value={remindAt}
                onChange={(event) => setRemindAt(event.target.value)}
                className="w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
              />
            ) : scheduleMode === 'dates' ? (
              <div className="space-y-2">
                <textarea
                  value={datesDraft}
                  onChange={(event) => setDatesDraft(event.target.value)}
                  placeholder={'Каждая дата с новой строки:\n2026-06-05 19:00\n2026-06-12 19:00'}
                  className="h-28 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
                />
                <p className="text-xs text-[var(--tg-theme-hint-color)]">
                  Подходит для нерегулярных встреч, дежурств и событий с разными датами.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as 'daily' | 'weekly' | 'monthly')}
                  className="w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
                >
                  <option value="daily">Каждый день</option>
                  <option value="weekly">Каждую неделю</option>
                  <option value="monthly">Каждый месяц</option>
                </select>
                <div className="grid grid-cols-[1fr_120px] gap-2">
                  {frequency === 'weekly' ? (
                    <select
                      value={weekday}
                      onChange={(event) => setWeekday(Number(event.target.value))}
                      className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
                    >
                      {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                    </select>
                  ) : frequency === 'monthly' ? (
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={monthDay}
                      onChange={(event) => setMonthDay(Math.min(31, Math.max(1, Number(event.target.value))))}
                      className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
                      aria-label="День месяца"
                    />
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={interval}
                      onChange={(event) => setIntervalValue(Math.max(1, Number(event.target.value)))}
                      className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
                      aria-label="Интервал в днях"
                    />
                  )}
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm outline-none"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm">
                <input type="checkbox" checked={appChannel} onChange={(event) => setAppChannel(event.target.checked)} />
                В приложении
              </label>
              <label className="flex items-center gap-2 rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm">
                <input type="checkbox" checked={botChannel} onChange={(event) => setBotChannel(event.target.checked)} />
                Telegram-бот
              </label>
            </div>

            <button
              onClick={createReminder}
              disabled={saving || !title.trim()}
              className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
            >
              {saving ? 'Сохраняю...' : 'Создать напоминание'}
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-bold">Активные напоминания</h2>
          {loading ? (
            <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-4 text-center text-sm text-[var(--tg-theme-hint-color)]">
              Загружаю...
            </div>
          ) : active.length === 0 ? (
            <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-4 text-center text-sm text-[var(--tg-theme-hint-color)]">
              Напоминаний пока нет
            </div>
          ) : (
            active.map((reminder) => (
              <ReminderCard
                key={reminder.id}
                reminder={reminder}
                onPause={() => updateStatus(reminder, 'paused')}
                onResume={() => updateStatus(reminder, 'active')}
                onDelete={() => deleteReminder(reminder)}
              />
            ))
          )}
        </section>

        <section className="mt-5 space-y-2">
          <h2 className="text-sm font-bold">На паузе</h2>
          {paused.length === 0 ? (
            <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-4 text-center text-sm text-[var(--tg-theme-hint-color)]">
              Приостановленных напоминаний нет
            </div>
          ) : (
            paused.map((reminder) => (
              <ReminderCard
                key={reminder.id}
                reminder={reminder}
                onPause={() => updateStatus(reminder, 'paused')}
                onResume={() => updateStatus(reminder, 'active')}
                onDelete={() => deleteReminder(reminder)}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function ReminderCard({
  reminder,
  onPause,
  onResume,
  onDelete,
}: {
  reminder: Reminder;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const due = reminder.nextRunAt && new Date(reminder.nextRunAt).getTime() <= Date.now();
  const isPaused = reminder.status === 'paused';
  return (
    <div className={`rounded-[14px] border p-3 ${due && !isPaused ? 'border-amber-400/60 bg-amber-500/10' : 'border-transparent bg-[var(--tg-theme-secondary-bg-color)]'} ${isPaused ? 'opacity-75' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xl">⏰</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{reminder.title}</p>
          {reminder.description && <p className="mt-1 line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">{reminder.description}</p>}
          <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">
            {isPaused ? 'На паузе' : reminder.scheduleType === 'recurring' ? 'Повторяется' : 'Разовое'} · {formatDate(reminder.nextRunAt ?? reminder.remindAt)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--tg-theme-hint-color)]">
            {reminder.channels.app ? 'приложение' : ''}{reminder.channels.app && reminder.channels.telegramBot ? ' + ' : ''}{reminder.channels.telegramBot ? 'бот' : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={isPaused ? onResume : onPause}
          className="flex-1 rounded-[10px] bg-[var(--tg-theme-bg-color)] py-2 text-xs font-semibold"
        >
          {isPaused ? 'Возобновить' : 'Пауза'}
        </button>
        <button onClick={onDelete} className="h-9 w-11 rounded-[10px] bg-red-500/15 text-lg font-bold text-red-500">
          ×
        </button>
      </div>
    </div>
  );
}

function sortReminders(a: Reminder, b: Reminder) {
  return new Date(a.nextRunAt ?? a.remindAt ?? 0).getTime() - new Date(b.nextRunAt ?? b.remindAt ?? 0).getTime();
}

function formatDate(value?: string) {
  if (!value) return 'без времени';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseDateSet(value: string) {
  return value
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const normalized = line.includes('T') ? line : line.replace(' ', 'T');
      const parsed = new Date(normalized);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    })
    .filter((date): date is string => Boolean(date));
}
