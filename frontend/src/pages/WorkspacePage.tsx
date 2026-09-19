import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { activityApi } from '../api/activity';
import { useProjectStore } from '../store/projectStore';
import Breadcrumbs from '../components/workspace/Breadcrumbs';
import { usePageStore } from '../store/pageStore';
import type { PageNode, PageNodeType, ProjectFileRecord } from '../types';
import ContextMenu from '../components/common/ContextMenu';
import { getInboxReadAt, loadInboxUnreadSummary } from '../services/inboxService';
import { remindersApi } from '../api/reminders';
import { useAuthStore } from '../store/authStore';
import { getProjectPermissions } from '../utils/projectPermissions';
import { projectFileIcon, projectFileToBlockContent } from '../api/projectFiles';

const BoardPage = lazy(() => import('../pages/BoardPage'));
const CommandPalette = lazy(() => import('../components/workspace/CommandPalette'));
const PageEditor = lazy(() => import('../components/workspace/PageEditor'));
const PageTree = lazy(() => import('../components/workspace/PageTree'));
const QuickCaptureModal = lazy(() => import('../components/workspace/QuickCaptureModal'));
const IconPickerModal = lazy(() => import('../components/workspace/IconPickerModal'));
const FileUploadModal = lazy(() => import('../components/workspace/FileUploadModal'));

