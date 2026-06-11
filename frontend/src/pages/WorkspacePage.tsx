import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { activityApi } from '../api/activity';
import { useProjectStore } from '../store/projectStore';
import BoardPage from '../pages/BoardPage';
import Breadcrumbs from '../components/workspace/Breadcrumbs';
import CommandPalette from '../components/workspace/CommandPalette';
import PageEditor from '../components/workspace/PageEditor';
import PageTree from '../components/workspace/PageTree';
import QuickCaptureModal from '../components/workspace/QuickCaptureModal';
import IconPickerModal from '../components/workspace/IconPickerModal';
import { usePageStore } from '../store/pageStore';
import type { PageNode, PageNodeType } from '../types';
import ContextMenu from '../components/common/ContextMenu';
import { copyPlainText } from '../utils/clipboard';
import { getInboxReadAt, getInboxUnreadSummary } from '../services/inboxService';
import { remindersApi } from '../api/reminders';

export default function WorkspacePage() {
  const { projectId, pageId } = useParams<{ projectId: string; pageId?: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const [treeOpen, setTreeOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [inboxVersion, setInboxVersion] = useState(0);
  const [dueReminderCount, setDueReminderCount] = useState(0);

  const { currentProject, fetchProject } = useProjectStore();
  const {
    nodes,
    blocks,
    selectedPageId,
    loadProjectSpace,
    selectPage,
    createNode,
    renameNode,
    updateNodeIcon,
    duplicateNode,
    moveNode,
    undo,
    redo,
    undoStack,
    redoStack,
  } = usePageStore();

  useEffect(() => {
    if (!pid) return;
    fetchProject(pid);
  }, [pid]);

  useEffect(() => {
    if (!projectId) return;
    loadProjectSpace(projectId, currentProject?.title);
  }, [projectId]);

  useEffect(() => {
    if (pageId) selectPage(pageId);
  }, [pageId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (cmdOrCtrl && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (cmdOrCtrl && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const refreshInbox = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: number }>).detail;
      if (!detail?.projectId || detail.projectId === pid) {
        setInboxVersion((version) => version + 1);
      }
    };
    window.addEventListener('workspace-activity-updated', refreshInbox);
    window.addEventListener('workspace-inbox-read', refreshInbox);
    window.addEventListener('storage', refreshInbox);
    return () => {
      window.removeEventListener('workspace-activity-updated', refreshInbox);
      window.removeEventListener('workspace-inbox-read', refreshInbox);
      window.removeEventListener('storage', refreshInbox);
    };
  }, [pid]);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    const loadActivity = () => {
      activityApi
        .load(pid)
        .then(() => {
          if (!cancelled) setInboxVersion((version) => version + 1);
        })
        .catch(() => undefined);
    };
    loadActivity();
    const timer = window.setInterval(loadActivity, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pid]);

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    const loadDueReminders = () => {
      const readAt = getInboxReadAt(Number(projectId));
      remindersApi
        .list(projectId)
        .then((items) => {
          if (!mounted) return;
          setDueReminderCount(
            items.filter(
              (item) =>
                item.status === 'active' &&
                item.targetUserId === '1' &&
                item.nextRunAt &&
                new Date(item.nextRunAt).getTime() <= Date.now() &&
                new Date(item.nextRunAt).getTime() > readAt,
            ).length,
          );
        })
        .catch(() => {
          if (mounted) setDueReminderCount(0);
        });
    };
    loadDueReminders();
    const timer = window.setInterval(loadDueReminders, 60000);
    window.addEventListener('workspace-inbox-read', loadDueReminders);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('workspace-inbox-read', loadDueReminders);
    };
  }, [projectId]);

  const activePage = useMemo(
    () => nodes.find((node) => !node.isDeleted && node.id === (pageId ?? selectedPageId)) ?? null,
    [nodes, pageId, selectedPageId],
  );
  const inboxUnread = useMemo(
    () => {
      const summary = pid ? getInboxUnreadSummary(pid, currentProject) : { hasUnread: false, count: 0 };
      const count = summary.count + dueReminderCount;
      return { count, hasUnread: count > 0 };
    },
    [blocks, currentProject, dueReminderCount, inboxVersion, nodes, pid],
  );

  const openPage = (nextPageId: string, options?: { replace?: boolean }) => {
    const nextPage = nodes.find((node) => !node.isDeleted && node.id === nextPageId);
    selectPage(nextPageId);
    if (nextPage?.type === 'folder' && nextPage.parentId === null) {
      navigate(`/project/${projectId}/workspace`, { replace: options?.replace });
      return;
    }
    navigate(`/project/${projectId}/workspace/page/${nextPageId}`, { replace: options?.replace });
  };

  const handleBack = () => {
    if (!activePage || activePage.parentId === null) {
      navigate('/');
      return;
    }
    openPage(activePage.parentId);
  };

  useEffect(() => {
    const isProjectRoot = activePage?.type === 'folder' && activePage.parentId === null;
    if (pageId && isProjectRoot) {
      openPage(activePage.id, { replace: true });
    }
  }, [activePage?.id, activePage?.parentId, activePage?.type, pageId]);

  return (
    <div className="flex h-full bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      {!focusMode && (
      <div className="hidden sm:block w-[290px] border-r border-[var(--tg-theme-secondary-bg-color)]">
        <PageTree
          projectId={projectId!}
          selectedPageId={activePage?.id ?? null}
          onOpenPage={openPage}
        />
      </div>
      )}

      {treeOpen && !focusMode && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setTreeOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[86vw] max-w-[330px] shadow-2xl">
            <PageTree
              projectId={projectId!}
              selectedPageId={activePage?.id ?? null}
              onOpenPage={openPage}
              onCloseDrawer={() => setTreeOpen(false)}
            />
          </div>
        </div>
      )}

      <section className="flex-1 min-w-0 flex flex-col">
        {!focusMode && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
          <button
            onClick={() => setTreeOpen(true)}
            className="sm:hidden w-8 h-8 flex items-center justify-center text-[var(--tg-theme-link-color)]"
            aria-label="Открыть дерево страниц"
          >
            ☰
          </button>
          <button
            onClick={handleBack}
            className="w-8 h-8 flex items-center justify-center text-lg text-[var(--tg-theme-link-color)]"
            aria-label="Назад"
          >
            ←
          </button>
          <div className="min-w-0">
            <p className="text-xs text-[var(--tg-theme-hint-color)] truncate">
              {currentProject?.title ?? 'Проект'}
            </p>
            <h1 className="text-base font-semibold truncate">
              {activePage ? `${activePage.icon} ${activePage.title}` : 'Рабочее пространство'}
            </h1>
            <Breadcrumbs activePage={activePage} nodes={nodes} onOpenPage={openPage} />
          </div>
          <button
            onClick={() => setCommandOpen(true)}
            className="ml-auto w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Поиск"
          >
            ⌕
          </button>
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] disabled:opacity-35"
            aria-label="Отменить действие"
          >
            ⤶
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] disabled:opacity-35"
            aria-label="Вернуть действие"
          >
            ⤷
          </button>
          <button
            onClick={() => navigate(`/project/${projectId}/calendar`)}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Календарь"
            title="Календарь"
          >
            📅
          </button>
          <button
            onClick={() => navigate(`/project/${projectId}/reminders`)}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Напоминания"
            title="Напоминания"
          >
            ⏰
          </button>
          <button
            onClick={() => navigate(`/project/${projectId}/inbox`)}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Inbox"
            title="Inbox"
          >
            📥
          </button>
          <button
            onClick={() => navigate(`/project/${projectId}/notifications`)}
            className="relative w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Уведомления"
            title="Уведомления"
          >
            🔔
            {inboxUnread.hasUnread && (
              <span className="absolute -right-1 -top-1 flex min-w-[17px] h-[17px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--tg-theme-bg-color)]">
                {inboxUnread.count > 99 ? '99+' : inboxUnread.count}
              </span>
            )}
          </button>
          <button
            onClick={() => setFocusMode(true)}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Focus mode"
          >
            ◱
          </button>
          <button
            onClick={() => navigate(`/project/${projectId}/settings`)}
            className="w-8 h-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Настройки"
          >
            <svg className="mx-auto h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
        )}

        {focusMode && (
          <button
            onClick={() => setFocusMode(false)}
            className="fixed right-4 top-4 z-50 rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] shadow"
          >
            Выйти из фокуса
          </button>
        )}

        <div className="flex-1 min-h-0">
          {!activePage ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--tg-theme-hint-color)]">
              Выбери страницу
            </div>
          ) : activePage.type === 'kanban' ? (
            <BoardPage embedded boardPageId={activePage.id} />
          ) : activePage.type === 'folder' ? (
            <FolderView
              folder={activePage}
              nodes={nodes}
              projectId={projectId!}
              onCreate={(type) => {
                const node = createNode({ projectId: projectId!, parentId: activePage.id, type });
                openPage(node.id);
              }}
              onRename={(title) => renameNode(activePage.id, title)}
              onIconChange={(nodeId, icon) => updateNodeIcon(nodeId, icon)}
              onDuplicate={duplicateNode}
              onMove={moveNode}
              onOpenPage={openPage}
            />
          ) : (
            <PageEditor
              page={activePage}
              projectId={projectId!}
              members={currentProject?.members ?? []}
              onOpenPage={openPage}
            />
          )}
        </div>
      </section>

      {commandOpen && (
        <CommandPalette
          projectId={projectId!}
          nodes={nodes}
          blocks={blocks}
          onOpenPage={openPage}
          onClose={() => setCommandOpen(false)}
          onQuickCapture={() => setQuickCaptureOpen(true)}
        />
      )}

      {quickCaptureOpen && (
        <QuickCaptureModal
          projectId={projectId!}
          onOpenPage={openPage}
          onClose={() => setQuickCaptureOpen(false)}
        />
      )}

    </div>
  );
}

