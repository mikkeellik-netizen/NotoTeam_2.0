import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, FileText, FolderPlus, ListPlus, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { projectsApi } from '../api/projects';
import { tasksApi, type UserTaskProgress } from '../api/tasks';
import {
  GreetingHero,
  HomeProjectCard,
  HomeTaskList,
  QuickActions,
  SectionHeader,
  TaskFilters,
  type HomeTaskFilter,
} from '../components/home/HomeDashboard';
import TaskModal from '../components/task/TaskModal';
import UserAvatarImage from '../components/UserAvatarImage';
import { Button, IconButton, Modal, Select, TextField } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';
import { useTaskStore } from '../store/taskStore';
import type { Project, Task } from '../types';

type MyTaskGroups = {
  red: Task[];
  yellow: Task[];
  green: Task[];
  noDate: Task[];
  stats: UserTaskProgress;
};

export default function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { projects, isLoading: projectsLoading, fetchProjects } = useProjectStore();
  const { selectedTask, openTask, closeTask } = useTaskStore();
  const [taskGroups, setTaskGroups] = useState<MyTaskGroups | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskError, setTaskError] = useState('');
  const [taskFilter, setTaskFilter] = useState<HomeTaskFilter>('today');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!user?.id) {
      setTaskGroups(null);
      setTasksLoading(false);
      return;
    }
    setTasksLoading(true);
    setTaskError('');
    try {
      setTaskGroups(await tasksApi.getMyTasks(user.id));
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Не удалось загрузить задачи');
    } finally {
      setTasksLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void fetchProjects(); }, [fetchProjects, user?.id]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const allTasks = useMemo(() => taskGroups
    ? [...taskGroups.red, ...taskGroups.yellow, ...taskGroups.green, ...taskGroups.noDate]
    : [], [taskGroups]);
  const taskBuckets = useMemo(() => groupHomeTasks(allTasks), [allTasks]);
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const visibleProjects = useMemo(() => projects.filter((project) => !normalizedQuery
    || `${project.title} ${project.description ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery)), [normalizedQuery, projects]);
  const visibleTasks = useMemo(() => taskBuckets[taskFilter].filter((task) => !normalizedQuery
    || `${task.title} ${task.project?.title ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery)), [normalizedQuery, taskBuckets, taskFilter]);
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || 'Пользователь';
  const firstName = user?.firstName || user?.username || 'друг';
  const alertCount = taskBuckets.overdue.length;

  const openHomeTask = (task: Task) => {
    void openTask(task.id);
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--nt-color-canvas)] text-white">
      <div className="mx-auto w-full max-w-[68rem] px-4 pb-6 pt-3 sm:px-6 sm:pt-4 lg:px-7">
        <header className="mb-4 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3 text-left" aria-label="Главная NotoTime">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--nt-home-radius-md)] bg-[var(--nt-home-accent)] text-2xl font-black text-[var(--nt-home-accent-ink)] shadow-[var(--nt-shadow-sm)]">N</span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-extrabold text-white">NotoTime</span>
              <span className="block truncate text-xs font-medium text-[var(--nt-home-text-muted)]">Больше, чем задачи</span>
            </span>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <IconButton
              variant="ghost"
              aria-label={searchOpen ? 'Закрыть поиск' : 'Открыть поиск'}
              title={searchOpen ? 'Закрыть поиск' : 'Поиск'}
              className="rounded-full border border-white/8 bg-white/8 text-white hover:bg-white/14"
              onClick={() => { setSearchOpen((current) => !current); if (searchOpen) setQuery(''); }}
            >
              {searchOpen ? <X size={20} /> : <Search size={20} />}
            </IconButton>
            <IconButton
              variant="ghost"
              aria-label="Открыть экран сегодня"
              title="Сегодня"
              className="relative rounded-full border border-white/8 bg-white/8 text-white hover:bg-white/14"
              onClick={() => navigate('/today')}
            >
              <Bell size={20} />
              {alertCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--nt-home-danger)] px-1 text-[10px] font-bold text-white">{Math.min(alertCount, 99)}</span>}
            </IconButton>
            <button type="button" onClick={() => navigate('/settings')} className="rounded-full focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)]" aria-label="Открыть профиль">
              {user && <UserAvatarImage user={user} label={displayName} size="sm" className="border-2 border-white/15" />}
            </button>
          </div>
        </header>

        {searchOpen && (
          <TextField
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти проект или задачу"
            aria-label="Поиск по главному экрану"
            startAdornment={<Search size={16} />}
            containerClassName="mb-4"
            className="border-white/10 bg-[var(--nt-home-surface)] text-white placeholder:text-[var(--nt-home-text-muted)]"
          />
        )}

        <div className="space-y-4 sm:space-y-5">
          <GreetingHero firstName={firstName} />

          <QuickActions actions={[
            { id: 'task', label: 'Новая задача', icon: <ListPlus size={25} />, tone: 'primary', onClick: () => setQuickTaskOpen(true) },
            { id: 'project', label: 'Новый проект', icon: <FolderPlus size={25} />, tone: 'blue', onClick: () => navigate('/projects?create=1') },
            { id: 'note', label: 'Быстрая заметка', icon: <FileText size={25} />, tone: 'amber', onClick: () => navigate(projects[0] ? `/project/${projects[0].id}/workspace` : '/projects?create=1') },
            { id: 'event', label: 'Событие', icon: <CalendarDays size={25} />, tone: 'green', onClick: () => navigate('/my-calendar?create=1') },
          ]} />

          <section className="space-y-2.5">
            <SectionHeader title="Мои проекты" actionLabel="Все проекты" onAction={() => navigate('/projects')} />
            {projectsLoading ? (
              <DashboardLoading label="Загружаем проекты" />
            ) : visibleProjects.length > 0 ? (
              <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:-mx-7 lg:px-7">
                {visibleProjects.slice(0, 8).map((project) => <HomeProjectCard key={project.id} project={project} />)}
              </div>
            ) : (
              <DashboardEmpty
                title={normalizedQuery ? 'Проекты не найдены' : 'Проектов пока нет'}
                actionLabel={normalizedQuery ? 'Сбросить поиск' : 'Создать проект'}
                onAction={() => normalizedQuery ? setQuery('') : navigate('/projects?create=1')}
              />
            )}
          </section>

          <section className="space-y-2.5">
            <SectionHeader title="Мои задачи" actionLabel="Все задачи" onAction={() => navigate('/my-tasks')} />
            <TaskFilters
              active={taskFilter}
              counts={{ today: taskBuckets.today.length, week: taskBuckets.week.length, overdue: taskBuckets.overdue.length }}
              onChange={setTaskFilter}
            />
            {tasksLoading ? (
              <DashboardLoading label="Загружаем задачи" />
            ) : taskError ? (
              <DashboardEmpty title={taskError} actionLabel="Повторить" onAction={() => void loadTasks()} />
            ) : (
              <HomeTaskList tasks={visibleTasks} onOpen={openHomeTask} />
            )}
          </section>
        </div>
      </div>

      <QuickTaskModal
        open={quickTaskOpen}
        projects={projects}
        currentUserId={user?.id}
        onClose={() => setQuickTaskOpen(false)}
        onCreated={async (task) => {
          setQuickTaskOpen(false);
          await loadTasks();
          navigate(`/board/${task.projectId}?taskId=${task.id}`);
        }}
      />

      {selectedTask && <TaskModal task={selectedTask} members={[]} onClose={closeTask} />}
    </div>
  );
}

