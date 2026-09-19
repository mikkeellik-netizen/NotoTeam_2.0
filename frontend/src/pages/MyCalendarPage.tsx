import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate, useParams } from 'react-router-dom';
import { calendarApi, type CalendarEventInput } from '../api/calendar';
import { useAuthStore } from '../store/authStore';
import type { Calendar, CalendarCategory, CalendarEvent, CalendarEventType, ExternalCalendarConnection, Task } from '../types';

type ViewMode = '1' | '3' | '5' | '7' | 'month' | 'agenda';

const FILTER_STORAGE_KEY = 'nototime-my-calendar-visible-v1';
const DEADLINES_STORAGE_KEY = 'nototime-calendar-show-task-deadlines-v1';
const HOUR_HEIGHT_STORAGE_KEY = 'nototime-calendar-hour-height-v3';
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const DEFAULT_HOUR_HEIGHT = 64;
const MIN_HOUR_HEIGHT = 36;
const MAX_HOUR_HEIGHT = 120;
const CALENDAR_HEADER_HEIGHT = 64;
const TIME_COLUMN_WIDTH = 36;
const SNAP_MINUTES = 15;
const FINAL_HOUR_HEIGHT_MULTIPLIER = 2;
const BASE_EVENT_CATEGORIES: CalendarCategory[] = [
  { id: 'base:meeting', label: 'Встреча', color: '#3B82F6', type: 'meeting' },
  { id: 'base:deadline', label: 'Дедлайн', color: '#EF4444', type: 'deadline' },
  { id: 'base:birthday', label: 'День рождения', color: '#EC4899', type: 'birthday' },
];
const DEFAULT_EVENT_CATEGORY = BASE_EVENT_CATEGORIES[0];
const VIEW_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: '1', label: '1 день' },
  { id: '3', label: '3 дня' },
  { id: '5', label: '5 дней' },
  { id: '7', label: '7 дней' },
  { id: 'month', label: 'Месяц' },
  { id: 'agenda', label: 'Расписание' },
];

type EventDraft = {
  calendarId: string;
  color: string;
  type: CalendarEventType;
  categoryId: string;
  categoryLabel: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  notificationEnabled: boolean;
  notificationAt: string;
};