function FolderView({
  folder,
  nodes,
  projectId,
  onCreate,
  onRename,
  onIconChange,
  onDuplicate,
  onMove,
  onOpenPage,
}: {
  folder: PageNode;
  nodes: PageNode[];
  projectId: string;
  onCreate: (type: PageNodeType) => void;
  onRename: (title: string) => void;
  onIconChange: (nodeId: string, icon: string) => void;
  onDuplicate: (nodeId: string) => PageNode | null;
  onMove: (nodeId: string, parentId: string | null, order: number) => void;
  onOpenPage: (pageId: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(folder.title);
  const [contextNode, setContextNode] = useState<{ node: PageNode; x: number; y: number } | null>(null);
  const [nodeToMove, setNodeToMove] = useState<PageNode | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<PageNode | null>(null);
  const [iconTarget, setIconTarget] = useState<PageNode | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const children = useMemo(
    () =>
      nodes
        .filter((node) => !node.isDeleted && node.projectId === projectId && node.parentId === folder.id)
        .sort((a, b) => a.order - b.order),
    [folder.id, nodes, projectId],
  );
  const folders = useMemo(
    () => nodes.filter((node) => !node.isDeleted && node.projectId === projectId && node.type === 'folder').sort((a, b) => a.order - b.order),
    [nodes, projectId],
  );

  useEffect(() => {
    setTitleDraft(folder.title);
  }, [folder.id, folder.title]);

  const commitTitle = () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleDraft(folder.title);
      return;
    }
    onRename(nextTitle);
    if (nextTitle !== folder.title) {
      activityApi.log({
        projectId: Number(projectId),
        type: 'folder_rename',
        title: `Переименовал папку в «${nextTitle}»`,
        entityType: 'folder',
        entityId: folder.id,
        context: folder.title,
      });
    }
  };

  const openNodeMenu = (node: PageNode, x: number, y: number) => {
    setContextNode({ node, x, y });
  };

  const startNodeLongPress = (node: PageNode, x: number, y: number) => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => openNodeMenu(node, x, y), 600);
  };

  const clearNodeLongPress = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-5 select-text">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5">
          <button
            type="button"
            onClick={() => setIconTarget(folder)}
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] text-3xl active:scale-[0.96]"
            aria-label="Сменить иконку"
          >
            {folder.icon}
          </button>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                setTitleDraft(folder.title);
                event.currentTarget.blur();
              }
            }}
            className="w-full bg-transparent text-2xl font-bold text-[var(--tg-theme-text-color)] outline-none"
          />
          <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">
            {children.length > 0 ? `Вложений: ${children.length}` : 'Папка пока пустая'}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => onCreate('page')}
            className="rounded-[12px] bg-[var(--tg-theme-button-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] active:scale-[0.98]"
          >
            + Страница
          </button>
          <button
            onClick={() => onCreate('folder')}
            className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
          >
            + Папка
          </button>
          <button
            onClick={() => onCreate('kanban')}
            className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
          >
            + Kanban
          </button>
        </div>

        {children.length === 0 ? (
          <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">
            Создай страницу, папку или Kanban-доску внутри этой папки.
          </div>
        ) : (
          <div className="space-y-2">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => onOpenPage(child.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openNodeMenu(child, event.clientX, event.clientY);
                }}
                onPointerDown={(event) => startNodeLongPress(child, event.clientX, event.clientY)}
                onPointerUp={clearNodeLongPress}
                onPointerLeave={clearNodeLongPress}
                onPointerCancel={clearNodeLongPress}
                className="flex w-full items-center gap-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left active:scale-[0.99]"
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIconTarget(child);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    setIconTarget(child);
                  }}
                  className="rounded-[8px] px-1 text-xl active:scale-[0.95]"
                  aria-label="Сменить иконку"
                >
                  {child.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">
                    {child.title}
                  </span>
                  <span className="block text-xs text-[var(--tg-theme-hint-color)]">
                    {child.type === 'folder' ? 'Папка' : child.type === 'kanban' ? 'Kanban-доска' : 'Страница'}
                  </span>
                </span>
                <span className="text-[var(--tg-theme-hint-color)]">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {contextNode && (
        <ContextMenu
          title={contextNode.node.title}
          x={contextNode.x}
          y={contextNode.y}
          onClose={() => setContextNode(null)}
          items={[
            { label: 'Сменить иконку', onClick: () => setIconTarget(contextNode.node) },
            { label: 'Открыть', onClick: () => onOpenPage(contextNode.node.id) },
            {
              label: 'Копировать название',
              onClick: () => copyPlainText(`${contextNode.node.icon} ${contextNode.node.title}`),
            },
            {
              label: 'Дублировать',
              onClick: () => {
                const node = onDuplicate(contextNode.node.id);
                if (node && node.type !== 'folder') onOpenPage(node.id);
              },
            },
            { label: 'Переместить...', onClick: () => setNodeToMove(contextNode.node) },
            { label: 'Переместить в корзину', danger: true, onClick: () => setNodeToDelete(contextNode.node) },
          ]}
        />
      )}
      {nodeToDelete && (
        <div className="fixed inset-0 z-[88] flex items-end bg-black/50" onClick={() => setNodeToDelete(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-bold text-[var(--tg-theme-text-color)]">Переместить в корзину?</h3>
            <p className="mb-4 text-sm text-[var(--tg-theme-hint-color)]">
              «{nodeToDelete.title}» будет перенесено в корзину. Его можно будет восстановить или удалить навсегда.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setNodeToDelete(null)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  activityApi.log({
                    projectId: Number(projectId),
                    type: 'page_delete',
                    title: `Перенес в корзину ${nodeToDelete.type === 'folder' ? 'папку' : 'страницу'} «${nodeToDelete.title}»`,
                    entityType: nodeToDelete.type === 'folder' ? 'folder' : 'page',
                    entityId: nodeToDelete.id,
                    context: folder.title,
                  });
                  usePageStore.getState().deleteNode(nodeToDelete.id);
                  setNodeToDelete(null);
                }}
                className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white"
              >
                В корзину
              </button>
            </div>
          </div>
        </div>
      )}
      {nodeToMove && (
        <div className="fixed inset-0 z-[86] flex items-end bg-black/50" onClick={() => setNodeToMove(null)}>
          <div
            className="max-h-[75vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--tg-theme-text-color)]">Переместить</h3>
                <p className="text-xs text-[var(--tg-theme-hint-color)]">{nodeToMove.title}</p>
              </div>
              <button onClick={() => setNodeToMove(null)} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">
                ×
              </button>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const order = nodes.filter((node) => !node.isDeleted && node.projectId === projectId && node.parentId === null).length;
                  onMove(nodeToMove.id, null, order);
                  setNodeToMove(null);
                }}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
              >
                В корень проекта
              </button>
              {folders
                .filter((target) => target.id !== nodeToMove.id && !isFolderDescendant(nodes, target.id, nodeToMove.id))
                .map((target) => (
                  <button
                    key={target.id}
                    onClick={() => {
                      const order = nodes.filter((node) => !node.isDeleted && node.projectId === projectId && node.parentId === target.id).length;
                      onMove(nodeToMove.id, target.id, order);
                      setNodeToMove(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
                  >
                    <span>{target.icon}</span>
                    <span className="truncate">{target.title}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      {iconTarget && (
        <IconPickerModal
          node={iconTarget}
          onSelect={(icon) => onIconChange(iconTarget.id, icon)}
          onClose={() => setIconTarget(null)}
        />
      )}
    </div>
  );
}

function isFolderDescendant(nodes: PageNode[], possibleChildId: string, parentId: string) {
  let current = nodes.find((node) => node.id === possibleChildId);
  while (current) {
    if (current.parentId === parentId) return true;
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) : undefined;
  }
  return false;
}
