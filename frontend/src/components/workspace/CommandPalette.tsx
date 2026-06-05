import { useEffect, useMemo, useState } from 'react';
import { templatesApi } from '../../api/templates';
import type { Block, PageNode, Template } from '../../types';
import { usePageStore } from '../../store/pageStore';
import { PAGE_TEMPLATES } from './templates';

interface Props {
  projectId: string;
  nodes: PageNode[];
  blocks: Block[];
  onOpenPage: (pageId: string) => void;
  onClose: () => void;
  onQuickCapture: () => void;
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
  blocks,
  onOpenPage,
  onClose,
  onQuickCapture,
}: Props) {
  const [query, setQuery] = useState('');
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
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

  const results = useMemo<CommandItem[]>(() => {
    if (!normalized) return [];

    const pageResults = nodes
      .filter((node) => `${node.title} ${node.icon}`.toLowerCase().includes(normalized))
      .map((node) => ({
        id: `page-${node.id}`,
        title: `${node.icon} ${node.title}`,
        subtitle: node.type === 'kanban' ? 'Kanban-доска' : node.type === 'folder' ? 'Папка' : 'Страница',
        action: () => onOpenPage(node.id),
      }));

    const blockResults = blocks
      .filter((block) => JSON.stringify(block.content).toLowerCase().includes(normalized))
      .slice(0, 8)
      .map((block) => {
        const page = nodes.find((node) => node.id === block.pageId);
        return {
          id: `block-${block.id}`,
          title: `Текст: ${extractBlockText(block.content).slice(0, 64) || block.type}`,
          subtitle: page ? `${page.icon} ${page.title}` : 'Блок',
          action: () => page && onOpenPage(page.id),
        };
      });

    const templateResults = allTemplates
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
      }));

    return [...pageResults, ...blockResults, ...templateResults].slice(0, 16);
  }, [activeParentId, allTemplates, blocks, createPageFromTemplate, nodes, normalized, onOpenPage, projectId]);

  const runAction = (action: () => void) => {
    action();
    onClose();
  };

  const actions: CommandItem[] = [
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
  ];

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
            <div className="px-3 py-4 text-sm text-[var(--tg-theme-hint-color)]">Ничего не найдено</div>
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

function getActiveParentId(nodes: PageNode[], selectedPageId: string | null) {
  const activeNode = nodes.find((node) => node.id === selectedPageId);
  if (!activeNode) return null;
  return activeNode.type === 'folder' ? activeNode.id : activeNode.parentId ?? null;
}

function extractBlockText(content: any) {
  if (!content) return '';
  if (typeof content.text === 'string') return content.text;
  if (typeof content.title === 'string') return content.title;
  return '';
}
