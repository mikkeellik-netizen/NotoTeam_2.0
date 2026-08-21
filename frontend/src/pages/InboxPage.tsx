import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { usePageStore } from '../store/pageStore';
import { useProjectStore } from '../store/projectStore';
import type { PageNode } from '../types';
import { markInboxRead } from '../services/inboxService';

type InboxMode = 'note' | 'task' | 'idea';
type InboxTab = 'mine' | 'general';

const MODE_META: Record<InboxMode, { label: string; title: string; icon: string; blockType: 'paragraph' | 'todo' }> = {
  note: { label: 'Заметка', title: 'Заметка', icon: '📥', blockType: 'paragraph' },
  task: { label: 'Задача', title: 'Задача', icon: '📌', blockType: 'todo' },
  idea: { label: 'Идея', title: 'Идея', icon: '💡', blockType: 'paragraph' },
};

export default function InboxPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const currentUser = useAuthStore((state) => state.user);
  const { currentProject, fetchProject } = useProjectStore();
  const { nodes, loadProjectSpace, ensureFolderChildrenLoaded, createNode, ensureInbox } = usePageStore();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<InboxMode>('note');
  const [activeTab, setActiveTab] = useState<InboxTab>('mine');

  useEffect(() => {
    if (!pid) return;
    markInboxRead(pid);
    fetchProject(pid);
  }, [fetchProject, pid]);

  useEffect(() => {
    if (!projectId || !currentProject) return;
    loadProjectSpace(projectId, currentProject.title);
  }, [currentProject, loadProjectSpace, projectId]);

  const inbox = useMemo(
    () => nodes.find((node) => node.projectId === projectId && node.title === 'Inbox' && !node.isDeleted),
    [nodes, projectId],
  );

  useEffect(() => {
    if (!projectId || !inbox) return;
    void ensureFolderChildrenLoaded(projectId, inbox.id);
  }, [ensureFolderChildrenLoaded, inbox, projectId]);

  const allInboxItems = useMemo(() => {
    if (!projectId || !inbox) return [];
    return nodes
      .filter((node) => node.projectId === projectId && node.parentId === inbox.id && !node.isDeleted)
      .sort((a, b) => getNodeTime(b) - getNodeTime(a));
  }, [inbox, nodes, projectId]);

  const inboxItems = useMemo(() => {
    const currentAuthor = currentUser?.id ? String(currentUser.id) : '';
    return allInboxItems.filter((item) => {
      const author = item.properties?.author ? String(item.properties.author) : '';
      if (activeTab === 'mine') return !author || author === currentAuthor;
      return Boolean(author && author !== currentAuthor);
    });
  }, [activeTab, allInboxItems, currentUser?.id]);

  const saveQuickItem = () => {
    if (!projectId) return;
    const clean = text.trim();
    if (!clean) return;

    const targetInbox = inbox ?? ensureInbox(projectId);
    const meta = MODE_META[mode];
    createNode({
      projectId,
      parentId: targetInbox.id,
      type: 'page',
      title: `${meta.title}: ${clean.slice(0, 42)}`,
      icon: meta.icon,
      properties: currentUser?.id ? { author: String(currentUser.id) } : undefined,
      initialBlocks: [
        {
          type: meta.blockType,
          content: meta.blockType === 'todo'
            ? { text: clean, checked: false, source: 'inbox' }
            : { text: clean, source: 'inbox' },
          order: 0,
        },
      ],
    });
    setText('');
  };

  const openPage = (pageId: string) => navigate(`/project/${pid}/workspace/page/${pageId}`);

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <header className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[var(--tg-theme-link-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
          aria-label="Назад"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">Входящие</h1>
          <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{currentProject?.title ?? 'Проект'}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-2">
        {([
          { value: 'mine', label: 'Мои' },
          { value: 'general', label: 'Общие' },
        ] as const).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-[10px] py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.value
                ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                : 'text-[var(--tg-theme-hint-color)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-4 rounded-[16px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[var(--tg-theme-bg-color)] text-2xl">
              📥
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold">Быстро добавить</h2>
              <p className="text-xs text-[var(--tg-theme-hint-color)]">Заметка, задача или идея попадет в неразобранное.</p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2">
            {(Object.keys(MODE_META) as InboxMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`rounded-[12px] px-2 py-2 text-sm font-semibold transition-colors ${
                  mode === item
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                }`}
              >
                <span className="mr-1">{MODE_META[item].icon}</span>
                {MODE_META[item].label}
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="Напишите мысль, задачу или идею..."
            className="w-full resize-none rounded-[14px] bg-[var(--tg-theme-bg-color)] p-3 text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
          />

          <button
            type="button"
            onClick={saveQuickItem}
            disabled={!text.trim()}
            className="mt-3 w-full rounded-[14px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
          >
            Создать новую
          </button>
        </section>

        <InboxSection title="📥 Неразобранное" count={inboxItems.length}>
          {inboxItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openPage(item.id)}
              className="block w-full rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left active:scale-[0.99]"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-xl">{item.icon || '📥'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                    Создано: {formatCreatedAt(item.createdAt)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </InboxSection>
      </main>
    </div>
  );
}

function InboxSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)]">
          {count}
        </span>
      </div>
      <div className="space-y-2">
        {count > 0 ? children : (
          <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-5 text-center text-sm text-[var(--tg-theme-hint-color)]">
            Пока пусто
          </div>
        )}
      </div>
    </section>
  );
}

function getNodeTime(node: PageNode) {
  return new Date(node.updatedAt ?? node.createdAt).getTime();
}

function formatCreatedAt(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
