import { useEffect, useMemo, useRef, useState } from 'react';
import { activityApi } from '../../api/activity';
import { templatesApi } from '../../api/templates';
import type { PageNode, PageNodeType, Template } from '../../types';
import { usePageStore } from '../../store/pageStore';
import { PAGE_TEMPLATES } from './templates';
import TemplateBuilderModal from './TemplateBuilderModal';
import IconPickerModal from './IconPickerModal';
import ContextMenu from '../common/ContextMenu';
import { copyPlainText } from '../../utils/clipboard';

interface Props {
  projectId: string;
  selectedPageId: string | null;
  onOpenPage: (pageId: string) => void;
  onCloseDrawer?: () => void;
}

export default function PageTree({ projectId, selectedPageId, onOpenPage, onCloseDrawer }: Props) {
  const {
    nodes,
    collapsedIds,
    recentPages,
    createNode,
    createPageFromTemplate,
    renameNode,
    updateNodeIcon,
    duplicateNode,
    deleteNode,
    restoreNode,
    purgeNode,
    toggleCollapsed,
    togglePinned,
    movePinned,
    moveNode,
  } = usePageStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateBuilderOpen, setTemplateBuilderOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<PageNode | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [nodeToPurge, setNodeToPurge] = useState<PageNode | null>(null);
  const [contextNode, setContextNode] = useState<{ node: PageNode; x: number; y: number } | null>(null);
  const [nodeToMove, setNodeToMove] = useState<PageNode | null>(null);
  const [iconTarget, setIconTarget] = useState<PageNode | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const roots = useMemo(
    () => nodes.filter((n) => !n.isDeleted && n.parentId === null).sort((a, b) => a.order - b.order),
    [nodes],
  );
  const pinned = useMemo(
    () => nodes.filter((n) => !n.isDeleted && n.isPinned).sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0)),
    [nodes],
  );
  const recent = useMemo(
    () =>
      recentPages
        .map((id) => nodes.find((node) => !node.isDeleted && node.id === id))
        .filter((node): node is PageNode => Boolean(node))
        .slice(0, 8),
    [nodes, recentPages],
  );
  const trash = useMemo(
    () => nodes.filter((node) => node.isDeleted).sort((a, b) => new Date(b.deletedAt ?? 0).getTime() - new Date(a.deletedAt ?? 0).getTime()),
    [nodes],
  );
  const folders = useMemo(
    () => nodes.filter((node) => !node.isDeleted && node.type === 'folder').sort((a, b) => a.order - b.order),
    [nodes],
  );
  const allTemplates = useMemo(() => [...PAGE_TEMPLATES, ...customTemplates], [customTemplates]);

  useEffect(() => {
    if (!templatesOpen) return;
    templatesApi.list(projectId).then(setCustomTemplates).catch(() => undefined);
  }, [projectId, templatesOpen]);

  const startRename = (node: PageNode) => {
    setEditingId(node.id);
    setDraftTitle(node.title);
  };

  const finishRename = () => {
    if (editingId && draftTitle.trim()) renameNode(editingId, draftTitle.trim());
    setEditingId(null);
  };

  const addNode = (type: PageNodeType, parentId?: string | null) => {
    const node = createNode({ projectId, parentId: parentId ?? null, type });
    if (node.type !== 'folder') {
      onOpenPage(node.id);
      onCloseDrawer?.();
    }
    return node;
  };

  const createFromTemplate = (templateId: string) => {
    const template = allTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const activeNode = nodes.find((node) => node.id === selectedPageId);
    const activeParent = activeNode?.type === 'folder' ? activeNode.id : activeNode?.parentId ?? null;
    const node = createPageFromTemplate(projectId, activeParent, template);
    if (node.type !== 'folder') {
      onOpenPage(node.id);
      onCloseDrawer?.();
    }
    setTemplatesOpen(false);
  };

  const moveTemplate = async (templateId: string, direction: -1 | 1) => {
    const from = customTemplates.findIndex((template) => template.id === templateId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= customTemplates.length) return;
    const next = [...customTemplates];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCustomTemplates(next);
    try {
      const saved = await templatesApi.reorder(projectId, next.map((template) => template.id));
      setCustomTemplates(saved);
    } catch {
      setCustomTemplates(customTemplates);
    }
  };

  const deleteTemplate = async (template: Template) => {
    if (!template.isCustom) return;
    await templatesApi.remove(projectId, template.id);
    setCustomTemplates((items) => items.filter((item) => item.id !== template.id));
    setTemplateToDelete(null);
  };

  const openNode = (node: PageNode) => {
    onOpenPage(node.id);
    onCloseDrawer?.();
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

  const renderQuickNode = (node: PageNode, prefix?: string) => (
    <button
      key={node.id}
      onClick={() => openNode(node)}
      className="w-full flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left active:bg-[var(--tg-theme-secondary-bg-color)]"
    >
      <span className="shrink-0">{prefix ?? node.icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--tg-theme-text-color)]">
        {node.title}
      </span>
    </button>
  );

  const renderNode = (node: PageNode, depth = 0) => {
    const children = nodes
      .filter((n) => !n.isDeleted && n.parentId === node.id)
      .sort((a, b) => a.order - b.order);
    const isFolder = node.type === 'folder';
    const isCollapsed = collapsedIds.has(node.id);
    const isSelected = selectedPageId === node.id;

    return (
      <div key={node.id}>
        <div
          draggable
          onDragStart={() => setDraggedId(node.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!draggedId || draggedId === node.id) return;
            moveNode(draggedId, isFolder ? node.id : node.parentId, isFolder ? children.length : node.order);
            setDraggedId(null);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openNodeMenu(node, event.clientX, event.clientY);
          }}
          onPointerDown={(event) => startNodeLongPress(node, event.clientX, event.clientY)}
          onPointerUp={clearNodeLongPress}
          onPointerLeave={clearNodeLongPress}
          onPointerCancel={clearNodeLongPress}
          className={`flex items-center gap-1 rounded-[8px] px-2 py-1.5 ${
            isSelected ? 'bg-[var(--tg-theme-secondary-bg-color)]' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {isFolder ? (
            <button
              onClick={() => toggleCollapsed(node.id)}
              className="w-5 h-5 text-[var(--tg-theme-hint-color)]"
            >
              {isCollapsed ? '›' : '⌄'}
            </button>
          ) : (
            <span className="w-5" />
          )}

          <button
            onClick={() => openNode(node)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
          >
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                setIconTarget(node);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                setIconTarget(node);
              }}
              className="shrink-0 rounded-[6px] px-1 active:scale-[0.95]"
              aria-label="Сменить иконку"
            >
              {node.icon}
            </span>
            {editingId === node.id ? (
              <input
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--tg-theme-text-color)] outline-none"
              />
            ) : (
              <span className="truncate text-sm text-[var(--tg-theme-text-color)]">
                {node.title}
              </span>
            )}
          </button>

          <button
            onClick={() => togglePinned(node.id)}
            className="w-7 h-7 text-xs text-[var(--tg-theme-hint-color)]"
            aria-label={node.isPinned ? 'Открепить' : 'Закрепить'}
          >
            {node.isPinned ? '★' : '☆'}
          </button>

          <button
            onClick={() => startRename(node)}
            className="w-7 h-7 text-xs text-[var(--tg-theme-hint-color)]"
            aria-label="Переименовать"
          >
            ✎
          </button>
          <button
            onClick={() => setNodeToDelete(node)}
            className="w-7 h-7 text-xs text-[var(--tg-theme-hint-color)]"
            aria-label="Удалить"
          >
            ×
          </button>
        </div>

        {isFolder && !isCollapsed && (
          <div>
            {children.map((child) => renderNode(child, depth + 1))}
            <div className="flex gap-1 mt-1" style={{ paddingLeft: 28 + depth * 14 }}>
              <button onClick={() => addNode('page', node.id)} className="text-xs text-[var(--tg-theme-link-color)]">
                + страница
              </button>
              <button onClick={() => addNode('folder', node.id)} className="text-xs text-[var(--tg-theme-link-color)]">
                + папка
              </button>
              <button onClick={() => addNode('kanban', node.id)} className="text-xs text-[var(--tg-theme-link-color)]">
                + kanban
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="h-full flex flex-col bg-[var(--tg-theme-bg-color)]">
      <div className="px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Страницы</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setTemplatesOpen(true)} className="text-xs text-[var(--tg-theme-link-color)]">
              Шаблоны
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {pinned.length > 0 && (
          <div className="mb-3">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase text-[var(--tg-theme-hint-color)]">
              ⭐ Закрепленное
            </p>
            {pinned.map((node) => (
              <div key={node.id} className="flex items-center">
                <div className="flex-1 min-w-0">{renderQuickNode(node)}</div>
                <button onClick={() => movePinned(node.id, -1)} className="w-6 h-6 text-xs text-[var(--tg-theme-hint-color)]">↑</button>
                <button onClick={() => movePinned(node.id, 1)} className="w-6 h-6 text-xs text-[var(--tg-theme-hint-color)]">↓</button>
              </div>
            ))}
          </div>
        )}

        {roots.map((node) => renderNode(node))}
      </div>

      <div className="shrink-0 border-t border-[var(--tg-theme-secondary-bg-color)] p-2 space-y-2">
        {trash.length > 0 && (
          <button
            onClick={() => setTrashOpen(true)}
            className="w-full rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
          >
            🗑 Корзина · {trash.length}
          </button>
        )}

        {recent.length > 0 && (
          <div>
          <p className="px-2 py-1 text-[11px] font-semibold uppercase text-[var(--tg-theme-hint-color)]">
            🕘 Недавние
          </p>
          <div className="max-h-44 overflow-y-auto">
            {recent.map((node) => renderQuickNode(node))}
          </div>
          </div>
        )}
      </div>

      {trashOpen && (
        <div className="fixed inset-0 z-[75] bg-black/50 flex items-end" onClick={() => setTrashOpen(false)}>
          <div
            className="w-full max-h-[78vh] overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--tg-theme-text-color)]">Корзина</h3>
              <button onClick={() => setTrashOpen(false)} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">
                ×
              </button>
            </div>
            {trash.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">Корзина пуста</p>
            ) : (
              <div className="space-y-2">
                {trash.map((node) => (
                  <div key={node.id} className="flex items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                    <span className="text-xl">{node.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--tg-theme-text-color)]">{node.title}</p>
                      <p className="text-xs text-[var(--tg-theme-hint-color)]">
                        Удалится навсегда через {daysLeft(node.deletedAt)} дн.
                      </p>
                    </div>
                    <button
                      onClick={() => restoreNode(node.id)}
                      className="rounded-[9px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-button-text-color)]"
                    >
                      Восстановить
                    </button>
                    <button
                      onClick={() => setNodeToPurge(node)}
                      className="h-9 w-9 shrink-0 rounded-full bg-red-500/15 text-lg font-bold text-red-500"
                      aria-label="Удалить навсегда"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {templatesOpen && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end" onClick={() => setTemplatesOpen(false)}>
          <div
            className="w-full max-h-[75vh] overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[var(--tg-theme-text-color)] mb-3">
              Создать из шаблона
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTemplateBuilderOpen(true)}
                className="rounded-[12px] border border-dashed border-[var(--tg-theme-button-color)] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left active:scale-[0.98]"
              >
                <span className="block text-2xl mb-2">+</span>
                <span className="block text-sm font-medium text-[var(--tg-theme-button-color)]">
                  Создать шаблон
                </span>
              </button>
              {allTemplates.map((template) => {
                const customIndex = customTemplates.findIndex((item) => item.id === template.id);
                return (
                  <div
                    key={template.id}
                    className="relative rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left active:scale-[0.98]"
                  >
                    <button onClick={() => createFromTemplate(template.id)} className="w-full text-left">
                      <span className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-2xl">{template.icon}</span>
                        {template.isCustom && (
                          <span className="rounded-full bg-[var(--tg-theme-button-color)]/15 px-2 py-1 text-[10px] font-semibold text-[var(--tg-theme-button-color)]">
                            свой
                          </span>
                        )}
                      </span>
                      <span className="block pr-1 text-sm font-medium text-[var(--tg-theme-text-color)]">{template.title}</span>
                      {template.description && (
                        <span className="mt-1 block line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">
                          {template.description}
                        </span>
                      )}
                    </button>
                    {template.isCustom && (
                      <div className="mt-3 flex items-center gap-1 border-t border-[var(--tg-theme-bg-color)] pt-2">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            moveTemplate(template.id, -1);
                          }}
                          disabled={customIndex <= 0}
                          className="h-8 w-8 rounded-full bg-[var(--tg-theme-bg-color)] text-sm text-[var(--tg-theme-text-color)] disabled:opacity-30"
                          aria-label="Поднять шаблон"
                        >
                          ↑
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            moveTemplate(template.id, 1);
                          }}
                          disabled={customIndex < 0 || customIndex >= customTemplates.length - 1}
                          className="h-8 w-8 rounded-full bg-[var(--tg-theme-bg-color)] text-sm text-[var(--tg-theme-text-color)] disabled:opacity-30"
                          aria-label="Опустить шаблон"
                        >
                          ↓
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setTemplateToDelete(template);
                          }}
                          className="ml-auto h-8 w-8 rounded-full bg-red-500/15 text-lg font-bold text-red-500"
                          aria-label="Удалить шаблон"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {templateToDelete && (
        <div className="fixed inset-0 z-[91] flex items-end bg-black/50" onClick={() => setTemplateToDelete(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-bold text-[var(--tg-theme-text-color)]">Удалить шаблон?</h3>
            <p className="mb-4 text-sm text-[var(--tg-theme-hint-color)]">
              «{templateToDelete.title}» будет удалён из ваших шаблонов. Уже созданные по нему страницы не изменятся.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setTemplateToDelete(null)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={() => deleteTemplate(templateToDelete)}
                className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {templateBuilderOpen && (
        <TemplateBuilderModal
          projectId={projectId}
          onClose={() => setTemplateBuilderOpen(false)}
          onCreated={(template) => setCustomTemplates((items) => [...items, template])}
        />
      )}

      {nodeToDelete && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-end" onClick={() => setNodeToDelete(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)] mb-2">
              Перенести в корзину?
            </h3>
            <p className="text-sm text-[var(--tg-theme-hint-color)] mb-4">
              «{nodeToDelete.title}» будет перемещено в корзину. Можно восстановить в течение 30 дней.
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
                    context: 'Дерево страниц',
                  });
                  deleteNode(nodeToDelete.id);
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

      {nodeToPurge && (
        <div className="fixed inset-0 z-[85] bg-black/50 flex items-end" onClick={() => setNodeToPurge(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)] mb-2">
              Удалить навсегда?
            </h3>
            <p className="text-sm text-[var(--tg-theme-hint-color)] mb-4">
              «{nodeToPurge.title}» и все вложения будут удалены без возможности восстановления.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setNodeToPurge(null)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  activityApi.log({
                    projectId: Number(projectId),
                    type: 'page_delete',
                    title: `Удалил навсегда ${nodeToPurge.type === 'folder' ? 'папку' : 'страницу'} «${nodeToPurge.title}»`,
                    entityType: nodeToPurge.type === 'folder' ? 'folder' : 'page',
                    entityId: nodeToPurge.id,
                    context: 'Корзина страниц',
                  });
                  purgeNode(nodeToPurge.id);
                  setNodeToPurge(null);
                }}
                className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {contextNode && (
        <ContextMenu
          title={contextNode.node.title}
          x={contextNode.x}
          y={contextNode.y}
          onClose={() => setContextNode(null)}
          items={[
            { label: 'Открыть', onClick: () => openNode(contextNode.node) },
            { label: 'Переименовать', onClick: () => startRename(contextNode.node) },
            {
              label: contextNode.node.isPinned ? 'Открепить' : 'Закрепить',
              onClick: () => togglePinned(contextNode.node.id),
            },
            {
              label: 'Копировать название',
              onClick: () => copyPlainText(`${contextNode.node.icon} ${contextNode.node.title}`),
            },
            {
              label: 'Дублировать',
              onClick: () => {
                const node = duplicateNode(contextNode.node.id);
                if (node && node.type !== 'folder') openNode(node);
              },
            },
            { label: 'Переместить...', onClick: () => setNodeToMove(contextNode.node) },
            { label: 'Переместить в корзину', danger: true, onClick: () => setNodeToDelete(contextNode.node) },
          ]}
        />
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
                  const order = nodes.filter((node) => !node.isDeleted && node.parentId === null).length;
                  moveNode(nodeToMove.id, null, order);
                  setNodeToMove(null);
                }}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
              >
                В корень проекта
              </button>
              {folders
                .filter((folder) => folder.id !== nodeToMove.id && !isTreeDescendant(nodes, folder.id, nodeToMove.id))
                .map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => {
                      const order = nodes.filter((node) => !node.isDeleted && node.parentId === folder.id).length;
                      moveNode(nodeToMove.id, folder.id, order);
                      setNodeToMove(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
                  >
                    <span>{folder.icon}</span>
                    <span className="truncate">{folder.title}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function isTreeDescendant(nodes: PageNode[], possibleChildId: string, parentId: string) {
  let current = nodes.find((node) => node.id === possibleChildId);
  while (current) {
    if (current.parentId === parentId) return true;
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) : undefined;
  }
  return false;
}

function daysLeft(deletedAt?: string) {
  if (!deletedAt) return 30;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((30 * 24 * 3600000 - elapsed) / (24 * 3600000)));
}