export default function WorkspacePage() {
  const { projectId, pageId } = useParams<{ projectId: string; pageId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const pid = Number(projectId);
  const [treeOpen, setTreeOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [workspaceIconTarget, setWorkspaceIconTarget] = useState<PageNode | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [inboxVersion, setInboxVersion] = useState(0);
  const [dueReminderCount, setDueReminderCount] = useState(0);
  const [inboxSummary, setInboxSummary] = useState({ count: 0, hasUnread: false });
  const currentUserId = useAuthStore((state) => state.user?.id);

  const { currentProject, fetchProject } = useProjectStore();
  const {
    nodes,
    isPartialSpace,
    loadedBlockPageIds,
    loadingBlockPageIds,
    selectedPageId,
    loadProjectSpace,
    ensureFolderChildrenLoaded,
    ensureNodeLoaded,
    ensurePageBlocksLoaded,
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
    if (!projectId || !pageId || nodes.some((node) => node.id === pageId)) return;
    void ensureNodeLoaded(projectId, pageId);
  }, [ensureNodeLoaded, nodes, pageId, projectId]);

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
    if (!pid || !currentUserId) {
      setInboxSummary({ count: 0, hasUnread: false });
      return;
    }
    let cancelled = false;
    loadInboxUnreadSummary(pid)
      .then((summary) => {
        if (!cancelled) setInboxSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setInboxSummary({ count: 0, hasUnread: false });
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, inboxVersion, pid]);

  useEffect(() => {
    if (!projectId || !currentUserId) return;
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
                String(item.targetUserId) === String(currentUserId) &&
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
  }, [currentUserId, projectId]);

  // Корневой узел проекта (первая папка/узел в корне) — что показываем на /workspace без pageId.
  const entryNode = useMemo(
    () =>
      nodes
        .filter((node) => !node.isDeleted && node.parentId === null && node.type === 'folder')
        .sort((a, b) => a.order - b.order)[0] ??
      nodes
        .filter((node) => !node.isDeleted && node.parentId === null)
        .sort((a, b) => a.order - b.order)[0] ??
      null,
    [nodes],
  );

  // Активная страница определяется URL-ом (pageId), а НЕ последним выбранным элементом,
  // иначе кнопка «назад» на корневой экран не обновляет вид (см. баг с возвратом).
  const activePage = useMemo(
    () => (pageId ? nodes.find((node) => !node.isDeleted && node.id === pageId) ?? entryNode : entryNode),
    [nodes, pageId, entryNode],
  );

  // Подсветка в боковом дереве следует за URL.
  useEffect(() => {
    if (activePage && activePage.id !== selectedPageId) selectPage(activePage.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id]);

  useEffect(() => {
    if (!projectId || !activePage) return;
    if (activePage.type === 'folder') {
      void ensureFolderChildrenLoaded(projectId, activePage.id);
      return;
    }
    if (activePage.type === 'page') {
      void ensurePageBlocksLoaded(projectId, activePage.id);
    }
  }, [activePage?.id, activePage?.type, ensureFolderChildrenLoaded, ensurePageBlocksLoaded, projectId]);

  const activePageBlocksReady =
    !activePage ||
    activePage.type !== 'page' ||
    !isPartialSpace ||
    loadedBlockPageIds.has(activePage.id);
  const activePageBlocksLoading = Boolean(activePage?.id && loadingBlockPageIds.has(activePage.id));

  const inboxUnread = useMemo(
    () => {
      const count = inboxSummary.count + dueReminderCount;
      return { count, hasUnread: count > 0 };
    },
    [dueReminderCount, inboxSummary.count],
  );
  const permissions = useMemo(
    () => getProjectPermissions(currentProject, currentUserId),
    [currentProject, currentUserId],
  );
  const canCreatePage = Boolean(permissions.createPage);
  const canUpdatePage = Boolean(permissions.updatePage);
  const canDeletePage = Boolean(permissions.deletePage);
  const canManageTemplates = Boolean(permissions.manageTemplates);

  const openPage = (nextPageId: string, options?: { replace?: boolean }) => {
    const nextPage = nodes.find((node) => !node.isDeleted && node.id === nextPageId);
    selectPage(nextPageId);
    if (nextPage?.type === 'folder' && nextPage.parentId === null) {
      navigate(`/project/${projectId}/workspace`, { replace: options?.replace });
      return;
    }
    navigate(`/project/${projectId}/workspace/page/${nextPageId}`, { replace: options?.replace });
  };

  const openTask = (targetPageId: string | undefined, taskId: string | number) => {
    if (!targetPageId) return;
    selectPage(targetPageId);
    navigate(`/project/${projectId}/workspace/page/${targetPageId}?taskId=${encodeURIComponent(String(taskId))}`);
  };

  const handleBack = () => {
    if (!activePage || activePage.parentId === null) {
      navigate('/');
      return;
    }
    openPage(activePage.parentId);
  };

  const navigationState = location.state as {
    adminReturn?: {
      projectId: number | string;
      tab: 'overview' | 'people' | 'responsibility' | 'risks' | 'meeting' | 'reports' | 'bot' | 'ai';
      section?: 'action-plan';
      label: string;
    };
    responsibilityReturn?: {
      projectId: string;
      pageId: string;
      areaId: string;
      areaTitle: string;
    };
  } | null;
  const adminReturn = navigationState?.adminReturn;
  const responsibilityReturn = navigationState?.responsibilityReturn;

  const returnToAdminPanel = () => {
    if (!adminReturn || String(adminReturn.projectId) !== String(projectId)) return;
    navigate(`/project/${projectId}/settings`, { state: { adminReturn } });
  };

  const returnToResponsibilityArea = () => {
    if (!responsibilityReturn || String(responsibilityReturn.projectId) !== String(projectId)) return;
    selectPage(responsibilityReturn.pageId);
    navigate(`/project/${projectId}/workspace/page/${responsibilityReturn.pageId}`, {
      state: {
        responsibilityAreaId: responsibilityReturn.areaId,
        responsibilitySourcePageId: responsibilityReturn.pageId,
      },
    });
  };

  useEffect(() => {
    const isProjectRoot = activePage?.type === 'folder' && activePage.parentId === null;
    if (pageId && activePage?.id === pageId && isProjectRoot) {
      openPage(activePage.id, { replace: true });
    }
  }, [activePage?.id, activePage?.parentId, activePage?.type, pageId]);

  return (
    <div className="flex h-full bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      {!focusMode && (
      <div className="hidden sm:block w-[290px] border-r border-[var(--tg-theme-secondary-bg-color)]">
        <Suspense fallback={<InlinePageFallback label="Загрузка дерева..." />}>
          <PageTree
            projectId={projectId!}
            selectedPageId={activePage?.id ?? null}
            onOpenPage={openPage}
            permissions={permissions}
          />
        </Suspense>
      </div>
      )}

      {treeOpen && !focusMode && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setTreeOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[86vw] max-w-[330px] shadow-2xl">
            <Suspense fallback={<InlinePageFallback label="Загрузка дерева..." />}>
              <PageTree
                projectId={projectId!}
                selectedPageId={activePage?.id ?? null}
                onOpenPage={openPage}
                onCloseDrawer={() => setTreeOpen(false)}
                permissions={permissions}
              />
            </Suspense>
          </div>
        </div>
      )}

      <section className="flex-1 min-w-0 flex flex-col">
        {!focusMode && (
        <div className="flex items-center gap-2 overflow-hidden px-4 py-2 border-b border-[var(--tg-theme-secondary-bg-color)]">
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
          <div className="min-w-0 flex-1 overflow-hidden leading-tight">
            <p className="truncate text-xs leading-4 text-[var(--tg-theme-hint-color)]">
              {currentProject?.title ?? 'Проект'}
            </p>
            <h1 className="flex h-6 min-w-0 items-center gap-1 overflow-hidden text-base font-semibold leading-6">
              {activePage ? (
                <>
                  <button
                    type="button"
                    onClick={() => canUpdatePage && setWorkspaceIconTarget(activePage)}
                    disabled={!canUpdatePage}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-base active:scale-[0.95] disabled:opacity-70"
                    aria-label="Сменить иконку"
                    title="Сменить иконку"
                  >
                    {activePage.icon}
                  </button>
                  <span className="min-w-0 truncate">{activePage.title}</span>
                </>
              ) : (
                <span className="min-w-0 truncate">Рабочее пространство</span>
              )}
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

        <div className="flex min-h-0 flex-1 flex-col">
          {responsibilityReturn && String(responsibilityReturn.projectId) === String(projectId) && (
            <div className="shrink-0 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-2">
              <button
                type="button"
                onClick={returnToResponsibilityArea}
                className="flex max-w-full items-center gap-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-link-color)]"
              >
                <span aria-hidden="true">←</span>
                <span className="truncate">Вернуться к зоне «{responsibilityReturn.areaTitle}»</span>
              </button>
            </div>
          )}
          {adminReturn && String(adminReturn.projectId) === String(projectId) && (
            <div className="shrink-0 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-2">
              <button
                type="button"
                onClick={returnToAdminPanel}
                className="flex max-w-full items-center gap-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-link-color)]"
              >
                <span aria-hidden="true">←</span>
                <span className="truncate">Вернуться: Администратор · {adminReturn.label}</span>
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
          {!activePage ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--tg-theme-hint-color)]">
              Выбери страницу
            </div>
          ) : activePage.type === 'kanban' ? (
            <Suspense fallback={<InlinePageFallback label="Загрузка доски..." />}>
              <BoardPage embedded boardPageId={activePage.id} />
            </Suspense>
          ) : activePage.type === 'folder' ? (
            <FolderView
              folder={activePage}
              nodes={nodes}
              projectId={projectId!}
              onCreate={(type) => {
                if (!canCreatePage) return;
                const node = createNode({ projectId: projectId!, parentId: activePage.id, type });
                openPage(node.id);
              }}
              onRename={(title) => canUpdatePage && renameNode(activePage.id, title)}
              onRenameNode={(nodeId, title) => canUpdatePage && renameNode(nodeId, title)}
              onIconChange={(nodeId, icon) => canUpdatePage && updateNodeIcon(nodeId, icon)}
              onDuplicate={duplicateNode}
              onMove={moveNode}
              onOpenPage={openPage}
              canCreate={canCreatePage}
              canUpdate={canUpdatePage}
              canDelete={canDeletePage}
            />
          ) : !activePageBlocksReady ? (
            <InlinePageFallback label={activePageBlocksLoading ? 'Загрузка блоков...' : 'Подготовка страницы...'} />
          ) : (
            <Suspense fallback={<InlinePageFallback label="Загрузка редактора..." />}>
              <PageEditor
                page={activePage}
                projectId={projectId!}
                members={currentProject?.members ?? []}
                onOpenPage={openPage}
                canEdit={canUpdatePage}
              />
            </Suspense>
          )}
          </div>
        </div>
      </section>

      {workspaceIconTarget && (
        <Suspense fallback={null}>
          <IconPickerModal
            node={workspaceIconTarget}
            onSelect={(icon) => updateNodeIcon(workspaceIconTarget.id, icon)}
            onClose={() => setWorkspaceIconTarget(null)}
          />
        </Suspense>
      )}

      {commandOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            projectId={projectId!}
            nodes={nodes}
            onOpenPage={openPage}
            onOpenTask={openTask}
            onClose={() => setCommandOpen(false)}
            onQuickCapture={() => setQuickCaptureOpen(true)}
            canCreatePage={canCreatePage}
            canManageTemplates={canManageTemplates}
          />
        </Suspense>
      )}

      {quickCaptureOpen && (
        <Suspense fallback={null}>
          <QuickCaptureModal
            projectId={projectId!}
            onOpenPage={openPage}
            onClose={() => setQuickCaptureOpen(false)}
          />
        </Suspense>
      )}

    </div>
  );
}

function InlinePageFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--tg-theme-hint-color)]">
      {label}
    </div>
  );
}

function FolderView({
  folder,
  nodes,
  projectId,
  onCreate,
  onRename,
  onRenameNode,
  onIconChange,
  onDuplicate,
  onMove,
  onOpenPage,
  canCreate,
  canUpdate,
  canDelete,
}: {
  folder: PageNode;
  nodes: PageNode[];
  projectId: string;
  onCreate: (type: PageNodeType) => void;
  onRename: (title: string) => void;
  onRenameNode: (nodeId: string, title: string) => void;
  onIconChange: (nodeId: string, icon: string) => void;
  onDuplicate: (nodeId: string) => PageNode | null;
  onMove: (nodeId: string, parentId: string | null, order: number) => void;
  onOpenPage: (pageId: string) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [titleDraft, setTitleDraft] = useState(folder.title);
  const [contextNode, setContextNode] = useState<{ node: PageNode; x: number; y: number } | null>(null);
  const [nodeToMove, setNodeToMove] = useState<PageNode | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<PageNode | null>(null);
  const [iconTarget, setIconTarget] = useState<PageNode | null>(null);
  const [renameTarget, setRenameTarget] = useState<PageNode | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [fileUploadOpen, setFileUploadOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const {
    loadedTreeParentIds,
    loadingTreeParentIds,
    ensureFolderChildrenLoaded,
    createNode,
  } = usePageStore();
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

  useEffect(() => {
    void ensureFolderChildrenLoaded(projectId, folder.id);
  }, [ensureFolderChildrenLoaded, folder.id, projectId]);

  const isLoadingChildren = loadingTreeParentIds.has(folder.id);
  const hasLoadedChildren = loadedTreeParentIds.has(folder.id);

  const commitTitle = () => {
    if (!canUpdate) {
      setTitleDraft(folder.title);
      return;
    }
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

  const openRenameModal = (node: PageNode) => {
    setRenameTarget(node);
    setRenameDraft(node.title);
  };

  const commitNodeRename = () => {
    if (!renameTarget) return;
    const nextTitle = renameDraft.trim();
    if (nextTitle && nextTitle !== renameTarget.title) {
      onRenameNode(renameTarget.id, nextTitle);
    }
    setRenameTarget(null);
    setRenameDraft('');
  };

  const createPagesForFiles = (files: ProjectFileRecord[]) => {
    let firstPageId = '';
    files.forEach((file) => {
      const node = createNode({
        projectId,
        parentId: folder.id,
        type: 'page',
        title: file.fileName,
        icon: projectFileIcon(file),
        initialBlocks: [{ type: 'file', content: projectFileToBlockContent(file) }],
      });
      firstPageId ||= node.id;
    });
    if (firstPageId) onOpenPage(firstPageId);
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
            onClick={() => canUpdate && setIconTarget(folder)}
            disabled={!canUpdate}
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] text-3xl active:scale-[0.96] disabled:opacity-80"
            aria-label="Сменить иконку"
          >
            {folder.icon}
          </button>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            readOnly={!canUpdate}
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

        {canCreate && (
        <div className="mb-4 grid grid-cols-2 gap-2">
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
          <button
            onClick={() => setFileUploadOpen(true)}
            className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
          >
            ↑ Файл
          </button>
        </div>
        )}

        {isLoadingChildren && !hasLoadedChildren ? (
          <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">
            Загрузка вложений...
          </div>
        ) : children.length === 0 ? (
          <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">
            Создай страницу, папку, Kanban-доску или загрузи файл внутрь этой папки.
          </div>
        ) : (
          <div className="space-y-2">
            {children.map((child) => (
              <div
                key={child.id}
                onContextMenu={(event) => {
                  if (!canUpdate && !canDelete && !canCreate) return;
                  event.preventDefault();
                  openNodeMenu(child, event.clientX, event.clientY);
                }}
                onPointerDown={(event) => {
                  if (canUpdate || canDelete || canCreate) startNodeLongPress(child, event.clientX, event.clientY);
                }}
                onPointerUp={clearNodeLongPress}
                onPointerLeave={clearNodeLongPress}
                onPointerCancel={clearNodeLongPress}
                className="flex w-full items-center gap-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left active:scale-[0.99]"
              >
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canUpdate) setIconTarget(child);
                  }}
                  disabled={!canUpdate}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--tg-theme-bg-color)] text-xl active:scale-[0.95] disabled:opacity-80"
                  aria-label="Сменить иконку"
                  title="Сменить иконку"
                >
                  {child.icon}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPage(child.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">
                    {child.title}
                  </span>
                  <span className="block text-xs text-[var(--tg-theme-hint-color)]">
                    {child.type === 'folder' ? 'Папка' : child.type === 'kanban' ? 'Kanban-доска' : 'Страница'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPage(child.id)}
                  className="h-8 w-8 shrink-0 text-[var(--tg-theme-hint-color)]"
                  aria-label="Открыть"
                >
                  ›
                </button>
              </div>
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
            ...(canUpdate ? [
              { label: 'Сменить иконку', onClick: () => setIconTarget(contextNode.node) },
              { label: 'Редактировать название', onClick: () => openRenameModal(contextNode.node) },
            ] : []),
            {
              label: 'Дублировать',
              disabled: !canCreate,
              onClick: () => {
                if (!canCreate) return;
                const node = onDuplicate(contextNode.node.id);
                if (node && node.type !== 'folder') onOpenPage(node.id);
              },
            },
            { label: 'Переместить...', disabled: !canUpdate, onClick: () => setNodeToMove(contextNode.node) },
            { label: 'Переместить в корзину', danger: true, disabled: !canDelete, onClick: () => setNodeToDelete(contextNode.node) },
          ]}
        />
      )}
      {renameTarget && (
        <div className="fixed inset-0 z-[88] flex items-end bg-black/50" onClick={() => setRenameTarget(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-bold text-[var(--tg-theme-text-color)]">Редактировать название</h3>
            <input
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitNodeRename();
                }
                if (event.key === 'Escape') {
                  setRenameTarget(null);
                  setRenameDraft('');
                }
              }}
              autoFocus
              className="mb-4 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-[var(--tg-theme-text-color)] outline-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setRenameTarget(null);
                  setRenameDraft('');
                }}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={commitNodeRename}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
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
        <Suspense fallback={null}>
          <IconPickerModal
            node={iconTarget}
            onSelect={(icon) => onIconChange(iconTarget.id, icon)}
            onClose={() => setIconTarget(null)}
          />
        </Suspense>
      )}
      {fileUploadOpen && (
        <Suspense fallback={null}>
          <FileUploadModal
            projectId={projectId}
            mode="node"
            onUploaded={createPagesForFiles}
            onClose={() => setFileUploadOpen(false)}
          />
        </Suspense>
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
