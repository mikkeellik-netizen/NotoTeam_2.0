import type { ReactNode } from 'react';
import { Check, ChevronRight, MoreVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import heroImage from '../../assets/home-hero.jpg';
import UserAvatarImage from '../UserAvatarImage';
import { cn } from '../ui';
import type { Project, ProjectMember, Task } from '../../types';

export function GreetingHero({ firstName }: { firstName: string }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  return (
    <section
      className="relative isolate h-40 overflow-hidden rounded-[var(--nt-home-radius-lg)] bg-cover bg-center px-5 py-4 shadow-[var(--nt-home-shadow)] sm:h-52 sm:px-6 sm:py-5"
      style={{ backgroundImage: `url(${heroImage})` }}
      aria-label={`${greeting}, ${firstName}`}
    >
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(4,10,16,0.94)_0%,rgba(4,10,16,0.7)_44%,rgba(4,10,16,0.16)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-[linear-gradient(0deg,rgba(4,10,16,0.9)_0%,transparent_100%)]" />
      <div className="flex h-full max-w-[34rem] flex-col justify-start">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">{greeting},</p>
        <h1 className="mt-1.5 font-[var(--nt-font-display)] text-[clamp(2.25rem,7vw,4rem)] font-semibold leading-none text-white">
          {firstName}!
        </h1>
      </div>
      <p className="absolute bottom-4 right-5 origin-right -rotate-[5deg] text-right font-[var(--nt-font-display)] text-xl italic leading-6 text-[var(--nt-home-accent)] sm:bottom-5 sm:right-6 sm:text-2xl">
        Делать значимое
      </p>
    </section>
  );
}

export type QuickAction = {
  id: string;
  label: string;
  icon: ReactNode;
  tone: 'primary' | 'blue' | 'amber' | 'green';
  onClick: () => void;
};

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const toneClass: Record<QuickAction['tone'], string> = {
    primary: 'bg-[var(--nt-home-accent)] text-[var(--nt-home-accent-ink)] border-[var(--nt-home-accent)]',
    blue: 'bg-[var(--nt-home-blue)] text-white border-[#4a789e]',
    amber: 'bg-[var(--nt-home-amber)] text-white border-[#8a5b2b]',
    green: 'bg-[var(--nt-home-green)] text-white border-[#4c8b63]',
  };

  return (
    <section className="grid grid-cols-4 gap-2 sm:gap-3" aria-label="Быстрые действия">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={action.onClick}
          className={cn(
            'group flex h-[4.75rem] min-h-0 min-w-0 flex-col items-center justify-center gap-1.5 rounded-[var(--nt-home-radius-md)] border p-1.5 text-center shadow-[var(--nt-shadow-sm)] transition-[transform,filter] duration-[var(--nt-motion-fast)] hover:brightness-110 focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] active:scale-[0.98] sm:h-24 sm:gap-2 sm:p-3',
            toneClass[action.tone],
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[var(--nt-home-radius-sm)] bg-white/16 transition-transform group-hover:-translate-y-0.5 sm:h-10 sm:w-10 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-6 sm:[&>svg]:w-6">
            {action.icon}
          </span>
          <span className="w-full text-[10px] font-bold leading-[0.8rem] sm:text-sm sm:leading-5">{action.label}</span>
        </button>
      ))}
    </section>
  );
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-xl font-extrabold text-white sm:text-[1.35rem]">{title}</h2>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--nt-home-link)] hover:text-white focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)]"
      >
        {actionLabel}<ChevronRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

export function HomeProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const members = project.members ?? [];
  const taskCount = project._count?.tasks ?? 0;
  const backgroundPosition = `${35 + (Math.abs(Number(project.id)) % 4) * 15}% center`;

  return (
    <button
      type="button"
      onClick={() => navigate(`/project/${project.id}/workspace`)}
      className="group relative isolate flex min-h-40 w-[8.75rem] shrink-0 snap-start overflow-hidden rounded-[var(--nt-home-radius-md)] border border-white/10 bg-[var(--nt-home-surface)] p-2.5 text-left shadow-[var(--nt-shadow-sm)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-white/25 focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] sm:min-h-44 sm:w-[11.5rem] sm:p-3 lg:w-56"
      aria-label={`Открыть проект «${project.title}»`}
    >
      <span
        className="absolute inset-x-0 top-0 -z-20 h-[46%] bg-cover opacity-90 transition-transform duration-300 group-hover:scale-105"
        style={{ backgroundImage: `url(${heroImage})`, backgroundPosition }}
      />
      <span className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_15%,rgba(11,18,25,0.72)_45%,rgba(18,27,35,1)_68%)]" />
      <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-white sm:right-3 sm:top-3 sm:h-8 sm:w-8" aria-hidden="true">
        <MoreVertical size={17} />
      </span>
      <span className="mt-auto block w-full">
        <span className="block line-clamp-2 text-sm font-bold leading-4 text-white sm:text-base sm:leading-5">{project.title}</span>
        <span className="mt-1 block truncate text-xs text-[var(--nt-home-text-muted)] sm:text-sm">
          {formatTaskCount(taskCount)} · {formatMemberCount(members.length)}
        </span>
        <span className="mt-3 flex -space-x-2" aria-label={`Участников: ${members.length}`}>
          {members.slice(0, 4).map((member) => (
            <UserAvatarImage
              key={member.id}
              user={member.user}
              label={projectMemberLabel(member)}
              size="xs"
              className="border-2 border-[var(--nt-home-surface)] sm:h-9 sm:w-9 sm:text-sm"
            />
          ))}
          {members.length > 4 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--nt-home-surface)] bg-[var(--nt-home-pill)] text-[10px] font-bold text-white sm:h-9 sm:w-9 sm:text-xs">
              +{members.length - 4}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export type HomeTaskFilter = 'today' | 'week' | 'overdue';

