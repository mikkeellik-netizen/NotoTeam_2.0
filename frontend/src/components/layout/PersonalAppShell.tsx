import { CalendarDays, FolderKanban, Home, ListChecks, UserRound, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import UserAvatarImage from '../UserAvatarImage';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../ui';

type NavigationItem = {
  to: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  end?: boolean;
};

const NAVIGATION_ITEMS: NavigationItem[] = [
  { to: '/', label: 'Главная', shortLabel: 'Главная', icon: Home, end: true },
  { to: '/projects', label: 'Проекты', shortLabel: 'Проекты', icon: FolderKanban },
  { to: '/my-calendar', label: 'Календарь', shortLabel: 'Календарь', icon: CalendarDays },
  { to: '/my-tasks', label: 'Мои задачи', shortLabel: 'Задачи', icon: ListChecks },
  { to: '/settings', label: 'Профиль', shortLabel: 'Профиль', icon: UserRound },
];

export default function PersonalAppShell() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.telegramId || 'Пользователь';
  const username = user?.username ? `@${user.username}` : user?.telegramId ? `ID ${user.telegramId}` : '';

  return (
    <div className={cn(
      'grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-[var(--nt-color-canvas)] text-[var(--nt-color-text)] md:grid-cols-[var(--nt-shell-sidebar-width)_minmax(0,1fr)] md:grid-rows-1',
      location.pathname === '/' && 'nt-home-theme',
    )}>
      <aside className="relative z-20 hidden min-h-0 flex-col border-r border-[var(--nt-color-border)] bg-[var(--nt-color-surface)] md:flex" aria-label="Основная навигация">
        <div className="flex h-16 items-center gap-3 border-b border-[var(--nt-color-border)] px-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--nt-radius-control)] bg-[var(--nt-color-accent)] text-lg font-bold text-[var(--nt-color-accent-text)]" aria-hidden="true">N</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">NotoTime</p>
            <p className="truncate text-xs text-[var(--nt-color-text-muted)]">Рабочее пространство</p>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" aria-label="Личные разделы">
          {NAVIGATION_ITEMS.map((item) => <DesktopNavigationLink key={item.to} item={item} />)}
        </nav>

        <div className="border-t border-[var(--nt-color-border)] p-3">
          <NavLink to="/settings" className="flex min-w-0 items-center gap-3 rounded-[var(--nt-radius-control)] px-2 py-2 focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)]">
            {user ? <UserAvatarImage user={user} label={displayName} size="sm" /> : <span className="h-8 w-8 rounded-full bg-[var(--nt-color-surface-hover)]" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{displayName}</span>
              {username && <span className="block truncate text-xs text-[var(--nt-color-text-muted)]">{username}</span>}
            </span>
          </NavLink>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden">
        <Outlet />
      </main>

      <nav className="relative z-30 grid h-[var(--nt-shell-nav-height)] grid-cols-5 border-t border-[var(--nt-color-border)] bg-[var(--nt-color-canvas)] pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Основная навигация">
        {NAVIGATION_ITEMS.map((item) => <MobileNavigationLink key={item.to} item={item} />)}
      </nav>
    </div>
  );
}

function DesktopNavigationLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn(
        'flex min-h-[var(--nt-control-md)] items-center gap-3 rounded-[var(--nt-radius-control)] px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)]',
        isActive
          ? 'bg-[var(--nt-color-accent)] text-[var(--nt-color-accent-text)]'
          : 'text-[var(--nt-color-text-muted)] hover:bg-[var(--nt-color-surface-hover)] hover:text-[var(--nt-color-text)]',
      )}
    >
      <Icon size={19} strokeWidth={2} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function MobileNavigationLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn(
        'flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)]',
        isActive ? 'text-[var(--nt-color-accent)]' : 'text-[var(--nt-color-text-muted)]',
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cn('flex h-7 w-10 items-center justify-center rounded-[var(--nt-radius-sm)]', isActive && 'bg-[var(--nt-color-surface)]')}>
            <Icon size={20} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
          </span>
          <span className="max-w-full truncate">{item.shortLabel}</span>
        </>
      )}
    </NavLink>
  );
}
