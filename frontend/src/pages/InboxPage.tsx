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

export default function InboxPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const currentUser = useAuthStore((state) => state.user);
  const { currentProject, fetchProject } = useProjectStore();
  const { nodes, blocks, loadProjectSpace, createNode, createBlockWithContent, ensureInbox } = usePageStore();
  const [activeTab, setActiveTab] = useState<'mine' | 'general'>('mine');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'note' | 'task' | 'idea'>('note');

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

  // Загрузка ленты: назначенные задачи, напоминания, заявки
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

    // Заявки видит только владелец/админ — ошибку доступа просто игнорируем
    projectsApi.getJoinRequests(pid)
      .then((list) => { if (!cancelled) setJoinRequests(list.filter((r) => r.status === 'pending')); })
      .catch(() => { if (!cancelled) setJoinRequests([]); });

    return () => { cancelled = true; };
  }, [projectId, pid, currentUser?.id]);

  const inboxItems = useMemo(() => {
    if (!projectId) return [];
    const inbox = nodes.find((node) => node.projectId === projectId && node.title === 'Inbox');
    if (!inbox) return [];
    return nodes
      .filter((node) => node.projectId === projectId && node.parentId === inbox.id)
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
  }, [nodes, projectId]);

  // Упоминания текущего пользователя на страницах проекта
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

  const openPage = (pageId: string) => navigate(`/project/${pid}/workspace/page/${pageId}`);

  const saveQuickItem = async () => {
    if (!projectId) return;
    const clean = text.trim();
    if (!clean) return;
    if (mode === 'task') {
      await tasksApi.create(Number(projectId), { title: clean, priority: 'MEDIUM' });
      setText('');
      return;
    }
    const inbox = ensureInbox(projectId);
    const node = createNode({
      projectId,
      parentId: inbox.id,
      type: 'page',
      title: mode === 'idea' ? `Идея: ${clean.slice(0, 32)}` : `Заметка: ${clean.slice(0, 32)}`,
      icon: mode === 'idea' ? '💡' : '📥',
    });
    createBlockWithContent(node.id, 'paragraph', { text: clean }, 0);
    setText('');
  };

  const mineCount = taskItems.length + mentions.length + reminderItems.length;
  const generalCount = joinItems.length + inboxItems.length;

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <div className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button onClick={() => navigate(-1)} className="h-9 w-9 text-xl text-[var(--tg-theme-link-color)]" aria-label="Назад">←</button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">Входящие</h1>
          <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{currentProject?.title ?? 'Проект'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <TabButton active={activeTab === 'mine'} onClick={() => setActiveTab('mine')}>Мои ({mineCount})</TabButton>
        <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')}>Общие ({generalCount})</TabButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-4 rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <div className="mb-3 grid grid-cols-3 gap-2">
            {(['note', 'task', 'idea'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`rounded-[10px] py-2 text-sm font-medium ${mode === item ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'}`}
              >
                {item === 'note' ? 'Заметка' : item === 'task' ? 'Задача' : 'Идея'}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="Быстро добавить во входящие..."
            className="w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-[var(--tg-theme-text-color)] outline-none"
          />
          <button
            onClick={saveQuickItem}
            disabled={!text.trim()}
            className="mt-3 w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
          >
            Добавить
          </button>
        </section>

        {activeTab === 'mine' ? (
          <>
            <FeedSection title="📋 Назначенные задачи" items={taskItems} />
            <FeedSection title="💬 Упоминания" items={mentions} />
            <FeedSection title="⏰ Напоминания" items={reminderItems} />
          </>
        ) : (
          <>
            <FeedSection title="👋 Заявки на вступление" items={joinItems} />
            <InboxSection title="📥 Неразобранное" count={inboxItems.length}>
              {inboxItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openPage(item.id)}
                  className="block w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left"
                >
                  <p className="truncate text-sm font-semibold">{item.icon} {item.title}</p>
                  <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Создано: {fmt(item.createdAt)}</p>
                </button>
              ))}
            </InboxSection>
          </>
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

function InboxSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)]">{count}</span>
      </div>
      <div className="space-y-2">
        {count > 0 ? children : (
          <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-4 text-center text-sm text-[var(--tg-theme-hint-color)]">Пока пусто</div>
        )}
      </div>
    </section>
  );
}
