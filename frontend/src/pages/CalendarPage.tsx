import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { calendarApi } from '../api/calendar';
import { tasksApi } from '../api/tasks';
import ContextMenu from '../components/common/ContextMenu';
import { useProjectStore } from '../store/projectStore';
import type { CalendarCategory, CalendarEvent, CalendarEventType, Task } from '../types';

type ViewMode = 'year' | 'month' | 'week' | 'day' | 'list';
type CalendarItem =
  | { kind: 'event'; date: string; color: string; title: string; event: CalendarEvent }
  | { kind: 'deadline'; date: string; color: string; title: string; task: Task };

const DEADLINES_KEY = 'workspace-calendar-show-kanban-deadlines-v1';
type CalendarTypeOption = {
  id: string;
  value: CalendarEventType;
  label: string;
  color: string;
  isCustom?: boolean;
};

const BASE_TYPE_OPTIONS: CalendarTypeOption[] = [
  { id: 'base:meeting', value: 'meeting', label: 'Встреча', color: '#3B82F6' },
  { id: 'base:service', value: 'service', label: 'Служение', color: '#22C55E' },
  { id: 'base:deadline', value: 'deadline', label: 'Дедлайн', color: '#EF4444' },
  { id: 'base:duty', value: 'duty', label: 'Дежурство', color: '#F59E0B' },
  { id: 'base:event', value: 'event', label: 'Событие', color: '#8B5CF6' },
  { id: 'base:custom', value: 'custom', label: 'Другое', color: '#64748B' },
];

const emptyForm = () => ({
  title: '',
  description: '',
  startsAt: toLocalInputValue(new Date(Date.now() + 3600000)),
  endsAt: '',
  allDay: false,
  type: 'meeting' as CalendarEventType,
  categoryId: BASE_TYPE_OPTIONS[0].id,
  color: BASE_TYPE_OPTIONS[0].color,
  visibility: 'project' as 'project' | 'selected',
  selectedUserIds: [] as string[],
});

