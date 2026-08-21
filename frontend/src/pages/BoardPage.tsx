import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useTaskStore } from '../store/taskStore';
import KanbanBoard from '../components/board/KanbanBoard';
import TaskModal from '../components/task/TaskModal';
import CreateTaskModal from '../components/board/CreateTaskModal';
import { tasksApi, type ArchiveCleanupMode } from '../api/tasks';
import { botSettingsApi } from '../api/botSettings';
import { useAuthStore } from '../store/authStore';
import type { ProjectMember, Task } from '../types';
import { getProjectPermissions } from '../utils/projectPermissions';

const MY_TASKS_FILTER_KEY = 'kanban-show-only-my-tasks-v1';

interface Props {
  embedded?: boolean;
  boardPageId?: string;
}

export default function BoardPage({ embedded = false, boardPageId }: Props) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pid = Number(projectId);

  const { currentProject, columns, fetchProject, fetchColumns, createColumn, updateColumn, deleteColumn } = useProjectStore();
  const { tasks, fetchTasks, openTask, closeTask, selectedTask, createTask } = useTaskStore();
  const currentUser = useAuthStore((state) => state.user);
  const currentUserId = currentUser?.id;

  const [createColumnId, setCreateColumnId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [activeView, setActiveView] = useState<'board' | 'members' | 'deferred' | 'archive'>('board');
  const [now, setNow] = useState(Date.now());
  const [showOnlyMyTasks, setShowOnlyMyTasks] = useState(() => localStorage.getItem(MY_TASKS_FILTER_KEY) === 'true');
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [archiveCleanupMode, setArchiveCleanupMode] = useState<ArchiveCleanupMode>('never');

  useEffect(() => {
    const loadBoard = async () => {
      await fetchProject(pid);
      await fetchColumns(pid, boardPageId);
      await fetchTasks(pid, boardPageId);
    };
    loadBoard();
  }, [boardPageId, fetchColumns, fetchProject, fetchTasks, pid]);

  useEffect(() => {
    const taskId = Number(searchParams.get('taskId'));
    if (!taskId || selectedTask?.id === taskId) return;
    openTask(taskId).catch(() => undefined);
  }, [openTask, searchParams, selectedTask?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(MY_TASKS_FILTER_KEY, String(showOnlyMyTasks));
  }, [showOnlyMyTasks]);

  useEffect(() => {
    if (activeView !== 'archive') return;
    tasksApi.getArchived(pid, boardPageId).then(setArchivedTasks);
  }, [activeView, archiveCleanupMode, boardPageId, pid]);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    botSettingsApi
      .getArchiveCleanupMode(pid)
      .then((mode) => {
        if (!cancelled) setArchiveCleanupMode(mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pid]);

  const members = currentProject?.members ?? [];
  const permissions = getProjectPermissions(currentProject, currentUserId);
  const canCreateTask = Boolean(permissions.createTask);
  const canUpdateTask = Boolean(permissions.updateTask);
  const canMoveTask = Boolean(permissions.moveTask);
  const canDeleteTask = Boolean(permissions.deleteTask);
  const canManageColumns = Boolean(permissions.manageColumns);

  const handleAddTask = (columnId: number) => {
    if (!canCreateTask) return;
    setCreateColumnId(columnId);
  };

  const handleTaskClick = async (task: Task) => {
    await openTask(task.id);
  };

  const handleCloseTask = () => {
    if (searchParams.has('taskId')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('taskId');
      setSearchParams(nextParams, { replace: true });
    }
    closeTask();
  };

  const handleCreateTask = async (data: any) => {
    if (!canCreateTask) return;
    const member = currentUserId
      ? currentProject?.members?.find((item) => String(item.userId) === String(currentUserId))
      : undefined;
    await createTask(pid, {
      ...data,
      pageId: boardPageId,
      assigneeId: showOnlyMyTasks && !data.assigneeId && currentUserId ? currentUserId : data.assigneeId,
      assignee: showOnlyMyTasks && !data.assigneeId ? member?.user : data.assignee,
    });
    await fetchTasks(pid, boardPageId);
  };

  const handleAddColumn = async () => {
    if (!canManageColumns) return;
    const nextNumber = columns.filter((column) => column.title.startsWith('Новый столбец')).length + 1;
    await createColumn(pid, nextNumber > 1 ? `Новый столбец ${nextNumber}` : 'Новый столбец', boardPageId);
  };

  const handleDuplicateColumn = async (columnId: number) => {
    if (!canManageColumns) return;
    const source = columns.find((column) => column.id === columnId);
    if (!source) return;
    await createColumn(pid, `${source.title} копия`, boardPageId);
  };

  const handleMoveColumn = async (columnId: number, direction: -1 | 1) => {
    if (!canManageColumns) return;
    const visible = columns.filter((column) => !column.isHidden && !column.isArchive).sort((a, b) => a.position - b.position);
    const index = visible.findIndex((column) => column.id === columnId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= visible.length) return;
    const ordered = [...visible];
    const [item] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, item);
    await useProjectStore.getState().reorderColumns(pid, ordered.map((column) => column.id), boardPageId);
  };

  const searchWords = searchQuery
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const filteredTasks = searchWords.length > 0
    ? tasks.filter((task) => {
        const subtasksText = (task.subtasks ?? []).map((subtask) => subtask.title).join(' ');
        const searchableText = `${task.title} ${task.description ?? ''} ${subtasksText}`.toLowerCase();
        return searchWords.every((word) => searchableText.includes(word));
      })
    : tasks;
  const personalTasks = showOnlyMyTasks
    ? filteredTasks.filter((task) => currentUserId && String(task.assigneeId ?? task.assignee?.id ?? '') === String(currentUserId))
    : filteredTasks;
  const dueTasks = personalTasks.filter((task) => !task.scheduledAt || new Date(task.scheduledAt).getTime() <= now);
  const deferredTasks = personalTasks.filter((task) => task.scheduledAt && new Date(task.scheduledAt).getTime() > now);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--tg-theme-bg-color)]">
      {embedded ? (
        <div className="px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
          <label className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-[var(--tg-theme-hint-color)]">
            <SearchIcon />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск задач..."
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--tg-theme-hint-color)]"
                aria-label="Очистить поиск"
              >
                ×
              </button>
            )}
          </label>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-link-color)]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {showSearch ? (
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск задач..."
              className="flex-1 bg-[var(--tg-theme-secondary-bg-color)] px-3 py-1.5 rounded-[8px] text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
              onBlur={() => {
                if (!searchQuery) setShowSearch(false);
              }}
            />
          ) : (
            <h1 className="flex-1 font-bold text-[var(--tg-theme-text-color)] truncate">
              {currentProject?.title ?? '...'}
            </h1>
          )}

          <button
            onClick={() => {
              if (showSearch && searchQuery) { setSearchQuery(''); }
              setShowSearch((v) => !v);
            }}
            className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-hint-color)]"
          >
            {showSearch && searchQuery ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <SearchIcon />
            )}
          </button>

          <button
            onClick={() => navigate(`/project/${pid}/settings`)}
            className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-hint-color)]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      )}

      {/* Нижняя навигация */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-2">
        <span className="text-xs font-medium text-[var(--tg-theme-hint-color)]">Фильтр задач</span>
        <button
          onClick={() => setShowOnlyMyTasks((value) => !value)}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            showOnlyMyTasks
              ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
              : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
          }`}
          aria-pressed={showOnlyMyTasks}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${showOnlyMyTasks ? 'bg-white' : 'bg-[var(--tg-theme-hint-color)]'}`} />
          Только мои
        </button>
      </div>

      <div className="flex border-b border-[var(--tg-theme-secondary-bg-color)]">
        {[
          { label: 'Доска', active: activeView === 'board', onClick: () => setActiveView('board') },
          { label: 'Участники', active: activeView === 'members', onClick: () => setActiveView('members') },
          { label: `Отложенные${deferredTasks.length ? ` · ${deferredTasks.length}` : ''}`, active: activeView === 'deferred', onClick: () => setActiveView('deferred') },
          { label: `Архив${archivedTasks.length ? ` · ${archivedTasks.length}` : ''}`, active: activeView === 'archive', onClick: () => setActiveView('archive') },
        ].map(({ label, active, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors ${
              active
                ? 'border-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-color)]'
                : 'border-transparent text-[var(--tg-theme-hint-color)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Kanban доска */}
      <div className="flex-1 overflow-visible py-3">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-[var(--tg-theme-button-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeView === 'members' ? (
          <MembersInlineView members={members} />
        ) : activeView === 'deferred' ? (
          <DeferredTasksView tasks={deferredTasks} onTaskClick={handleTaskClick} />
        ) : activeView === 'archive' ? (
          <ArchiveInlineView
            tasks={archivedTasks}
            cleanupMode={archiveCleanupMode}
            onCleanupModeChange={async (mode) => {
              setArchiveCleanupMode(mode);
              const savedMode = await botSettingsApi.setArchiveCleanupMode(pid, mode);
              setArchiveCleanupMode(savedMode);
            }}
            onClear={async () => {
              await tasksApi.clearArchive(pid);
              setArchivedTasks(await tasksApi.getArchived(pid, boardPageId));
            }}
          />
        ) : (
          <KanbanBoard
            columns={columns}
            tasks={dueTasks}
            onTaskClick={handleTaskClick}
            onAddTask={handleAddTask}
            onRenameColumn={canManageColumns ? (columnId, title) => updateColumn(columnId, { title }) : undefined}
            onAddColumn={canManageColumns ? handleAddColumn : undefined}
            onDuplicateColumn={canManageColumns ? handleDuplicateColumn : undefined}
            onMoveColumn={canManageColumns ? handleMoveColumn : undefined}
            onDeleteColumn={canManageColumns ? deleteColumn : undefined}
            canCreateTask={canCreateTask}
            canMoveTask={canMoveTask}
            canManageColumns={canManageColumns}
          />
        )}
      </div>

      {/* FAB — добавить задачу */}
      {canCreateTask && (
      <button
        onClick={() => {
          const defaultCol = columns.find((c) => c.isDefault) ?? columns[0];
          if (defaultCol) setCreateColumnId(defaultCol.id);
        }}
        className="fixed bottom-6 right-4 w-14 h-14 rounded-full bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] shadow-lg flex items-center justify-center text-2xl z-40 active:scale-90 transition-transform"
      >
        +
      </button>
      )}

      {/* Модалка задачи */}
      {selectedTask && (
        <TaskModal
          task={selectedTask}
          members={members}
          onClose={handleCloseTask}
          canEdit={canUpdateTask}
          canMove={canMoveTask}
          canArchive={canDeleteTask || canUpdateTask}
        />
      )}

      {/* Модалка создания задачи */}
      {createColumnId !== null && (
        <CreateTaskModal
          columns={columns}
          members={members}
          defaultColumnId={createColumnId}
          onConfirm={handleCreateTask}
          onClose={() => setCreateColumnId(null)}
        />
      )}
    </div>
  );
}

function DeferredTasksView({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (task: Task) => void }) {
  const sorted = [...tasks].sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());

  if (sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--tg-theme-hint-color)]">
        Отложенных задач нет. При создании задачи нажми “Отложить задачу” и выбери дату появления на доске.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Отложенные задачи</p>
        <p className="text-xs text-[var(--tg-theme-hint-color)]">
          Они появятся на основной доске, когда наступит заданная дата.
        </p>
      </div>
      <div className="space-y-2">
        {sorted.map((task) => (
          <button
            key={task.id}
            onClick={() => onTaskClick(task)}
            className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left active:scale-[0.99]"
          >
            <span className="block text-sm font-semibold text-[var(--tg-theme-text-color)]">{task.title}</span>
            {task.description && (
              <span className="mt-1 block line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">{task.description}</span>
            )}
            <span className="mt-2 inline-flex rounded-full bg-[var(--tg-theme-button-color)]/15 px-2 py-1 text-xs font-medium text-[var(--tg-theme-link-color)]">
              Появится: {new Date(task.scheduledAt!).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MembersInlineView({ members }: { members: ProjectMember[] }) {
  if (members.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--tg-theme-hint-color)]">
        В проекте пока нет участников.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Участники</p>
        <p className="text-xs text-[var(--tg-theme-hint-color)]">Люди, которые участвуют в этом проекте.</p>
      </div>
      <div className="space-y-2">
        {members.map((member) => (
          <div key={member.id} className="flex items-center gap-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--tg-theme-button-color)] text-sm font-bold text-[var(--tg-theme-button-text-color)]">
              {(member.user?.firstName?.[0] || member.user?.username?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">
                {member.user?.firstName ?? member.user?.username ?? `ID ${member.userId}`}
              </p>
              <p className="text-xs text-[var(--tg-theme-hint-color)]">{member.role?.name ?? 'member'}</p>
            </div>
            {member.user?.username && (
              <span className="text-xs text-[var(--tg-theme-hint-color)]">@{member.user.username}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const ARCHIVE_CLEANUP_OPTIONS: Array<{ value: ArchiveCleanupMode; label: string }> = [
  { value: 'never', label: 'Не удалять' },
  { value: '2weeks', label: 'Удалять раз в две недели' },
  { value: '1month', label: 'Удалять раз в месяц' },
  { value: '3months', label: 'Удалять раз в три месяца' },
];

function ArchiveInlineView({
  tasks,
  cleanupMode,
  onCleanupModeChange,
  onClear,
}: {
  tasks: Task[];
  cleanupMode: ArchiveCleanupMode;
  onCleanupModeChange: (mode: ArchiveCleanupMode) => void;
  onClear: () => Promise<void>;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Архив</p>
        <p className="text-xs text-[var(--tg-theme-hint-color)]">{tasks.length} завершенных задач</p>
      </div>

      <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <label className="mb-2 block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Автоочистка</label>
        <select
          value={cleanupMode}
          onChange={(event) => onCleanupModeChange(event.target.value as ArchiveCleanupMode)}
          className="w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
        >
          {ARCHIVE_CLEANUP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => setConfirmClear(true)}
        disabled={tasks.length === 0}
        className="mb-3 w-full rounded-[12px] bg-red-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Очистить архив
      </button>

      {tasks.length === 0 ? (
        <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color)]">
          В архиве пока нет завершенных задач.
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <article key={task.id} className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
              <h3 className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{task.title}</h3>
              {task.description && (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">{task.description}</p>
              )}
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

      {confirmClear && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/50" onClick={() => setConfirmClear(false)}>
          <div className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="mb-2 text-lg font-bold text-[var(--tg-theme-text-color)]">Очистить архив?</h3>
            <p className="mb-4 text-sm text-[var(--tg-theme-hint-color)]">Все завершенные задачи будут удалены без восстановления.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  await onClear();
                  setConfirmClear(false);
                }}
                className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white"
              >
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}