function QuickTaskModal({ open, projects, currentUserId, onClose, onCreated }: {
  open: boolean;
  projects: Project[];
  currentUserId?: number;
  onClose: () => void;
  onCreated: (task: Task) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProjectId((current) => current || String(projects[0]?.id ?? ''));
    setError('');
  }, [open, projects]);

  const submit = async () => {
    const numericProjectId = Number(projectId);
    if (!numericProjectId || !title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const columns = await projectsApi.getAllColumns(numericProjectId);
      const targetColumn = columns
        .filter((column) => !column.isArchive && !column.isHidden)
        .sort((left, right) => Number(left.position) - Number(right.position))[0];
      if (!targetColumn) throw new Error('В проекте нет доступной канбан-колонки.');
      const task = await tasksApi.create(numericProjectId, {
        columnId: targetColumn.id,
        title: title.trim(),
        priority: 'MEDIUM',
        deadlineAt: deadlineAt ? new Date(deadlineAt).toISOString() : undefined,
        assigneeId: currentUserId,
      });
      setTitle('');
      setDeadlineAt('');
      await onCreated(task);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать задачу');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая задача"
      description="Задача появится в первой активной колонке выбранного проекта."
      size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" form="home-quick-task" loading={busy} disabled={!projectId || !title.trim()}>Создать</Button></>}
    >
      <form id="home-quick-task" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Select label="Проект" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
          <option value="">Выберите проект</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </Select>
        <TextField autoFocus label="Название" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
        <TextField label="Дедлайн" type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} />
        {error && <p className="text-sm text-[var(--nt-color-danger)]" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function DashboardLoading({ label }: { label: string }) {
  return <div className="flex min-h-24 items-center justify-center rounded-[var(--nt-home-radius-lg)] border border-white/8 bg-[var(--nt-home-surface)] text-sm text-[var(--nt-home-text-muted)]">{label}...</div>;
}

function DashboardEmpty({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="rounded-[var(--nt-home-radius-lg)] border border-white/8 bg-[var(--nt-home-surface)] px-5 py-6 text-center">
      <p className="text-sm text-[var(--nt-home-text-muted)]">{title}</p>
      <Button variant="secondary" className="mt-4" onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}

function groupHomeTasks(tasks: Task[]): Record<HomeTaskFilter, Task[]> {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday.getTime() + 24 * 3600000);
  const endWeek = new Date(startToday.getTime() + 7 * 24 * 3600000);
  const byDeadline = (left: Task, right: Task) => new Date(left.deadlineAt ?? 0).getTime() - new Date(right.deadlineAt ?? 0).getTime();
  return {
    today: tasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt) >= startToday && new Date(task.deadlineAt) < endToday).sort(byDeadline),
    week: tasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt) >= startToday && new Date(task.deadlineAt) < endWeek).sort(byDeadline),
    overdue: tasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt) < now).sort(byDeadline),
  };
}