export default function CalendarPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const { currentProject, fetchProject, updateProject } = useProjectStore();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [eventToDelete, setEventToDelete] = useState<CalendarEvent | null>(null);
  const [contextEvent, setContextEvent] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({ label: '', color: '#64748B' });
  const [showKanbanDeadlines, setShowKanbanDeadlines] = useState(() => localStorage.getItem(DEADLINES_KEY) !== '0');

  const members = currentProject?.members ?? [];
  const calendarTypeOptions = useMemo(
    () => [
      ...BASE_TYPE_OPTIONS,
      ...((currentProject?.calendarCategories ?? []).map((category) => ({
        id: category.id,
        value: category.type ?? 'custom',
        label: category.label,
        color: category.color,
        isCustom: true,
      })) satisfies CalendarTypeOption[]),
    ],
    [currentProject?.calendarCategories],
  );
  const visibleEvents = useMemo(() => {
    const calendarItems = events.map((event) => ({
      kind: 'event' as const,
      date: event.startsAt,
      color: event.color,
      title: event.title,
      event,
    }));
    const deadlineItems = showKanbanDeadlines
      ? tasks
          .filter((task) => task.deadlineAt && !task.isArchived)
          .map((task) => ({
            kind: 'deadline' as const,
            date: task.deadlineAt!,
            color: '#EF4444',
            title: task.title,
            task,
          }))
      : [];
    return [...calendarItems, ...deadlineItems].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, showKanbanDeadlines, tasks]);

  useEffect(() => {
    if (!pid) return;
    fetchProject(pid);
  }, [fetchProject, pid]);

  useEffect(() => {
    if (!projectId) return;
    calendarApi.list(projectId).then(setEvents).catch(() => setEvents([]));
    tasksApi.getAllProjectTasks(Number(projectId)).then(setTasks).catch(() => setTasks([]));
  }, [projectId]);

  const openCreateForm = () => {
    setEditingEvent(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEditForm = (event: CalendarEvent) => {
    setSelectedEvent(null);
    setEditingEvent(event);
    setForm({
      title: event.title,
      description: event.description ?? '',
      startsAt: toLocalInputValue(new Date(event.startsAt)),
      endsAt: event.endsAt ? toLocalInputValue(new Date(event.endsAt)) : '',
      allDay: event.allDay,
      type: event.type,
      categoryId: event.categoryId ?? `base:${event.type}`,
      color: event.color,
      visibility: event.visibility,
      selectedUserIds: event.participantUserIds ?? [],
    });
    setShowForm(true);
  };

  const toggleKanbanDeadlines = () => {
    setShowKanbanDeadlines((value) => {
      localStorage.setItem(DEADLINES_KEY, value ? '0' : '1');
      return !value;
    });
  };

  const saveEvent = async () => {
    if (!projectId || !form.title.trim()) return;
    const participantUserIds = form.visibility === 'project' ? members.map((member) => String(member.userId)) : form.selectedUserIds;
    const selectedCategory = calendarTypeOptions.find((option) => option.id === form.categoryId);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
      allDay: form.allDay,
      type: selectedCategory?.value ?? form.type,
      color: form.color,
      categoryId: selectedCategory?.id ?? form.categoryId,
      categoryLabel: selectedCategory?.label,
      visibility: form.visibility,
      participantUserIds,
      location: '',
      link: '',
      sourceType: editingEvent?.sourceType ?? 'manual',
      sourceId: editingEvent?.sourceId,
    };

    if (editingEvent) {
      const updated = await calendarApi.update(editingEvent.id, payload);
      setEvents((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } else {
      const created = await calendarApi.create(projectId, payload);
      setEvents((items) => [...items, created].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
    }

    setShowForm(false);
    setEditingEvent(null);
    setForm(emptyForm());
  };

  const createCalendarCategory = async () => {
    if (!pid || !categoryDraft.label.trim()) return;
    const category: CalendarCategory = {
      id: `category_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      label: categoryDraft.label.trim(),
      color: categoryDraft.color,
      type: 'custom',
      createdAt: new Date().toISOString(),
    };
    const nextCategories = [...(currentProject?.calendarCategories ?? []), category];
    await updateProject(pid, { calendarCategories: nextCategories });
    setForm((value) => ({
      ...value,
      categoryId: category.id,
      type: 'custom',
      color: category.color,
    }));
    setCategoryDraft({ label: '', color: '#64748B' });
    setShowCategoryForm(false);
  };

  const removeEvent = async () => {
    if (!eventToDelete) return;
    await calendarApi.remove(eventToDelete.id);
    setEvents((items) => items.filter((item) => item.id !== eventToDelete.id));
    setSelectedEvent(null);
    setEventToDelete(null);
  };

  const openCalendarItem = (item: CalendarItem) => {
    if (item.kind === 'deadline') {
      const boardPageId = item.task.pageId;
      const path = boardPageId ? `/project/${projectId}/workspace/page/${boardPageId}` : `/project/${projectId}/workspace`;
      navigate(`${path}?taskId=${item.task.id}`);
      return;
    }

    if (item.event.type === 'duty' && item.event.sourceId) {
      navigate(`/project/${projectId}/workspace/page/${item.event.sourceId}`);
      return;
    }

    setSelectedEvent(item.event);
  };

  const openEventMenu = (event: CalendarEvent, x: number, y: number) => {
    setContextEvent({ event, x, y });
  };

  const range = getRange(view, cursor);
  const rangeItems = visibleEvents.filter((item) => isInsideRange(new Date(item.date), range.start, range.end));

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <div className="border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="h-9 w-9 text-xl text-[var(--tg-theme-link-color)]" aria-label="Назад">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">📅 Календарь</h1>
            <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{currentProject?.title ?? 'Проект'}</p>
          </div>
          <button onClick={openCreateForm} className="h-9 rounded-full bg-[var(--tg-theme-button-color)] px-4 text-sm font-semibold text-[var(--tg-theme-button-text-color)]">+</button>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto">
          {(['year', 'month', 'week', 'day', 'list'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${view === mode ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'}`}
            >
              {viewLabel(mode)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setCursor(shiftCursor(cursor, view, -1))} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)]">‹</button>
          <button onClick={() => setCursor(startOfDay(new Date()))} className="h-9 flex-1 rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm font-semibold">
            {rangeLabel(view, cursor)}
          </button>
          <button onClick={() => setCursor(shiftCursor(cursor, view, 1))} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)]">›</button>
        </div>

        <label className="mt-3 flex items-center justify-between rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm">
          <span>Отображать дедлайны Kanban</span>
          <input type="checkbox" checked={showKanbanDeadlines} onChange={toggleKanbanDeadlines} />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {view === 'month' && (
          <MonthGrid
            cursor={cursor}
            items={visibleEvents}
            onOpenItem={openCalendarItem}
            onEventMenu={openEventMenu}
            onSelectDay={(day) => {
              setCursor(day);
              setView('day');
            }}
          />
        )}
        {view === 'year' && (
          <YearGrid
            cursor={cursor}
            items={visibleEvents}
            onSelectMonth={(month) => {
              setCursor(new Date(cursor.getFullYear(), month, 1));
              setView('month');
            }}
          />
        )}
        {(view === 'week' || view === 'day' || view === 'list') && (
          <EventList items={rangeItems} empty="На этот период событий нет" onOpenItem={openCalendarItem} onEventMenu={openEventMenu} />
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-[90] flex items-end bg-black/50" onClick={() => setShowForm(false)}>
          <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">{editingEvent ? 'Редактировать событие' : 'Новое событие'}</h2>
              <button onClick={() => setShowForm(false)} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)]">×</button>
            </div>
            <div className="space-y-3">
              <input value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} placeholder="Название события" className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none" />
              <textarea value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} placeholder="Описание" className="h-20 w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none" />
              <div className="grid grid-cols-[1fr_52px_64px] gap-2">
                <select
                  value={form.categoryId}
                  onChange={(event) => {
                    const selected = calendarTypeOptions.find((option) => option.id === event.target.value);
                    if (!selected) return;
                    setForm((value) => ({
                      ...value,
                      categoryId: selected.id,
                      type: selected.value,
                      color: selected.color,
                    }));
                  }}
                  className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none"
                >
                  {calendarTypeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setShowCategoryForm(true)}
                  className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-lg font-bold text-[var(--tg-theme-link-color)]"
                  aria-label="Добавить тип события"
                  title="Добавить тип события"
                >
                  +
                </button>
                <input type="color" value={form.color} onChange={(event) => setForm((value) => ({ ...value, color: event.target.value }))} className="h-12 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-2" />
              </div>
              <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((value) => ({ ...value, startsAt: event.target.value }))} className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none" />
              <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((value) => ({ ...value, endsAt: event.target.value }))} className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none" />
              <label className="flex items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm">
                <input type="checkbox" checked={form.allDay} onChange={(event) => setForm((value) => ({ ...value, allDay: event.target.checked }))} />
                Весь день
              </label>
              <select value={form.visibility} onChange={(event) => setForm((value) => ({ ...value, visibility: event.target.value as 'project' | 'selected' }))} className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none">
                <option value="project">Видно всем участникам</option>
                <option value="selected">Только выбранным</option>
              </select>
              {form.visibility === 'selected' && (
                <div className="space-y-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                  <p className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">Участники</p>
                  {members.map((member) => {
                    const id = String(member.userId);
                    return (
                      <label key={id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.selectedUserIds.includes(id)}
                          onChange={(event) =>
                            setForm((value) => ({
                              ...value,
                              selectedUserIds: event.target.checked
                                ? [...new Set([...value.selectedUserIds, id])]
                                : value.selectedUserIds.filter((item) => item !== id),
                            }))
                          }
                        />
                        {member.user?.firstName ?? member.user?.username ?? `User ${id}`}
                      </label>
                    );
                  })}
                </div>
              )}
              <button onClick={saveEvent} disabled={!form.title.trim()} className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50">
                {editingEvent ? 'Сохранить изменения' : 'Создать событие'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <EventDetails
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => openEditForm(selectedEvent)}
          onDelete={() => setEventToDelete(selectedEvent)}
        />
      )}

      {showCategoryForm && (
        <div className="fixed inset-0 z-[98] flex items-end bg-black/50" onClick={() => setShowCategoryForm(false)}>
          <div className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">Новый тип события</h3>
              <button onClick={() => setShowCategoryForm(false)} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)]">×</button>
            </div>
            <div className="space-y-3">
              <input
                value={categoryDraft.label}
                onChange={(event) => setCategoryDraft((value) => ({ ...value, label: event.target.value }))}
                placeholder="Например: Репетиция, Лагерь, Дежурство"
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm outline-none"
              />
              <div className="grid grid-cols-[1fr_72px] gap-2">
                <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-hint-color)]">
                  Цвет типа
                </div>
                <input
                  type="color"
                  value={categoryDraft.color}
                  onChange={(event) => setCategoryDraft((value) => ({ ...value, color: event.target.value }))}
                  className="h-12 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-2"
                />
              </div>
              <button
                onClick={createCalendarCategory}
                disabled={!categoryDraft.label.trim()}
                className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
              >
                Добавить в список
              </button>
            </div>
          </div>
        </div>
      )}

      {eventToDelete && (
        <DeleteEventModal
          event={eventToDelete}
          onCancel={() => setEventToDelete(null)}
          onConfirm={removeEvent}
        />
      )}

      {contextEvent && (
        <ContextMenu
          title={contextEvent.event.title}
          x={contextEvent.x}
          y={contextEvent.y}
          onClose={() => setContextEvent(null)}
          items={[
            { label: 'Открыть карточку', onClick: () => setSelectedEvent(contextEvent.event) },
            { label: 'Редактировать', onClick: () => openEditForm(contextEvent.event) },
            { label: 'Удалить', danger: true, onClick: () => setEventToDelete(contextEvent.event) },
          ]}
        />
      )}
    </div>
  );
}

