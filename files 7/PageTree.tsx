import { useMemo, useState } from 'react';
import type { PageNode, PageNodeType } from '../types';
import { usePageStore } from './pageStore';

interface Props {
  projectId: string;
  selectedPageId: string | null;
  onOpenPage: (pageId: string) => void;
  onCloseDrawer?: () => void;
}

export default function PageTree({ projectId, selectedPageId, onOpenPage, onCloseDrawer }: Props) {
  const { nodes, collapsedIds, createNode, renameNode, deleteNode, toggleCollapsed } = usePageStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const roots = useMemo(
    () => nodes.filter((n) => n.parentId === null).sort((a, b) => a.order - b.order),
    [nodes],
  );

  const startRename = (node: PageNode) => {
    setEditingId(node.id);
    setDraftTitle(node.title);
  };

  const finishRename = () => {
    if (editingId && draftTitle.trim()) renameNode(editingId, draftTitle.trim());
    setEditingId(null);
  };

  const addNode = (type: PageNodeType, parentId?: string | null) => {
    createNode({ projectId, parentId: parentId ?? null, type });
  };

  const renderNode = (node: PageNode, depth = 0) => {
    const children = nodes
      .filter((n) => n.parentId === node.id)
      .sort((a, b) => a.order - b.order);
    const isFolder = node.type === 'folder';
    const isCollapsed = collapsedIds.has(node.id);
    const isSelected = selectedPageId === node.id;

    return (
      <div key={node.id}>
        <div
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
            onClick={() => {
              if (isFolder) toggleCollapsed(node.id);
              else {
                onOpenPage(node.id);
                onCloseDrawer?.();
              }
            }}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
          >
            <span className="shrink-0">{node.icon}</span>
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
            onClick={() => startRename(node)}
            className="w-7 h-7 text-xs text-[var(--tg-theme-hint-color)]"
            aria-label="Переименовать"
          >
            ✎
          </button>
          <button
            onClick={() => deleteNode(node.id)}
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
          <button onClick={() => addNode('page')} className="text-sm text-[var(--tg-theme-link-color)]">
            +
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {roots.map((node) => renderNode(node))}
      </div>
    </aside>
  );
}