export default function MyCalendarPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [deadlineTasks, setDeadlineTasks] = useState<Task[]>([]);
  const [showTaskDeadlines, setShowTaskDeadlines] = useState(readShowTaskDeadlines);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>('3');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [externalCalendarsOpen, setExternalCalendarsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [eventPendingDelete, setEventPendingDelete] = useState<CalendarEvent | null>(null);
  const [eventRemoving, setEventRemoving] = useState(false);
  const [scrollToNowRequest, setScrollToNowRequest] = useState(0);
  const [externalConnections, setExternalConnections] = useState<ExternalCalendarConnection[]>([]);

  const range = useMemo(() => getViewRange(view, cursor), [cursor, view]);
  const calendarById = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const deadlineTaskByEventId = useMemo(
    () => new Map(deadlineTasks.map((task) => [taskDeadlineEventId(task), task])),
    [deadlineTasks],
  );
  const writableCalendars = useMemo(() => calendars.filter((calendar) => calendar.permissions?.create !== false), [calendars]);
  const canManageExternalCalendars = !projectId || calendars.some((calendar) => calendar.permissions?.manage === true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([calendarApi.listCalendars(), calendarApi.listExternalConnections(projectId)])
      .then(([items, connections]) => {
        if (!active) return;
        const scopedItems = projectId
          ? items.filter((calendar) => String(calendar.projectId) === String(projectId))
          : items;
        setCalendars(scopedItems);
        setEnabledIds(projectId ? new Set(scopedItems.map((calendar) => calendar.id)) : readEnabledCalendars(scopedItems));
        setExternalConnections(connections);
      })
      .catch((reason) => active && setError(toErrorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [eventItems, taskItems] = await Promise.all([
        calendarApi.listMine({ from: range.start.toISOString(), to: range.end.toISOString() }),
        calendarApi.listTaskDeadlines({
          from: range.start.toISOString(),
          to: range.end.toISOString(),
          projectId,
        }),
      ]);
      setEvents(projectId ? eventItems.filter((event) => String(event.projectId) === String(projectId)) : eventItems);
      setDeadlineTasks(taskItems);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [projectId, range.end, range.start]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const visibleEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    const deadlineEvents = showTaskDeadlines
      ? deadlineTasks
          .map((task) => taskToDeadlineEvent(task, calendars))
          .filter((event): event is CalendarEvent => Boolean(event))
      : [];
    return [...events, ...deadlineEvents]
      .filter((event) => enabledIds.has(event.calendarId))
      .filter((event) => !query || `${event.title} ${event.description ?? ''} ${event.location ?? ''} ${calendarById.get(event.calendarId)?.name ?? ''}`.toLocaleLowerCase('ru-RU').includes(query))
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  }, [calendarById, calendars, deadlineTasks, enabledIds, events, search, showTaskDeadlines]);

  const toggleTaskDeadlines = () => {
    setShowTaskDeadlines((current) => {
      const next = !current;
      localStorage.setItem(DEADLINES_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  const openCalendarItem = (event: CalendarEvent) => {
    const task = deadlineTaskByEventId.get(event.id);
    if (!task) {
      setSelectedEvent(event);
      return;
    }
    const target = task.pageId
      ? `/project/${task.projectId}/workspace/page/${task.pageId}`
      : `/project/${task.projectId}/workspace`;
    navigate(`${target}?taskId=${task.id}&returnTo=${encodeURIComponent(window.location.pathname)}`);
  };

  const toggleCalendar = (calendarId: string) => {
    setEnabledIds((current) => {
      const next = new Set(current);
      if (next.has(calendarId)) next.delete(calendarId);
      else next.add(calendarId);
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const selectView = (nextView: ViewMode) => {
    setView(nextView);
    setViewMenuOpen(false);
    if (nextView !== 'month' && nextView !== 'agenda') setCursor(startOfDay(new Date()));
  };

  const goToToday = () => {
    const today = startOfDay(new Date());
    if (view !== 'month' && view !== 'agenda' && isSameDay(cursor, today)) {
      setScrollToNowRequest((current) => current + 1);
    }
    setCursor(today);
  };

  const openCreate = (date = cursor, hour?: number, minute = 0) => {
    const calendar = writableCalendars.find((item) => enabledIds.has(item.id)) ?? writableCalendars[0];
    if (!calendar) return;
    const start = new Date(date);
    start.setHours(hour ?? Math.min(DAY_END_HOUR - 1, Math.max(DAY_START_HOUR, new Date().getHours() + 1)), minute, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEditingEvent(null);
    setDraft({
      calendarId: calendar.id,
      color: DEFAULT_EVENT_CATEGORY.color,
      type: DEFAULT_EVENT_CATEGORY.type ?? 'meeting',
      categoryId: DEFAULT_EVENT_CATEGORY.id,
      categoryLabel: DEFAULT_EVENT_CATEGORY.label,
      title: '',
      description: '',
      location: '',
      startsAt: toLocalInputValue(start),
      endsAt: toLocalInputValue(end),
      allDay: false,
      notificationEnabled: false,
      notificationAt: toLocalInputValue(new Date(start.getTime() - 30 * 60 * 1000)),
    });
  };

  const openEdit = (event: CalendarEvent) => {
    setSelectedEvent(null);
    setEditingEvent(event);
    setDraft({
      calendarId: event.calendarId,
      color: event.color || calendarById.get(event.calendarId)?.color || '#3B82F6',
      type: event.type,
      categoryId: event.categoryId || `base:${event.type}`,
      categoryLabel: event.categoryLabel || categoryLabelForType(event.type),
      title: event.title,
      description: event.description ?? '',
      location: event.location ?? '',
      startsAt: toLocalInputValue(new Date(event.startsAt)),
      endsAt: event.endsAt ? toLocalInputValue(new Date(event.endsAt)) : '',
      allDay: event.allDay,
      notificationEnabled: event.notification?.enabled ?? false,
      notificationAt: event.notification?.remindAt
        ? toLocalInputValue(new Date(event.notification.remindAt))
        : toLocalInputValue(new Date(new Date(event.startsAt).getTime() - 30 * 60 * 1000)),
    });
  };

  const saveEvent = async () => {
    if (!draft?.title.trim()) return;
    const calendar = calendarById.get(draft.calendarId);
    if (!calendar) return;
    const start = new Date(draft.startsAt);
    const end = draft.endsAt ? new Date(draft.endsAt) : undefined;
    if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end < start))) {
      setError('Проверьте дату и время окончания события.');
      return;
    }
    const notificationAt = draft.notificationEnabled ? new Date(draft.notificationAt) : undefined;
    if (draft.notificationEnabled && (!notificationAt || !Number.isFinite(notificationAt.getTime()) || notificationAt > start)) {
      setError('Время уведомления должно быть указано и наступать не позже начала события.');
      return;
    }
    const payload: CalendarEventInput = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      location: draft.location.trim(),
      startsAt: start.toISOString(),
      endsAt: end?.toISOString(),
      allDay: draft.allDay,
      type: draft.type,
      color: draft.color || calendar.color,
      categoryId: draft.categoryId,
      categoryLabel: draft.categoryLabel,
      visibility: calendar.type === 'PERSONAL' ? 'private' : 'project',
      participantUserIds: [],
      sourceType: 'manual',
      notification: draft.notificationEnabled
        ? { enabled: true, remindAt: notificationAt?.toISOString() }
        : { enabled: false },
    };
    try {
      if (editingEvent) {
        const updated = await calendarApi.update(editingEvent.id, payload);
        setEvents((current) => current.map((event) => event.id === updated.id ? updated : event));
      } else {
        const created = await calendarApi.createInCalendar(calendar.id, payload);
        setEvents((current) => [...current, created]);
      }
      setDraft(null);
      setEditingEvent(null);
      setError('');
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  };

  const createCategory = async (label: string, color: string) => {
    if (!draft) throw new Error('Сначала выберите календарь.');
    try {
      const category = await calendarApi.createCategory(draft.calendarId, { label, color });
      setCalendars((current) => current.map((calendar) => calendar.id === draft.calendarId
        ? { ...calendar, categories: [...(calendar.categories ?? []), category] }
        : calendar));
      setDraft((current) => current ? {
        ...current,
        categoryId: category.id,
        categoryLabel: category.label,
        type: category.type ?? 'custom',
        color: category.color,
      } : current);
      setError('');
      return category;
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
    }
  };

  const updateCategory = async (categoryId: string, color: string) => {
    if (!draft) throw new Error('Сначала выберите календарь.');
    try {
      const category = await calendarApi.updateCategory(draft.calendarId, categoryId, { color });
      setCalendars((current) => current.map((calendar) => calendar.id === draft.calendarId
        ? { ...calendar, categories: upsertCalendarCategory(calendar.categories, category) }
        : calendar));
      setEvents((current) => current.map((event) => event.calendarId === draft.calendarId && event.categoryId === category.id
        ? { ...event, color: category.color, categoryLabel: category.label, type: category.type ?? event.type }
        : event));
      setDraft((current) => current?.categoryId === category.id
        ? { ...current, color: category.color, categoryLabel: category.label, type: category.type ?? current.type }
        : current);
      setError('');
      return category;
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
    }
  };

  const removeCategory = async (categoryId: string) => {
    if (!draft) throw new Error('Сначала выберите календарь.');
    try {
      await calendarApi.removeCategory(draft.calendarId, categoryId);
      const fallback = calendarCategoryOptions(calendarById.get(draft.calendarId)).find((category) => category.id === DEFAULT_EVENT_CATEGORY.id)
        ?? DEFAULT_EVENT_CATEGORY;
      setCalendars((current) => current.map((calendar) => calendar.id === draft.calendarId
        ? { ...calendar, categories: (calendar.categories ?? []).filter((category) => category.id !== categoryId) }
        : calendar));
      setEvents((current) => current.map((event) => event.calendarId === draft.calendarId && event.categoryId === categoryId
        ? {
            ...event,
            categoryId: fallback.id,
            categoryLabel: fallback.label,
            type: fallback.type ?? 'meeting',
            color: fallback.color,
          }
        : event));
      setDraft((current) => current?.categoryId === categoryId
        ? {
            ...current,
            categoryId: fallback.id,
            categoryLabel: fallback.label,
            type: fallback.type ?? 'meeting',
            color: fallback.color,
          }
        : current);
      setError('');
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
    }
  };

  const removeEvent = async (event: CalendarEvent) => {
    if (eventRemoving) return;
    setEventRemoving(true);
    try {
      await calendarApi.remove(event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setSelectedEvent(null);
      setEventPendingDelete(null);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setEventRemoving(false);
    }
  };

  const canEdit = (event: CalendarEvent) => {
    if (deadlineTaskByEventId.has(event.id) || event.readOnly || event.sourceType === 'external') return false;
    const permission = calendarById.get(event.calendarId)?.permissions;
    return Boolean(permission?.editAll || (permission?.editOwn && String(event.ownerUserId) === String(currentUserId)));
  };
  const canDelete = (event: CalendarEvent) => {
    if (deadlineTaskByEventId.has(event.id) || event.readOnly || event.sourceType === 'external') return false;
    const permission = calendarById.get(event.calendarId)?.permissions;
    return Boolean(permission?.deleteAll || (permission?.deleteOwn && String(event.ownerUserId) === String(currentUserId)));
  };

  const updateEventTime = async (event: CalendarEvent, startsAt: Date, endsAt: Date) => {
    const previousStart = new Date(event.startsAt);
    const shift = startsAt.getTime() - previousStart.getTime();
    const notification = event.notification?.enabled && event.notification.remindAt
      ? { enabled: true, remindAt: new Date(new Date(event.notification.remindAt).getTime() + shift).toISOString() }
      : { enabled: false };
    try {
      const updated = await calendarApi.update(event.id, {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        notification,
      });
      setEvents((current) => current.map((item) => item.id === updated.id ? updated : item));
      setError('');
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  };

  const moveEvent = (event: CalendarEvent, date: Date, minuteOfDay: number) => {
    const previousStart = new Date(event.startsAt);
    const previousEnd = event.endsAt ? new Date(event.endsAt) : new Date(previousStart.getTime() + 60 * 60 * 1000);
    const duration = Math.max(SNAP_MINUTES * 60 * 1000, previousEnd.getTime() - previousStart.getTime());
    const nextStart = startOfDay(date);
    nextStart.setMinutes(minuteOfDay);
    void updateEventTime(event, nextStart, new Date(nextStart.getTime() + duration));
  };

  const resizeEvent = (event: CalendarEvent, endsAt: Date) => {
    void updateEventTime(event, new Date(event.startsAt), endsAt);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <header className="relative z-30 border-b border-[var(--tg-theme-secondary-bg-color)] px-2 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(projectId ? `/project/${projectId}/workspace` : '/')} className={`h-9 w-9 shrink-0 text-xl ${projectId ? '' : 'md:hidden'}`} aria-label="Назад">←</button>
          <div className="hidden min-w-0 flex-1 sm:block">
            <h1 className="text-lg font-bold">{projectId ? 'Календарь проекта' : 'Мой календарь'}</h1>
            <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{projectId ? calendars[0]?.name ?? 'Проект' : 'Личные события и доступные проекты'}</p>
          </div>
          <div className="flex min-w-0 flex-1 items-center sm:hidden">
            <button type="button" onClick={() => setCursor(shiftCursor(cursor, view, -1))} className="h-8 w-7 shrink-0 text-xl" aria-label="Предыдущий период">‹</button>
            <button type="button" onClick={goToToday} className="h-8 min-w-0 flex-1 truncate px-1 text-sm font-bold capitalize" aria-label="Перейти к сегодняшней дате">
              {compactMonthLabel(cursor)}
            </button>
            <button type="button" onClick={() => setCursor(shiftCursor(cursor, view, 1))} className="h-8 w-7 shrink-0 text-xl" aria-label="Следующий период">›</button>
          </div>
          <button type="button" onClick={() => { setSearchOpen((value) => !value); setFiltersOpen(false); setViewMenuOpen(false); }} className={`h-9 w-9 shrink-0 rounded-[8px] text-xl sm:hidden ${searchOpen ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : ''}`} aria-label="Поиск событий" aria-expanded={searchOpen}>⌕</button>
          <button type="button" onClick={() => { setFiltersOpen((value) => !value); setSearchOpen(false); setViewMenuOpen(false); }} className={`h-9 shrink-0 rounded-[8px] px-2 text-lg font-semibold sm:hidden ${filtersOpen ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : ''}`} aria-label="Календари" aria-expanded={filtersOpen}>▦</button>
          <button type="button" onClick={() => { setViewMenuOpen((value) => !value); setSearchOpen(false); setFiltersOpen(false); }} className={`h-9 min-w-9 shrink-0 rounded-[8px] px-1.5 text-xs font-bold sm:hidden ${viewMenuOpen ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`} aria-label="Режим календаря" aria-expanded={viewMenuOpen}>
            {shortViewLabel(view)}
          </button>
        </div>

        {viewMenuOpen && (
          <div className="absolute right-2 top-12 z-40 grid w-52 grid-cols-2 gap-1 rounded-[8px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-2 shadow-xl sm:hidden">
            {VIEW_OPTIONS.map((option) => (
              <button key={option.id} type="button" onClick={() => selectView(option.id)} className={`h-9 rounded-[6px] px-2 text-xs font-semibold ${view === option.id ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}>
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className={`${searchOpen ? 'flex' : 'hidden'} mt-2 items-center gap-2 sm:mt-3 sm:flex`}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск событий" aria-label="Поиск событий" autoFocus={searchOpen} className="h-9 min-w-0 flex-1 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm outline-none" />
          <button type="button" onClick={() => setFiltersOpen((value) => !value)} className={`hidden h-9 rounded-[8px] px-3 text-sm font-semibold sm:block ${filtersOpen ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}>
            Календари
          </button>
          <button type="button" onClick={() => openCreate()} disabled={!writableCalendars.length} className="hidden h-9 w-9 shrink-0 rounded-[8px] bg-[var(--tg-theme-button-color)] text-xl font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-40 sm:block" aria-label="Создать событие">+</button>
        </div>

        <div className="mt-2 hidden gap-1 overflow-x-auto pb-1 sm:flex">
          {VIEW_OPTIONS.map((option) => (
            <button key={option.id} type="button" onClick={() => selectView(option.id)} className={`shrink-0 rounded-[8px] px-3 py-2 text-xs font-semibold ${view === option.id ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-2 hidden items-center gap-2 sm:flex">
          <button type="button" onClick={() => setCursor(shiftCursor(cursor, view, -1))} className="h-9 w-9 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)]" aria-label="Предыдущий период">‹</button>
          <button type="button" onClick={goToToday} className="h-9 min-w-0 flex-1 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm font-semibold">
            {rangeLabel(view, cursor)}
          </button>
          <button type="button" onClick={() => setCursor(shiftCursor(cursor, view, 1))} className="h-9 w-9 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)]" aria-label="Следующий период">›</button>
        </div>

        {filtersOpen && (
          <div className="absolute left-2 right-2 top-full z-40 mt-1 grid max-h-64 gap-1 overflow-y-auto rounded-[8px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-2 shadow-xl sm:left-auto sm:right-4 sm:w-96 sm:grid-cols-2">
            <label className="flex min-w-0 items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-[var(--tg-theme-secondary-bg-color)] sm:col-span-2">
              <input type="checkbox" checked={showTaskDeadlines} onChange={toggleTaskDeadlines} />
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-[#FF3B30] text-sm shadow-[inset_0_0_0_2px_#FFD60A]">📋</span>
              <span className="min-w-0 flex-1 text-sm font-semibold">Показывать дедлайны задач</span>
              <span className="text-[10px] text-[var(--tg-theme-hint-color)]">Канбан</span>
            </label>
            {calendars.map((calendar) => (
              <label key={calendar.id} className="flex min-w-0 items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-[var(--tg-theme-secondary-bg-color)]">
                <input type="checkbox" checked={enabledIds.has(calendar.id)} onChange={() => toggleCalendar(calendar.id)} />
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: calendar.color }} />
                <span className="min-w-0 flex-1 truncate text-sm">{calendar.name}</span>
                <span className="text-[10px] text-[var(--tg-theme-hint-color)]">{calendar.sourceType === 'external' ? 'Внешний' : calendar.type === 'PERSONAL' ? 'Личный' : 'Проект'}</span>
              </label>
            ))}
            {canManageExternalCalendars && (
              <button type="button" onClick={() => { setFiltersOpen(false); setExternalCalendarsOpen(true); }} className="mt-1 flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[var(--tg-theme-link-color)] px-3 text-sm font-semibold text-[var(--tg-theme-link-color)] sm:col-span-2">
                <span aria-hidden="true">↻</span> Внешние календари{externalConnections.length ? ` · ${externalConnections.length}` : ''}
              </button>
            )}
          </div>
        )}
      </header>

      <main className={`relative min-h-0 flex-1 ${view === 'month' || view === 'agenda' ? 'overflow-auto p-3 pb-20 sm:pb-3' : 'overflow-hidden'}`}>
        {error && <div className="mb-3 rounded-[8px] border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading && !calendars.length ? (
          <div className="flex justify-center py-16"><div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" /></div>
        ) : view === 'month' ? (
          <MonthView cursor={cursor} events={visibleEvents} calendars={calendarById} onSelectDay={(date) => { setCursor(date); setView('1'); }} onOpen={openCalendarItem} />
        ) : view === 'agenda' ? (
          <AgendaView events={visibleEvents} calendars={calendarById} onOpen={openCalendarItem} />
        ) : (
          <DaysView cursor={cursor} days={Number(view)} events={visibleEvents} calendars={calendarById} onCreate={openCreate} onOpen={openCalendarItem} canMove={canEdit} onMove={moveEvent} onResize={resizeEvent} onShift={(direction) => setCursor((current) => addDays(current, direction))} scrollToNowRequest={scrollToNowRequest} />
        )}
      </main>

      <div className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center sm:hidden ${projectId ? 'bottom-4' : 'bottom-[calc(var(--nt-shell-nav-height)+1rem)]'}`}>
        <button type="button" onClick={goToToday} className="pointer-events-auto h-11 rounded-full border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] px-5 text-sm font-bold shadow-lg">Сегодня</button>
        <button type="button" onClick={() => openCreate()} disabled={!writableCalendars.length} className="pointer-events-auto absolute right-4 h-12 w-12 rounded-full bg-[var(--tg-theme-button-color)] text-2xl font-medium text-[var(--tg-theme-button-text-color)] shadow-lg disabled:opacity-40" aria-label="Создать событие">+</button>
      </div>

      {draft && (
        <EventForm
          draft={draft}
          calendars={editingEvent ? calendars.filter((calendar) => calendar.id === draft.calendarId) : writableCalendars}
          editing={Boolean(editingEvent)}
          onChange={setDraft}
          onCreateCategory={createCategory}
          onUpdateCategory={updateCategory}
          onRemoveCategory={removeCategory}
          onClose={() => { setDraft(null); setEditingEvent(null); }}
          onSave={() => void saveEvent()}
        />
      )}

      {selectedEvent && (
        <EventDetails
          event={selectedEvent}
          calendar={calendarById.get(selectedEvent.calendarId)}
          canEdit={canEdit(selectedEvent)}
          canDelete={canDelete(selectedEvent)}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => openEdit(selectedEvent)}
          onDelete={() => setEventPendingDelete(selectedEvent)}
          onOpenProject={() => selectedEvent.projectId && navigate(`/project/${selectedEvent.projectId}/calendar`)}
        />
      )}

      {eventPendingDelete && (
        <ConfirmDialog
          title="Удалить событие?"
          description={`«${eventPendingDelete.title}» будет удалено без возможности восстановления.`}
          busy={eventRemoving}
          onCancel={() => setEventPendingDelete(null)}
          onConfirm={() => void removeEvent(eventPendingDelete)}
        />
      )}

      {externalCalendarsOpen && (
        <ExternalCalendarsSheet
          connections={externalConnections}
          projectId={projectId}
          onClose={() => setExternalCalendarsOpen(false)}
          onChanged={async () => {
            const [calendarItems, connections] = await Promise.all([
              calendarApi.listCalendars(),
              calendarApi.listExternalConnections(projectId),
            ]);
            const scopedItems = projectId
              ? calendarItems.filter((calendar) => String(calendar.projectId) === String(projectId))
              : calendarItems;
            setCalendars(scopedItems);
            setExternalConnections(connections);
            setEnabledIds((current) => {
              const accessible = new Set(scopedItems.map((item) => item.id));
              const next = new Set([...current].filter((id) => accessible.has(id)));
              for (const item of scopedItems) {
                if (!calendarById.has(item.id)) next.add(item.id);
              }
              if (!projectId) localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([...next]));
              return next;
            });
            await loadEvents();
          }}
        />
      )}
    </div>
  );
}

function ExternalCalendarsSheet({ connections, projectId, onClose, onChanged }: {
  connections: ExternalCalendarConnection[];
  projectId?: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(connections.length === 0);
  const [name, setName] = useState('Яндекс Календарь');
  const [feedUrl, setFeedUrl] = useState('');
  const [color, setColor] = useState('#FFCC00');
  const [busyId, setBusyId] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState('');
  const [localError, setLocalError] = useState('');

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setLocalError('');
    try {
      await action();
      await onChanged();
    } catch (reason) {
      const message = toErrorMessage(reason);
      setLocalError(message);
    } finally {
      setBusyId('');
    }
  };

  const connect = async () => {
    if (!feedUrl.trim()) {
      setLocalError('Вставьте ссылку iCal из раздела «Экспорт» в Яндекс Календаре');
      return;
    }
    await run('new', async () => {
      await calendarApi.connectYandexCalendar({ name: name.trim() || 'Яндекс Календарь', color, feedUrl: feedUrl.trim() }, projectId);
      setFeedUrl('');
      setAdding(false);
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/50 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Внешние календари">
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-[12px] bg-[var(--tg-theme-bg-color)] p-4 text-[var(--tg-theme-text-color)] shadow-2xl sm:max-w-xl sm:rounded-[8px]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Внешние календари</h2>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Автоматическое обновление каждые 15 минут</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 text-xl" aria-label="Закрыть">×</button>
        </div>

        {localError && <div className="mt-3 rounded-[8px] border border-red-300 bg-red-50 p-3 text-sm text-red-700">{localError}</div>}

        <div className="mt-4 space-y-2">
          {connections.map((connection) => (
            <div key={connection.id} className="border-b border-[var(--tg-theme-secondary-bg-color)] py-3 last:border-0">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: connection.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{connection.name}</p>
                    <span className={`shrink-0 text-[10px] font-semibold ${connection.lastSyncStatus === 'error' ? 'text-red-500' : 'text-[var(--tg-theme-hint-color)]'}`}>
                      {connection.lastSyncStatus === 'error' ? 'Ошибка' : connection.enabled ? 'Активен' : 'На паузе'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--tg-theme-hint-color)]">
                    {connection.importedEvents} событий{connection.lastSyncAt ? ` · ${formatSyncTime(connection.lastSyncAt)}` : ''}
                  </p>
                  {connection.lastSyncError && <p className="mt-1 line-clamp-2 text-xs text-red-500">{connection.lastSyncError}</p>}
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={connection.enabled}
                    disabled={busyId === connection.id}
                    onChange={() => void run(connection.id, () => calendarApi.updateExternalConnection(connection.id, { enabled: !connection.enabled }, projectId))}
                    className="peer sr-only"
                  />
                  <span className="h-6 w-10 rounded-full bg-gray-300 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-[var(--tg-theme-button-color)] peer-checked:after:translate-x-4" />
                </label>
              </div>
              <div className="mt-3 flex gap-2 pl-6">
                <button type="button" disabled={busyId === connection.id} onClick={() => void run(connection.id, () => calendarApi.syncExternalConnection(connection.id, projectId))} className="h-8 rounded-[7px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-xs font-semibold disabled:opacity-50">
                  {busyId === connection.id ? 'Обновление…' : 'Обновить'}
                </button>
                <button type="button" disabled={busyId === connection.id} onClick={() => setPendingDeleteId(connection.id)} className="h-8 rounded-[7px] px-3 text-xs font-semibold text-red-500 disabled:opacity-50">Отключить</button>
              </div>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mt-4 border-t border-[var(--tg-theme-secondary-bg-color)] pt-4">
            <h3 className="text-sm font-bold">Подключить Яндекс Календарь</h3>
            <div className="mt-1 space-y-1 text-xs leading-relaxed text-[var(--tg-theme-hint-color)]">
              <p>В Яндекс Календаре откройте настройки нужного календаря → «Экспорт» → скопируйте именно ссылку iCal.</p>
              <p>Код iframe и «Публичный адрес» вида <span className="font-mono">/embed/week</span> не подходят: это HTML-виджет, а не календарная лента.</p>
              <p className="font-mono text-[11px]">Пример: https://calendar.yandex.ru/export/ics.xml?…</p>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название" className="h-10 min-w-0 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm outline-none" />
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-10 w-12 cursor-pointer rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-1" aria-label="Цвет календаря" />
            </div>
            <input value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://calendar.yandex.ru/export/ics.xml?…" autoComplete="off" className="mt-2 h-10 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm outline-none" />
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busyId === 'new'} onClick={() => void connect()} className="h-10 flex-1 rounded-[8px] bg-[var(--tg-theme-button-color)] px-4 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50">
                {busyId === 'new' ? 'Проверяю…' : 'Подключить'}
              </button>
              {connections.length > 0 && <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-4 text-sm font-semibold">Отмена</button>}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-4 h-10 w-full rounded-[8px] border border-[var(--tg-theme-link-color)] text-sm font-semibold text-[var(--tg-theme-link-color)]">+ Подключить календарь</button>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title="Отключить календарь?"
          description="Импортированные события будут удалены из NotoTime. В Яндекс Календаре ничего не изменится."
          busy={busyId === pendingDeleteId}
          onCancel={() => setPendingDeleteId('')}
          onConfirm={() => void run(pendingDeleteId, async () => {
            await calendarApi.removeExternalConnection(pendingDeleteId, projectId);
            setPendingDeleteId('');
          })}
        />
      )}
    </div>
  );
}

function formatSyncTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function MonthView({ cursor, events, calendars, onSelectDay, onOpen }: {
  cursor: Date;
  events: CalendarEvent[];
  calendars: Map<string, Calendar>;
  onSelectDay: (date: Date) => void;
  onOpen: (event: CalendarEvent) => void;
}) {
  const days = monthGrid(cursor);
  const today = new Date();
  return (
    <div className="min-w-[620px] overflow-hidden rounded-[8px] border border-[var(--tg-theme-secondary-bg-color)]">
      <div className="grid grid-cols-7 bg-[var(--tg-theme-secondary-bg-color)] text-center text-xs font-semibold text-[var(--tg-theme-hint-color)]">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div key={day} className="py-2">{day}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const items = events.filter((event) => eventTouchesDay(event, date));
          const outside = date.getMonth() !== cursor.getMonth();
          return (
            <div key={date.toISOString()} onDoubleClick={() => onSelectDay(date)} className={`min-h-[108px] border-b border-r border-[var(--tg-theme-secondary-bg-color)] p-1 ${outside ? 'opacity-45' : ''}`}>
              <button type="button" onClick={() => onSelectDay(date)} className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${isSameDay(date, today) ? 'bg-[var(--tg-theme-button-color)] font-bold text-[var(--tg-theme-button-text-color)]' : ''}`}>{date.getDate()}</button>
              <div className="space-y-1">
                {items.slice(0, 3).map((event) => (
                  <button key={event.id} type="button" onClick={() => onOpen(event)} className="block w-full truncate rounded-[4px] px-1.5 py-1 text-left text-[11px] font-semibold" style={eventCardStyle(event, calendars.get(event.calendarId)?.color ?? event.color, 3)}>
                    {event.allDay ? '' : formatTime(event.startsAt)} {event.title}
                  </button>
                ))}
                {items.length > 3 && <button type="button" onClick={() => onSelectDay(date)} className="px-1 text-[11px] font-semibold text-[var(--tg-theme-link-color)]">+{items.length - 3}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DaysView({ cursor, days, events, calendars, onCreate, onOpen, canMove, onMove, onResize, onShift, scrollToNowRequest }: {
  cursor: Date;
  days: number;
  events: CalendarEvent[];
  calendars: Map<string, Calendar>;
  onCreate: (date: Date, hour?: number, minute?: number) => void;
  onOpen: (event: CalendarEvent) => void;
  canMove: (event: CalendarEvent) => boolean;
  onMove: (event: CalendarEvent, date: Date, minuteOfDay: number) => void;
  onResize: (event: CalendarEvent, endsAt: Date) => void;
  onShift: (direction: -1 | 1) => void;
  scrollToNowRequest: number;
}) {
  const dates = Array.from({ length: days }, (_, index) => addDays(cursor, index));
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => index + DAY_START_HOUR);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [hourHeight, setHourHeight] = useState(readHourHeight);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const pinchRef = useRef<{ distance: number; initialHourHeight: number; anchorMinute: number; viewportY: number } | null>(null);
  const suppressSwipeRef = useRef(false);
  const didInitialScrollRef = useRef(false);
  const wheelDistanceRef = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
  const handleDragStart = (drag: DragStartEvent) => {
    const event = events.find((item) => `calendar-event:${item.id}` === String(drag.active.id));
    setActiveEvent(event ?? null);
  };
  const handleDragEnd = (drag: DragEndEvent) => {
    setActiveEvent(null);
    const event = events.find((item) => `calendar-event:${item.id}` === String(drag.active.id));
    const target = parseTimelineDropId(String(drag.over?.id ?? ''));
    if (!event || !target || !canMove(event)) return;
    onMove(event, target.date, target.minuteOfDay);
  };
  const scrollToCurrentTime = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const top = CALENDAR_HEADER_HEIGHT + minutesToPixels(minuteOfDay, hourHeight) - scroll.clientHeight * 0.3;
    scroll.scrollTo({ top: clamp(top, 0, Math.max(0, scroll.scrollHeight - scroll.clientHeight)), behavior });
  }, [hourHeight]);

  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const timeout = window.setTimeout(() => {
      didInitialScrollRef.current = true;
      scrollToCurrentTime('auto');
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [scrollToCurrentTime]);

  useEffect(() => {
    if (scrollToNowRequest > 0) scrollToCurrentTime();
  }, [scrollToNowRequest, scrollToCurrentTime]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const preventPagePinch = (event: TouchEvent) => {
      if (event.touches.length === 2) event.preventDefault();
    };
    const preventPageZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    scroll.addEventListener('touchmove', preventPagePinch, { passive: false });
    scroll.addEventListener('wheel', preventPageZoom, { passive: false });
    return () => {
      scroll.removeEventListener('touchmove', preventPagePinch);
      scroll.removeEventListener('wheel', preventPageZoom);
    };
  }, []);

  const changeZoomAt = (nextHourHeight: number, clientY: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const next = clamp(nextHourHeight, MIN_HOUR_HEIGHT, MAX_HOUR_HEIGHT);
    if (Math.abs(next - hourHeight) < 0.5) return;
    const viewportY = clientY - scroll.getBoundingClientRect().top;
    const timelineY = Math.max(0, scroll.scrollTop + viewportY - CALENDAR_HEADER_HEIGHT);
    const anchorMinute = DAY_START_HOUR * 60 + timelineY / hourHeight * 60;
    setHourHeight(next);
    saveHourHeight(next);
    window.requestAnimationFrame(() => {
      const nextTop = CALENDAR_HEADER_HEIGHT + minutesToPixels(anchorMinute, next) - viewportY;
      scroll.scrollTop = clamp(nextTop, 0, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
    });
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const first = event.touches[0];
      const second = event.touches[1];
      const viewportY = (first.clientY + second.clientY) / 2 - scroll.getBoundingClientRect().top;
      const timelineY = Math.max(0, scroll.scrollTop + viewportY - CALENDAR_HEADER_HEIGHT);
      pinchRef.current = {
        distance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
        initialHourHeight: hourHeight,
        anchorMinute: DAY_START_HOUR * 60 + timelineY / hourHeight * 60,
        viewportY,
      };
      touchStartXRef.current = null;
      suppressSwipeRef.current = true;
      return;
    }
    const target = event.target as HTMLElement;
    touchStartXRef.current = target.closest('[data-calendar-event]') ? null : event.touches[0]?.clientX ?? null;
  };
  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    const distance = Math.max(1, Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY));
    const next = clamp(Math.round(pinch.initialHourHeight * distance / pinch.distance), MIN_HOUR_HEIGHT, MAX_HOUR_HEIGHT);
    if (next === hourHeight) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    setHourHeight(next);
    saveHourHeight(next);
    window.requestAnimationFrame(() => {
      const nextTop = CALENDAR_HEADER_HEIGHT + minutesToPixels(pinch.anchorMinute, next) - pinch.viewportY;
      scroll.scrollTop = clamp(nextTop, 0, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
    });
  };
  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (pinchRef.current || suppressSwipeRef.current) {
      pinchRef.current = null;
      if (event.touches.length === 0) suppressSwipeRef.current = false;
      touchStartXRef.current = null;
      return;
    }
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined || Math.abs(endX - startX) < 48) return;
    onShift(endX < startX ? 1 : -1);
  };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      changeZoomAt(hourHeight + (event.deltaY < 0 ? 6 : -6), event.clientY);
      return;
    }
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    wheelDistanceRef.current += event.deltaX;
    if (Math.abs(wheelDistanceRef.current) < 80) return;
    onShift(wheelDistanceRef.current > 0 ? 1 : -1);
    wheelDistanceRef.current = 0;
  };
  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragCancel={() => setActiveEvent(null)} onDragEnd={handleDragEnd}>
      <div ref={scrollRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onWheel={handleWheel} className="h-full w-full overflow-y-auto overflow-x-hidden overscroll-contain border-t border-[var(--tg-theme-secondary-bg-color)] [scrollbar-width:thin]" style={{ touchAction: 'pan-y' }}>
        <div className="sticky top-0 z-20 grid w-full bg-[var(--tg-theme-bg-color)] shadow-[0_1px_0_var(--tg-theme-secondary-bg-color)]" style={{ gridTemplateColumns: `${TIME_COLUMN_WIDTH}px repeat(${days}, minmax(0, 1fr))` }}>
          <div className="border-b border-r border-[var(--tg-theme-secondary-bg-color)]" />
          {dates.map((date) => {
            const today = isSameDay(date, new Date());
            return <div key={date.toISOString()} className={`flex h-10 min-w-0 flex-col items-center justify-center border-b border-r border-[var(--tg-theme-secondary-bg-color)] px-0.5 text-center ${today ? 'text-[var(--tg-theme-link-color)]' : ''}`}><div className="truncate text-[9px] font-semibold uppercase sm:text-[11px]">{date.toLocaleDateString('ru-RU', { weekday: 'short' })}</div><div className={`mt-0.5 flex h-5 min-w-5 items-center justify-center text-xs font-bold ${today ? 'rounded-full bg-[var(--tg-theme-button-color)] px-1 text-[var(--tg-theme-button-text-color)]' : ''}`}>{date.getDate()}</div></div>;
          })}
          <div className="flex h-6 items-center justify-center whitespace-nowrap border-b border-r border-[var(--tg-theme-secondary-bg-color)] text-[7px] leading-none text-[var(--tg-theme-hint-color)]">Весь день</div>
          {dates.map((date) => <div key={`all-${date.toISOString()}`} className="h-6 min-w-0 overflow-hidden border-b border-r border-[var(--tg-theme-secondary-bg-color)] p-0.5">{events.filter((event) => event.allDay && eventTouchesDay(event, date)).slice(0, 1).map((event) => <EventChip key={event.id} event={event} calendar={calendars.get(event.calendarId)} onOpen={onOpen} />)}</div>)}
        </div>
        <div className="grid w-full" style={{ gridTemplateColumns: `${TIME_COLUMN_WIDTH}px repeat(${days}, minmax(0, 1fr))` }}>
          <div className="relative border-r border-[var(--tg-theme-secondary-bg-color)]" style={{ height: timelineGridHeight(hours.length, hourHeight) }}>
            {hours.map((hour, index) => <span key={hour} className="absolute right-1 text-[8px] leading-none text-[var(--tg-theme-hint-color)]" style={{ top: index * hourHeight + 3 }}>{String(hour).padStart(2, '0')}:00</span>)}
          </div>
          {dates.map((date) => (
            <TimelineDay
              key={date.toISOString()}
              date={date}
              hours={hours}
              events={events.filter((event) => !event.allDay && eventTouchesDay(event, date))}
              calendars={calendars}
              canMove={canMove}
              onCreate={onCreate}
              onOpen={onOpen}
              onResize={onResize}
              hourHeight={hourHeight}
            />
          ))}
        </div>
      </div>
      <DragOverlay>{activeEvent ? <div className="w-44 rounded-[6px] bg-[var(--tg-theme-button-color)] px-2 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] shadow-xl">{activeEvent.title}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function TimelineDay({ date, hours, events, calendars, canMove, onCreate, onOpen, onResize, hourHeight }: {
  date: Date;
  hours: number[];
  events: CalendarEvent[];
  calendars: Map<string, Calendar>;
  canMove: (event: CalendarEvent) => boolean;
  onCreate: (date: Date, hour?: number, minute?: number) => void;
  onOpen: (event: CalendarEvent) => void;
  onResize: (event: CalendarEvent, endsAt: Date) => void;
  hourHeight: number;
}) {
  const layouts = layoutTimelineEvents(events, date, hourHeight);
  const slots = Array.from({ length: (DAY_END_HOUR - DAY_START_HOUR) * (60 / SNAP_MINUTES) }, (_, index) => DAY_START_HOUR * 60 + index * SNAP_MINUTES);
  const now = new Date();
  return (
    <div className="relative border-r border-[var(--tg-theme-secondary-bg-color)]" style={{ height: timelineGridHeight(hours.length, hourHeight) }}>
      {hours.map((hour, index) => <span key={hour} className="pointer-events-none absolute left-0 right-0 border-b border-[var(--tg-theme-secondary-bg-color)]" style={{ top: index * hourHeight, height: index === hours.length - 1 ? hourHeight * FINAL_HOUR_HEIGHT_MULTIPLIER : hourHeight }} />)}
      {slots.map((minute) => <TimelineDropSlot key={minute} date={date} minuteOfDay={minute} onCreate={onCreate} hourHeight={hourHeight} />)}
      {layouts.map((layout) => (
        <TimedEventBlock
          key={layout.event.id}
          layout={layout}
          backgroundColor={layout.event.color}
          calendarColor={calendars.get(layout.event.calendarId)?.color ?? layout.event.color}
          movable={canMove(layout.event)}
          onOpen={onOpen}
          onResize={onResize}
          hourHeight={hourHeight}
        />
      ))}
      {isSameDay(date, now) && now.getHours() >= DAY_START_HOUR && now.getHours() < DAY_END_HOUR && <span className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 bg-red-500" style={{ top: minutesToPixels(now.getHours() * 60 + now.getMinutes(), hourHeight) }} />}
    </div>
  );
}

function TimelineDropSlot({ date, minuteOfDay, onCreate, hourHeight }: { date: Date; minuteOfDay: number; onCreate: (date: Date, hour?: number, minute?: number) => void; hourHeight: number }) {
  const id = timelineDropId(date, minuteOfDay);
  const { setNodeRef, isOver } = useDroppable({ id });
  return <button type="button" ref={setNodeRef} onClick={() => onCreate(date, Math.floor(minuteOfDay / 60), minuteOfDay % 60)} className={`absolute left-0 right-0 z-[1] text-left ${isOver ? 'bg-[var(--tg-theme-button-color)]/15 hover:bg-[var(--tg-theme-button-color)]/10' : 'hover:bg-[var(--tg-theme-secondary-bg-color)]'}`} style={{ top: minutesToPixels(minuteOfDay, hourHeight), height: minutesToDurationPixels(SNAP_MINUTES, hourHeight) }} aria-label={`Создать событие в ${Math.floor(minuteOfDay / 60)}:${String(minuteOfDay % 60).padStart(2, '0')}`} />;
}

type TimelineLayout = { event: CalendarEvent; top: number; height: number; column: number; columns: number; resizable: boolean };

function TimedEventBlock({ layout, backgroundColor, calendarColor, movable, onOpen, onResize, hourHeight }: { layout: TimelineLayout; backgroundColor: string; calendarColor: string; movable: boolean; onOpen: (event: CalendarEvent) => void; onResize: (event: CalendarEvent, endsAt: Date) => void; hourHeight: number }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `calendar-event:${layout.event.id}`, disabled: !movable });
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const height = previewHeight ?? layout.height;
  const showTime = height >= 40;
  const titleLines = Math.max(1, Math.floor((height - (showTime ? 18 : 7)) / 11));
  const startResize = (pointer: ReactPointerEvent<HTMLButtonElement>) => {
    pointer.preventDefault();
    pointer.stopPropagation();
    const startY = pointer.clientY;
    const initialHeight = height;
    let finalHeight = initialHeight;
    const move = (event: PointerEvent) => {
      finalHeight = Math.max(minutesToDurationPixels(SNAP_MINUTES, hourHeight), Math.round((initialHeight + event.clientY - startY) / minutesToDurationPixels(SNAP_MINUTES, hourHeight)) * minutesToDurationPixels(SNAP_MINUTES, hourHeight));
      setPreviewHeight(finalHeight);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      setPreviewHeight(null);
      const durationMinutes = Math.max(SNAP_MINUTES, Math.round(finalHeight / (hourHeight / 60) / SNAP_MINUTES) * SNAP_MINUTES);
      onResize(layout.event, new Date(new Date(layout.event.startsAt).getTime() + durationMinutes * 60 * 1000));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      data-calendar-event
      tabIndex={0}
      onClick={(click) => { click.stopPropagation(); if (!isDragging) onOpen(layout.event); }}
      onKeyDown={(key) => key.key === 'Enter' && onOpen(layout.event)}
      className={`absolute z-[5] overflow-hidden rounded-[5px] px-1 py-1 text-left text-[10px] shadow-sm sm:px-1.5 sm:text-[11px] ${movable ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'} ${isDragging ? 'opacity-30' : ''}`}
      style={{
        top: layout.top,
        height,
        left: `calc(${(layout.column / layout.columns) * 100}% + 2px)`,
        width: `calc(${100 / layout.columns}% - 4px)`,
        ...eventCardStyle(layout.event, calendarColor, 4, backgroundColor),
        transform: CSS.Translate.toString(transform),
      }}
    >
      <span className="overflow-hidden break-words font-semibold leading-[1.08]" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: titleLines }}>{layout.event.title}</span>
      {showTime && <span className="mt-0.5 block truncate text-[8px] leading-none opacity-70 sm:text-[9px]">{formatTime(layout.event.startsAt)}–{layout.event.endsAt ? formatTime(layout.event.endsAt) : ''}</span>}
      {movable && layout.resizable && <button type="button" onPointerDown={startResize} onClick={(click) => click.stopPropagation()} className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize touch-none" aria-label="Изменить длительность"><span className="mx-auto block h-0.5 w-6 rounded bg-current opacity-40" /></button>}
    </div>
  );
}

function layoutTimelineEvents(events: CalendarEvent[], date: Date, hourHeight: number): TimelineLayout[] {
  const visibleStart = startOfDay(date);
  visibleStart.setHours(DAY_START_HOUR);
  const visibleEnd = startOfDay(date);
  visibleEnd.setHours(DAY_END_HOUR);
  const items = events
    .map((event) => {
      const originalStart = new Date(event.startsAt);
      const originalEnd = event.endsAt ? new Date(event.endsAt) : new Date(originalStart.getTime() + 60 * 60 * 1000);
      const start = new Date(Math.max(originalStart.getTime(), visibleStart.getTime()));
      const end = new Date(Math.min(originalEnd.getTime(), visibleEnd.getTime()));
      return { event, originalStart, start, end };
    })
    .filter((item) => item.end > item.start)
    .sort((left, right) => left.start.getTime() - right.start.getTime() || left.end.getTime() - right.end.getTime());

  const groups: typeof items[] = [];
  let group: typeof items = [];
  let groupEnd = 0;
  for (const item of items) {
    if (group.length && item.start.getTime() >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = 0;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end.getTime());
  }
  if (group.length) groups.push(group);

  return groups.flatMap((overlapGroup) => {
    const columnEnds: number[] = [];
    const placed = overlapGroup.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.start.getTime());
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = item.end.getTime();
      return { item, column };
    });
    const columns = Math.max(1, columnEnds.length);
    return placed.map(({ item, column }) => ({
      event: item.event,
      top: minutesToPixels(item.start.getHours() * 60 + item.start.getMinutes(), hourHeight),
      height: Math.max(minutesToDurationPixels(SNAP_MINUTES, hourHeight), minutesToDurationPixels((item.end.getTime() - item.start.getTime()) / 60000, hourHeight)),
      column,
      columns,
      resizable: isSameDay(item.originalStart, date),
    }));
  });
}

function minutesToPixels(minuteOfDay: number, hourHeight: number) {
  return (minuteOfDay - DAY_START_HOUR * 60) * (hourHeight / 60);
}

function minutesToDurationPixels(minutes: number, hourHeight: number) {
  return minutes * (hourHeight / 60);
}

function timelineGridHeight(hourCount: number, hourHeight: number) {
  return (hourCount - 1 + FINAL_HOUR_HEIGHT_MULTIPLIER) * hourHeight;
}

function timelineDropId(date: Date, minuteOfDay: number) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `calendar-slot:${key}:${minuteOfDay}`;
}

function parseTimelineDropId(value: string) {
  const match = /^calendar-slot:(\d{4})-(\d{2})-(\d{2}):(\d+)$/.exec(value);
  if (!match) return undefined;
  return {
    date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    minuteOfDay: Number(match[4]),
  };
}

function EventChip({ event, calendar, onOpen }: { event: CalendarEvent; calendar?: Calendar; onOpen: (event: CalendarEvent) => void }) {
  const calendarColor = calendar?.color ?? event.color;
  return <span role="button" tabIndex={0} onClick={(click) => { click.stopPropagation(); onOpen(event); }} onKeyDown={(key) => key.key === 'Enter' && onOpen(event)} className="block h-full w-full truncate rounded-[3px] px-1 text-[9px] font-semibold leading-[17px]" style={eventCardStyle(event, calendarColor, 2)}>{event.allDay ? '' : formatTime(event.startsAt)} {event.title}</span>;
}

function AgendaView({ events, calendars, onOpen }: { events: CalendarEvent[]; calendars: Map<string, Calendar>; onOpen: (event: CalendarEvent) => void }) {
  const groups = groupEventsByDay(events);
  if (!events.length) return <EmptyState />;
  return <div className="mx-auto max-w-3xl space-y-5">{groups.map(([key, items]) => <section key={key}><h2 className="sticky top-0 z-10 mb-2 bg-[var(--tg-theme-bg-color)] py-1 text-sm font-bold">{formatDayHeading(new Date(key))}</h2><div className="space-y-2">{items.map((event) => { const calendarColor = calendars.get(event.calendarId)?.color ?? event.color; return <button key={event.id} type="button" onClick={() => onOpen(event)} className="flex w-full items-start gap-3 rounded-[8px] p-3 text-left" style={eventCardStyle(event, calendarColor, 4)}><span className="w-20 shrink-0 text-xs font-semibold opacity-80">{event.allDay ? 'Весь день' : formatTime(event.startsAt)}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold leading-tight">{event.title}</span><span className="mt-0.5 block truncate text-xs opacity-75">{calendars.get(event.calendarId)?.name}</span></span></button>; })}</div></section>)}</div>;
}

function EmptyState() {
  return <div className="py-16 text-center"><p className="font-semibold">Событий на этот период нет</p><p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">Создайте событие или включите нужный календарь.</p></div>;
}

function calendarCategoryOptions(calendar?: Calendar, draft?: EventDraft) {
  const overrides = new Map((calendar?.categories ?? []).map((category) => [category.id, category]));
  const options = [
    ...BASE_EVENT_CATEGORIES.map((category) => ({ ...category, ...overrides.get(category.id) })),
    ...(calendar?.categories ?? []).filter((category) => !category.id.startsWith('base:')),
  ];
  if (draft?.categoryId && !options.some((category) => category.id === draft.categoryId)) {
    options.push({
      id: draft.categoryId,
      label: draft.categoryLabel || categoryLabelForType(draft.type),
      color: draft.color,
      type: draft.type,
    });
  }
  return options.filter((category, index) => options.findIndex((item) => item.id === category.id) === index);
}

function upsertCalendarCategory(categories: CalendarCategory[] | undefined, category: CalendarCategory) {
  const current = categories ?? [];
  return current.some((item) => item.id === category.id)
    ? current.map((item) => item.id === category.id ? category : item)
    : [...current, category];
}

function categoryLabelForType(type: CalendarEventType) {
  return BASE_EVENT_CATEGORIES.find((category) => category.type === type)?.label ?? 'Другое';
}

function eventCardStyle(event: CalendarEvent, calendarColor: string, calendarStripeWidth: number, backgroundOverride?: string): CSSProperties {
  const isTaskDeadline = event.sourceType === 'kanban' && event.type === 'deadline';
  const categoryColor = isTaskDeadline ? '#FF3B30' : backgroundOverride ?? event.color;
  return {
    backgroundColor: hexToRgba(categoryColor, isTaskDeadline ? 0.34 : 0.22),
    color: 'var(--tg-theme-text-color)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: categoryColor,
    borderTopWidth: calendarStripeWidth,
    borderTopColor: calendarColor,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.9)${isTaskDeadline ? ', inset 0 0 0 2px #FFD60A' : ''}`,
  };
}

function hexToRgba(color: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function EventForm({ draft, calendars, editing, onChange, onCreateCategory, onUpdateCategory, onRemoveCategory, onClose, onSave }: {
  draft: EventDraft;
  calendars: Calendar[];
  editing: boolean;
  onChange: (draft: EventDraft) => void;
  onCreateCategory: (label: string, color: string) => Promise<CalendarCategory>;
  onUpdateCategory: (categoryId: string, color: string) => Promise<CalendarCategory>;
  onRemoveCategory: (categoryId: string) => Promise<void>;
  onClose: () => void;
  onSave: () => void;
}) {
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryLabel, setCategoryLabel] = useState('');
  const [categoryColor, setCategoryColor] = useState('#EC4899');
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryUpdating, setCategoryUpdating] = useState(false);
  const [categoryRemoving, setCategoryRemoving] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [categoryPendingDelete, setCategoryPendingDelete] = useState<CalendarCategory | null>(null);
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const categoryOptions = calendarCategoryOptions(selectedCalendar, draft);
  const selectedCategory = categoryOptions.find((category) => category.id === draft.categoryId);
  const canManageCategories = Boolean(selectedCalendar && (selectedCalendar.type === 'PERSONAL' || selectedCalendar.permissions?.editAll));

  const changeStart = (startsAt: string) => {
    const start = new Date(startsAt);
    const endsAt = Number.isNaN(start.getTime())
      ? draft.endsAt
      : toLocalInputValue(new Date(start.getTime() + 60 * 60 * 1000));
    onChange({ ...draft, startsAt, endsAt });
  };

  const changeAllDayDate = (date: string) => {
    const time = draft.startsAt.slice(11, 16) || '09:00';
    changeStart(`${date}T${time}`);
  };

  const selectCategory = (categoryId: string) => {
    if (categoryId === 'add-category') {
      setCategoryEditorOpen(true);
      return;
    }
    const category = categoryOptions.find((item) => item.id === categoryId);
    if (!category) return;
    setCategoryEditorOpen(false);
    onChange({
      ...draft,
      categoryId: category.id,
      categoryLabel: category.label,
      type: category.type ?? 'custom',
      color: category.color,
    });
  };

  const saveCategory = async () => {
    const label = categoryLabel.trim();
    if (!label || categorySaving) return;
    setCategorySaving(true);
    try {
      await onCreateCategory(label, categoryColor);
      setCategoryLabel('');
      setCategoryError('');
      setCategoryEditorOpen(false);
    } catch (reason) {
      setCategoryError(toErrorMessage(reason));
    } finally {
      setCategorySaving(false);
    }
  };

  const updateSelectedCategoryColor = async (color: string) => {
    if (!selectedCategory || categoryUpdating) return;
    setCategoryUpdating(true);
    try {
      await onUpdateCategory(selectedCategory.id, color.toUpperCase());
      setCategoryError('');
    } catch (reason) {
      setCategoryError(toErrorMessage(reason));
    } finally {
      setCategoryUpdating(false);
    }
  };

  const removeSelectedCategory = async () => {
    if (!categoryPendingDelete || categoryPendingDelete.id.startsWith('base:') || categoryRemoving) return;
    setCategoryRemoving(true);
    try {
      await onRemoveCategory(categoryPendingDelete.id);
      setCategoryError('');
      setCategoryPendingDelete(null);
    } catch (reason) {
      setCategoryError(toErrorMessage(reason));
      setCategoryPendingDelete(null);
    } finally {
      setCategoryRemoving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-end bg-black/50" onClick={onClose}>
        <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(click) => click.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? 'Редактировать событие' : 'Новое событие'}</h2>
          <button type="button" onClick={onClose} className="h-8 w-8" aria-label="Закрыть">×</button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Календарь
            <select value={draft.calendarId} disabled={editing} onChange={(event) => {
              onChange({
                ...draft,
                calendarId: event.target.value,
                categoryId: DEFAULT_EVENT_CATEGORY.id,
                categoryLabel: DEFAULT_EVENT_CATEGORY.label,
                type: DEFAULT_EVENT_CATEGORY.type ?? 'meeting',
                color: DEFAULT_EVENT_CATEGORY.color,
              });
            }} className="mt-1 h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm text-[var(--tg-theme-text-color)] outline-none">
              {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
            </select>
          </label>
          <input autoFocus value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder="Название события" maxLength={160} className="h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm outline-none" />
          <textarea value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="Описание" rows={3} className="w-full resize-none rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-sm outline-none" />
          <input value={draft.location} onChange={(event) => onChange({ ...draft, location: event.target.value })} placeholder="Место" className="h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm outline-none" />
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-[var(--tg-theme-hint-color)]">Категория мероприятия</legend>
            <label className="relative block min-w-0">
              <span className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full" style={{ backgroundColor: draft.color }} />
              <select value={draft.categoryId} onChange={(event) => selectCategory(event.target.value)} className="h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] pl-8 pr-3 text-sm text-[var(--tg-theme-text-color)] outline-none">
                {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                {canManageCategories && <option value="add-category">＋ Добавить категорию</option>}
              </select>
            </label>
            {categoryEditorOpen && canManageCategories && (
              <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-[var(--tg-theme-secondary-bg-color)] p-2">
                <label className="relative h-9 w-9 shrink-0 cursor-pointer rounded-full border-2 border-white shadow" style={{ backgroundColor: categoryColor }} title="Цвет категории">
                  <input type="color" value={categoryColor} onChange={(event) => setCategoryColor(event.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Цвет новой категории" />
                </label>
                <input value={categoryLabel} onChange={(event) => setCategoryLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCategory(); } }} placeholder="Название категории" maxLength={80} className="h-9 min-w-0 flex-1 rounded-[6px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm outline-none" />
                <button type="button" onClick={() => void saveCategory()} disabled={!categoryLabel.trim() || categorySaving} className="h-9 rounded-[6px] bg-[var(--tg-theme-button-color)] px-3 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-40">{categorySaving ? '...' : 'Добавить'}</button>
              </div>
            )}
            {!categoryEditorOpen && canManageCategories && selectedCategory && (
              <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-[var(--tg-theme-secondary-bg-color)] px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--tg-theme-hint-color)]">Цвет всей категории</span>
                <label className="relative h-8 w-8 shrink-0 cursor-pointer rounded-full border-2 border-white shadow" style={{ backgroundColor: selectedCategory.color }} title="Изменить цвет всей категории">
                  <input type="color" value={selectedCategory.color} disabled={categoryUpdating} onChange={(event) => void updateSelectedCategoryColor(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait" aria-label="Изменить цвет всей категории" />
                </label>
                {!selectedCategory.id.startsWith('base:') && (
                  <button type="button" onClick={() => setCategoryPendingDelete(selectedCategory)} disabled={categoryRemoving} className="h-8 w-8 shrink-0 rounded-[6px] bg-red-500/10 text-base text-red-500 disabled:opacity-40" aria-label="Удалить категорию">×</button>
                )}
              </div>
            )}
            {categoryError && <p className="mt-1 text-xs text-red-500">{categoryError}</p>}
          </fieldset>
          <label className="flex items-center justify-between rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm"><span>Весь день</span><input type="checkbox" checked={draft.allDay} onChange={(event) => onChange({ ...draft, allDay: event.target.checked })} /></label>
          {draft.allDay ? (
            <label className="block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Дата<input type="date" value={draft.startsAt.slice(0, 10)} onChange={(event) => changeAllDayDate(event.target.value)} className="mt-1 h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm text-[var(--tg-theme-text-color)]" /></label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">Начало<input type="datetime-local" value={draft.startsAt} onInput={(event) => changeStart(event.currentTarget.value)} className="mt-1 h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 text-sm text-[var(--tg-theme-text-color)]" /></label>
              <label className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">Окончание<input type="datetime-local" value={draft.endsAt} onChange={(event) => onChange({ ...draft, endsAt: event.target.value })} className="mt-1 h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 text-sm text-[var(--tg-theme-text-color)]" /></label>
            </div>
          )}
          <label className="flex items-center justify-between rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm">
            <span><span className="block font-semibold">Уведомление в Telegram</span><span className="block text-xs text-[var(--tg-theme-hint-color)]">Выключено по умолчанию</span></span>
            <input type="checkbox" checked={draft.notificationEnabled} onChange={(event) => onChange({ ...draft, notificationEnabled: event.target.checked })} />
          </label>
          {draft.notificationEnabled && <label className="block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Дата и время уведомления<input type="datetime-local" value={draft.notificationAt} max={draft.startsAt} onChange={(event) => onChange({ ...draft, notificationAt: event.target.value })} className="mt-1 h-11 w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 text-sm text-[var(--tg-theme-text-color)]" /></label>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] font-semibold">Отмена</button>
            <button type="button" onClick={onSave} disabled={!draft.title.trim()} className="h-11 flex-1 rounded-[8px] bg-[var(--tg-theme-button-color)] font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-40">Сохранить</button>
          </div>
        </div>
      </div>
      </div>
      {categoryPendingDelete && (
        <ConfirmDialog
          title="Удалить категорию?"
          description={`«${categoryPendingDelete.label}» исчезнет из списка, а ее события будут перенесены в категорию «Встреча».`}
          busy={categoryRemoving}
          onCancel={() => setCategoryPendingDelete(null)}
          onConfirm={() => void removeSelectedCategory()}
        />
      )}
    </>
  );
}

function ConfirmDialog({ title, description, busy, onCancel, onConfirm }: {
  title: string;
  description: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={() => !busy && onCancel()}>
      <div className="w-full max-w-sm rounded-[8px] bg-[var(--tg-theme-bg-color)] p-4 text-[var(--tg-theme-text-color)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-base font-bold">{title}</h3>
        <p className="mt-2 text-sm leading-5 text-[var(--tg-theme-hint-color)]">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="h-10 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-4 text-sm font-semibold disabled:opacity-40">Отмена</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="h-10 min-w-24 rounded-[8px] bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Удаление...' : 'Удалить'}</button>
        </div>
      </div>
    </div>
  );
}

function EventDetails({ event, calendar, canEdit, canDelete, onClose, onEdit, onDelete, onOpenProject }: { event: CalendarEvent; calendar?: Calendar; canEdit: boolean; canDelete: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenProject: () => void }) {
  return <div className="fixed inset-0 z-[90] flex items-end bg-black/50" onClick={onClose}><div className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5" onClick={(click) => click.stopPropagation()}><div className="flex items-start gap-3"><span className="mt-1 h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: calendar?.color ?? event.color }} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">{calendar?.name}</p><h2 className="break-words text-lg font-bold">{event.title}</h2><p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">{formatEventRange(event)}</p>{event.location && <p className="mt-2 text-sm">{event.location}</p>}<p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">{calendarNotificationLabel(event)}</p></div><button type="button" onClick={onClose} className="h-8 w-8" aria-label="Закрыть">×</button></div>{event.description && <p className="mt-4 whitespace-pre-wrap rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-sm">{event.description}</p>}<div className="mt-4 flex flex-wrap gap-2">{event.projectId && <button type="button" onClick={onOpenProject} className="h-10 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm font-semibold">Открыть проект</button>}{canEdit && <button type="button" onClick={onEdit} className="h-10 rounded-[8px] bg-[var(--tg-theme-button-color)] px-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)]">Изменить</button>}{canDelete && <button type="button" onClick={onDelete} className="h-10 rounded-[8px] bg-red-500 px-3 text-sm font-semibold text-white">Удалить</button>}</div></div></div>;
}

function calendarNotificationLabel(event: CalendarEvent) {
  const notification = event.notification;
  if (!notification?.enabled || !notification.remindAt) return 'Уведомление выключено';
  const time = new Date(notification.remindAt).toLocaleString('ru-RU');
  if (notification.deliveryStatus === 'sent') return `Отправлено в Telegram: ${time}`;
  if (notification.deliveryStatus === 'failed') return `Не удалось отправить в Telegram: ${time}`;
  if (notification.deliveryStatus === 'missed') return `Время уведомления пропущено: ${time}`;
  if (notification.deliveryStatus === 'disabled') return `Уведомления Telegram отключены: ${time}`;
  if (notification.deliveryStatus === 'retry') return `Повторная попытка отправки: ${time}`;
  return `Запланировано в Telegram: ${time}`;
}

function readEnabledCalendars(calendars: Calendar[]) {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const accessible = new Set(calendars.map((calendar) => calendar.id));
      return new Set<string>(saved.map(String).filter((id) => accessible.has(id)));
    }
  } catch {
    // Use all accessible calendars when browser storage is unavailable or invalid.
  }
  return new Set(calendars.map((calendar) => calendar.id));
}

function readShowTaskDeadlines() {
  try {
    return localStorage.getItem(DEADLINES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function taskDeadlineEventId(task: Task) {
  return `task-deadline:${task.id}`;
}

function taskToDeadlineEvent(task: Task, calendars: Calendar[]): CalendarEvent | undefined {
  if (!task.deadlineAt) return undefined;
  const calendar = calendars.find((item) => String(item.projectId) === String(task.projectId));
  if (!calendar) return undefined;
  const deadline = new Date(task.deadlineAt);
  if (!Number.isFinite(deadline.getTime())) return undefined;
  return {
    id: taskDeadlineEventId(task),
    calendarId: calendar.id,
    projectId: String(task.projectId),
    ownerUserId: String(task.assigneeId ?? ''),
    createdByUserId: '',
    title: `📋 ${task.title}`,
    description: `Дедлайн задачи${task.project?.title ? ` в проекте «${task.project.title}»` : ''}`,
    startsAt: deadline.toISOString(),
    endsAt: new Date(deadline.getTime() + 30 * 60 * 1000).toISOString(),
    allDay: false,
    type: 'deadline',
    color: '#FF3B30',
    categoryId: 'kanban:deadline',
    categoryLabel: 'Дедлайн задачи',
    visibility: 'project',
    participantUserIds: [],
    location: 'Канбан-доска',
    sourceType: 'kanban',
    sourceId: String(task.id),
    notification: { enabled: false },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt ?? task.createdAt,
  };
}

function readHourHeight() {
  try {
    const stored = localStorage.getItem(HOUR_HEIGHT_STORAGE_KEY);
    if (stored !== null) {
      const saved = Number(stored);
      if (Number.isFinite(saved)) return clamp(saved, MIN_HOUR_HEIGHT, MAX_HOUR_HEIGHT);
    }
  } catch {
    // Fall back to the standard density when browser storage is unavailable.
  }
  return DEFAULT_HOUR_HEIGHT;
}

function saveHourHeight(hourHeight: number) {
  try {
    localStorage.setItem(HOUR_HEIGHT_STORAGE_KEY, String(hourHeight));
  } catch {
    // The current session can still use zoom when browser storage is unavailable.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getViewRange(view: ViewMode, cursor: Date) {
  if (view === 'month') {
    const days = monthGrid(cursor);
    return { start: days[0], end: addDays(days[days.length - 1], 1) };
  }
  if (view === 'agenda') return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 120) };
  return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), Number(view)) };
}

function shiftCursor(cursor: Date, view: ViewMode, direction: number) {
  if (view === 'month') return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
  if (view === 'agenda') return addDays(cursor, direction * 30);
  return addDays(cursor, direction * Number(view));
}

function rangeLabel(view: ViewMode, cursor: Date) {
  if (view === 'month') return capitalize(cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }));
  if (view === 'agenda') return `С ${cursor.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
  const days = Number(view);
  if (days === 1) return capitalize(cursor.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }));
  return `${cursor.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} – ${addDays(cursor, days - 1).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
}

function compactMonthLabel(cursor: Date) {
  const includeYear = cursor.getFullYear() !== new Date().getFullYear();
  return capitalize(cursor.toLocaleDateString('ru-RU', includeYear ? { month: 'long', year: 'numeric' } : { month: 'long' }));
}

function shortViewLabel(view: ViewMode) {
  if (view === 'month') return 'Мес';
  if (view === 'agenda') return 'Список';
  return `${view}д`;
}

function monthGrid(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const weekday = result.getDay() || 7;
  result.setDate(result.getDate() - weekday + 1);
  return result;
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function eventTouchesDay(event: CalendarEvent, day: Date) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const eventStart = new Date(event.startsAt).getTime();
  const eventEnd = event.endsAt ? new Date(event.endsAt).getTime() : eventStart;
  return eventStart < dayEnd && eventEnd >= dayStart;
}

function groupEventsByDay(events: CalendarEvent[]) {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = startOfDay(new Date(event.startsAt)).toISOString();
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function formatDayHeading(date: Date) {
  return capitalize(date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatEventRange(event: CalendarEvent) {
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: event.allDay ? undefined : '2-digit', minute: event.allDay ? undefined : '2-digit' };
  const start = new Date(event.startsAt).toLocaleString('ru-RU', options);
  return event.endsAt ? `${start} – ${new Date(event.endsAt).toLocaleString('ru-RU', options)}` : start;
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function withAlpha(color: string, alpha: number) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, '0')}` : color;
}

function capitalize(value: string) {
  return value ? value[0].toLocaleUpperCase('ru-RU') + value.slice(1) : value;
}

function toErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : 'Не удалось загрузить календарь.';
  if (!message.startsWith('Workspace API ')) return message;

  const payloadStart = message.indexOf('{');
  if (payloadStart < 0) return message;
  try {
    const payload = JSON.parse(message.slice(payloadStart)) as { error?: unknown };
    return typeof payload.error === 'string' && payload.error.trim() ? payload.error : message;
  } catch {
    return message;
  }
}