function MonthGrid({
  cursor,
  items,
  onSelectDay,
  onOpenItem,
  onEventMenu,
}: {
  cursor: Date;
  items: CalendarItem[];
  onSelectDay: (day: Date) => void;
  onOpenItem: (item: CalendarItem) => void;
  onEventMenu: (event: CalendarEvent, x: number, y: number) => void;
}) {
  const days = getMonthGrid(cursor);
  return (
    <div className="grid grid-cols-7 gap-1">
      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div key={day} className="py-1 text-center text-[11px] text-[var(--tg-theme-hint-color)]">{day}</div>)}
      {days.map((day) => {
        const dayItems = items.filter((item) => isSameDay(new Date(item.date), day)).slice(0, 3);
        return (
          <div
            key={day.toISOString()}
            onClick={() => onSelectDay(day)}
            className={`min-h-[82px] rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-1 active:scale-[0.98] ${day.getMonth() !== cursor.getMonth() ? 'opacity-45' : ''}`}
            role="button"
            tabIndex={0}
          >
            <p className="mb-1 text-center text-xs font-semibold leading-5">{day.getDate()}</p>
            <div className="space-y-1">
              {dayItems.map((item, index) => (
                <EventPill
                  key={`${item.kind}-${item.title}-${index}`}
                  item={item}
                  compact
                  onOpen={onOpenItem}
                  onEventMenu={onEventMenu}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function YearGrid({
  cursor,
  items,
  onSelectMonth,
}: {
  cursor: Date;
  items: CalendarItem[];
  onSelectMonth: (month: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 12 }, (_, month) => {
        const count = items.filter((item) => new Date(item.date).getFullYear() === cursor.getFullYear() && new Date(item.date).getMonth() === month).length;
        return (
          <button key={month} onClick={() => onSelectMonth(month)} className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left active:scale-[0.98]">
            <p className="text-sm font-bold">{new Date(cursor.getFullYear(), month, 1).toLocaleString('ru-RU', { month: 'long' })}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--tg-theme-button-color)]">{count}</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">событий</p>
          </button>
        );
      })}
    </div>
  );
}

function EventList({
  items,
  empty,
  onOpenItem,
  onEventMenu,
}: {
  items: CalendarItem[];
  empty: string;
  onOpenItem: (item: CalendarItem) => void;
  onEventMenu: (event: CalendarEvent, x: number, y: number) => void;
}) {
  if (items.length === 0) return <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">{empty}</div>;
  return <div className="space-y-2">{items.map((item, index) => <EventPill key={`${item.kind}-${item.title}-${index}`} item={item} onOpen={onOpenItem} onEventMenu={onEventMenu} />)}</div>;
}

function EventPill({
  item,
  compact = false,
  onOpen,
  onEventMenu,
}: {
  item: CalendarItem;
  compact?: boolean;
  onOpen: (item: CalendarItem) => void;
  onEventMenu: (event: CalendarEvent, x: number, y: number) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const clearLongPress = () => {
    if (!timerRef.current) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  return (
    <button
      type="button"
      data-testid={item.kind === 'event' ? `calendar-event-${item.event.id}` : `calendar-task-${item.task.id}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      onContextMenu={(event) => {
        if (item.kind !== 'event') return;
        event.preventDefault();
        event.stopPropagation();
        onEventMenu(item.event, event.clientX, event.clientY);
      }}
      onPointerDown={(event) => {
        if (item.kind !== 'event') return;
        const x = event.clientX;
        const y = event.clientY;
        timerRef.current = window.setTimeout(() => onEventMenu(item.event, x, y), 650);
      }}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      className={`block w-full rounded-[8px] text-left ${compact ? 'px-1 py-0.5' : 'p-3'} text-white active:scale-[0.99]`}
      style={{ backgroundColor: item.color }}
    >
      <p className={`${compact ? 'truncate text-[10px]' : 'text-sm'} font-semibold`}>{item.kind === 'deadline' ? '📋 ' : ''}{item.title}</p>
      {!compact && <p className="mt-1 text-xs opacity-90">{new Date(item.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>}
    </button>
  );
}

function EventDetails({
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[88] flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5" onClick={(click) => click.stopPropagation()}>
        <div className="mb-3 flex items-start gap-3">
          <span className="mt-1 h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">{event.categoryLabel || typeLabel(event.type)}</p>
            <h2 className="break-words text-lg font-bold text-[var(--tg-theme-text-color)]">{event.title}</h2>
            <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">{formatEventRange(event)}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)]">×</button>
        </div>
        {event.description && <p className="mb-4 whitespace-pre-wrap rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-sm">{event.description}</p>}
        <div className="flex gap-3">
          <button onClick={onEdit} className="flex-1 rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)]">
            Редактировать
          </button>
          <button onClick={onDelete} className="flex-1 rounded-[12px] bg-red-500 py-3 text-sm font-semibold text-white">
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteEventModal({
  event,
  onCancel,
  onConfirm,
}: {
  event: CalendarEvent;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onCancel}>
      <div className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5" onClick={(click) => click.stopPropagation()}>
        <h3 className="mb-2 text-lg font-bold">Удалить событие?</h3>
        <p className="mb-4 text-sm text-[var(--tg-theme-hint-color)]">«{event.title}» будет удалено из календаря. Это действие нельзя отменить.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium">Отмена</button>
          <button onClick={onConfirm} className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white">Удалить</button>
        </div>
      </div>
    </div>
  );
}

function viewLabel(view: ViewMode) {
  return ({ year: 'Год', month: 'Месяц', week: 'Неделя', day: 'День', list: 'Список' } as const)[view];
}

function typeLabel(type: CalendarEventType) {
  return BASE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Событие';
}

function rangeLabel(view: ViewMode, cursor: Date) {
  if (view === 'year') return String(cursor.getFullYear());
  if (view === 'month') return cursor.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
  if (view === 'day') return cursor.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
  if (view === 'week') {
    const range = getRange('week', cursor);
    return `${range.start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} - ${new Date(range.end.getTime() - 1).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
  }
  return 'Ближайшие события';
}

function formatEventRange(event: CalendarEvent) {
  const start = new Date(event.startsAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: event.allDay ? undefined : '2-digit',
    minute: event.allDay ? undefined : '2-digit',
  });
  if (!event.endsAt) return start;
  const end = new Date(event.endsAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: event.allDay ? undefined : '2-digit',
    minute: event.allDay ? undefined : '2-digit',
  });
  return `${start} - ${end}`;
}

function shiftCursor(date: Date, view: ViewMode, direction: number) {
  const next = new Date(date);
  if (view === 'year') next.setFullYear(next.getFullYear() + direction);
  else if (view === 'month') next.setMonth(next.getMonth() + direction);
  else if (view === 'week') next.setDate(next.getDate() + direction * 7);
  else next.setDate(next.getDate() + direction);
  return startOfDay(next);
}

function getRange(view: ViewMode, cursor: Date) {
  if (view === 'year') return { start: new Date(cursor.getFullYear(), 0, 1), end: new Date(cursor.getFullYear() + 1, 0, 1) };
  if (view === 'month') return { start: new Date(cursor.getFullYear(), cursor.getMonth(), 1), end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) };
  if (view === 'week') {
    const start = startOfWeek(cursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }
  if (view === 'day') {
    const start = startOfDay(cursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { start, end };
  }
  return { start: startOfDay(new Date()), end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120) };
}

function getMonthGrid(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function startOfWeek(date: Date) {
  const start = startOfDay(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isInsideRange(date: Date, start: Date, end: Date) {
  return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
