import { useEffect, useMemo, useState } from 'react';
import { searchApi, type WorkspaceSearchResult } from '../../api/search';
import { templatesApi } from '../../api/templates';
import type { PageNode, Template } from '../../types';
import { usePageStore } from '../../store/pageStore';
import { PAGE_TEMPLATES } from './templates';

interface Props {
  projectId: string;
  nodes: PageNode[];
  onOpenPage: (pageId: string) => void;
  onOpenTask?: (pageId: string | undefined, taskId: string | number) => void;
  onClose: () => void;
  onQuickCapture: () => void;
  canCreatePage?: boolean;
  canManageTemplates?: boolean;
}

interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  action: () => void;
}

export default function CommandPalette({
  projectId,
  nodes,
  onOpenPage,
  onOpenTask,
  onClose,
  onQuickCapture,
  canCreatePage = true,
  canManageTemplates = true,
}: Props) {
  const [query, setQuery] = useState('');
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { createNode, createPageFromTemplate, ensureDailyNote, selectedPageId } = usePageStore();
  const normalized = query.toLowerCase().trim();

  const allTemplates = useMemo(() => [...PAGE_TEMPLATES, ...customTemplates], [customTemplates]);
  const activeParentId = useMemo(() => getActiveParentId(nodes, selectedPageId), [nodes, selectedPageId]);

  useEffect(() => {
    let mounted = true;
    templatesApi
      .list(projectId)
      .then((templates) => {
        if (mounted) setCustomTemplates(templates);
      })
      .catch(() => {
        if (mounted) setCustomTemplates([]);
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!normalized) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      searchApi
        .list(projectId, normalized, 16)
        .then((items) => {
          if (!cancelled) setSearchResults(items);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalized, projectId]);

  const results = useMemo<CommandItem[]>(() => {
    if (!normalized) return [];

    const remoteResults = searchResults.map((result) => ({
      id: `search-${result.kind}-${String(result.id)}`,
      title: `${result.icon ? `${result.icon} ` : ''}${result.title}`,
      subtitle: result.subtitle || resultKindLabel(result.kind),
      action: () => openSearchResult(result, onOpenPage, onOpenTask),
    }));

    const templateResults = canCreatePage
      ? allTemplates
      .filter((template) =>
        `${template.title} ${template.icon} ${template.description ?? ''}`.toLowerCase().includes(normalized),
      )
      .slice(0, 8)
      .map((template) => ({
        id: `template-search-${template.id}`,
        title: `${template.icon} Шаблон: ${template.title}`,
        subtitle: template.isCustom ? 'Пользовательский шаблон' : 'Создать страницу из шаблона',
        action: () => {
          const node = createPageFromTemplate(projectId, activeParentId, template);
          onOpenPage(node.id);
        },
      }))
      : [];

    return [...remoteResults, ...templateResults].slice(0, 16);
  }, [
    activeParentId,
    allTemplates,
    createPageFromTemplate,
    normalized,
    onOpenPage,
    onOpenTask,
    projectId,
    searchResults,
    canCreatePage,
  ]);

  const runAction = (action: () => void) => {
    action();
    onClose();
  };

  const createActions: CommandItem[] = canCreatePage ? [
    {
      id: 'new-page',
      title: '📝 Создать страницу',
      subtitle: 'Новая пустая страница',
      action: () => {
        const node = createNode({
          projectId,
          parentId: activeParentId,
          type: 'page',
          title: 'Новая страница',
          icon: '📝',
        });
        onOpenPage(node.id);
      },
    },
    {
      id: 'daily',
      title: '📅 Открыть заметку дня',
      subtitle: 'Daily Notes',
      action: () => {
        const node = ensureDailyNote(projectId);
        onOpenPage(node.id);
      },
    },
    {
      id: 'capture',
      title: '📥 Quick Capture',
      subtitle: 'Быстро сохранить мысль',
      action: onQuickCapture,
    },
    ...allTemplates.map((template) => ({
      id: `template-${template.id}`,
      title: `${template.icon} Шаблон: ${template.title}`,
      subtitle: template.isCustom ? 'Пользовательский шаблон' : 'Создать страницу из шаблона',
      action: () => {
        const node = createPageFromTemplate(projectId, activeParentId, template);
        onOpenPage(node.id);
      },
    })),
  ] : [];
  const actions: CommandItem[] = canManageTemplates ? createActions : createActions.filter((item) => !item.id.startsWith('template-'));

  const visible = normalized ? results : actions;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/45 p-3" onClick={onClose}>
      <div
        className="mt-8 w-full max-w-xl overflow-hidden rounded-[14px] bg-[var(--tg-theme-bg-color)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск или команда..."
          className="w-full border-b border-[var(--tg-theme-secondary-bg-color)] bg-transparent px-4 py-3 text-base text-[var(--tg-theme-text-color)] outline-none"
        />
        <div className="max-h-[62vh] overflow-y-auto p-2">
          {visible.length === 0 ? (
            <div className="px-3 py-4 text-sm text-[var(--tg-theme-hint-color)]">
              {isSearching ? 'Ищем...' : 'Ничего не найдено'}
            </div>
          ) : (
            visible.map((item) => (
              <button
                key={item.id}
                onClick={() => runAction(item.action)}
                className="w-full rounded-[10px] px-3 py-2 text-left active:bg-[var(--tg-theme-secondary-bg-color)]"
              >
                <span className="block text-sm font-medium text-[var(--tg-theme-text-color)]">{item.title}</span>
                <span className="block text-xs text-[var(--tg-theme-hint-color)]">{item.subtitle}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function openSearchResult(
  result: WorkspaceSearchResult,
  onOpenPage: (pageId: string) => void,
  onOpenTask?: (pageId: string | undefined, taskId: string | number) => void,
) {
  const pageId = result.pageId ?? (isPageLike(result.kind) ? String(result.id) : undefined);
  if ((result.kind === 'task' || result.kind === 'subtask') && result.taskId && onOpenTask) {
    onOpenTask(pageId, result.taskId);
    return;
  }
  if (pageId) onOpenPage(pageId);
}

function isPageLike(kind: WorkspaceSearchResult['kind']) {
  return kind === 'page' || kind === 'folder' || kind === 'kanban';
}

function resultKindLabel(kind: WorkspaceSearchResult['kind']) {
  if (kind === 'folder') return 'Папка';
  if (kind === 'kanban') return 'Kanban-доска';
  if (kind === 'block') return 'Блок';
  if (kind === 'task') return 'Задача';
  if (kind === 'subtask') return 'Подзадача';
  if (kind === 'member') return 'Участник';
  return 'Страница';
}

function getActiveParentId(nodes: PageNode[], selectedPageId: string | null) {
  const activeNode = nodes.find((node) => node.id === selectedPageId);
  if (!activeNode) return null;
  return activeNode.type === 'folder' ? activeNode.id : activeNode.parentId ?? null;
}