export function TaskFilters({ active, counts, onChange }: {
  active: HomeTaskFilter;
  counts: Record<HomeTaskFilter, number>;
  onChange: (filter: HomeTaskFilter) => void;
}) {
  const items: Array<{ id: HomeTaskFilter; label: string; danger?: boolean }> = [
    { id: 'today', label: 'Сегодня' },
    { id: 'week', label: 'На неделю' },
    { id: 'overdue', label: 'Просроченные', danger: true },
  ];

  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Фильтр задач">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] sm:px-4 sm:text-sm',
            active === item.id
              ? 'bg-[var(--nt-home-accent)] text-[var(--nt-home-accent-ink)]'
              : 'bg-[var(--nt-home-pill)] text-[var(--nt-home-text-muted)] hover:text-white',
          )}
          aria-pressed={active === item.id}
        >
          <span className="truncate">{item.label}</span>
          <span className={cn(
            'flex min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold',
            item.danger
              ? 'bg-[var(--nt-home-danger-soft)] text-[var(--nt-home-danger)]'
              : active === item.id
                ? 'bg-black/10'
                : 'bg-black/20 text-white',
          )}>
            {counts[item.id]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function HomeTaskList({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-[var(--nt-home-radius-lg)] border border-white/8 bg-[var(--nt-home-surface)] px-5 py-7 text-center text-sm text-[var(--nt-home-text-muted)]">
        В этом разделе задач нет
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--nt-home-radius-lg)] border border-white/8 bg-[var(--nt-home-surface)]">
      {tasks.slice(0, 5).map((task, index) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onOpen(task)}
          className={cn(
            'grid min-h-[3.75rem] w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]',
            index > 0 && 'border-t border-white/8',
          )}
        >
          <span className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2',
            task.completedAt
              ? 'border-[var(--nt-home-success)] bg-[var(--nt-home-success)] text-[#102018]'
              : 'border-[var(--nt-home-text-muted)] text-transparent',
          )}>
            <Check size={17} strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className={cn('block truncate text-sm font-semibold text-white sm:text-base', task.completedAt && 'text-[var(--nt-home-text-muted)] line-through')}>
              {task.title}
            </span>
            {task.project?.title && <span className="mt-1 block truncate text-xs text-[var(--nt-home-link)]">{task.project.title}</span>}
          </span>
          {task.project?.title && (
            <span className="hidden max-w-36 truncate rounded-full bg-[var(--nt-home-blue-soft)] px-3 py-1 text-xs font-bold text-[#bfe0ff] sm:block">
              {task.project.title}
            </span>
          )}
          <span className={cn('text-xs font-medium text-[var(--nt-home-text-muted)]', isOverdue(task) && 'text-[var(--nt-home-danger)]')}>
            {formatTaskTime(task)}
          </span>
        </button>
      ))}
    </div>
  );
}

function projectMemberLabel(member: ProjectMember) {
  const user = member.user;
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.telegramId || '?';
}

function formatTaskCount(count: number) {
  return `${count} ${pluralize(count, 'задача', 'задачи', 'задач')}`;
}

function formatMemberCount(count: number) {
  return `${count} ${pluralize(count, 'участник', 'участника', 'участников')}`;
}

function pluralize(count: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatTaskTime(task: Task) {
  if (!task.deadlineAt) return 'Без даты';
  const date = new Date(task.deadlineAt);
  if (isSameDay(date, new Date())) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function isOverdue(task: Task) {
  return Boolean(task.deadlineAt && new Date(task.deadlineAt).getTime() < Date.now());
}
