import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tasksApi } from '../api/tasks';
import { remindersApi } from '../api/reminders';
import { projectsApi } from '../api/projects';
import { usePageStore } from '../store/pageStore';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { markInboxRead } from '../services/inboxService';
import type { Task, Reminder, ProjectJoinRequest } from '../types';

type FeedItem = {
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
  time?: string;
  onClick?: () => void;
};

function fmt(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function blockText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.title === 'string') return content.title;
  if (Array.isArray(content.rows)) return content.rows.flat().join(' ');
  return '';
}

export default function NotificationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const currentUser = useAuthStore((state) => state.user);
  const { currentProject, fetchProject } = useProjectStore();
  const { nodes, blocks, loadProjectSpace } = usePageStore();
  const [activeTab, setActiveTab] = useState<'mine' | 'general'>('mine');

  const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [joinRequests, setJoinRequests] = useState<ProjectJoinRequest[]>([]);

  useEffect(() => {
    if (!pid) return;
    markInboxRead(pid);
    fetchProject(pid);
  }, [fetchProject, pid]);

  useEffect(() => {
    if (!projectId || !currentProject) return;
    loadProjectSpace(projectId, currentProject.title);
  }, [currentProject, loadProjectSpace, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    tasksApi.getMyTasks()
      .then((result) => {
        if (cancelled) return;
        const all = [...result.red, ...result.yellow, ...result.green, ...result.noDate]
          .filter((task) => String(task.projectId) === String(pid));
        setAssignedTasks(all);
      })
      .catch(() => undefined);

    remindersApi.list(projectId)
      .then((list) => {
        if (cancelled) return;
        const myId = String(currentUser?.id ?? '');
        setReminders(list.filter((r) => String(r.targetUserId) === myId && r.status !== 'done' && r.status !== 'cancelled'));
      })
      .catch(() => undefined);

    projectsApi.getJoinRequests(pid)
      .then((list) => { if (!cancelled) setJoinRequests(list.filter((r) => r.status === 'pending')); })
      .catch(() => { if (!cancelled) setJoinRequests([]); });

    return () => { cancelled = true; };
  }, [projectId, pid, currentUser?.id]);

  const mentions = useMemo<FeedItem[]>(() => {
    if (!projectId || !currentUser?.username) return [];
    const key = `@${currentUser.username.toLowerCase()}`;
    return blocks
      .filter((block) => {
        const node = nodes.find((item) => item.id === block.pageId);
        if (!node || node.projectId !== String(projectId) || node.isDeleted) return false;
        return blockText(block.content).toLowerCase().includes(key);
      })
      .map((block) => {
        const node = nodes.find((item) => item.id === block.pageId);
        return {
          id: `mention-${block.id}`,
          icon: '💬',
          title: `Упоминание на «${node?.title ?? 'странице'}»`,
          subtitle: blockText(block.content).slice(0, 80),
          time: fmt(block.updatedAt),
          onClick: () => node && navigate(`/project/${pid}/workspace/page/${node.id}`),
        };
      });
  }, [blocks, nodes, projectId, currentUser?.username, navigate, pid]);

  const taskItems = useMemo<FeedItem[]>(
    () => assignedTasks.map((task) => {
      const hours = task.deadlineAt ? (new Date(task.deadlineAt).getTime() - Date.now()) / 3600000 : null;
      const icon = hours === null ? '📌' : hours < 0 ? '🔴' : hours < 12 ? '🟠' : hours < 48 ? '🟡' : '🟢';
      return {
        id: `task-${task.id}`,
        icon,
        title: task.title,
        subtitle: task.deadlineAt ? `Дедлайн: ${fmt(task.deadlineAt)}` : 'Назначена вам',
        onClick: () => navigate(`/project/${pid}/workspace?task=${task.id}`),
      };
    }),
    [assignedTasks, navigate, pid],
  );

  const reminderItems = useMemo<FeedItem[]>(
    () => reminders.map((r) => ({
      id: `reminder-${r.id}`,
      icon: '⏰',
      title: r.title,
      subtitle: r.remindAt ? `Когда: ${fmt(r.remindAt)}` : r.description,
      onClick: () => navigate(`/project/${pid}/reminders`),
    })),
    [reminders, navigate, pid],
  );

  const joinItems = useMemo<FeedItem[]>(
    () => joinRequests.map((r) => ({
      id: `join-${r.id}`,
      icon: '👋',
      title: `Заявка: ${r.displayName || r.username || 'пользователь'}`,
      subtitle: r.username ? `@${r.username}` : undefined,
      time: fmt(r.createdAt),
      onClick: () => navigate(`/project/${pid}/settings`),
    })),
    [joinRequests, navigate, pid],
  );

  const mineCount = taskItems.length + mentions.length + reminderItems.length;
  const generalCount = joinItems.length;

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <div className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button onClick={() => navigate(-1)} className="h-9 w-9 text-xl text-[var(--tg-theme-link-color)]" aria-label="Назад">←</button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">Уведомления</h1>
          <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{currentProject?.title ?? 'Проект'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <TabButton active={activeTab === 'mine'} onClick={() => setActiveTab('mine')}>Мои ({mineCount})</TabButton>
        <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')}>Общие ({generalCount})</TabButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'mine' ? (
          <>
            <FeedSection title="📋 Назначенные задачи" items={taskItems} />
            <FeedSection title="💬 Упоминания" items={mentions} />
            <FeedSection title="⏰ Напоминания" items={reminderItems} />
          </>
        ) : (
          <FeedSection title="👋 Заявки на вступление" items={joinItems} />
        )}
      </div>
    </div>
  );
}

function FeedSection({ title, items }: { title: string; items: FeedItem[] }) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)]">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.length > 0 ? items.map((item) => (
          <button
            key={item.id}
            onClick={item.onClick}
            className="block w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left"
          >
            <p className="truncate text-sm font-semibold">{item.icon} {item.title}</p>
            {item.subtitle && <p className="mt-1 truncate text-xs text-[var(--tg-theme-hint-color)]">{item.subtitle}</p>}
            {item.time && <p className="mt-0.5 text-[11px] text-[var(--tg-theme-hint-color)]">{item.time}</p>}
          </button>
        )) : (
          <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-4 text-center text-sm text-[var(--tg-theme-hint-color)]">Пусто</div>
        )}
      </div>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`py-3 text-sm font-semibold ${active ? 'text-[var(--tg-theme-button-color)]' : 'text-[var(--tg-theme-hint-color)]'}`}
    >
      {children}
    </button>
  );
}
