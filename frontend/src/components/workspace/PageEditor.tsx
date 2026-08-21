import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { activityApi } from '../../api/activity';
import { linkPreviewApi } from '../../api/linkPreview';
import { tasksApi } from '../../api/tasks';
import type { Block, BlockType, PageNode, ProjectMember, WebEmbedContent, WebEmbedProvider } from '../../types';
import { usePageStore } from '../../store/pageStore';
import SlashMenu from './SlashMenu';
import ContextMenu from '../common/ContextMenu';
import { copyPlainText } from '../../utils/clipboard';
import IconPickerModal from './IconPickerModal';

interface Props {
  page: PageNode;
  projectId: string;
  members: ProjectMember[];
  onOpenPage: (pageId: string) => void;
  canEdit?: boolean;
}

type TableColumnType =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'person'
  | 'status'
  | 'priority'
  | 'checkbox'
  | 'tags'
  | 'select';

type TableColumn = {
  key?: string;
  title: string;
  type: TableColumnType;
  options?: string[];
  optionColors?: Record<string, string>;
  personColors?: Record<string, string>;
  width?: number;
};

type TableTemplate = {
  title: string;
  columns: TableColumn[];
  rows: string[][];
  tableKind?: string;
};

type TableCellCoordinate = {
  rowIndex: number;
  columnIndex: number;
};

type TableFillDrag = TableCellCoordinate & {
  targetRowIndex: number;
};

type TaskPlanningDraft = {
  title: string;
  project: string;
  assigneeId: string;
  deadline: string;
  isImportant: boolean;
  isUrgent: boolean;
  description: string;
  status: string;
  priority: string;
  tags: string;
  subtasks: string;
  reminder: string;
  linkedPage: string;
  recurrence: string;
  adminComment: string;
};

const TABLE_COLUMN_TYPES: Array<{ value: TableColumnType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'money', label: 'Money' },
  { value: 'date', label: 'Date' },
  { value: 'person', label: 'Person' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'tags', label: 'Tags' },
  { value: 'select', label: 'Select' },
];

const STATUS_OPTIONS = ['Не начато', 'В работе', 'На паузе', 'Готово'];
const PRIORITY_OPTIONS = ['Низкий', 'Средний', 'Высокий', 'Критичный'];
const FINANCE_INCOME_TYPES = ['Разовый', 'Регулярный'];
const TASK_PLANNING_STATUSES = ['Новая', 'В работе', 'Готово', 'Архив'];
const TASK_PLANNING_QUADRANTS = [
  {
    id: 'important_urgent',
    title: 'Важно и срочно',
    subtitle: 'Сделать сейчас',
    important: true,
    urgent: true,
    color: '#EF4444',
  },
  {
    id: 'important_not_urgent',
    title: 'Важно, не срочно',
    subtitle: 'Запланировать',
    important: true,
    urgent: false,
    color: '#3B82F6',
  },
  {
    id: 'not_important_urgent',
    title: 'Не важно, срочно',
    subtitle: 'Делегировать',
    important: false,
    urgent: true,
    color: '#F59E0B',
  },
  {
    id: 'not_important_not_urgent',
    title: 'Не важно, не срочно',
    subtitle: 'Отложить или удалить',
    important: false,
    urgent: false,
    color: '#64748B',
  },
] as const;

const SELECT_OPTION_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'];
const BoardPage = lazy(() => import('../../pages/BoardPage'));

export default function PageEditor({ page, projectId, members, onOpenPage, canEdit = true }: Props) {
  const { nodes, createBlock, createBlockWithContent, updateBlock, moveBlock, deleteBlock, renameNode, updateNodeIcon, updatePageProperties, getBlocksByPage } = usePageStore();
  const blocks = getBlocksByPage(page.id);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashBlockId, setSlashBlockId] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(page.title);
  const [contextBlock, setContextBlock] = useState<{ block: Block; x: number; y: number } | null>(null);
  const [readMode, setReadMode] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedBlockId, setLastSelectedBlockId] = useState<string | null>(null);
  const [deleteSelectionConfirmOpen, setDeleteSelectionConfirmOpen] = useState(false);
  const dragSelectionActionRef = useRef<'select' | 'deselect' | null>(null);
  const pageContentRef = useRef<HTMLDivElement>(null);
  const effectiveReadMode = readMode || !canEdit;

  const pageOptions = useMemo(
    () => nodes.filter((n) => n.type !== 'folder' && n.id !== page.id),
    [nodes, page.id],
  );
  const selectedBlocks = useMemo(
    () => blocks.filter((block) => selectedBlockIds.has(block.id)),
    [blocks, selectedBlockIds],
  );
  const selectedText = useMemo(
    () => selectedBlocks.map(blockToPlainText).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    [selectedBlocks],
  );

  const clearBlockSelection = () => {
    setSelectedBlockIds(new Set());
    setLastSelectedBlockId(null);
    setDeleteSelectionConfirmOpen(false);
  };

  const setSelectionEnabled = (enabled: boolean) => {
    if (!canEdit && enabled) return;
    setSelectionMode(enabled);
    setContextBlock(null);
    if (enabled) {
      setReadMode(false);
      setPlusOpen(false);
      return;
    }
    clearBlockSelection();
  };

  const setBlockSelection = (blockId: string, shouldSelect: boolean) => {
    setSelectedBlockIds((current) => {
      const next = new Set(current);
      if (shouldSelect) next.add(blockId);
      else next.delete(blockId);
      return next;
    });
    setLastSelectedBlockId(blockId);
  };

  const startBlockDragSelection = (block: Block, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectionMode || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (event.shiftKey && lastSelectedBlockId) {
      const startIndex = blocks.findIndex((item) => item.id === lastSelectedBlockId);
      const endIndex = blocks.findIndex((item) => item.id === block.id);
      if (startIndex >= 0 && endIndex >= 0) {
        const from = Math.min(startIndex, endIndex);
        const to = Math.max(startIndex, endIndex);
        setSelectedBlockIds((current) => {
          const next = new Set(current);
          blocks.slice(from, to + 1).forEach((item) => next.add(item.id));
          return next;
        });
        setLastSelectedBlockId(block.id);
        dragSelectionActionRef.current = 'select';
        return;
      }
    }
    const shouldSelect = !selectedBlockIds.has(block.id);
    dragSelectionActionRef.current = shouldSelect ? 'select' : 'deselect';
    setBlockSelection(block.id, shouldSelect);
  };

  const continueBlockDragSelection = (block: Block) => {
    if (!selectionMode || !dragSelectionActionRef.current) return;
    setBlockSelection(block.id, dragSelectionActionRef.current === 'select');
  };

  const selectAllBlocks = () => {
    setSelectedBlockIds(new Set(blocks.map((block) => block.id)));
    setLastSelectedBlockId(blocks[blocks.length - 1]?.id ?? null);
  };

  const copySelectedBlocks = () => {
    if (!selectedText) return;
    void copyPlainText(selectedText);
  };

  const deleteSelectedBlocks = () => {
    if (!canEdit) return;
    if (selectedBlocks.length === 0) return;
    const text = selectedText;
    selectedBlocks.forEach((block) => deleteBlock(block.id));
    if (text) {
      activityApi.log({
        projectId: Number(projectId),
        type: 'page_delete',
        title: `Удалил выбранные строки на странице «${page.title}»`,
        details: trimActivityText(text),
        entityType: 'page',
        entityId: page.id,
        context: page.title,
      });
    }
    setSelectionEnabled(false);
    setFocusedBlockId(null);
    setActiveBlockId(null);
  };

  const insertBlock = (type: BlockType) => {
    if (!canEdit) return;
    const block = slashBlockId ? blocks.find((b) => b.id === slashBlockId) : null;
    if (block) {
      updateBlock(block.id, defaultContentFor(type, projectId, page.id), type);
    } else {
      const created = createBlock(page.id, type, Math.max(0, blocks.length - 1));
      setFocusedBlockId(created.id);
    }
    setSlashBlockId(null);
    setSlashQuery('');
    setPlusOpen(false);
  };

  useEffect(() => {
    setTitleDraft(page.title);
  }, [page.id, page.title]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedBlockIds(new Set());
    setLastSelectedBlockId(null);
    setDeleteSelectionConfirmOpen(false);
    setContextBlock(null);
    dragSelectionActionRef.current = null;
  }, [page.id]);

  useEffect(() => {
    if (!selectionMode) return;
    const stopSelection = () => {
      dragSelectionActionRef.current = null;
    };
    window.addEventListener('pointerup', stopSelection);
    window.addEventListener('pointercancel', stopSelection);
    return () => {
      window.removeEventListener('pointerup', stopSelection);
      window.removeEventListener('pointercancel', stopSelection);
    };
  }, [selectionMode]);

  useEffect(() => {
    const handleNativeSelectionDelete = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const ids = getNativeSelectedTextBlockIds(pageContentRef.current, blocks);
      if (ids.length <= 1) return;
      event.preventDefault();
      setSelectedBlockIds(new Set(ids));
      setDeleteSelectionConfirmOpen(true);
    };
    window.addEventListener('keydown', handleNativeSelectionDelete, true);
    return () => window.removeEventListener('keydown', handleNativeSelectionDelete, true);
  }, [blocks]);

  const commitTitle = () => {
    if (!canEdit) {
      setTitleDraft(page.title);
      return;
    }
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleDraft(page.title);
      return;
    }
    renameNode(page.id, nextTitle);
    activityApi.log({
      projectId: Number(projectId),
      type: 'page_rename',
      title: `Переименовал страницу в «${nextTitle}»`,
      entityType: 'page',
      entityId: page.id,
      context: page.title,
    });
  };

  useEffect(() => {
    if (blocks.length === 0) {
      if (!canEdit) return;
      const created = createBlock(page.id, 'paragraph', undefined, { skipHistory: true });
      setFocusedBlockId(created.id);
      return;
    }

    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock.type !== 'paragraph' || !isBlockEmpty(lastBlock)) {
      if (!canEdit) return;
      createBlock(page.id, 'paragraph', lastBlock.order + 1, { skipHistory: true });
    }
  }, [blocks, canEdit, createBlock, page.id]);

  const createTextLineAfter = (block: Block, type: BlockType = 'paragraph') => {
    if (!canEdit) return;
    const created = createBlock(page.id, type, block.order + 1);
    setFocusedBlockId(created.id);
    setActiveBlockId(created.id);
  };

  const deleteTextLine = (block: Block) => {
    if (!canEdit) return;
    const currentIndex = blocks.findIndex((item) => item.id === block.id);
    const previous = blocks[currentIndex - 1] ?? blocks[currentIndex + 1];
    const deletedText = String(block.content?.text ?? '').trim();
    if (blocks.length <= 1) {
      updateBlock(block.id, { text: '' }, 'paragraph');
      if (deletedText) {
        activityApi.log({
          projectId: Number(projectId),
          type: 'page_delete',
          title: `Удалил текст на странице «${page.title}»`,
          details: trimActivityText(deletedText),
          entityType: 'page',
          entityId: page.id,
          context: page.title,
        });
      }
      return;
    }
    deleteBlock(block.id);
    if (deletedText) {
      activityApi.log({
        projectId: Number(projectId),
        type: 'page_delete',
        title: `Удалил строку на странице «${page.title}»`,
        details: trimActivityText(deletedText),
        entityType: 'page',
        entityId: page.id,
        context: page.title,
      });
    }
    setFocusedBlockId(previous?.id ?? null);
    setActiveBlockId(previous?.id ?? null);
  };

  const openBlockMenu = (block: Block, x: number, y: number) => {
    setContextBlock({ block, x, y });
  };

  const emptyPagePlaceholderBlockId = useMemo(() => {
    const textBlocks = blocks.filter(isTextInputBlock);
    if (textBlocks.length === 0) return null;
    return blocks.every((block) => !isTextInputBlock(block) || isBlockEmpty(block)) ? textBlocks[0].id : null;
  }, [blocks]);

  return (
    <main className="relative h-full flex flex-col bg-[var(--tg-theme-bg-color)]">
      <div className="flex-1 overflow-y-auto px-4 py-5 select-text">
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => canEdit && setIconPickerOpen(true)}
            disabled={!canEdit}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-2xl active:scale-95 disabled:opacity-80"
            title="Сменить иконку"
            aria-label="Сменить иконку"
          >
            {page.icon}
          </button>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            readOnly={!canEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                setTitleDraft(page.title);
                event.currentTarget.blur();
              }
            }}
            className="w-full bg-transparent text-2xl font-bold text-[var(--tg-theme-text-color)] outline-none"
          />
          <button
            onClick={() => {
              setReadMode((value) => !value);
              setSelectionMode(false);
              clearBlockSelection();
            }}
            className={`shrink-0 h-9 w-9 rounded-full active:scale-90 transition-transform ${effectiveReadMode ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'}`}
            title={readMode ? 'Режим редактирования' : 'Режим чтения (выделять и копировать текст)'}
            aria-label="Режим чтения"
          >
            {readMode ? '✎' : '📄'}
          </button>
          <button
            type="button"
            onClick={() => setSelectionEnabled(!selectionMode)}
            disabled={!canEdit}
            className={`shrink-0 h-9 rounded-full px-3 text-sm font-semibold active:scale-90 transition-transform ${selectionMode ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'}`}
            title={selectionMode ? 'Завершить выбор строк' : 'Выбрать несколько строк'}
            aria-label={selectionMode ? 'Завершить выбор строк' : 'Выбрать несколько строк'}
          >
            {selectionMode ? 'Готово' : 'Выбрать'}
          </button>
          <button
            onClick={() => copyPlainText(blocks.map(blockToPlainText).join('\n').replace(/\n{3,}/g, '\n\n').trim())}
            className="shrink-0 h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] active:scale-90 transition-transform"
            title="Копировать текст страницы"
            aria-label="Копировать текст страницы"
          >
            ⧉
          </button>
        </div>

        {!canEdit && (
          <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-hint-color)]">
            Режим просмотра: у вашей роли нет прав на редактирование этой страницы.
          </div>
        )}

        {effectiveReadMode ? (
          <div className="whitespace-pre-wrap break-words select-text pb-24 text-[15px] leading-relaxed text-[var(--tg-theme-text-color)]">
            {blocks.map(blockToPlainText).join('\n').replace(/\n{3,}/g, '\n\n').trim() || 'Пустая страница'}
          </div>
        ) : (
        <div ref={pageContentRef} className="space-y-0.5 pb-24">
          {selectionMode && (
            <div className="mb-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-hint-color)]">
              Нажимай на строки или проведи по ним, чтобы выбрать несколько абзацев.
            </div>
          )}
          {blocks.map((block) => (
            <div
              key={block.id}
              data-page-block-id={block.id}
              className={`relative rounded-[10px] transition-colors ${selectionMode ? 'cursor-pointer select-none pl-9 pr-8' : ''} ${selectedBlockIds.has(block.id) ? 'bg-[var(--tg-theme-secondary-bg-color)] ring-1 ring-[var(--tg-theme-button-color)]' : ''}`}
              onPointerDown={(event) => startBlockDragSelection(block, event)}
              onPointerEnter={() => continueBlockDragSelection(block)}
              onClick={(event) => {
                if (selectionMode || isInteractiveSelectionTarget(event.target)) return;
              }}
              onContextMenu={(event) => {
                // Не показываем системное контекстное меню и НЕ открываем меню блока
                // по нажатию/долгому тапу — меню вызывается только кнопкой ⋮.
                if (selectionMode) event.preventDefault();
              }}
            >
            {selectionMode && (
              <span
                className={`absolute left-1 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-[8px] border text-sm font-bold ${selectedBlockIds.has(block.id) ? 'border-[var(--tg-theme-button-color)] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'border-[var(--tg-theme-hint-color)] text-[var(--tg-theme-hint-color)]'}`}
                aria-label={selectedBlockIds.has(block.id) ? 'Убрать строку из выбора' : 'Выбрать строку'}
                title={selectedBlockIds.has(block.id) ? 'Убрать строку из выбора' : 'Выбрать строку'}
              >
                {selectedBlockIds.has(block.id) ? '✓' : ''}
              </span>
            )}
            {block.type !== 'simple_table' && !selectionMode && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openBlockMenu(block, event.clientX, event.clientY);
                }}
                className="absolute right-0 top-1 z-10 flex h-6 w-6 items-center justify-center rounded text-[var(--tg-theme-hint-color)] opacity-40 active:opacity-100"
                aria-label="Меню блока"
                title="Меню блока"
              >
                ⋮
              </button>
            )}
            <div className={selectionMode ? 'pointer-events-none' : ''}>
              <BlockEditor
                block={block}
                projectId={projectId}
                blocks={blocks}
                nodes={nodes}
                members={members}
                page={page}
                pageOptions={pageOptions}
                onOpenPage={onOpenPage}
                onPagePropertiesChange={(properties) => updatePageProperties(page.id, properties)}
                onUpdate={(content) => updateBlock(block.id, content)}
                onEditBlock={() => {
                  setFocusedBlockId(block.id);
                  setActiveBlockId(block.id);
                }}
                onCopyBlock={() => copyPlainText(blockToPlainText(block))}
                onDuplicateBlock={() => createBlockWithContent(page.id, block.type, cloneContent(block.content), block.order + 1)}
                onMoveBlockUp={() => moveBlock(block.id, -1)}
                onMoveBlockDown={() => moveBlock(block.id, 1)}
                onDeleteBlock={() => deleteTextLine(block)}
                canMoveBlockUp={blocks[0]?.id !== block.id}
                canMoveBlockDown={blocks[blocks.length - 1]?.id !== block.id}
                canDeleteBlock={blocks.length > 1}
                onEnter={() => createTextLineAfter(block, nextBlockTypeAfterEnter(block.type))}
                onDelete={() => deleteTextLine(block)}
                onSlash={(query) => {
                  setSlashBlockId(block.id);
                  setSlashQuery(query);
                }}
                onCommit={(value) => {
                  if (!value.trim()) return;
                  activityApi.log({
                    projectId: Number(projectId),
                    type: 'page_edit',
                    title: `Изменил текст на странице «${page.title}»`,
                    details: trimActivityText(value),
                    entityType: 'page',
                    entityId: page.id,
                    context: page.title,
                  });
                }}
                shouldFocus={focusedBlockId === block.id}
                onFocused={() => setFocusedBlockId(null)}
                showPlaceholder={(activeBlockId ? activeBlockId === block.id : emptyPagePlaceholderBlockId === block.id)}
                onFocus={() => setActiveBlockId(block.id)}
              />
            </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {!effectiveReadMode && !selectionMode && canEdit && (
      <button
        onClick={() => setPlusOpen(true)}
        className="fixed bottom-6 right-4 z-40 w-14 h-14 rounded-full bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] shadow-lg flex items-center justify-center text-2xl active:scale-90 transition-transform"
      >
        +
      </button>
      )}

      {selectionMode && (
        <div className="fixed bottom-4 left-4 right-4 z-50 rounded-[16px] border border-[var(--tg-theme-section-separator-color)] bg-[var(--tg-theme-secondary-bg-color)] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Выбрано строк: {selectedBlocks.length}</p>
            <button
              type="button"
              onClick={() => setSelectionEnabled(false)}
              className="rounded-full px-3 py-1.5 text-sm text-[var(--tg-theme-hint-color)] active:bg-[var(--tg-theme-bg-color)]"
            >
              Готово
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={selectAllBlocks}
              className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-text-color)] active:scale-95"
            >
              Все
            </button>
            <button
              type="button"
              disabled={selectedBlocks.length === 0}
              onClick={copySelectedBlocks}
              className="rounded-[12px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-45 active:scale-95"
            >
              Копировать
            </button>
            <button
              type="button"
              disabled={selectedBlocks.length === 0}
              onClick={() => setDeleteSelectionConfirmOpen(true)}
              className="rounded-[12px] bg-red-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-45 active:scale-95"
            >
              Удалить
            </button>
          </div>
        </div>
      )}

      {deleteSelectionConfirmOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end bg-black/55 px-3 pb-3"
          onClick={() => setDeleteSelectionConfirmOpen(false)}
        >
          <section
            className="w-full rounded-[18px] bg-[var(--tg-theme-secondary-bg-color)] p-4 text-[var(--tg-theme-text-color)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-bold">Удалить выбранные строки?</h3>
            <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">
              Будет удалено: {selectedBlocks.length}. Это действие попадет в историю изменений.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteSelectionConfirmOpen(false)}
                className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-4 py-3 font-semibold"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={deleteSelectedBlocks}
                className="rounded-[12px] bg-red-500 px-4 py-3 font-semibold text-white"
              >
                Удалить
              </button>
            </div>
          </section>
        </div>
      )}

      {canEdit && (slashBlockId || plusOpen) && (
        <SlashMenu
          query={slashQuery}
          onSelect={insertBlock}
          onClose={() => {
            setSlashBlockId(null);
            setSlashQuery('');
            setPlusOpen(false);
          }}
        />
      )}
      {canEdit && contextBlock && (
        <ContextMenu
          title="Блок"
          displayTitle={blockContextMenuTitle(contextBlock.block)}
          x={contextBlock.x}
          y={contextBlock.y}
          onClose={() => setContextBlock(null)}
          items={[
            {
              label: 'Редактировать',
              onClick: () => {
                setFocusedBlockId(contextBlock.block.id);
                setActiveBlockId(contextBlock.block.id);
              },
            },
            { label: 'Копировать', onClick: () => copyPlainText(blockToPlainText(contextBlock.block)) },
            {
              label: 'Дублировать',
              onClick: () => createBlockWithContent(page.id, contextBlock.block.type, cloneContent(contextBlock.block.content), contextBlock.block.order + 1),
            },
            {
              label: 'Выше',
              disabled: blocks[0]?.id === contextBlock.block.id,
              onClick: () => moveBlock(contextBlock.block.id, -1),
            },
            {
              label: 'Ниже',
              disabled: blocks[blocks.length - 1]?.id === contextBlock.block.id,
              onClick: () => moveBlock(contextBlock.block.id, 1),
            },
            {
              label: 'Удалить',
              danger: true,
              disabled: blocks.length <= 1,
              onClick: () => deleteTextLine(contextBlock.block),
            },
          ]}
        />
      )}
      {canEdit && iconPickerOpen && (
        <IconPickerModal
          node={page}
          onSelect={(icon) => updateNodeIcon(page.id, icon)}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </main>
  );
}

function BlockEditor({
  block,
  projectId,
  blocks,
  nodes,
  members,
  page,
  pageOptions,
  onOpenPage,
  onPagePropertiesChange,
  onUpdate,
  onEditBlock,
  onCopyBlock,
  onDuplicateBlock,
  onMoveBlockUp,
  onMoveBlockDown,
  onDeleteBlock,
  canMoveBlockUp,
  canMoveBlockDown,
  canDeleteBlock,
  onEnter,
  onDelete,
  onSlash,
  onCommit,
  shouldFocus,
  onFocused,
  showPlaceholder,
  onFocus,
}: {
  block: Block;
  projectId: string;
  blocks: Block[];
  nodes: PageNode[];
  members: ProjectMember[];
  page: PageNode;
  pageOptions: PageNode[];
  onOpenPage: (pageId: string) => void;
  onPagePropertiesChange: (properties: NonNullable<PageNode['properties']>) => void;
  onUpdate: (content: any) => void;
  onEditBlock: () => void;
  onCopyBlock: () => void;
  onDuplicateBlock: () => void;
  onMoveBlockUp: () => void;
  onMoveBlockDown: () => void;
  onDeleteBlock: () => void;
  canMoveBlockUp: boolean;
  canMoveBlockDown: boolean;
  canDeleteBlock: boolean;
  onEnter: () => void;
  onDelete: () => void;
  onSlash: (query: string) => void;
  onCommit: (value: string) => void;
  shouldFocus: boolean;
  onFocused: () => void;
  showPlaceholder: boolean;
  onFocus: () => void;
}) {
  const text = block.content?.text ?? '';
  const [linkPreviewId, setLinkPreviewId] = useState<string | null>(null);
  const [taskCreated, setTaskCreated] = useState(false);
  const taskSuggestion = detectTaskSuggestion(text);

  if (block.type === 'todo') {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onUpdate({ ...block.content, checked: !block.content?.checked })}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
            block.content?.checked ? 'bg-green-500 border-green-500 text-white' : 'border-[var(--tg-theme-hint-color)]'
          }`}
        >
          {block.content?.checked ? '✓' : ''}
        </button>
        <TextInput
          value={text}
          placeholder={showPlaceholder ? 'To-do' : ''}
          className={block.content?.checked ? 'line-through text-[var(--tg-theme-hint-color)]' : ''}
          onChange={(value) => onUpdate({ ...block.content, text: value })}
          onEnter={onEnter}
          onDelete={onDelete}
          onSlash={onSlash}
          onCommit={onCommit}
          members={members}
          shouldFocus={shouldFocus}
          onFocused={onFocused}
          onFocus={onFocus}
        />
      </div>
    );
  }

  if (block.type === 'link_to_page') {
    const target = pageOptions.find((p) => p.id === block.content?.targetPageId);
    const previewBlocks = target ? blocks.filter((item) => item.pageId === target.id).slice(0, 3) : [];
    return (
      <div className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <select
          value={block.content?.targetPageId ?? ''}
          onChange={(e) => {
            const next = pageOptions.find((p) => p.id === e.target.value);
            onUpdate({
              targetPageId: e.target.value,
              displayText: next?.title ?? '',
            });
          }}
          className="w-full bg-transparent text-sm text-[var(--tg-theme-text-color)] outline-none"
        >
          <option value="">Выбрать страницу</option>
          {pageOptions.map((page) => (
            <option key={page.id} value={page.id}>
              {page.icon} {page.title}
            </option>
          ))}
        </select>
        {target && (
          <button
            onClick={() => onOpenPage(target.id)}
            onMouseEnter={() => setLinkPreviewId(target.id)}
            onMouseLeave={() => setLinkPreviewId(null)}
            onFocus={() => setLinkPreviewId(target.id)}
            onBlur={() => setLinkPreviewId(null)}
            className="mt-2 text-sm font-medium text-[var(--tg-theme-link-color)]"
          >
            {target.icon} {block.content?.displayText || target.title}
          </button>
        )}
        {target && linkPreviewId === target.id && (
          <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3 shadow">
            <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">
              {target.icon} {target.title}
            </p>
            <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
              Обновлено: {new Date(target.updatedAt).toLocaleDateString('ru-RU')}
            </p>
            {previewBlocks.map((item) => (
              <p key={item.id} className="mt-1 truncate text-xs text-[var(--tg-theme-hint-color)]">
                {extractBlockText(item.content) || item.type}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'simple_table') {
    const rows: string[][] = normalizeTableRows(block.content?.rows ?? [['', ''], ['', '']]);
    const inferredTableKind = block.content?.tableKind === 'duty_schedule' || block.content?.reminderConfig ? 'duty_schedule' : block.content?.tableKind;
    const columns = normalizeTableColumns(block.content?.columns, rows[0]?.length ?? 2, inferredTableKind);
    const isAttendance = block.content?.tableKind === 'attendance';
    const isTaskPlanning = block.content?.tableKind === 'task_planning';
    const isFinance = block.content?.tableKind === 'finance';
    const stickyFirstColumn = Boolean(block.content?.stickyFirstColumn);
    const stickyHeader = Boolean(block.content?.stickyHeader);
    const [tableMenuOpen, setTableMenuOpen] = useState(false);
    const [attendanceStatsOpen, setAttendanceStatsOpen] = useState(false);
    const [tableContextMenu, setTableContextMenu] = useState<{ rowIndex: number; columnIndex: number; x: number; y: number } | null>(null);
    const [tableHeaderMenu, setTableHeaderMenu] = useState<{ columnIndex: number; x: number; y: number } | null>(null);
    const [selectOptionsColumnIndex, setSelectOptionsColumnIndex] = useState<number | null>(null);
    const [personColorsColumnIndex, setPersonColorsColumnIndex] = useState<number | null>(null);
    const [tableSearch, setTableSearch] = useState('');
    const [tableSort, setTableSort] = useState<{ columnIndex: number; direction: 'asc' | 'desc' } | null>(null);
    const [tableFilter, setTableFilter] = useState<{ columnIndex: number; operator: string; value: string } | null>(null);
    const [filterColumnIndex, setFilterColumnIndex] = useState<number | null>(null);
    const [tableTemplatesOpen, setTableTemplatesOpen] = useState(false);
    const [tableSettingsMenu, setTableSettingsMenu] = useState<{ x: number; y: number } | null>(null);
    const [financeTab, setFinanceTab] = useState<FinanceTab>('common');
    const [financePeriodRange, setFinancePeriodRange] = useState<FinancePeriodRange>({ from: '', to: '' });
    const [activeTableCell, setActiveTableCell] = useState<TableCellCoordinate | null>(null);
    const [fillDrag, setFillDrag] = useState<TableFillDrag | null>(null);
    const tableHeaderLongPressRef = useRef<number | null>(null);
    const visibleRows = getVisibleTableRows(rows, columns, members, tableSearch, tableSort, tableFilter)
      .filter(({ row }) => !isFinance || financeRowMatchesView(row, columns, financeTab, financePeriodRange));
    const visibleRowPositionByIndex = new Map(visibleRows.map(({ rowIndex }, index) => [rowIndex, index]));
    const fillRange = fillDrag ? getTableFillRange(fillDrag, visibleRowPositionByIndex) : null;
    const isCellInFillRange = (rowIndex: number, columnIndex: number) => {
      if (!fillDrag || !fillRange || fillDrag.columnIndex !== columnIndex) return false;
      const position = visibleRowPositionByIndex.get(rowIndex);
      return position !== undefined && position >= fillRange.from && position <= fillRange.to;
    };
    const updateTable = (nextRows: string[][], nextColumns: TableColumn[] = columns) => {
      onUpdate({ ...block.content, rows: nextRows, columns: nextColumns });
    };
    const updateTableMeta = (patch: Record<string, unknown>) => {
      onUpdate({ ...block.content, ...patch, rows, columns });
    };
    const addRow = () => {
      updateTable([...rows, columns.map(() => '')]);
      setTableMenuOpen(false);
    };
    const addColumn = () => {
      const nextColumns = [
        ...columns,
        { title: `Столбец ${columns.length + 1}`, type: 'text' as TableColumnType },
      ];
      updateTable(rows.map((row) => [...row, '']), nextColumns);
      setTableMenuOpen(false);
    };
    const importPeople = async (file: File) => {
      const text = await file.text();
      const importedRows = parsePeopleRows(text, columns.length);
      if (importedRows.length === 0) return;
      updateTable([...rows.filter((row) => row.some((cell) => cell.trim())), ...importedRows]);
    };
    const addRowAfter = (rowIndex: number) => {
      const nextRows = [...rows];
      nextRows.splice(rowIndex + 1, 0, columns.map(() => ''));
      updateTable(nextRows);
    };
    const resizeColumn = (columnIndex: number, width: number) => {
      const nextColumns = columns.map((column, index) =>
        index === columnIndex ? { ...column, width: Math.max(72, Math.min(420, width)) } : column,
      );
      updateTable(rows, nextColumns);
    };
    const pasteTableData = (rowIndex: number, columnIndex: number, text: string) => {
      const parsed = parsePastedTable(text);
      if (parsed.length === 0) return false;
      if (parsed.length === 1 && parsed[0].length === 1) return false;

      const nextRows = rows.map((row) => [...row]);
      const requiredRows = rowIndex + parsed.length;
      while (nextRows.length < requiredRows) nextRows.push(columns.map(() => ''));

      parsed.forEach((parsedRow, parsedRowIndex) => {
        parsedRow.forEach((cell, parsedCellIndex) => {
          const targetColumnIndex = columnIndex + parsedCellIndex;
          if (targetColumnIndex >= columns.length) return;
          nextRows[rowIndex + parsedRowIndex][targetColumnIndex] = cell;
        });
      });
      updateTable(nextRows);
      return true;
    };
    const cellFromPoint = (x: number, y: number, columnIndex: number) => {
      const target = document.elementFromPoint(x, y);
      const cell = target?.closest('[data-table-fill-cell="true"]') as HTMLElement | null;
      if (!cell || cell.dataset.tableBlockId !== block.id) return null;
      const targetColumnIndex = Number(cell.dataset.tableColumnIndex);
      const targetRowIndex = Number(cell.dataset.tableRowIndex);
      if (targetColumnIndex !== columnIndex || !Number.isFinite(targetRowIndex)) return null;
      return targetRowIndex;
    };
    const fillColumnCells = (sourceRowIndex: number, columnIndex: number, targetRowIndex: number) => {
      const sourcePosition = visibleRowPositionByIndex.get(sourceRowIndex);
      const targetPosition = visibleRowPositionByIndex.get(targetRowIndex);
      if (sourcePosition === undefined || targetPosition === undefined || sourcePosition === targetPosition) return;
      const from = Math.min(sourcePosition, targetPosition);
      const to = Math.max(sourcePosition, targetPosition);
      const sourceValue = rows[sourceRowIndex]?.[columnIndex] ?? '';
      const nextRows = rows.map((row) => [...row]);
      visibleRows.slice(from, to + 1).forEach(({ rowIndex }) => {
        if (rowIndex === sourceRowIndex) return;
        if (!nextRows[rowIndex]) nextRows[rowIndex] = columns.map(() => '');
        nextRows[rowIndex][columnIndex] = sourceValue;
      });
      updateTable(nextRows);
    };
    const startFillHandleDrag = (sourceRowIndex: number, columnIndex: number, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      let latestTargetRowIndex = sourceRowIndex;
      setActiveTableCell({ rowIndex: sourceRowIndex, columnIndex });
      setFillDrag({ rowIndex: sourceRowIndex, columnIndex, targetRowIndex: sourceRowIndex });

      const updateTarget = (x: number, y: number) => {
        const targetRowIndex = cellFromPoint(x, y, columnIndex);
        if (targetRowIndex === null) return;
        latestTargetRowIndex = targetRowIndex;
        setFillDrag({ rowIndex: sourceRowIndex, columnIndex, targetRowIndex });
      };
      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        updateTarget(moveEvent.clientX, moveEvent.clientY);
      };
      const stopDragging = (upEvent: PointerEvent) => {
        updateTarget(upEvent.clientX, upEvent.clientY);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);
        setFillDrag(null);
        fillColumnCells(sourceRowIndex, columnIndex, latestTargetRowIndex);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
    };
    const deleteRow = (rowIndex: number) => {
      const nextRows = rows.filter((_, index) => index !== rowIndex);
      updateTable(nextRows.length ? nextRows : [columns.map(() => '')]);
      setTableContextMenu(null);
    };
    const duplicateRow = (rowIndex: number) => {
      const nextRows = [...rows];
      nextRows.splice(rowIndex + 1, 0, [...rows[rowIndex]]);
      updateTable(nextRows);
      setTableContextMenu(null);
    };
    const moveRow = (rowIndex: number, direction: -1 | 1) => {
      const nextIndex = rowIndex + direction;
      if (nextIndex < 0 || nextIndex >= rows.length) return;
      const nextRows = [...rows];
      const [row] = nextRows.splice(rowIndex, 1);
      nextRows.splice(nextIndex, 0, row);
      updateTable(nextRows);
      setTableContextMenu(null);
    };
    const deleteColumn = (columnIndex: number) => {
      if (columns.length <= 1) return;
      const nextColumns = columns.filter((_, index) => index !== columnIndex);
      const nextRows = rows.map((row) => row.filter((_, index) => index !== columnIndex));
      updateTable(nextRows, nextColumns);
      setTableContextMenu(null);
      setTableHeaderMenu(null);
    };
    const insertColumn = (columnIndex: number, side: 'left' | 'right') => {
      const insertIndex = side === 'left' ? columnIndex : columnIndex + 1;
      const nextColumn: TableColumn = { title: `Столбец ${columns.length + 1}`, type: 'text' };
      const nextColumns = [...columns];
      nextColumns.splice(insertIndex, 0, nextColumn);
      const nextRows = rows.map((row) => {
        const nextRow = [...row];
        nextRow.splice(insertIndex, 0, '');
        return nextRow;
      });
      updateTable(nextRows, nextColumns);
      setTableHeaderMenu(null);
    };
    const moveColumn = (columnIndex: number, direction: -1 | 1) => {
      const nextIndex = columnIndex + direction;
      if (nextIndex < 0 || nextIndex >= columns.length) return;
      const nextColumns = [...columns];
      const [column] = nextColumns.splice(columnIndex, 1);
      nextColumns.splice(nextIndex, 0, column);
      const nextRows = rows.map((row) => {
        const nextRow = [...row];
        const [cell] = nextRow.splice(columnIndex, 1);
        nextRow.splice(nextIndex, 0, cell ?? '');
        return nextRow;
      });
      updateTable(nextRows, nextColumns);
      setTableHeaderMenu(null);
    };
    const openHeaderMenu = (columnIndex: number, x: number, y: number) => {
      setTableHeaderMenu({ columnIndex, x, y });
      setTableContextMenu(null);
    };
    const startHeaderLongPress = (columnIndex: number, x: number, y: number) => {
      if (tableHeaderLongPressRef.current) window.clearTimeout(tableHeaderLongPressRef.current);
      tableHeaderLongPressRef.current = window.setTimeout(() => openHeaderMenu(columnIndex, x, y), 600);
    };
    const clearHeaderLongPress = () => {
      if (!tableHeaderLongPressRef.current) return;
      window.clearTimeout(tableHeaderLongPressRef.current);
      tableHeaderLongPressRef.current = null;
    };
    const openCellMenu = (rowIndex: number, columnIndex: number, x: number, y: number) => {
      setTableContextMenu({ rowIndex, columnIndex, x, y });
    };
    const projectTitle = nodes.find((node) => node.projectId === projectId && node.parentId === null)?.title ?? 'Текущий проект';
    const updateTaskPlanningRow = (rowIndex: number, patch: Record<string, string>) => {
      const nextRows = rows.map((row) => [...row]);
      const nextRow = [...(nextRows[rowIndex] ?? columns.map(() => ''))];
      Object.entries(patch).forEach(([key, value]) => {
        const columnIndex = taskPlanningColumnIndex(columns, key);
        if (columnIndex !== -1) nextRow[columnIndex] = value;
      });
      nextRows[rowIndex] = nextRow;
      updateTable(nextRows);
    };
    const createTaskPlanningTask = (draft: TaskPlanningDraft) => {
      updateTable([...rows, taskPlanningDraftToRow(draft, columns)]);
    };
    const completeTaskPlanningTask = (rowIndex: number) => {
      updateTaskPlanningRow(rowIndex, {
        status: 'Готово',
        completedAt: formatLocalDateForTable(new Date()),
      });
    };
    const archiveTaskPlanningTask = (rowIndex: number) => {
      updateTaskPlanningRow(rowIndex, {
        status: 'Архив',
        archivedAt: formatLocalDateForTable(new Date()),
      });
    };
    const restoreTaskPlanningTask = (rowIndex: number) => {
      updateTaskPlanningRow(rowIndex, {
        status: 'Новая',
        archivedAt: '',
      });
    };

    return (
      <>
      {isAttendance && (
        <div className="rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <div className="mb-3">
            <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Посещаемость</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Статистика, импорт людей и быстрый учет присутствия.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAttendanceStatsOpen(true)}
              className="rounded-[11px] bg-[var(--tg-theme-button-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] active:scale-[0.98]"
            >
              Посмотреть статистику
            </button>
            <label className="cursor-pointer rounded-[11px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-center text-sm font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]">
              Загрузить из Excel
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importPeople(file);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      )}
      {isTaskPlanning && (
        <TaskPlanningDashboard
          rows={rows}
          columns={columns}
          members={members}
          projectTitle={projectTitle}
          onCreate={createTaskPlanningTask}
          onComplete={completeTaskPlanningTask}
          onArchive={archiveTaskPlanningTask}
          onRestore={restoreTaskPlanningTask}
          onDelete={deleteRow}
        />
      )}
      {isFinance && (
        <FinanceDashboard
          rows={rows}
          columns={columns}
          activeTab={financeTab}
          periodRange={financePeriodRange}
          onTabChange={setFinanceTab}
          onPeriodRangeChange={setFinancePeriodRange}
        />
      )}
      <div className="rounded-[10px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-1.5">
        <div className="flex items-center gap-2">
          <input
            value={tableSearch}
            onChange={(event) => setTableSearch(event.target.value)}
            placeholder="Поиск по таблице"
            className="min-w-0 flex-1 rounded-[9px] bg-[var(--tg-theme-bg-color)] px-3 py-1.5 text-sm text-[var(--tg-theme-text-color)] outline-none"
          />
          <button
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setTableSettingsMenu({ x: rect.right, y: rect.bottom + 6 });
            }}
            className="h-8 w-8 shrink-0 rounded-[9px] bg-[var(--tg-theme-bg-color)] text-sm font-bold text-[var(--tg-theme-link-color)] active:scale-[0.96]"
            aria-label="Настройки таблицы"
          >
            ✎
          </button>
          {(tableSearch || tableFilter || tableSort) && (
            <button
              type="button"
              onClick={() => {
                setTableSearch('');
                setTableFilter(null);
                setTableSort(null);
              }}
              className="rounded-[9px] bg-[var(--tg-theme-bg-color)] px-2.5 py-1.5 text-xs font-semibold text-[var(--tg-theme-hint-color)] active:scale-[0.98]"
            >
              Сброс
            </button>
          )}
        </div>
        {(tableFilter || tableSort) && (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--tg-theme-hint-color)]">
            {tableSort && <span className="rounded-full bg-[var(--tg-theme-bg-color)] px-2 py-1">Сортировка: {columns[tableSort.columnIndex]?.title} {tableSort.direction === 'asc' ? 'A-Z' : 'Z-A'}</span>}
            {tableFilter && <span className="rounded-full bg-[var(--tg-theme-bg-color)] px-2 py-1">Фильтр: {columns[tableFilter.columnIndex]?.title}</span>}
          </div>
        )}
      </div>
        <div
          className={`relative rounded-[10px] border border-[var(--tg-theme-secondary-bg-color)] pb-10 ${
            stickyHeader ? 'max-h-[520px] overflow-auto' : 'overflow-x-auto'
          }`}
          onClick={() => { setTableContextMenu(null); setTableHeaderMenu(null); }}
        >
        {false && isAttendance && (
          <div className="sticky left-0 top-0 z-20 flex min-w-[520px] items-center justify-between gap-2 border-b border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-2">
            <span className="text-xs font-semibold text-[var(--tg-theme-text-color)]">Список посещаемости</span>
            <div className="flex items-center gap-2">
            <button
              onClick={() => setAttendanceStatsOpen(true)}
              className="rounded-[9px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] active:scale-[0.98]"
            >
              Посмотреть статистику
            </button>
            <label className="cursor-pointer rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-text-color)] active:scale-[0.98]">
              Загрузить из Excel
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importPeople(file);
                  event.target.value = '';
                }}
              />
            </label>
            </div>
          </div>
        )}
        <table className="w-full min-w-[520px] table-fixed text-sm text-[var(--tg-theme-text-color)]">
          <colgroup>
            {columns.map((column, columnIndex) => (
              <col key={columnIndex} style={{ width: column.width ?? (columnIndex === 0 ? 180 : 112) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column, columnIndex) => {
                const displayColumn = isFinance && isFinanceColumn(column, 'month')
                  ? financeDateColumn(column)
                  : column;

                return (
                <th
                  key={columnIndex}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openHeaderMenu(columnIndex, event.clientX, event.clientY);
                  }}
                  onPointerDown={(event) => {
                    if (isInteractiveElement(event.target)) return;
                    startHeaderLongPress(columnIndex, event.clientX, event.clientY);
                  }}
                  onPointerUp={clearHeaderLongPress}
                  onPointerLeave={clearHeaderLongPress}
                  onPointerCancel={clearHeaderLongPress}
                  className={`relative border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-2 text-left align-top ${
                    stickyHeader ? 'sticky top-0 z-30 shadow-[0_6px_14px_rgba(0,0,0,0.18)]' : ''
                  } ${
                    stickyFirstColumn && columnIndex === 0
                      ? `sticky left-0 min-w-[180px] ${stickyHeader ? 'z-40' : 'z-10'}`
                      : ''
                  }`}
                >
                  <input
                    value={column.title}
                    onChange={(event) => {
                      const nextColumns = columns.map((item, index) =>
                        index === columnIndex ? { ...item, title: event.target.value } : item,
                      );
                      updateTable(rows, nextColumns);
                    }}
                    className="mb-1 w-full bg-transparent font-semibold text-[var(--tg-theme-text-color)] outline-none"
                    placeholder="Название"
                  />
                  <div className="flex items-center gap-1">
                    <select
                      value={displayColumn.type}
                      onChange={(event) => {
                        const nextColumns = columns.map((item, index) =>
                          index === columnIndex ? { ...item, type: event.target.value as TableColumnType } : item,
                        );
                        updateTable(rows, nextColumns);
                      }}
                      className="min-w-0 flex-1 rounded-[8px] bg-[var(--tg-theme-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)] outline-none"
                    >
                      {TABLE_COLUMN_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        openHeaderMenu(columnIndex, rect.right, rect.bottom + 6);
                      }}
                      className="h-7 w-7 shrink-0 rounded-[8px] bg-[var(--tg-theme-bg-color)] text-xs font-bold text-[var(--tg-theme-link-color)] active:scale-[0.96]"
                      aria-label="Фильтр и сортировка столбца"
                    >
                      <span aria-hidden="true" className="mx-auto block h-3 w-3">
                        <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                          <path d="M2 3h12L9.5 8.2V13l-3 1V8.2L2 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                    {displayColumn.type === 'person' && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPersonColorsColumnIndex(columnIndex);
                        }}
                        className="h-7 w-7 shrink-0 rounded-[8px] bg-[var(--tg-theme-bg-color)] text-xs font-bold text-[var(--tg-theme-link-color)] active:scale-[0.96]"
                        aria-label="Цвета пользователей"
                      >
                        <span
                          aria-hidden="true"
                          className="mx-auto block h-3.5 w-3.5 rounded-full border border-white/30"
                          style={{ background: 'conic-gradient(#3B82F6, #22C55E, #F59E0B, #EF4444, #8B5CF6, #3B82F6)' }}
                        />
                      </button>
                    )}
                    {displayColumn.type === 'select' && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectOptionsColumnIndex(columnIndex);
                        }}
                        className="h-7 w-7 shrink-0 rounded-[8px] bg-[var(--tg-theme-bg-color)] text-xs font-bold text-[var(--tg-theme-link-color)] active:scale-[0.96]"
                        aria-label="Опции select"
                      >
                        <span aria-hidden="true" className="mx-auto flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current">
                          <span className="h-0 w-0 border-x-[3.5px] border-t-[5px] border-x-transparent border-t-current" />
                        </span>
                      </button>
                    )}
                  </div>
                  {displayColumn.type === 'select' && (
                    <button
                      type="button"
                      onClick={() => setSelectOptionsColumnIndex(columnIndex)}
                      className="hidden"
                    >
                      Опции
                    </button>
                  )}
                  <button
                    type="button"
                    onMouseDown={(event) => startColumnResize(event, columns[columnIndex].width ?? (columnIndex === 0 ? 180 : 112), (width) => resizeColumn(columnIndex, width))}
                    onTouchStart={(event) => startColumnResize(event, columns[columnIndex].width ?? (columnIndex === 0 ? 180 : 112), (width) => resizeColumn(columnIndex, width))}
                    className="absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none border-r-2 border-transparent active:border-[var(--tg-theme-button-color)]"
                    aria-label="Изменить ширину столбца"
                  />
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, rowIndex }) => (
              <tr key={rowIndex} className={isFinance ? financeRowClass(row, columns) : ''}>
                {row.map((cell, cellIndex) => {
                  const column = columns[cellIndex];
                  const isFinanceDateColumn =
                    isFinance &&
                    Boolean(column) &&
                    isFinanceColumn(column, 'month');
                  const financeIncomeSubtypeColumn =
                    isFinance &&
                    Boolean(column) &&
                    isFinanceIncomeRow(row, columns) &&
                    isFinanceColumn(column, 'subcategory');
                  const effectiveColumn: TableColumn | undefined = financeIncomeSubtypeColumn
                    ? {
                        ...(column as TableColumn),
                        type: 'select',
                        options: FINANCE_INCOME_TYPES,
                        optionColors: {
                          'Разовый': '#22C55E',
                          'Регулярный': '#16A34A',
                        },
                      }
                    : isFinanceDateColumn
                      ? financeDateColumn(column as TableColumn)
                    : column;
                  const isActiveCell = activeTableCell?.rowIndex === rowIndex && activeTableCell.columnIndex === cellIndex;
                  const isFillCell = isCellInFillRange(rowIndex, cellIndex);

                  return (
                    <td
                      key={cellIndex}
                      data-table-fill-cell="true"
                      data-table-block-id={block.id}
                      data-table-row-index={rowIndex}
                      data-table-column-index={cellIndex}
                      onClick={() => setActiveTableCell({ rowIndex, columnIndex: cellIndex })}
                      onFocusCapture={() => setActiveTableCell({ rowIndex, columnIndex: cellIndex })}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openCellMenu(rowIndex, cellIndex, event.clientX, event.clientY);
                      }}
                      className={`relative border border-[var(--tg-theme-secondary-bg-color)] p-2 ${
                        stickyFirstColumn && cellIndex === 0 ? 'sticky left-0 z-10 min-w-[180px] bg-[var(--tg-theme-bg-color)]' : ''
                      } ${isFillCell ? 'bg-[var(--tg-theme-button-color)]/10 ring-1 ring-inset ring-[var(--tg-theme-button-color)]/70' : ''} ${
                        isActiveCell && !isFillCell ? 'ring-1 ring-inset ring-[var(--tg-theme-button-color)]/80' : ''
                      }`}
                    >
                      <TableCellInput
                        value={cell}
                        type={effectiveColumn?.type ?? 'text'}
                        column={effectiveColumn}
                        options={effectiveColumn?.options}
                        members={members}
                        onEnter={() => addRowAfter(rowIndex)}
                        onPaste={(text) => pasteTableData(rowIndex, cellIndex, text)}
                        onLongPress={(x, y) => openCellMenu(rowIndex, cellIndex, x, y)}
                        onChange={(value) => {
                          const nextRows = rows.map((r) => [...r]);
                          nextRows[rowIndex][cellIndex] = value;
                          updateTable(nextRows);
                        }}
                      />
                      {isActiveCell && (
                        <button
                          type="button"
                          onPointerDown={(event) => startFillHandleDrag(rowIndex, cellIndex, event)}
                          className="absolute -bottom-2 -right-2 z-30 flex h-5 w-5 cursor-crosshair touch-none items-center justify-center rounded-full bg-[var(--tg-theme-bg-color)]"
                          title="Протянуть значение вниз"
                          aria-label="Протянуть значение вниз"
                        >
                          <span className="block h-2.5 w-2.5 rounded-[3px] bg-[var(--tg-theme-button-color)] shadow" />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {isAttendance && rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((column, columnIndex) => (
                  <td
                    key={columnIndex}
                    className={`border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-2 text-xs font-semibold ${
                      stickyFirstColumn && columnIndex === 0 ? 'sticky left-0 z-10 min-w-[180px]' : ''
                    }`}
                  >
                    {columnIndex === 0 ? 'Присутствуют' : attendanceCount(rows, columnIndex)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
          {!isAttendance && rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((column, columnIndex) => (
                  <td
                    key={columnIndex}
                    className={`border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-2 text-xs font-semibold text-[var(--tg-theme-hint-color)] ${
                      stickyFirstColumn && columnIndex === 0 ? 'sticky left-0 z-10 min-w-[180px]' : ''
                    }`}
                  >
                    {tableSummaryCell(column, columnIndex, visibleRows)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>

        <div className="sticky bottom-2 left-0 z-50 flex w-full justify-end pr-2">
          {tableMenuOpen && (
            <div className="absolute bottom-11 right-0 w-44 overflow-hidden rounded-[10px] bg-[var(--tg-theme-bg-color)] shadow-xl border border-[var(--tg-theme-secondary-bg-color)]">
              <button
                onClick={addRow}
                className="block w-full px-3 py-2 text-left text-sm text-[var(--tg-theme-text-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
              >
                Добавить строку
              </button>
              <button
                onClick={addColumn}
                className="block w-full px-3 py-2 text-left text-sm text-[var(--tg-theme-text-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
              >
                Добавить столбец
              </button>
            </div>
          )}
          <button
            onClick={() => setTableMenuOpen((value) => !value)}
            className="h-8 w-8 rounded-full bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] shadow-lg"
            aria-label="Добавить строку или столбец"
          >
            +
          </button>
        </div>
        {isAttendance && attendanceStatsOpen && (
          <AttendanceStatsView
            columns={columns}
            rows={rows}
            onClose={() => setAttendanceStatsOpen(false)}
          />
        )}
        {tableSettingsMenu && (
          <ContextMenu
            title="Таблица целиком"
            x={tableSettingsMenu.x}
            y={tableSettingsMenu.y}
            onClose={() => setTableSettingsMenu(null)}
            items={[
              {
                label: 'Дублировать',
                onClick: onDuplicateBlock,
              },
              {
                label: 'Выше',
                disabled: !canMoveBlockUp,
                onClick: onMoveBlockUp,
              },
              {
                label: 'Ниже',
                disabled: !canMoveBlockDown,
                onClick: onMoveBlockDown,
              },
              {
                label: stickyHeader ? 'Открепить шапку' : 'Закрепить шапку',
                onClick: () => updateTableMeta({ stickyHeader: !stickyHeader }),
              },
              {
                label: 'Шаблоны таблиц',
                onClick: () => setTableTemplatesOpen(true),
              },
              {
                label: 'Сбросить поиск и фильтры',
                disabled: !tableSearch && !tableFilter && !tableSort,
                onClick: () => {
                  setTableSearch('');
                  setTableFilter(null);
                  setTableSort(null);
                },
              },
              {
                label: 'Удалить',
                danger: true,
                disabled: !canDeleteBlock,
                onClick: onDeleteBlock,
              },
            ]}
          />
        )}
        {tableHeaderMenu && (
          <ContextMenu
            title={columns[tableHeaderMenu.columnIndex]?.title ?? 'Столбец'}
            x={tableHeaderMenu.x}
            y={tableHeaderMenu.y}
            onClose={() => setTableHeaderMenu(null)}
            items={[
              {
                label: 'Сортировать A-Z',
                onClick: () => setTableSort({ columnIndex: tableHeaderMenu.columnIndex, direction: 'asc' }),
              },
              {
                label: 'Сортировать Z-A',
                onClick: () => setTableSort({ columnIndex: tableHeaderMenu.columnIndex, direction: 'desc' }),
              },
              {
                label: 'Фильтр по столбцу',
                onClick: () => setFilterColumnIndex(tableHeaderMenu.columnIndex),
              },
              {
                label: 'Создать столбец слева',
                onClick: () => insertColumn(tableHeaderMenu.columnIndex, 'left'),
              },
              {
                label: 'Создать столбец справа',
                onClick: () => insertColumn(tableHeaderMenu.columnIndex, 'right'),
              },
              {
                label: 'Переместить влево',
                disabled: tableHeaderMenu.columnIndex === 0,
                onClick: () => moveColumn(tableHeaderMenu.columnIndex, -1),
              },
              {
                label: 'Переместить вправо',
                disabled: tableHeaderMenu.columnIndex >= columns.length - 1,
                onClick: () => moveColumn(tableHeaderMenu.columnIndex, 1),
              },
              {
                label: 'Настроить select',
                disabled: columns[tableHeaderMenu.columnIndex]?.type !== 'select',
                onClick: () => setSelectOptionsColumnIndex(tableHeaderMenu.columnIndex),
              },
              {
                label: 'Удалить столбец',
                danger: true,
                disabled: columns.length <= 1,
                onClick: () => deleteColumn(tableHeaderMenu.columnIndex),
              },
            ]}
          />
        )}
        {selectOptionsColumnIndex !== null && columns[selectOptionsColumnIndex] && (
          <SelectOptionsModal
            column={columns[selectOptionsColumnIndex]}
            onClose={() => setSelectOptionsColumnIndex(null)}
            onChange={(nextColumn) => {
              const nextColumns = columns.map((column, index) =>
                index === selectOptionsColumnIndex ? nextColumn : column,
              );
              updateTable(rows, nextColumns);
            }}
          />
        )}
        {personColorsColumnIndex !== null && columns[personColorsColumnIndex] && (
          <PersonColorsModal
            column={columns[personColorsColumnIndex]}
            members={members}
            onClose={() => setPersonColorsColumnIndex(null)}
            onChange={(nextColumn) => {
              const nextColumns = columns.map((column, index) =>
                index === personColorsColumnIndex ? nextColumn : column,
              );
              updateTable(rows, nextColumns);
            }}
          />
        )}
        {filterColumnIndex !== null && columns[filterColumnIndex] && (
          <TableFilterModal
            column={columns[filterColumnIndex]}
            members={members}
            onClose={() => setFilterColumnIndex(null)}
            onApply={(operator, value) => {
              setTableFilter({ columnIndex: filterColumnIndex, operator, value });
              setFilterColumnIndex(null);
            }}
            onClear={() => {
              setTableFilter(null);
              setFilterColumnIndex(null);
            }}
          />
        )}
        {tableTemplatesOpen && (
          <TableTemplatesModal
            onClose={() => setTableTemplatesOpen(false)}
            onSelect={(template) => {
              onUpdate({
                ...block.content,
                rows: template.rows,
                columns: template.columns,
                tableKind: template.tableKind,
              });
              setTableTemplatesOpen(false);
            }}
          />
        )}
        {tableContextMenu && (
          <div
            className="fixed z-[95] w-44 overflow-hidden rounded-[12px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] shadow-2xl"
            style={{ left: Math.min(tableContextMenu.x, window.innerWidth - 190), top: Math.min(tableContextMenu.y, window.innerHeight - 110) }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => copyPlainText(rows[tableContextMenu.rowIndex].map((cell) => String(cell ?? '')).join('\t'))}
              className="block w-full px-3 py-3 text-left text-sm text-[var(--tg-theme-text-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              Копировать строку
            </button>
            <button
              onClick={() => duplicateRow(tableContextMenu.rowIndex)}
              className="block w-full px-3 py-3 text-left text-sm text-[var(--tg-theme-text-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              Дублировать строку
            </button>
            <button
              onClick={() => moveRow(tableContextMenu.rowIndex, -1)}
              disabled={tableContextMenu.rowIndex === 0}
              className="block w-full px-3 py-3 text-left text-sm text-[var(--tg-theme-text-color)] disabled:opacity-40 active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              Переместить выше
            </button>
            <button
              onClick={() => moveRow(tableContextMenu.rowIndex, 1)}
              disabled={tableContextMenu.rowIndex >= rows.length - 1}
              className="block w-full px-3 py-3 text-left text-sm text-[var(--tg-theme-text-color)] disabled:opacity-40 active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              Переместить ниже
            </button>
            <button
              onClick={() => deleteRow(tableContextMenu.rowIndex)}
              className="block w-full px-3 py-3 text-left text-sm text-[var(--tg-theme-text-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              Удалить строку
            </button>
            <button
              onClick={() => deleteColumn(tableContextMenu.columnIndex)}
              disabled={columns.length <= 1}
              className="block w-full px-3 py-3 text-left text-sm text-red-400 disabled:opacity-40 active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              Удалить столбец
            </button>
          </div>
        )}
      </div>
      </>
    );
  }

  if (block.type === 'kanban_embed') {
    return (
      <div className="h-[540px] overflow-hidden rounded-[12px] border border-[var(--tg-theme-secondary-bg-color)]">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--tg-theme-hint-color)]">Загрузка доски...</div>}>
          <BoardPage embedded boardPageId={block.content?.pageId || page.id} />
        </Suspense>
      </div>
    );
  }

  if (block.type === 'web_embed') {
    return (
      <WebEmbedBlock
        content={block.content}
        onUpdate={onUpdate}
      />
    );
  }

  if (block.type === 'page_properties') {
    return (
      <PagePropertiesPanel
        page={page}
        members={members}
        onChange={onPagePropertiesChange}
      />
    );
  }

  if (block.type === 'smart_summary') {
    return <SmartSummary projectId={projectId} blocks={blocks} members={members} />;
  }

  if (block.type === 'collapsible') {
    const collapsed = Boolean(block.content?.collapsed);
    return (
      <div className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <button
          onClick={() => onUpdate({ ...block.content, collapsed: !collapsed })}
          className="mb-2 flex w-full items-center gap-2 text-left font-medium text-[var(--tg-theme-text-color)]"
        >
          <span>{collapsed ? '›' : '⌄'}</span>
          <input
            value={block.content?.title ?? ''}
            onChange={(event) => onUpdate({ ...block.content, title: event.target.value })}
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </button>
        {!collapsed && (
          <textarea
            value={block.content?.text ?? ''}
            onChange={(event) => onUpdate({ ...block.content, text: event.target.value })}
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-[var(--tg-theme-text-color)] outline-none"
            placeholder="Содержимое раздела"
          />
        )}
      </div>
    );
  }

  const className =
    block.type === 'heading_1'
      ? 'text-2xl font-bold'
      : block.type === 'heading_2'
        ? 'text-xl font-bold'
        : block.type === 'heading_3'
          ? 'text-lg font-semibold'
          : block.type === 'code'
            ? 'font-mono bg-[var(--tg-theme-secondary-bg-color)] rounded-[10px] px-3 py-2'
            : '';

  const prefix =
    block.type === 'bulleted_list'
      ? '•'
      : block.type === 'numbered_list'
        ? `${getNumberedListIndex(block, blocks)}.`
        : null;

  return (
    <div className="flex items-start gap-2">
      {prefix && <span className="pt-2 text-[var(--tg-theme-hint-color)]">{prefix}</span>}
      <TextInput
        value={text}
        placeholder={showPlaceholder ? 'Напиши что-нибудь или / для команд' : ''}
        className={className}
        onChange={(value) => onUpdate({ ...block.content, text: value })}
        onEnter={onEnter}
        onDelete={onDelete}
        onSlash={onSlash}
        onCommit={onCommit}
        members={members}
        shouldFocus={shouldFocus}
        onFocused={onFocused}
        onFocus={onFocus}
      />
      {taskSuggestion && !taskCreated && (
        <button
          onClick={async () => {
            await tasksApi.create(Number(projectId), {
              title: taskSuggestion.title,
              deadlineAt: taskSuggestion.deadlineAt,
              priority: taskSuggestion.priority,
            });
            setTaskCreated(true);
          }}
          className="mt-1 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-left text-xs text-[var(--tg-theme-text-color)]"
        >
          Создать задачу: {taskSuggestion.title}
        </button>
      )}
    </div>
  );
}

function TextInput({
  value,
  placeholder,
  className = '',
  onChange,
  onEnter,
  onDelete,
  onSlash,
  onCommit,
  members,
  shouldFocus,
  onFocused,
  onFocus,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  onDelete: () => void;
  onSlash: (query: string) => void;
  onCommit: (value: string) => void;
  members: ProjectMember[];
  shouldFocus: boolean;
  onFocused: () => void;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focusValueRef = useRef(value);
  const pendingCaretOffsetRef = useRef<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionOptions = members.filter((member) => {
    const label = `${mentionDisplayName(member)} ${mentionUsernameLabel(member)} ${member.user?.lastName ?? ''}`.toLowerCase();
    return mentionQuery !== null && label.includes(mentionQuery.toLowerCase());
  });
  const commitCurrentValue = () => {
    const currentValue = readEditableText(ref.current);
    const normalized = normalizeInlineDates(currentValue);
    if (ref.current && readEditableText(ref.current) !== normalized) ref.current.innerText = normalized;
    onChange(normalized);
    if (focusValueRef.current.trim() !== normalized.trim()) onCommit(normalized);
    return normalized;
  };
  const enterEditing = (event?: ReactMouseEvent<HTMLDivElement>) => {
    pendingCaretOffsetRef.current = event
      ? getTextOffsetFromPoint(event.currentTarget, event.clientX, event.clientY)
      : null;
    setIsEditing(true);
  };

  useEffect(() => {
    const element = ref.current;
    if (!element || !isEditing || document.activeElement === element) return;
    if (readEditableText(element) !== value) element.innerText = value;
  }, [isEditing, value]);

  useEffect(() => {
    if (!shouldFocus) return;
    setIsEditing(true);
    onFocused();
  }, [onFocused, shouldFocus]);

  useEffect(() => {
    if (!isEditing) return;
    const id = window.requestAnimationFrame(() => {
      if (!ref.current) return;
      if (readEditableText(ref.current) !== value) ref.current.innerText = value;
      ref.current.focus();
      const offset = pendingCaretOffsetRef.current;
      pendingCaretOffsetRef.current = null;
      if (offset === null) setEditableCaretToEnd(ref.current);
      else setEditableCaretToOffset(ref.current, offset);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isEditing]);

  if (!isEditing) {
    return (
      <div
        role="textbox"
        tabIndex={0}
        data-placeholder={placeholder}
        onClick={(event) => {
          if (window.getSelection()?.toString()) return;
          enterEditing(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            setIsEditing(true);
          }
        }}
        className={`min-h-[2.75rem] w-full max-w-full cursor-text select-text bg-transparent text-[var(--tg-theme-text-color)] outline-none py-2 whitespace-pre-wrap break-words leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--tg-theme-hint-color)] empty:before:pointer-events-none ${className}`}
      >
        {value}
      </div>
    );
  }

  return (
    <>
    <div
      ref={ref}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => {
        const next = readEditableText(e.currentTarget);
        onChange(next);
        if (next.startsWith('/')) onSlash(next);
        const mention = next.match(/(?:^|\s)@([A-Za-zА-Яа-яЁё0-9_]*)$/);
        setMentionQuery(mention ? mention[1] : null);
      }}
      onBlur={() => {
        commitCurrentValue();
        setIsEditing(false);
      }}
      onFocus={() => {
        focusValueRef.current = readEditableText(ref.current);
        onFocus();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
          return;
        }

        if ((e.key === 'Backspace' || e.key === 'Delete') && !readEditableText(e.currentTarget).trim()) {
          e.preventDefault();
          onDelete();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
      }}
      className={`min-h-[2.75rem] w-full max-w-full bg-transparent text-[var(--tg-theme-text-color)] outline-none py-2 whitespace-pre-wrap break-words leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--tg-theme-hint-color)] empty:before:pointer-events-none ${className}`}
    />
    {mentionOptions.length > 0 && (
      <div className="absolute z-[60] mt-10 max-h-56 w-64 overflow-y-auto rounded-[12px] bg-[var(--tg-theme-bg-color)] p-1 shadow-xl border border-[var(--tg-theme-secondary-bg-color)]">
        {mentionOptions.slice(0, 6).map((member) => {
          const displayName = mentionDisplayName(member);
          const usernameLabel = mentionUsernameLabel(member);
          const mentionToken = mentionInsertToken(member);
          return (
            <button
              key={member.id}
              onMouseDown={(event) => {
                event.preventDefault();
                const current = readEditableText(ref.current) || value;
                const next = current.replace(/@([A-Za-zА-Яа-яЁё0-9_]*)$/, `${mentionToken} `);
                if (ref.current) {
                  ref.current.innerText = next;
                  setEditableCaretToEnd(ref.current);
                }
                onChange(next);
                setMentionQuery(null);
              }}
              className="w-full rounded-[9px] px-2.5 py-2 text-left active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{displayName}</span>
              <span className="mt-0.5 block truncate text-xs text-[var(--tg-theme-hint-color)]">{usernameLabel}</span>
            </button>
          );
        })}
      </div>
    )}
    </>
  );
}

function mentionDisplayName(member: ProjectMember) {
  const user = member.user;
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return fullName || user?.username || `Участник ${member.userId}`;
}

function mentionUsernameLabel(member: ProjectMember) {
  const username = member.user?.username?.replace(/^@/, '');
  return username ? `@${username}` : 'Telegram username не указан';
}

function mentionInsertToken(member: ProjectMember) {
  const username = member.user?.username?.replace(/^@/, '');
  if (username) return `@${username}`;
  const fallback = (member.user?.firstName || member.user?.lastName || `user${member.userId}`).replace(/\s+/g, '_');
  return `@${fallback}`;
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

function readEditableText(element: HTMLElement | null) {
  return (element?.innerText ?? '').replace(/\n$/, '');
}

function setEditableCaretToEnd(element: HTMLElement | null) {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setEditableCaretToOffset(element: HTMLElement | null, offset: number) {
  if (!element) return;
  const textLength = element.textContent?.length ?? 0;
  let remaining = Math.max(0, Math.min(offset, textLength));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= length;
  }

  setEditableCaretToEnd(element);
}

function getTextOffsetFromPoint(element: HTMLElement, x: number, y: number) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(x, y);
  const range = position ? null : documentWithCaret.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? range?.startContainer ?? null;
  const offset = position?.offset ?? range?.startOffset ?? 0;

  if (!node || !element.contains(node) || node.nodeType !== Node.TEXT_NODE) {
    return element.textContent?.length ?? 0;
  }

  let total = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  return element.textContent?.length ?? 0;
}

function getNativeSelectedTextBlockIds(container: HTMLElement | null, blocks: Block[]) {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  const textBlockIds = new Set(blocks.filter(isTextInputBlock).map((block) => block.id));
  return [...container.querySelectorAll<HTMLElement>('[data-page-block-id]')]
    .filter((element) => {
      const blockId = element.dataset.pageBlockId;
      return blockId && textBlockIds.has(blockId) && range.intersectsNode(element);
    })
    .map((element) => element.dataset.pageBlockId!)
    .filter(Boolean);
}

function trimActivityText(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}

function nextBlockTypeAfterEnter(type: BlockType): BlockType {
  if (type === 'todo' || type === 'bulleted_list' || type === 'numbered_list') return type;
  return 'paragraph';
}

function isTextInputBlock(block: Block) {
  return [
    'paragraph',
    'heading_1',
    'heading_2',
    'heading_3',
    'todo',
    'bulleted_list',
    'numbered_list',
    'code',
  ].includes(block.type);
}

function getNumberedListIndex(block: Block, blocks: Block[]) {
  const index = blocks.findIndex((item) => item.id === block.id);
  if (index < 0) return 1;

  let number = 1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (blocks[i].type !== 'numbered_list') break;
    number += 1;
  }
  return number;
}

function isBlockEmpty(block: Block) {
  if (block.type === 'simple_table') return false;
  if (block.type === 'link_to_page') return !block.content?.targetPageId;
  if (block.type === 'kanban_embed') return false;
  if (block.type === 'web_embed') return !block.content?.url;
  return !String(block.content?.text ?? '').trim();
}

function blockContextMenuTitle(block: Block) {
  if (block.type === 'simple_table') return 'Таблица целиком';
  return 'Блок';
}

function WebEmbedBlock({
  content,
  onUpdate,
}: {
  content: WebEmbedContent;
  onUpdate: (content: WebEmbedContent) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(content?.url ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const provider = content?.provider ?? detectEmbedProvider(content?.url ?? '');
  const mode = content?.mode ?? 'auto';
  const safeContentUrl = normalizeUrl(content?.url ?? '');
  const safeEmbedUrl = normalizeUrl(content?.embedUrl ?? '') || buildEmbedUrl(safeContentUrl, provider);
  const safeImageUrl = normalizeUrl(content?.image ?? '');
  const canEmbed = Boolean(safeEmbedUrl);
  const shouldEmbed = Boolean(safeContentUrl && mode !== 'preview' && canEmbed);

  useEffect(() => {
    setUrlDraft(content?.url ?? '');
  }, [content?.url]);

  const applyUrl = async () => {
    const normalizedUrl = normalizeUrl(urlDraft);
    if (!normalizedUrl) {
      setError('Вставь корректную ссылку');
      return;
    }

    setIsLoading(true);
    setError('');
    const nextProvider = detectEmbedProvider(normalizedUrl);
    const embedUrl = buildEmbedUrl(normalizedUrl, nextProvider);
    try {
      const preview = await linkPreviewApi.get(normalizedUrl);
      onUpdate({
        ...content,
        ...preview,
        url: normalizedUrl,
        title: preview.title || content?.title || normalizedUrl,
        provider: nextProvider,
        embedUrl,
        mode: content?.mode ?? 'auto',
        height: content?.height ?? defaultEmbedHeight(nextProvider),
      });
    } catch {
      onUpdate({
        ...content,
        url: normalizedUrl,
        title: content?.title || hostnameLabel(normalizedUrl),
        provider: nextProvider,
        embedUrl,
        mode: content?.mode ?? 'auto',
        height: content?.height ?? defaultEmbedHeight(nextProvider),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void applyUrl();
            }
          }}
          placeholder="Вставь ссылку: YouTube, Figma, Miro, карта, сайт..."
          className="min-w-0 flex-1 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
        />
        <button
          onClick={() => void applyUrl()}
          disabled={isLoading}
          className="rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
        >
          {isLoading ? '...' : 'OK'}
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      {safeContentUrl && (
        <div className="mb-3 grid grid-cols-[1fr_96px] gap-2">
          <select
            value={mode}
            onChange={(event) => onUpdate({ ...content, mode: event.target.value as WebEmbedContent['mode'] })}
            className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm outline-none"
          >
            <option value="auto">Авто</option>
            <option value="preview">Preview</option>
            <option value="embed">Iframe</option>
          </select>
          <input
            type="number"
            min={160}
            max={900}
            value={content.height ?? defaultEmbedHeight(provider)}
            onChange={(event) => onUpdate({ ...content, height: Number(event.target.value) || defaultEmbedHeight(provider) })}
            className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm outline-none"
            title="Высота"
          />
        </div>
      )}

      {shouldEmbed ? (
        <div className="overflow-hidden rounded-[12px] bg-[var(--tg-theme-bg-color)]">
          <iframe
            title={content.title || content.url}
            src={safeEmbedUrl}
            style={{ height: content.height ?? defaultEmbedHeight(provider) }}
            className="block w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </div>
      ) : safeContentUrl ? (
        <a
          href={safeContentUrl}
          target="_blank"
          rel="noreferrer"
          className="flex gap-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-left active:scale-[0.99]"
        >
          {safeImageUrl ? (
            <img src={safeImageUrl} alt="" className="h-20 w-24 shrink-0 rounded-[10px] object-cover" />
          ) : (
            <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] text-2xl">
              🔗
            </div>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">
              {content.title || hostnameLabel(content.url)}
            </span>
            {content.description && (
              <span className="mt-1 line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">
                {content.description}
              </span>
            )}
            <span className="mt-2 block truncate text-xs text-[var(--tg-theme-link-color)]">
              {content.siteName || hostnameLabel(content.url)}
            </span>
          </span>
        </a>
      ) : (
        <div className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-6 text-center text-sm text-[var(--tg-theme-hint-color)]">
          Вставь ссылку, чтобы создать preview или встроенный виджет.
        </div>
      )}
    </div>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return isHttpUrl(parsed) ? parsed.toString() : '';
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`);
      return isHttpUrl(parsed) ? parsed.toString() : '';
    } catch {
      return '';
    }
  }
}

function isHttpUrl(url: URL) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function detectEmbedProvider(url: string): WebEmbedProvider {
  const normalized = normalizeUrl(url);
  if (!normalized) return 'generic';
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
    if (host.endsWith('figma.com')) return 'figma';
    if (host.endsWith('miro.com')) return 'miro';
    if (host.includes('google') && parsed.pathname.includes('/calendar')) return 'google_calendar';
    if (host.includes('google') && parsed.pathname.includes('/maps')) return 'map';
    if (host.endsWith('openstreetmap.org')) return 'map';
    return 'generic';
  } catch {
    return 'generic';
  }
}

function buildEmbedUrl(url: string, provider: WebEmbedProvider) {
  const normalized = normalizeUrl(url);
  if (!normalized) return undefined;

  try {
    const parsed = new URL(normalized);
    if (provider === 'youtube') {
      const id = getYoutubeId(parsed);
      return id ? `https://www.youtube.com/embed/${id}` : undefined;
    }

    if (provider === 'figma') {
      return `https://www.figma.com/embed?embed_host=telegram_workspace&url=${encodeURIComponent(normalized)}`;
    }

    if (provider === 'miro') {
      return normalized;
    }

    if (provider === 'google_calendar') {
      return normalized;
    }

    if (provider === 'map') {
      return normalized;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function getYoutubeId(url: URL) {
  if (url.hostname === 'youtu.be') return url.pathname.replace('/', '') || undefined;
  if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2];
  if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2];
  return url.searchParams.get('v') ?? undefined;
}

function defaultEmbedHeight(provider: WebEmbedProvider) {
  if (provider === 'youtube') return 240;
  if (provider === 'figma' || provider === 'miro') return 520;
  if (provider === 'google_calendar' || provider === 'map') return 420;
  return 280;
}

function hostnameLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function PagePropertiesPanel({
  page,
  members,
  onChange,
}: {
  page: PageNode;
  members: ProjectMember[];
  onChange: (properties: NonNullable<PageNode['properties']>) => void;
}) {
  const properties = page.properties ?? {};
  const tags = properties.tags?.join(', ') ?? '';

  return (
    <div className="mb-5 grid grid-cols-2 gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-xs sm:grid-cols-4">
      <label className="block">
        <span className="mb-1 block text-[var(--tg-theme-hint-color)]">Статус</span>
        <select
          value={properties.status ?? 'draft'}
          onChange={(event) => onChange({ status: event.target.value as NonNullable<typeof properties.status> })}
          className="w-full bg-transparent text-[var(--tg-theme-text-color)] outline-none"
        >
          <option value="draft">Черновик</option>
          <option value="active">В работе</option>
          <option value="done">Готово</option>
          <option value="archived">Архив</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[var(--tg-theme-hint-color)]">Дедлайн</span>
        <input
          type="date"
          value={properties.deadline ?? ''}
          onChange={(event) => onChange({ deadline: event.target.value })}
          className="w-full bg-transparent text-[var(--tg-theme-text-color)] outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[var(--tg-theme-hint-color)]">Ответственный</span>
        <select
          value={properties.responsibleUserId ?? ''}
          onChange={(event) => onChange({ responsibleUserId: event.target.value })}
          className="w-full bg-transparent text-[var(--tg-theme-text-color)] outline-none"
        >
          <option value="">Не выбран</option>
          {members.map((member) => (
            <option key={member.id} value={member.userId}>
              {member.user?.firstName ?? member.user?.username ?? member.userId}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[var(--tg-theme-hint-color)]">Теги</span>
        <input
          value={tags}
          onChange={(event) =>
            onChange({
              tags: event.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
          placeholder="tag, team"
          className="w-full bg-transparent text-[var(--tg-theme-text-color)] outline-none"
        />
      </label>
    </div>
  );
}

function TaskPlanningDashboard({
  rows,
  columns,
  members,
  projectTitle,
  onCreate,
  onComplete,
  onArchive,
  onRestore,
  onDelete,
}: {
  rows: string[][];
  columns: TableColumn[];
  members: ProjectMember[];
  projectTitle: string;
  onCreate: (draft: TaskPlanningDraft) => void;
  onComplete: (rowIndex: number) => void;
  onArchive: (rowIndex: number) => void;
  onRestore: (rowIndex: number) => void;
  onDelete: (rowIndex: number) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const tasks = useMemo(() => taskPlanningRows(rows, columns, members), [rows, columns, members]);
  const activeTasks = tasks.filter((task) => !task.isArchived && !task.isDone);
  const archivedTasks = tasks.filter((task) => task.isArchived);
  const doneTasks = tasks.filter((task) => task.isDone);
  const overdueTasks = activeTasks.filter((task) => task.deadlineTime && task.deadlineTime < startOfToday());

  const createDraft = (draft: TaskPlanningDraft) => {
    onCreate(draft);
    setModalOpen(false);
  };

  return (
    <section className="space-y-2 rounded-[12px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--tg-theme-text-color)]">Постановка задач</p>
          <p className="text-[11px] text-[var(--tg-theme-hint-color)]">Таблица, матрица и архив</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-sm font-bold text-[var(--tg-theme-button-text-color)] active:scale-[0.98]"
        >
          + Задача
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <TaskPlanningStat value={String(tasks.length)} label="всего" />
        <TaskPlanningStat value={String(activeTasks.length)} label="активных" />
        <TaskPlanningStat value={String(doneTasks.length)} label="готово" />
        <TaskPlanningStat value={String(overdueTasks.length)} label="просрочено" tone={overdueTasks.length ? 'danger' : 'normal'} />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {TASK_PLANNING_QUADRANTS.map((quadrant) => {
          const quadrantTasks = activeTasks.filter((task) => task.quadrantId === quadrant.id);
          return (
            <div
              key={quadrant.id}
              className="rounded-[12px] border p-3"
              style={{
                borderColor: `${quadrant.color}80`,
                background: `${quadrant.color}18`,
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[var(--tg-theme-text-color)]">{quadrant.title}</p>
                  <p className="text-xs text-[var(--tg-theme-hint-color)]">{quadrant.subtitle}</p>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
                  style={{ background: quadrant.color }}
                >
                  {quadrantTasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {quadrantTasks.length === 0 ? (
                  <p className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-center text-xs text-[var(--tg-theme-hint-color)]">
                    Нет задач
                  </p>
                ) : (
                  quadrantTasks.map((task) => (
                    <TaskPlanningCard
                      key={task.rowIndex}
                      task={task}
                      onComplete={() => onComplete(task.rowIndex)}
                      onArchive={() => onArchive(task.rowIndex)}
                      onDelete={() => onDelete(task.rowIndex)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <details className="rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
        <summary className="cursor-pointer list-none text-sm font-bold text-[var(--tg-theme-text-color)]">
          Архив · {archivedTasks.length}
        </summary>
        <div className="mt-3 space-y-2">
          {archivedTasks.length === 0 ? (
            <p className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-center text-xs text-[var(--tg-theme-hint-color)]">
              Архив пуст
            </p>
          ) : (
            archivedTasks.map((task) => (
              <TaskPlanningCard
                key={task.rowIndex}
                task={task}
                archived
                onRestore={() => onRestore(task.rowIndex)}
                onDelete={() => onDelete(task.rowIndex)}
              />
            ))
          )}
        </div>
      </details>

      {modalOpen && (
        <TaskPlanningModal
          members={members}
          projectTitle={projectTitle}
          onClose={() => setModalOpen(false)}
          onCreate={createDraft}
        />
      )}
    </section>
  );
}

function TaskPlanningStat({ value, label, tone = 'normal' }: { value: string; label: string; tone?: 'normal' | 'danger' }) {
  return (
    <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-2 py-3 text-center">
      <p className={`text-lg font-bold ${tone === 'danger' ? 'text-red-300' : 'text-[var(--tg-theme-text-color)]'}`}>{value}</p>
      <p className="text-[11px] text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function TaskPlanningCard({
  task,
  archived,
  onComplete,
  onArchive,
  onRestore,
  onDelete,
}: {
  task: ReturnType<typeof taskPlanningRows>[number];
  archived?: boolean;
  onComplete?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--tg-theme-text-color)]">{task.title || 'Без названия'}</p>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
            {task.assigneeName || 'Без исполнителя'}{task.deadline ? ` · ${task.deadline}` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${tableBadgeClass(task.priority, 'priority')}`}>
          {task.priority || 'Средний'}
        </span>
      </div>
      {task.description && (
        <p className="mt-2 line-clamp-2 text-xs text-[var(--tg-theme-hint-color)]">{task.description}</p>
      )}
      <div className="mt-3 flex gap-2">
        {archived ? (
          <button
            type="button"
            onClick={onRestore}
            className="flex-1 rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
          >
            Вернуть
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onComplete}
              className="flex-1 rounded-[9px] bg-emerald-500/90 py-2 text-xs font-semibold text-white active:scale-[0.98]"
            >
              Готово
            </button>
            <button
              type="button"
              onClick={onArchive}
              className="flex-1 rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
            >
              В архив
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="w-10 rounded-[9px] bg-red-500/15 py-2 text-xs font-bold text-red-300 active:scale-[0.98]"
          aria-label="Удалить задачу"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function TaskPlanningModal({
  members,
  projectTitle,
  onClose,
  onCreate,
}: {
  members: ProjectMember[];
  projectTitle: string;
  onClose: () => void;
  onCreate: (draft: TaskPlanningDraft) => void;
}) {
  const [draft, setDraft] = useState<TaskPlanningDraft>(() => ({
    title: '',
    project: projectTitle,
    assigneeId: members[0] ? String(members[0].userId) : '',
    deadline: '',
    isImportant: true,
    isUrgent: true,
    description: '',
    status: 'Новая',
    priority: 'Средний',
    tags: '',
    subtasks: '',
    reminder: 'За 15 часов',
    linkedPage: '',
    recurrence: 'Нет',
    adminComment: '',
  }));
  const canCreate = Boolean(draft.title.trim() && draft.project.trim() && draft.assigneeId && draft.deadline.trim());

  const update = (patch: Partial<TaskPlanningDraft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <div className="fixed inset-0 z-[97] flex items-end bg-black/50" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">Поставить задачу</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Задача попадет в общую таблицу и нужный квадрант.</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">
            ×
          </button>
        </div>

        <div className="space-y-3">
          <TaskPlanningField label="Название задачи" required>
            <input
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              placeholder="Что нужно сделать?"
            />
          </TaskPlanningField>
          <div className="grid grid-cols-2 gap-2">
            <TaskPlanningField label="Проект" required>
              <input
                value={draft.project}
                onChange={(event) => update({ project: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              />
            </TaskPlanningField>
            <TaskPlanningField label="Исполнитель" required>
              <select
                value={draft.assigneeId}
                onChange={(event) => update({ assigneeId: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              >
                <option value="">Не выбран</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberDisplayName(String(member.userId), members)}
                  </option>
                ))}
              </select>
            </TaskPlanningField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TaskPlanningField label="Дедлайн" required>
              <input
                value={draft.deadline}
                onChange={(event) => update({ deadline: formatTableDateInput(event.target.value) })}
                inputMode="numeric"
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
                placeholder="дд-мм-гггг"
              />
            </TaskPlanningField>
            <TaskPlanningField label="Приоритет">
              <select
                value={draft.priority}
                onChange={(event) => update({ priority: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </TaskPlanningField>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TaskPlanningToggle
              label="Важность"
              checked={draft.isImportant}
              onChange={(isImportant) => update({ isImportant })}
            />
            <TaskPlanningToggle
              label="Срочность"
              checked={draft.isUrgent}
              onChange={(isUrgent) => update({ isUrgent })}
            />
          </div>

          <TaskPlanningField label="Описание">
            <textarea
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
              rows={3}
              className="w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              placeholder="Контекст, критерий готовности, важные детали"
            />
          </TaskPlanningField>

          <div className="grid grid-cols-2 gap-2">
            <TaskPlanningField label="Статус">
              <select
                value={draft.status}
                onChange={(event) => update({ status: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              >
                {TASK_PLANNING_STATUSES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </TaskPlanningField>
            <TaskPlanningField label="Повтор">
              <select
                value={draft.recurrence}
                onChange={(event) => update({ recurrence: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              >
                {['Нет', 'Ежедневно', 'Еженедельно', 'Ежемесячно'].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </TaskPlanningField>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TaskPlanningField label="Теги">
              <input
                value={draft.tags}
                onChange={(event) => update({ tags: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
                placeholder="tag, team"
              />
            </TaskPlanningField>
            <TaskPlanningField label="Напоминание">
              <input
                value={draft.reminder}
                onChange={(event) => update({ reminder: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
                placeholder="Например: за 15 часов"
              />
            </TaskPlanningField>
          </div>

          <TaskPlanningField label="Подзадачи">
            <textarea
              value={draft.subtasks}
              onChange={(event) => update({ subtasks: event.target.value })}
              rows={2}
              className="w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              placeholder="Каждая подзадача с новой строки"
            />
          </TaskPlanningField>

          <div className="grid grid-cols-2 gap-2">
            <TaskPlanningField label="Связанная страница">
              <input
                value={draft.linkedPage}
                onChange={(event) => update({ linkedPage: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
                placeholder="Название или ссылка"
              />
            </TaskPlanningField>
            <TaskPlanningField label="Комментарий администратора">
              <input
                value={draft.adminComment}
                onChange={(event) => update({ adminComment: event.target.value })}
                className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
                placeholder="Внутренняя заметка"
              />
            </TaskPlanningField>
          </div>

          <button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate(draft)}
            className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-bold text-[var(--tg-theme-button-text-color)] disabled:opacity-50 active:scale-[0.98]"
          >
            Создать задачу
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskPlanningField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--tg-theme-hint-color)]">
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

function taskPlanningColumnIndex(columns: TableColumn[], key: string) {
  const byKey = columns.findIndex((column) => column.key === key);
  if (byKey !== -1) return byKey;
  const fallbackTitles: Record<string, string[]> = {
    title: ['Задача', 'Название задачи'],
    project: ['Проект'],
    assigneeId: ['Исполнитель', 'Ответственный'],
    deadline: ['Дедлайн', 'Срок'],
    isImportant: ['Важность', 'Важно'],
    isUrgent: ['Срочность', 'Срочно'],
    quadrant: ['Квадрант'],
    description: ['Описание'],
    status: ['Статус'],
    priority: ['Приоритет'],
    tags: ['Теги'],
    subtasks: ['Подзадачи'],
    reminder: ['Напоминание'],
    linkedPage: ['Связанная страница'],
    recurrence: ['Повтор', 'Повторяющаяся задача'],
    adminComment: ['Комментарий администратора'],
    completedAt: ['Выполнено'],
    archivedAt: ['В архиве'],
  };
  return columns.findIndex((column) => fallbackTitles[key]?.includes(column.title));
}

function taskPlanningCell(row: string[], columns: TableColumn[], key: string) {
  const columnIndex = taskPlanningColumnIndex(columns, key);
  return columnIndex === -1 ? '' : String(row[columnIndex] ?? '');
}

function taskPlanningQuadrantId(isImportant: boolean, isUrgent: boolean) {
  if (isImportant && isUrgent) return 'important_urgent';
  if (isImportant && !isUrgent) return 'important_not_urgent';
  if (!isImportant && isUrgent) return 'not_important_urgent';
  return 'not_important_not_urgent';
}

function taskPlanningQuadrantTitle(isImportant: boolean, isUrgent: boolean) {
  const quadrantId = taskPlanningQuadrantId(isImportant, isUrgent);
  return TASK_PLANNING_QUADRANTS.find((quadrant) => quadrant.id === quadrantId)?.title ?? '';
}

function taskPlanningDraftToRow(draft: TaskPlanningDraft, columns: TableColumn[]) {
  const nextRow = columns.map(() => '');
  const setCell = (key: string, value: string) => {
    const columnIndex = taskPlanningColumnIndex(columns, key);
    if (columnIndex !== -1) nextRow[columnIndex] = value;
  };

  setCell('title', draft.title.trim());
  setCell('project', draft.project.trim());
  setCell('assigneeId', draft.assigneeId);
  setCell('deadline', draft.deadline.trim());
  setCell('isImportant', draft.isImportant ? 'Да' : 'Нет');
  setCell('isUrgent', draft.isUrgent ? 'Да' : 'Нет');
  setCell('quadrant', taskPlanningQuadrantTitle(draft.isImportant, draft.isUrgent));
  setCell('description', draft.description.trim());
  setCell('status', draft.status);
  setCell('priority', draft.priority);
  setCell('tags', draft.tags.trim());
  setCell('subtasks', draft.subtasks.trim());
  setCell('reminder', draft.reminder.trim());
  setCell('linkedPage', draft.linkedPage.trim());
  setCell('recurrence', draft.recurrence);
  setCell('adminComment', draft.adminComment.trim());
  return nextRow;
}

function taskPlanningRows(rows: string[][], columns: TableColumn[], members: ProjectMember[]) {
  return rows
    .map((row, rowIndex) => {
      const title = taskPlanningCell(row, columns, 'title').trim();
      const description = taskPlanningCell(row, columns, 'description').trim();
      const status = taskPlanningCell(row, columns, 'status') || 'Новая';
      const priority = taskPlanningCell(row, columns, 'priority') || 'Средний';
      const assigneeId = taskPlanningCell(row, columns, 'assigneeId');
      const deadline = taskPlanningCell(row, columns, 'deadline');
      const isImportant = taskPlanningCell(row, columns, 'isImportant') !== 'Нет';
      const isUrgent = taskPlanningCell(row, columns, 'isUrgent') !== 'Нет';
      const archivedAt = taskPlanningCell(row, columns, 'archivedAt');

      return {
        rowIndex,
        title,
        project: taskPlanningCell(row, columns, 'project'),
        assigneeId,
        assigneeName: assigneeId ? memberDisplayName(assigneeId, members) : '',
        deadline,
        deadlineTime: parseTableDate(deadline),
        isImportant,
        isUrgent,
        quadrantId: taskPlanningQuadrantId(isImportant, isUrgent),
        status,
        priority,
        description,
        isDone: status === 'Готово',
        isArchived: status === 'Архив' || Boolean(archivedAt),
      };
    })
    .filter((task) => task.title || task.description || task.deadline);
}

function formatLocalDateForTable(date: Date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function TaskPlanningToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-[12px] px-3 py-3 text-left text-sm font-bold active:scale-[0.98] ${
        checked
          ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
          : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
      }`}
    >
      {label}: {checked ? 'Да' : 'Нет'}
    </button>
  );
}

function AttendanceStatsView({
  columns,
  rows,
  onClose,
}: {
  columns: TableColumn[];
  rows: string[][];
  onClose: () => void;
}) {
  const dateColumns = columns
    .map((column, index) => ({ ...column, index }))
    .filter((column) => column.index > 0);
  const eventCount = dateColumns.length;
  const participants = rows
    .map((row) => {
      const name = row[0]?.trim() || 'Без имени';
      const visits = dateColumns.filter((column) => row[column.index] === 'true').length;
      const missed = Math.max(0, eventCount - visits);
      const rate = eventCount ? visits / eventCount : 0;
      return { name, visits, missed, rate };
    })
    .filter((item) => item.name !== 'Без имени' || item.visits > 0);
  const maxVisits = Math.max(1, ...dateColumns.map((column) => attendanceCount(rows, column.index)));
  const completedEventCounts = dateColumns
    .map((column) => attendanceCount(rows, column.index))
    .filter((count) => count > 0);
  const averageAttendance = completedEventCounts.length
    ? completedEventCounts.reduce((sum, count) => sum + count, 0) / completedEventCounts.length
    : 0;
  const firstCount = dateColumns.length ? attendanceCount(rows, dateColumns[0].index) : 0;
  const lastCount = dateColumns.length ? attendanceCount(rows, dateColumns[dateColumns.length - 1].index) : 0;
  const trend = lastCount > firstCount ? 'рост' : lastCount < firstCount ? 'снижение' : 'без изменений';
  const groups = [
    {
      title: 'Критичный',
      hint: 'ни разу не был',
      colorClass: 'border-red-500/35 bg-red-500/10 text-red-300',
      badgeClass: 'bg-red-500/20 text-red-200',
      people: participants.filter((item) => item.visits === 0),
    },
    {
      title: 'На грани',
      hint: 'был 1-2 раза за все время',
      colorClass: 'border-orange-500/35 bg-orange-500/10 text-orange-200',
      badgeClass: 'bg-orange-500/20 text-orange-100',
      people: participants.filter((item) => item.visits >= 1 && item.visits <= 2),
    },
    {
      title: 'Редкий',
      hint: 'ходит редко относительно количества встреч',
      colorClass: 'border-yellow-500/35 bg-yellow-500/10 text-yellow-100',
      badgeClass: 'bg-yellow-500/20 text-yellow-100',
      people: participants.filter((item) => item.visits > 2 && item.rate < 0.5),
    },
    {
      title: 'Стабильно',
      hint: 'практически всегда ходит',
      colorClass: 'border-sky-500/35 bg-sky-500/10 text-sky-100',
      badgeClass: 'bg-sky-500/20 text-sky-100',
      people: participants.filter((item) => item.rate >= 0.75 && item.rate < 1),
    },
    {
      title: 'Без пропусков',
      hint: 'ни разу не пропустил',
      colorClass: 'border-green-500/35 bg-green-500/10 text-green-100',
      badgeClass: 'bg-green-500/20 text-green-100',
      people: participants.filter((item) => eventCount > 0 && item.visits === eventCount),
    },
  ];

  return (
    <div className="fixed inset-0 z-[90] bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <div className="flex items-center gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3">
        <button onClick={onClose} className="h-9 w-9 text-xl text-[var(--tg-theme-link-color)]" aria-label="Назад">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold">Статистика посещаемости</h2>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">
            {participants.length} участников · {eventCount} мероприятий · тренд: {trend}
          </p>
        </div>
      </div>

      <div className="h-[calc(100%-65px)] overflow-y-auto px-4 py-4">
        <section className="mb-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">График по датам</h3>
            <span className="text-xs text-[var(--tg-theme-hint-color)]">присутствующих</span>
          </div>
          <div className="flex h-44 items-end gap-2 overflow-x-auto pb-2">
            {dateColumns.map((column) => {
              const count = attendanceCount(rows, column.index);
              const height = Math.max(8, Math.round((count / maxVisits) * 140));
              return (
                <div key={column.index} className="flex min-w-[54px] flex-col items-center gap-2">
                  <div className="flex h-36 items-end">
                    <div
                      className="w-8 rounded-t-[8px] bg-[var(--tg-theme-button-color)]"
                      style={{ height }}
                      title={`${count}`}
                    />
                  </div>
                  <span className="text-xs font-semibold">{count}</span>
                  <span className="max-w-[54px] truncate text-[10px] text-[var(--tg-theme-hint-color)]">
                    {column.title}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <p className="text-xl font-bold">{participants.length}</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">людей</p>
          </div>
          <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <p className="text-xl font-bold">{eventCount}</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">встреч</p>
          </div>
          <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <p className="text-xl font-bold">{lastCount}</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">последняя</p>
          </div>
          <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <p className="text-xl font-bold">{averageAttendance.toFixed(1)}</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">среднее</p>
          </div>
        </section>

        <div className="space-y-2 pb-6">
          {groups.map((group) => (
            <details key={group.title} className={`rounded-[12px] border p-3 ${group.colorClass}`}>
              <summary className="cursor-pointer list-none font-semibold">
                <span>{group.title}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${group.badgeClass}`}>
                  {group.people.length}
                </span>
              </summary>
              <div className="mt-3 space-y-2">
                {group.people.length === 0 ? (
                  <p className="text-sm text-[var(--tg-theme-hint-color)]">Список пуст</p>
                ) : (
                  group.people.map((person) => (
                    <div key={`${group.title}-${person.name}`} className="flex items-center justify-between rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm">
                      <span className="truncate">{person.name}</span>
                      <span className="shrink-0 text-xs text-[var(--tg-theme-hint-color)]">
                        {person.visits}/{eventCount}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function TableCellInput({
  value,
  type,
  column,
  options,
  members,
  onEnter,
  onPaste,
  onLongPress,
  onChange,
}: {
  value: string;
  type: TableColumnType;
  column?: TableColumn;
  options?: string[];
  members: ProjectMember[];
  onEnter?: () => void;
  onPaste?: (text: string) => boolean;
  onLongPress?: (x: number, y: number) => void;
  onChange: (value: string) => void;
}) {
  const longPressTimer = useRef<number | null>(null);
  const startLongPress = (x: number, y: number) => {
    if (!onLongPress) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => onLongPress(x, y), 550);
  };
  const cancelLongPress = () => {
    if (!longPressTimer.current) return;
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  if (type === 'checkbox') {
    return (
      <button
        onClick={() => onChange(value === 'true' ? '' : 'true')}
        onTouchStart={(event) => startLongPress(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onMouseDown={(event) => startLongPress(event.clientX, event.clientY)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        className={`h-5 w-5 rounded-md border-2 flex items-center justify-center ${
          value === 'true'
            ? 'border-green-500 bg-green-500 text-white'
            : 'border-[var(--tg-theme-hint-color)]'
        }`}
      >
        {value === 'true' ? '✓' : ''}
      </button>
    );
  }

  if (type === 'person') {
    return (
      <TablePersonCell
        value={value}
        column={column}
        members={members}
        onChange={onChange}
        onLongPress={onLongPress}
      />
    );
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs outline-none"
      >
        <option value="">Не выбран</option>
        {members.map((member) => {
          const id = String(member.userId);
          const label = member.user?.firstName || member.user?.username || `User ${id}`;
          return (
            <option key={id} value={id}>
              {label}
            </option>
          );
        })}
      </select>
    );
  }

  if (type === 'status') {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-full px-2 py-1 text-xs font-semibold outline-none ${tableBadgeClass(value, 'status')}`}
      >
        <option value="">Без статуса</option>
        {STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (type === 'priority') {
    return (
      <TableOptionCell
        value={value}
        emptyLabel="Без приоритета"
        options={PRIORITY_OPTIONS}
        kind="priority"
        onChange={onChange}
        onLongPress={onLongPress}
      />
    );
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-full px-2 py-1 text-xs font-semibold outline-none ${tableBadgeClass(value, 'priority')}`}
      >
        <option value="">Без приоритета</option>
        {PRIORITY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (type === 'tags') {
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return (
      <div className="space-y-1">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[var(--tg-theme-button-color)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--tg-theme-link-color)]">
                {tag}
              </span>
            ))}
          </div>
        )}
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="tag, team"
          className="w-full bg-transparent text-xs outline-none"
        />
      </div>
    );
  }

  if (type === 'select') {
    if (options?.length) {
      return (
        <TableSelectCell
          value={value}
          column={column}
          options={options}
          onChange={onChange}
          onLongPress={onLongPress}
        />
      );
      const color = getSelectOptionColor(column, value);
      return (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-full px-2 py-1 text-xs font-semibold outline-none"
          style={color ? { backgroundColor: `${color}26`, color } : undefined}
        >
          <option value="">Не выбрано</option>
          {options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Option"
        className="w-full rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs outline-none"
      />
    );
  }

  return (
    <input
      type="text"
      inputMode={type === 'date' ? 'numeric' : type === 'number' || type === 'money' ? 'decimal' : undefined}
      value={value}
      onChange={(event) => {
        if (type === 'date') {
          onChange(formatTableDateInput(event.target.value));
          return;
        }
        if (type === 'number' || type === 'money') {
          onChange(normalizeNumericInput(event.target.value, type === 'money'));
          return;
        }
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onEnter?.();
        }
      }}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text');
        if (onPaste?.(text)) event.preventDefault();
      }}
      onTouchStart={(event) => startLongPress(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0)}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onMouseDown={(event) => startLongPress(event.clientX, event.clientY)}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      className={`w-full bg-transparent outline-none ${type === 'money' ? 'text-right tabular-nums' : ''}`}
      placeholder={type === 'date' ? 'дд-мм-гггг' : undefined}
    />
  );
}

function TableSelectCell({
  value,
  column,
  options,
  onChange,
  onLongPress,
}: {
  value: string;
  column?: TableColumn;
  options: string[];
  onChange: (value: string) => void;
  onLongPress?: (x: number, y: number) => void;
}) {
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const color = getSelectOptionColor(column, value);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuRect({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 280)),
      width: Math.max(rect.width, 220),
    });
  };
  const startLongPress = (x: number, y: number) => {
    if (!onLongPress) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => onLongPress(x, y), 550);
  };
  const cancelLongPress = () => {
    if (!longPressTimer.current) return;
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openMenu}
        onTouchStart={(event) => startLongPress(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onMouseDown={(event) => startLongPress(event.clientX, event.clientY)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        className="w-full truncate rounded-full px-2 py-1 text-left text-xs font-semibold outline-none"
        style={color ? { backgroundColor: `${color}26`, color } : { backgroundColor: '#E5E7EB', color: '#111827' }}
      >
        {value || 'Не выбрано'}
      </button>
      {menuRect && (
        <div className="fixed inset-0 z-[96]" onClick={() => setMenuRect(null)}>
          <div
            className="absolute max-h-64 overflow-y-auto rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-2 shadow-2xl"
            style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onChange('');
                setMenuRect(null);
              }}
              className="mb-1 block w-full rounded-[10px] bg-[#E5E7EB] px-3 py-2 text-left text-xs font-semibold text-[#111827] active:scale-[0.99]"
            >
              Не выбрано
            </button>
            {options.map((option) => {
              const optionColor = getSelectOptionColor(column, option) ?? SELECT_OPTION_COLORS[0];
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setMenuRect(null);
                  }}
                  className="mb-1 block w-full truncate rounded-full px-3 py-2 text-left text-xs font-semibold active:scale-[0.99]"
                  style={{ backgroundColor: `${optionColor}26`, color: optionColor }}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function TablePersonCell({
  value,
  column,
  members,
  onChange,
  onLongPress,
}: {
  value: string;
  column?: TableColumn;
  members: ProjectMember[];
  onChange: (value: string) => void;
  onLongPress?: (x: number, y: number) => void;
}) {
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const resolvedValue = resolvePersonCellValue(value, members);
  const color = getPersonColor(column, resolvedValue || value, members);
  const primaryLabel = resolvedValue ? memberTelegramLabel(resolvedValue, members) : value ? String(value) : 'Не выбран';
  const secondaryLabel = resolvedValue ? memberFullName(resolvedValue, members) : '';

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuRect({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 280)),
      width: Math.max(rect.width, 220),
    });
  };
  const startLongPress = (x: number, y: number) => {
    if (!onLongPress) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => onLongPress(x, y), 550);
  };
  const cancelLongPress = () => {
    if (!longPressTimer.current) return;
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openMenu}
        onTouchStart={(event) => startLongPress(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onMouseDown={(event) => startLongPress(event.clientX, event.clientY)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        className="w-full rounded-[12px] px-2 py-1 text-left text-xs font-semibold outline-none"
        style={color ? { backgroundColor: `${color}26`, color } : { backgroundColor: '#E5E7EB', color: '#111827' }}
      >
        <span className="block truncate">{primaryLabel}</span>
        {secondaryLabel && secondaryLabel !== primaryLabel && (
          <span className="block truncate text-[10px] font-medium opacity-75">{secondaryLabel}</span>
        )}
      </button>
      {menuRect && (
        <div className="fixed inset-0 z-[96]" onClick={() => setMenuRect(null)}>
          <div
            className="absolute max-h-64 overflow-y-auto rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-2 shadow-2xl"
            style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onChange('');
                setMenuRect(null);
              }}
              className="mb-1 block w-full rounded-full bg-[#E5E7EB] px-3 py-2 text-left text-xs font-semibold text-[#111827] active:scale-[0.99]"
            >
              Не выбран
            </button>
            {members.map((member, index) => {
              const id = String(member.userId);
              const memberColor = getPersonColor(column, id, members) ?? SELECT_OPTION_COLORS[index % SELECT_OPTION_COLORS.length];
              const primary = memberTelegramLabel(id, members);
              const fullName = memberFullName(id, members);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onChange(id);
                    setMenuRect(null);
                  }}
                  className="mb-1 block w-full rounded-[12px] px-3 py-2 text-left text-xs font-semibold active:scale-[0.99]"
                  style={{ backgroundColor: `${memberColor}26`, color: memberColor }}
                >
                  <span className="block truncate">
                    {primary}
                    {fullName && fullName !== primary ? <span className="font-medium opacity-80"> ({fullName})</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function TableOptionCell({
  value,
  emptyLabel,
  options,
  kind,
  onChange,
  onLongPress,
}: {
  value: string;
  emptyLabel: string;
  options: string[];
  kind: 'status' | 'priority';
  onChange: (value: string) => void;
  onLongPress?: (x: number, y: number) => void;
}) {
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimer = useRef<number | null>(null);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuRect({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 280)),
      width: Math.max(rect.width, 220),
    });
  };
  const startLongPress = (x: number, y: number) => {
    if (!onLongPress) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => onLongPress(x, y), 550);
  };
  const cancelLongPress = () => {
    if (!longPressTimer.current) return;
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openMenu}
        onTouchStart={(event) => startLongPress(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onMouseDown={(event) => startLongPress(event.clientX, event.clientY)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        className={`w-full truncate rounded-full px-2 py-1 text-left text-xs font-semibold outline-none ${tableBadgeClass(value, kind)}`}
      >
        {value || emptyLabel}
      </button>
      {menuRect && (
        <div className="fixed inset-0 z-[96]" onClick={() => setMenuRect(null)}>
          <div
            className="absolute max-h-64 overflow-y-auto rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-2 shadow-2xl"
            style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onChange('');
                setMenuRect(null);
              }}
              className="mb-1 block w-full rounded-full bg-[#E5E7EB] px-3 py-2 text-left text-xs font-semibold text-[#111827] active:scale-[0.99]"
            >
              {emptyLabel}
            </button>
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setMenuRect(null);
                }}
                className={`mb-1 block w-full truncate rounded-full px-3 py-2 text-left text-xs font-semibold active:scale-[0.99] ${tableBadgeClass(option, kind)}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function tableBadgeClass(value: string, kind: 'status' | 'priority') {
  if (!value) return 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-hint-color)]';
  if (kind === 'status') {
    if (value === 'Готово') return 'bg-green-500/15 text-green-300';
    if (value === 'В работе') return 'bg-blue-500/15 text-blue-300';
    if (value === 'На паузе') return 'bg-yellow-500/15 text-yellow-200';
    if (value === 'Не начато') return 'bg-slate-500/15 text-slate-200';
    if (value === 'Готово') return 'bg-green-500/15 text-green-300';
    if (value === 'В работе') return 'bg-blue-500/15 text-blue-300';
    if (value === 'На паузе') return 'bg-yellow-500/15 text-yellow-200';
    return 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]';
  }
  if (value === 'Критичный') return 'bg-red-500/15 text-red-300';
  if (value === 'Высокий') return 'bg-orange-500/15 text-orange-200';
  if (value === 'Средний') return 'bg-yellow-500/15 text-yellow-200';
  if (value === 'Низкий') return 'bg-green-500/15 text-green-300';
  if (value === 'Критичный') return 'bg-red-500/15 text-red-300';
  if (value === 'Высокий') return 'bg-orange-500/15 text-orange-200';
  if (value === 'Средний') return 'bg-yellow-500/15 text-yellow-200';
  return 'bg-green-500/15 text-green-300';
}

function formatTableDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join('-');
}

function normalizeNumericInput(value: string, allowDecimal: boolean) {
  const normalized = value.replace(',', '.').replace(/[^\d.-]/g, '');
  if (!allowDecimal) return normalized.replace(/\./g, '');
  const [integer, ...rest] = normalized.split('.');
  return rest.length ? `${integer}.${rest.join('').slice(0, 2)}` : integer;
}

function isInteractiveElement(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, button, label'));
}

function getSelectOptionColor(column: TableColumn | undefined, value: string) {
  if (!column || !value) return undefined;
  const savedColor = column.optionColors?.[value];
  if (savedColor) return savedColor;
  const optionIndex = column.options?.findIndex((option) => option === value) ?? -1;
  return optionIndex >= 0 ? SELECT_OPTION_COLORS[optionIndex % SELECT_OPTION_COLORS.length] : undefined;
}

function getPersonColor(column: TableColumn | undefined, value: string, members: ProjectMember[]) {
  if (!value) return undefined;
  const savedColor = column?.personColors?.[value];
  if (savedColor) return savedColor;
  const memberIndex = members.findIndex((member) => String(member.userId) === String(value));
  return memberIndex >= 0 ? SELECT_OPTION_COLORS[memberIndex % SELECT_OPTION_COLORS.length] : undefined;
}

function SelectOptionsModal({
  column,
  onChange,
  onClose,
}: {
  column: TableColumn;
  onChange: (column: TableColumn) => void;
  onClose: () => void;
}) {
  const options = column.options ?? [];
  const colors = column.optionColors ?? {};
  const addOption = () => {
    const title = `Вариант ${options.length + 1}`;
    onChange({
      ...column,
      options: [...options, title],
      optionColors: { ...colors, [title]: SELECT_OPTION_COLORS[options.length % SELECT_OPTION_COLORS.length] },
    });
  };
  const renameOption = (index: number, title: string) => {
    const previous = options[index];
    const nextOptions = options.map((option, optionIndex) => (optionIndex === index ? title : option));
    const nextColors = { ...colors };
    if (previous !== title) {
      nextColors[title] = nextColors[previous] ?? SELECT_OPTION_COLORS[index % SELECT_OPTION_COLORS.length];
      delete nextColors[previous];
    }
    onChange({ ...column, options: nextOptions, optionColors: nextColors });
  };
  const removeOption = (index: number) => {
    const previous = options[index];
    const nextColors = { ...colors };
    delete nextColors[previous];
    onChange({
      ...column,
      options: options.filter((_, optionIndex) => optionIndex !== index),
      optionColors: nextColors,
    });
  };

  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onClose}>
      <div className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">Варианты select</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{column.title}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">×</button>
        </div>
        <div className="space-y-2">
          {options.map((option, index) => (
            <div key={index} className="grid grid-cols-[44px_1fr_40px] items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-2">
              <input
                type="color"
                value={colors[option] ?? SELECT_OPTION_COLORS[index % SELECT_OPTION_COLORS.length]}
                onChange={(event) => onChange({ ...column, optionColors: { ...colors, [option]: event.target.value } })}
                className="h-9 w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] p-1"
              />
              <input
                value={option}
                onChange={(event) => renameOption(index, event.target.value)}
                className="min-w-0 rounded-[9px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
              />
              <button
                onClick={() => removeOption(index)}
                className="h-9 rounded-[9px] bg-red-500/15 text-sm font-bold text-red-300"
                aria-label="Удалить вариант"
              >
                ×
              </button>
            </div>
          ))}
          {options.length === 0 && (
            <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-6 text-center text-sm text-[var(--tg-theme-hint-color)]">
              Вариантов пока нет
            </div>
          )}
          <button
            onClick={addOption}
            className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)]"
          >
            + Добавить вариант
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonColorsModal({
  column,
  members,
  onChange,
  onClose,
}: {
  column: TableColumn;
  members: ProjectMember[];
  onChange: (column: TableColumn) => void;
  onClose: () => void;
}) {
  const colors = normalizePersonColors(members, column.personColors);
  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onClose}>
      <div className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">Цвета пользователей</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{column.title}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">×</button>
        </div>
        <div className="space-y-2">
          {members.map((member) => {
            const id = String(member.userId);
            return (
              <div key={id} className="grid grid-cols-[44px_1fr] items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-2">
                <input
                  type="color"
                  value={colors[id]}
                  onChange={(event) => onChange({ ...column, personColors: { ...colors, [id]: event.target.value } })}
                  className="h-9 w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] p-1"
                />
                <div className="min-w-0 rounded-[9px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm font-semibold" style={{ color: colors[id] }}>
                  {memberDisplayName(id, members)}
                </div>
              </div>
            );
          })}
          {members.length === 0 && (
            <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-6 text-center text-sm text-[var(--tg-theme-hint-color)]">
              Участников пока нет
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TableFilterModal({
  column,
  members,
  onApply,
  onClear,
  onClose,
}: {
  column: TableColumn;
  members: ProjectMember[];
  onApply: (operator: string, value: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const initialOperator = defaultFilterOperator(column.type);
  const [operator, setOperator] = useState(initialOperator);
  const [value, setValue] = useState('');
  const choices = tableFilterChoices(column, members);
  const needsValue = !['today', 'week', 'checked', 'unchecked'].includes(operator);

  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">Фильтр столбца</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{column.title}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">×</button>
        </div>
        <div className="space-y-3">
          <select
            value={operator}
            onChange={(event) => setOperator(event.target.value)}
            className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
          >
            {filterOperatorsForType(column.type).map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          {needsValue && choices.length > 0 ? (
            <select
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
            >
              <option value="">Выберите значение</option>
              {choices.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          ) : needsValue ? (
            <input
              value={value}
              onChange={(event) => setValue(column.type === 'date' ? formatTableDateInput(event.target.value) : event.target.value)}
              inputMode={column.type === 'date' ? 'numeric' : column.type === 'number' || column.type === 'money' ? 'decimal' : undefined}
              placeholder={column.type === 'date' ? 'дд-мм-гггг' : 'Значение фильтра'}
              className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
            />
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onClear}
              className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
            >
              Сбросить
            </button>
            <button
              onClick={() => onApply(operator, value)}
              className="rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] active:scale-[0.98]"
            >
              Применить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TableTemplatesModal({
  onSelect,
  onClose,
}: {
  onSelect: (template: TableTemplate) => void;
  onClose: () => void;
}) {
  const templates = tableTemplates();
  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onClose}>
      <div className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">Шаблоны таблиц</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">×</button>
        </div>
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.title}
              onClick={() => onSelect(template)}
              className="block w-full rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left active:scale-[0.99]"
            >
              <span className="block text-sm font-bold text-[var(--tg-theme-text-color)]">{template.title}</span>
              <span className="mt-1 block text-xs text-[var(--tg-theme-hint-color)]">
                {template.columns.map((column) => column.title).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type FinanceTab = 'common' | 'income' | 'expense' | 'summary';

type FinancePeriodRange = {
  from: string;
  to: string;
};

type FinanceChartMode = 'month' | 'week';

type FinanceSeriesVisibility = {
  income: boolean;
  expense: boolean;
  balance: boolean;
};

type FinancePeriodBucket = {
  key: string;
  label: string;
  income: number;
  expense: number;
  balance: number;
};

type FinancePieItem = {
  label: string;
  value: number;
  color: string;
};

const FINANCE_CHART_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6', '#64748B', '#84CC16'];

function FinanceDashboard({
  rows,
  columns,
  activeTab,
  periodRange,
  onTabChange,
  onPeriodRangeChange,
}: {
  rows: string[][];
  columns: TableColumn[];
  activeTab: FinanceTab;
  periodRange: FinancePeriodRange;
  onTabChange: (tab: FinanceTab) => void;
  onPeriodRangeChange: (range: FinancePeriodRange) => void;
}) {
  const [chartMode, setChartMode] = useState<FinanceChartMode>('month');
  const [visibleSeries, setVisibleSeries] = useState<FinanceSeriesVisibility>({ income: true, expense: true, balance: true });
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const entries = useMemo(() => getFinanceEntries(rows, columns), [rows, columns]);
  const filteredEntries = filterFinanceEntriesByDateRange(entries, periodRange);
  const incomeOneTime = sumFinanceEntries(filteredEntries.filter((entry) => entry.type === 'Доход' && normalizeFinanceIncomeKind(entry.subcategory) === 'Разовый'));
  const incomeRegular = sumFinanceEntries(filteredEntries.filter((entry) => entry.type === 'Доход' && normalizeFinanceIncomeKind(entry.subcategory) === 'Регулярный'));
  const incomeTotal = sumFinanceEntries(filteredEntries.filter((entry) => entry.type === 'Доход'));
  const expenseTotal = sumFinanceEntries(filteredEntries.filter((entry) => entry.type === 'Расход'));
  const balance = incomeTotal - expenseTotal;
  const expenseByProject = groupFinanceByProject(filteredEntries.filter((entry) => entry.type === 'Расход'));
  const summaryByProject = buildFinanceSummaryRows(filteredEntries);
  const incomeRowsCount = filteredEntries.filter((entry) => entry.type === 'Доход').length;
  const expenseRowsCount = filteredEntries.filter((entry) => entry.type === 'Расход').length;
  const periodBuckets = useMemo(() => buildFinancePeriodBuckets(filteredEntries, chartMode), [filteredEntries, chartMode]);
  const incomeByKind = buildFinanceIncomeKindBreakdown(filteredEntries);
  const insights = buildFinanceSmartInsights({
    incomeTotal,
    expenseTotal,
    balance,
    incomeRegular,
    incomeOneTime,
    expenseByProject,
    periodBuckets,
  });

  return (
    <section className="rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--tg-theme-text-color)]">Финансы</p>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">Доходы, расходы и баланс по общей таблице.</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        {([
          { id: 'common', label: 'Общая', className: 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' },
          { id: 'income', label: 'Доход', className: 'bg-green-500 text-white' },
          { id: 'expense', label: 'Расход', className: 'bg-red-500 text-white' },
          { id: 'summary', label: 'Сводная', className: 'bg-yellow-400 text-slate-950' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`rounded-[11px] px-2 py-2 text-xs font-bold active:scale-[0.98] ${
              activeTab === tab.id ? tab.className : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2">
        <FinanceMetricCard label="Доход" value={formatMoneyRub(incomeTotal)} tone="green" />
        <FinanceMetricCard label="Расход" value={formatMoneyRub(expenseTotal)} tone="red" />
        <FinanceMetricCard label="Баланс" value={formatMoneyRub(balance)} tone={balance >= 0 ? 'green' : 'red'} />
        <FinancePeriodPicker range={periodRange} onChange={onPeriodRangeChange} />
      </div>

      <button
        type="button"
        onClick={() => setAnalyticsOpen(true)}
        className="mb-3 flex w-full items-center justify-between rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-left active:scale-[0.99]"
      >
        <span>
          <span className="block text-sm font-bold text-[var(--tg-theme-text-color)]">📊 Аналитика и графики</span>
          <span className="mt-1 block text-xs text-[var(--tg-theme-hint-color)]">Открыть диаграммы, динамику и умный анализ</span>
        </span>
        <span className="text-lg text-[var(--tg-theme-hint-color)]">›</span>
      </button>

      {analyticsOpen && (
        <FinanceAnalyticsModal onClose={() => setAnalyticsOpen(false)}>
          <FinanceAnalyticsPanel
            buckets={periodBuckets}
            chartMode={chartMode}
            onChartModeChange={setChartMode}
            visibleSeries={visibleSeries}
            onVisibleSeriesChange={setVisibleSeries}
            periodRange={periodRange}
            onPeriodRangeChange={onPeriodRangeChange}
            incomeItems={incomeByKind}
            expenseItems={expenseByProject.map((item, index) => ({
              label: item.project,
              value: item.amount,
              color: FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length],
            }))}
            insights={insights}
          />
        </FinanceAnalyticsModal>
      )}

      {activeTab === 'income' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <FinanceMetricCard label="Регулярные" value={formatMoneyRub(incomeRegular)} tone="green" compact />
            <FinanceMetricCard label="Разовые" value={formatMoneyRub(incomeOneTime)} tone="green" compact />
          </div>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">Ниже показан только список доходов: {incomeRowsCount}</p>
        </div>
      )}

      {activeTab === 'expense' && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--tg-theme-hint-color)]">Ниже показан только список расходов: {expenseRowsCount}</p>
          <div className="space-y-1">
            {expenseByProject.map((item) => (
              <div key={item.project} className="flex items-center justify-between rounded-[10px] bg-red-500/10 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-[var(--tg-theme-text-color)]">{item.project}</span>
                <span className="shrink-0 font-bold text-red-300">{formatMoneyRub(item.amount)}</span>
              </div>
            ))}
            {expenseByProject.length === 0 && <FinanceEmptyState />}
          </div>
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-[12px] border border-[var(--tg-theme-bg-color)]">
            <table className="w-full min-w-[420px] text-xs text-[var(--tg-theme-text-color)]">
              <thead>
                <tr className="bg-[var(--tg-theme-bg-color)] text-left">
                  <th className="p-2">Проект</th>
                  <th className="p-2 text-right text-green-300">Доход</th>
                  <th className="p-2 text-right text-red-300">Расход</th>
                  <th className="p-2 text-right text-yellow-300">Общий итог</th>
                </tr>
              </thead>
              <tbody>
                {summaryByProject.map((item) => (
                  <tr key={item.project} className={item.total >= 0 ? 'bg-green-500/5' : 'bg-red-500/5'}>
                    <td className="p-2 font-semibold">{item.project}</td>
                    <td className="p-2 text-right text-green-300">{formatMoneyRub(item.income)}</td>
                    <td className="p-2 text-right text-red-300">{formatMoneyRub(item.expense)}</td>
                    <td className={`p-2 text-right font-bold ${item.total >= 0 ? 'text-green-300' : 'text-red-300'}`}>{formatMoneyRub(item.total)}</td>
                  </tr>
                ))}
                {summaryByProject.length === 0 && (
                  <tr><td className="p-3 text-center text-[var(--tg-theme-hint-color)]" colSpan={4}>Нет финансовых строк</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--tg-theme-bg-color)] font-bold">
                  <td className="p-2">Итого</td>
                  <td className="p-2 text-right text-green-300">{formatMoneyRub(incomeTotal)}</td>
                  <td className="p-2 text-right text-red-300">{formatMoneyRub(expenseTotal)}</td>
                  <td className={`p-2 text-right ${balance >= 0 ? 'text-green-300' : 'text-red-300'}`}>{formatMoneyRub(balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function FinanceMetricCard({ label, value, tone, compact = false }: { label: string; value: string; tone: 'green' | 'red'; compact?: boolean }) {
  const toneClass = tone === 'green' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300';
  return (
    <div className={`rounded-[12px] px-3 ${compact ? 'py-2' : 'py-3'} ${toneClass}`}>
      <p className={compact ? 'text-[11px] opacity-80' : 'text-xs opacity-80'}>{label}</p>
      <p className={`mt-1 font-bold ${compact ? 'text-sm' : 'text-base'}`}>{value}</p>
    </div>
  );
}

function FinancePeriodPicker({
  range,
  onChange,
}: {
  range: FinancePeriodRange;
  onChange: (range: FinancePeriodRange) => void;
}) {
  const label = financeDateRangeLabel(range);

  return (
    <details className="relative h-10 w-10">
      <summary
        className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-[10px] bg-[var(--tg-theme-button-color)] text-base text-[var(--tg-theme-button-text-color)] active:scale-[0.96] [&::-webkit-details-marker]:hidden"
        title={`Период: ${label}`}
        aria-label={`Период: ${label}`}
      >
        📅
      </summary>
      <div className="absolute right-0 top-11 z-40 w-64 rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] p-3 shadow-xl">
        <p className="mb-2 text-sm font-bold text-[var(--tg-theme-text-color)]">Период</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">
            С
            <input
              type="date"
              value={range.from}
              onChange={(event) => onChange({ ...range, from: event.target.value })}
              className="mt-1 w-full rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
            />
          </label>
          <label className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">
            По
            <input
              type="date"
              value={range.to}
              onChange={(event) => onChange({ ...range, to: event.target.value })}
              className="mt-1 w-full rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-[var(--tg-theme-hint-color)]">{label}</span>
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            className="shrink-0 rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-bold text-[var(--tg-theme-text-color)] active:scale-[0.98]"
          >
            Сброс
          </button>
        </div>
      </div>
    </details>
  );
}

function FinanceAnalyticsPanel({
  buckets,
  chartMode,
  onChartModeChange,
  visibleSeries,
  onVisibleSeriesChange,
  periodRange,
  onPeriodRangeChange,
  incomeItems,
  expenseItems,
  insights,
}: {
  buckets: FinancePeriodBucket[];
  chartMode: FinanceChartMode;
  onChartModeChange: (mode: FinanceChartMode) => void;
  visibleSeries: FinanceSeriesVisibility;
  onVisibleSeriesChange: (next: FinanceSeriesVisibility) => void;
  periodRange: FinancePeriodRange;
  onPeriodRangeChange: (range: FinancePeriodRange) => void;
  incomeItems: FinancePieItem[];
  expenseItems: FinancePieItem[];
  insights: string[];
}) {
  const seriesOptions: Array<{ id: keyof FinanceSeriesVisibility; label: string; color: string }> = [
    { id: 'income', label: 'Доход', color: 'bg-green-500' },
    { id: 'expense', label: 'Расход', color: 'bg-red-500' },
    { id: 'balance', label: 'Баланс', color: 'bg-yellow-400' },
  ];

  return (
    <div className="space-y-3 rounded-[14px] bg-[var(--tg-theme-bg-color)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--tg-theme-text-color)]">Аналитика</p>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">Графики считаются по строкам общей таблицы.</p>
        </div>
        <div className="flex items-center gap-2">
          <FinancePeriodPicker range={periodRange} onChange={onPeriodRangeChange} />
          <div className="flex rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-1">
            {([
              { id: 'month', label: 'Месяцы' },
              { id: 'week', label: 'Недели' },
            ] as const).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChartModeChange(mode.id)}
                className={`rounded-[8px] px-3 py-1.5 text-xs font-bold active:scale-[0.98] ${
                  chartMode === mode.id
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'text-[var(--tg-theme-hint-color)]'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {seriesOptions.map((option) => (
          <FinanceSeriesToggle
            key={option.id}
            label={option.label}
            colorClass={option.color}
            active={visibleSeries[option.id]}
            onClick={() => onVisibleSeriesChange({ ...visibleSeries, [option.id]: !visibleSeries[option.id] })}
          />
        ))}
      </div>

      <FinanceBarChart buckets={buckets} visibleSeries={visibleSeries} />

      <div className="grid gap-3 sm:grid-cols-2">
        <FinancePieChart title="Доходы" subtitle="по типу дохода" items={incomeItems} />
        <FinancePieChart title="Расходы" subtitle="по проектам" items={expenseItems} />
      </div>

      <div className="rounded-[12px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)] p-3">
        <p className="mb-2 text-sm font-bold text-[var(--tg-theme-text-color)]">Умный анализ</p>
        <div className="space-y-2">
          {insights.map((insight, index) => (
            <p key={`${index}-${insight}`} className="text-xs leading-relaxed text-[var(--tg-theme-hint-color)]">
              {insight}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function FinanceAnalyticsModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/55 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[18px] bg-[var(--tg-theme-secondary-bg-color)] p-3 shadow-2xl sm:mx-auto sm:max-w-3xl sm:rounded-[18px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-base font-bold text-[var(--tg-theme-text-color)]">Финансовая аналитика</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Графики, период и подсказки</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--tg-theme-bg-color)] text-xl font-bold text-[var(--tg-theme-hint-color)] active:scale-[0.96]"
            aria-label="Закрыть аналитику"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FinanceSeriesToggle({
  label,
  colorClass,
  active,
  onClick,
}: {
  label: string;
  colorClass: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold active:scale-[0.98] ${
        active
          ? 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
          : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-hint-color)] opacity-60'
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
      {label}
    </button>
  );
}

function FinanceBarChart({ buckets, visibleSeries }: { buckets: FinancePeriodBucket[]; visibleSeries: FinanceSeriesVisibility }) {
  const activeSeries = ([
    { id: 'income', label: 'Доход', colorClass: 'bg-green-500', textClass: 'text-green-300' },
    { id: 'expense', label: 'Расход', colorClass: 'bg-red-500', textClass: 'text-red-300' },
    { id: 'balance', label: 'Баланс', colorClass: 'bg-yellow-400', textClass: 'text-yellow-300' },
  ] as const).filter((series) => visibleSeries[series.id]);
  const maxValue = Math.max(
    1,
    ...buckets.flatMap((bucket) =>
      activeSeries.map((series) => Math.abs(bucket[series.id]))
    )
  );

  if (activeSeries.length === 0) {
    return (
      <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-8 text-center text-xs text-[var(--tg-theme-hint-color)]">
        Включите хотя бы один показатель для графика.
      </div>
    );
  }

  if (buckets.length === 0) {
    return <FinanceEmptyState />;
  }

  return (
    <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-[var(--tg-theme-text-color)]">Динамика по периодам</p>
        <span className="text-xs text-[var(--tg-theme-hint-color)]">столбцы можно скрывать</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-h-[188px] min-w-max items-end gap-3">
          {buckets.map((bucket) => (
            <div key={bucket.key} className="flex w-[112px] shrink-0 flex-col items-center">
              <div className="flex h-40 items-end gap-1.5">
                {activeSeries.map((series) => {
                  const value = bucket[series.id];
                  const height = Math.max(4, Math.round((Math.abs(value) / maxValue) * 118));
                  return (
                    <div key={series.id} className="flex w-8 flex-col items-center justify-end gap-1">
                      <span
                        className={`h-4 w-10 truncate text-center text-[9px] font-bold leading-4 ${series.textClass}`}
                        title={`${series.label}: ${formatMoneyRub(value)}`}
                      >
                        {formatMoneyCompact(value)}
                      </span>
                      <div
                        className={`w-5 rounded-t-[5px] ${series.colorClass} ${value === 0 ? 'opacity-30' : ''}`}
                        style={{ height }}
                        title={`${series.label}: ${formatMoneyRub(value)}`}
                      />
                    </div>
                  );
                })}
              </div>
              <span className="mt-2 w-full truncate text-center text-[10px] text-[var(--tg-theme-hint-color)]">{bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FinancePieChart({ title, subtitle, items }: { title: string; subtitle: string; items: FinancePieItem[] }) {
  const visibleItems = items.filter((item) => item.value > 0);
  const total = visibleItems.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const gradient = visibleItems
    .map((item) => {
      const start = cursor;
      const size = (item.value / total) * 100;
      cursor += size;
      return `${item.color} ${start}% ${cursor}%`;
    })
    .join(', ');

  return (
    <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--tg-theme-text-color)]">{title}</p>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">{subtitle}</p>
        </div>
        <span className="text-xs font-bold text-[var(--tg-theme-text-color)]">{formatMoneyCompact(total)}</span>
      </div>
      {total > 0 ? (
        <div className="flex items-center gap-3">
          <div
            className="h-24 w-24 shrink-0 rounded-full"
            style={{ background: `conic-gradient(${gradient})` }}
            aria-label={`${title}: ${formatMoneyRub(total)}`}
          />
          <div className="min-w-0 flex-1 space-y-1">
            {visibleItems.map((item) => {
              const percent = Math.round((item.value / total) * 100);
              return (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="min-w-0 flex-1 truncate text-[var(--tg-theme-text-color)]">{item.label}</span>
                  <span className="shrink-0 font-bold text-[var(--tg-theme-hint-color)]">{percent}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <FinanceEmptyState />
      )}
    </div>
  );
}

function FinanceEmptyState() {
  return (
    <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-center text-xs text-[var(--tg-theme-hint-color)]">
      Данных пока нет
    </div>
  );
}

function defaultFilterOperator(type: TableColumnType) {
  if (type === 'number' || type === 'money') return 'equals';
  if (type === 'date') return 'after';
  if (type === 'checkbox') return 'checked';
  if (['person', 'status', 'priority', 'select'].includes(type)) return 'equals';
  return 'contains';
}

function filterOperatorsForType(type: TableColumnType) {
  if (type === 'number' || type === 'money') {
    return [
      { value: 'equals', label: 'равно' },
      { value: 'gt', label: 'больше' },
      { value: 'lt', label: 'меньше' },
    ];
  }
  if (type === 'date') {
    return [
      { value: 'after', label: 'после' },
      { value: 'before', label: 'до' },
      { value: 'today', label: 'сегодня' },
      { value: 'week', label: 'на этой неделе' },
    ];
  }
  if (type === 'checkbox') {
    return [
      { value: 'checked', label: 'отмечено' },
      { value: 'unchecked', label: 'не отмечено' },
    ];
  }
  if (['person', 'status', 'priority', 'select'].includes(type)) {
    return [{ value: 'equals', label: 'выбранное значение' }];
  }
  return [
    { value: 'contains', label: 'содержит' },
    { value: 'not_contains', label: 'не содержит' },
  ];
}

function tableFilterChoices(column: TableColumn, members: ProjectMember[]) {
  if (column.type === 'status') return STATUS_OPTIONS.map((option) => ({ value: option, label: option }));
  if (column.type === 'priority') return PRIORITY_OPTIONS.map((option) => ({ value: option, label: option }));
  if (column.type === 'select') return (column.options ?? []).map((option) => ({ value: option, label: option }));
  if (column.type === 'person') {
    return members.map((member) => {
      const value = String(member.userId);
      return { value, label: memberDisplayName(value, members) };
    });
  }
  return [];
}

function getTableFillRange(fillDrag: TableFillDrag, visibleRowPositionByIndex: Map<number, number>) {
  const sourcePosition = visibleRowPositionByIndex.get(fillDrag.rowIndex);
  const targetPosition = visibleRowPositionByIndex.get(fillDrag.targetRowIndex);
  if (sourcePosition === undefined || targetPosition === undefined) return null;
  return {
    from: Math.min(sourcePosition, targetPosition),
    to: Math.max(sourcePosition, targetPosition),
  };
}

type FinanceEntry = {
  month: string;
  type: 'Доход' | 'Расход' | '';
  project: string;
  subcategory: string;
  amount: number;
};

function getFinanceEntries(rows: string[][], columns: TableColumn[]): FinanceEntry[] {
  const monthIndex = financeColumnIndex(columns, 'month');
  const typeIndex = financeColumnIndex(columns, 'type');
  const projectIndex = financeColumnIndex(columns, 'project');
  const subcategoryIndex = financeColumnIndex(columns, 'subcategory');
  const amountIndex = financeColumnIndex(columns, 'amount');

  return rows
    .map((row) => ({
      month: monthIndex === -1 ? '' : String(row[monthIndex] ?? '').trim(),
      type: normalizeFinanceType(typeIndex === -1 ? '' : row[typeIndex]),
      project: (projectIndex === -1 ? '' : String(row[projectIndex] ?? '').trim()) || 'Без проекта',
      subcategory: subcategoryIndex === -1 ? '' : String(row[subcategoryIndex] ?? '').trim(),
      amount: amountIndex === -1 ? 0 : parseTableNumber(row[amountIndex] ?? ''),
    }))
    .filter((entry) => entry.type || entry.project !== 'Без проекта' || entry.subcategory || entry.amount !== 0 || entry.month);
}

function filterFinanceEntriesByDateRange(entries: FinanceEntry[], range: FinancePeriodRange) {
  if (!hasFinanceDateRange(range)) return entries;
  return entries.filter((entry) => financeDateInRange(entry.month, range));
}

function financeRowMatchesView(row: string[], columns: TableColumn[], tab: FinanceTab, range: FinancePeriodRange) {
  const hasAnyValue = row.some((cell) => String(cell ?? '').trim());
  const monthIndex = financeColumnIndex(columns, 'month');
  const typeIndex = financeColumnIndex(columns, 'type');
  const month = monthIndex === -1 ? '' : String(row[monthIndex] ?? '').trim();
  const type = typeIndex === -1 ? '' : normalizeFinanceType(row[typeIndex]);

  if (!hasAnyValue) return tab === 'common' && !hasFinanceDateRange(range);
  if (hasFinanceDateRange(range) && !financeDateInRange(month, range)) return false;
  if (tab === 'income') return type === 'Доход';
  if (tab === 'expense') return type === 'Расход';
  return true;
}

function financeDateColumn(column: TableColumn): TableColumn {
  return { ...column, type: 'date', options: undefined, optionColors: undefined };
}

function financeColumnIndex(columns: TableColumn[], key: string) {
  return columns.findIndex((column) => isFinanceColumn(column, key));
}

function isFinanceColumn(column: TableColumn | undefined, key: string) {
  if (!column) return false;
  if (column.key === key) return true;
  const normalizedTitle = column.title.trim().toLowerCase();
  if (key === 'month') return normalizedTitle === 'дата' || normalizedTitle.includes('месяц');
  if (key === 'type') return normalizedTitle === 'тип';
  if (key === 'project') return normalizedTitle === 'проект';
  if (key === 'subcategory') return normalizedTitle === 'подкатегория';
  if (key === 'amount') return normalizedTitle.includes('сумма');
  return false;
}

function normalizeFinanceType(value: unknown): FinanceEntry['type'] {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'доход') return 'Доход';
  if (text === 'расход') return 'Расход';
  return '';
}

function normalizeFinanceIncomeKind(value: string) {
  const text = value.trim().toLowerCase();
  if (text.startsWith('разов')) return 'Разовый';
  if (text.startsWith('регуляр')) return 'Регулярный';
  return '';
}

function isFinanceIncomeRow(row: string[], columns: TableColumn[]) {
  const typeIndex = financeColumnIndex(columns, 'type');
  return typeIndex !== -1 && normalizeFinanceType(row[typeIndex]) === 'Доход';
}

function financeRowClass(row: string[], columns: TableColumn[]) {
  const typeIndex = financeColumnIndex(columns, 'type');
  const type = typeIndex === -1 ? '' : normalizeFinanceType(row[typeIndex]);
  if (type === 'Доход') return 'bg-green-500/5';
  if (type === 'Расход') return 'bg-red-500/5';
  return '';
}

function hasFinanceDateRange(range: FinancePeriodRange) {
  return Boolean(range.from || range.to);
}

function financeDateInRange(value: string, range: FinancePeriodRange) {
  const date = parseFinanceDate(value);
  if (!date) return false;
  const from = range.from ? parseFinanceDate(range.from) : null;
  const to = range.to ? parseFinanceDate(range.to) : null;
  const fromTime = from?.getTime() ?? Number.NEGATIVE_INFINITY;
  const toTime = to?.getTime() ?? Number.POSITIVE_INFINITY;
  const minTime = Math.min(fromTime, toTime);
  const maxTime = Math.max(fromTime, toTime);
  return date.getTime() >= minTime && date.getTime() <= maxTime;
}

function financeDateRangeLabel(range: FinancePeriodRange) {
  if (!hasFinanceDateRange(range)) return 'Весь период';
  const from = range.from ? formatFinanceDateLabel(range.from) : 'начало';
  const to = range.to ? formatFinanceDateLabel(range.to) : 'сегодня';
  return `${from} — ${to}`;
}

function formatFinanceDateLabel(value: string) {
  const date = parseFinanceDate(value);
  if (!date) return value;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseFinanceDate(value: string) {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return buildFinanceDate(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  const local = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
  if (!local) return null;
  const year = Number(local[3].length === 2 ? `20${local[3]}` : local[3]);
  return buildFinanceDate(Number(local[1]), Number(local[2]), year);
}

function buildFinanceDate(day: number, month: number, year: number) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function sumFinanceEntries(entries: FinanceEntry[]) {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

function groupFinanceByProject(entries: FinanceEntry[]) {
  const map = new Map<string, number>();
  for (const entry of entries) map.set(entry.project, (map.get(entry.project) ?? 0) + entry.amount);
  return Array.from(map.entries())
    .map(([project, amount]) => ({ project, amount }))
    .sort((left, right) => right.amount - left.amount);
}

function buildFinancePeriodBuckets(entries: FinanceEntry[], mode: FinanceChartMode): FinancePeriodBucket[] {
  const map = new Map<string, FinancePeriodBucket & { sortTime: number }>();

  for (const entry of entries) {
    if (!entry.type) continue;
    const identity = financeBucketIdentity(parseFinanceDate(entry.month), mode);
    const current = map.get(identity.key) ?? {
      key: identity.key,
      label: identity.label,
      income: 0,
      expense: 0,
      balance: 0,
      sortTime: identity.sortTime,
    };
    if (entry.type === 'Доход') current.income += entry.amount;
    if (entry.type === 'Расход') current.expense += entry.amount;
    current.balance = current.income - current.expense;
    map.set(identity.key, current);
  }

  return Array.from(map.values())
    .sort((left, right) => left.sortTime - right.sortTime)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      income: bucket.income,
      expense: bucket.expense,
      balance: bucket.balance,
    }));
}

function financeBucketIdentity(date: Date | null, mode: FinanceChartMode) {
  if (!date) return { key: 'no-date', label: 'Без даты', sortTime: Number.MAX_SAFE_INTEGER };
  if (mode === 'week') {
    const start = startOfFinanceWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      key: `week-${financeDateIso(start)}`,
      label: `${formatShortFinanceDate(start)}-${formatShortFinanceDate(end)}`,
      sortTime: start.getTime(),
    };
  }
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    label: monthStart.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }).replace('.', ''),
    sortTime: monthStart.getTime(),
  };
}

function startOfFinanceWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function financeDateIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatShortFinanceDate(date: Date) {
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function buildFinanceIncomeKindBreakdown(entries: FinanceEntry[]): FinancePieItem[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== 'Доход' || entry.amount <= 0) continue;
    const kind = normalizeFinanceIncomeKind(entry.subcategory) || entry.subcategory.trim() || 'Без категории';
    map.set(kind, (map.get(kind) ?? 0) + entry.amount);
  }
  const preferredColors: Record<string, string> = {
    Регулярный: '#22C55E',
    Разовый: '#84CC16',
    'Без категории': '#64748B',
  };
  return Array.from(map.entries())
    .map(([label, value], index) => ({
      label,
      value,
      color: preferredColors[label] ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length],
    }))
    .sort((left, right) => right.value - left.value);
}

function buildFinanceSmartInsights({
  incomeTotal,
  expenseTotal,
  balance,
  incomeRegular,
  incomeOneTime,
  expenseByProject,
  periodBuckets,
}: {
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  incomeRegular: number;
  incomeOneTime: number;
  expenseByProject: Array<{ project: string; amount: number }>;
  periodBuckets: FinancePeriodBucket[];
}) {
  const insights: string[] = [];
  if (incomeTotal === 0 && expenseTotal === 0) {
    return ['Добавьте доходы и расходы в общую таблицу, и здесь появится анализ: баланс, структура расходов, динамика и подсказки.'];
  }

  if (balance >= 0) {
    insights.push(`Финансовое состояние положительное: доходы выше расходов на ${formatMoneyRub(balance)}.`);
  } else {
    insights.push(`Сейчас расходы выше доходов на ${formatMoneyRub(Math.abs(balance))}. Лучше быстро проверить крупные категории расходов и временно ограничить необязательные траты.`);
  }

  if (incomeTotal > 0) {
    const expenseShare = Math.round((expenseTotal / incomeTotal) * 100);
    if (expenseShare >= 90) {
      insights.push(`Расходы забирают ${expenseShare}% дохода. Это высокий уровень нагрузки: стоит оставить только обязательные расходы и перенести второстепенные покупки.`);
    } else if (expenseShare >= 70) {
      insights.push(`Расходы составляют ${expenseShare}% дохода. Запас есть, но он небольшой: полезно заранее определить лимит на следующую неделю или месяц.`);
    } else {
      insights.push(`Расходы составляют ${expenseShare}% дохода. Запас выглядит здоровым, если крупные траты не ожидаются.`);
    }
  } else if (expenseTotal > 0) {
    insights.push('Доходов за выбранный период нет, а расходы уже есть. Для анализа лучше добавить источники дохода или сузить период фильтром.');
  }

  const largestExpense = expenseByProject[0];
  if (largestExpense && expenseTotal > 0) {
    const share = Math.round((largestExpense.amount / expenseTotal) * 100);
    insights.push(`Самая заметная статья расходов: «${largestExpense.project}» — ${formatMoneyRub(largestExpense.amount)} (${share}%). Если нужно экономить, начинать лучше с неё.`);
  }

  if (incomeTotal > 0) {
    const regularShare = Math.round((incomeRegular / incomeTotal) * 100);
    const oneTimeShare = Math.round((incomeOneTime / incomeTotal) * 100);
    if (regularShare < 50 && incomeOneTime > incomeRegular) {
      insights.push(`Доход больше держится на разовых поступлениях (${oneTimeShare}%). Для устойчивости стоит усиливать регулярные источники.`);
    } else if (regularShare >= 50) {
      insights.push(`Регулярный доход занимает ${regularShare}% поступлений. Это хороший фундамент для планирования расходов.`);
    }
  }

  const datedBuckets = periodBuckets.filter((bucket) => bucket.key !== 'no-date');
  if (datedBuckets.length >= 2) {
    const first = datedBuckets[0];
    const last = datedBuckets[datedBuckets.length - 1];
    if (last.balance > first.balance) {
      insights.push('Динамика баланса улучшается: последний период выглядит сильнее первого в выбранном диапазоне.');
    } else if (last.balance < first.balance) {
      insights.push('Динамика баланса ухудшилась. Проверьте, не выросли ли расходы в последних периодах.');
    }
  }

  return insights.slice(0, 5);
}

function buildFinanceSummaryRows(entries: FinanceEntry[]) {
  const map = new Map<string, { project: string; income: number; expense: number; total: number }>();
  for (const entry of entries) {
    if (!entry.type) continue;
    const current = map.get(entry.project) ?? { project: entry.project, income: 0, expense: 0, total: 0 };
    if (entry.type === 'Доход') current.income += entry.amount;
    if (entry.type === 'Расход') current.expense += entry.amount;
    current.total = current.income - current.expense;
    map.set(entry.project, current);
  }
  return Array.from(map.values()).sort((left, right) => Math.abs(right.total) - Math.abs(left.total));
}

function formatMoneyRub(value: number) {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
}

function formatMoneyCompact(value: number) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс`;
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
}

function tableTemplates() {
  const makeRows = (columns: TableColumn[]) => Array.from({ length: 3 }, () => columns.map(() => ''));
  const templates: TableTemplate[] = [
    {
      title: 'Проекты',
      columns: [
        { title: 'Название', type: 'text', width: 180 },
        { title: 'Ответственный', type: 'person', width: 150 },
        { title: 'Статус', type: 'status', width: 130 },
        { title: 'Дедлайн', type: 'date', width: 130 },
        { title: 'Приоритет', type: 'priority', width: 130 },
      ],
      rows: [],
    },
    {
      title: 'Финансы',
      tableKind: 'finance',
      columns: [
        {
          key: 'month',
          title: 'Дата',
          type: 'date',
          width: 130,
        },
        {
          key: 'type',
          title: 'Тип',
          type: 'select',
          width: 130,
          options: ['Доход', 'Расход'],
          optionColors: { 'Доход': '#22C55E', 'Расход': '#EF4444' },
        },
        {
          key: 'project',
          title: 'Проект',
          type: 'select',
          width: 160,
          options: ['Общий', 'Молодежь', 'Медиа', 'Служение', 'Мероприятия', 'Другое'],
          optionColors: {
            'Общий': '#3B82F6',
            'Молодежь': '#22C55E',
            'Медиа': '#8B5CF6',
            'Служение': '#F59E0B',
            'Мероприятия': '#EC4899',
            'Другое': '#64748B',
          },
        },
        { key: 'subcategory', title: 'Подкатегория', type: 'text', width: 170 },
        { key: 'amount', title: 'Сумма, ₽', type: 'money', width: 130 },
        { title: 'Комментарий', type: 'text', width: 200 },
      ],
      rows: [],
    },
    {
      title: 'Книги',
      columns: [
        { title: 'Название', type: 'text', width: 180 },
        { title: 'Автор', type: 'text', width: 150 },
        { title: 'Статус', type: 'status', width: 130 },
        { title: 'Прочитано', type: 'date', width: 130 },
        {
          title: 'Оценка',
          type: 'select',
          width: 120,
          options: ['⭐⭐⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐', '⭐⭐', '⭐'],
          optionColors: {
            '⭐⭐⭐⭐⭐': '#22C55E',
            '⭐⭐⭐⭐': '#84CC16',
            '⭐⭐⭐': '#F59E0B',
            '⭐⭐': '#F97316',
            '⭐': '#EF4444',
          },
        },
      ],
      rows: [],
    },
    {
      title: 'Мероприятия',
      columns: [
        { title: 'Название', type: 'text', width: 180 },
        { title: 'Дата', type: 'date', width: 130 },
        { title: 'Ответственный', type: 'person', width: 150 },
        { title: 'Статус', type: 'status', width: 130 },
        { title: 'Локация', type: 'text', width: 160 },
      ],
      rows: [],
    },
    {
      title: 'Задачи',
      columns: [
        { title: 'Задача', type: 'text', width: 180 },
        { title: 'Ответственный', type: 'person', width: 150 },
        { title: 'Статус', type: 'status', width: 130 },
        { title: 'Дедлайн', type: 'date', width: 130 },
        { title: 'Приоритет', type: 'priority', width: 130 },
        { title: 'Готово', type: 'checkbox', width: 90 },
      ],
      rows: [],
    },
  ];
  return templates.map((template) => ({ ...template, rows: makeRows(template.columns) }));
}

function normalizeTableRows(rows: string[][]) {
  const width = Math.max(1, ...rows.map((row) => row.length), 2);
  return rows.length
    ? rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')])
    : [Array.from({ length: width }, () => '')];
}

function getVisibleTableRows(
  rows: string[][],
  columns: TableColumn[],
  members: ProjectMember[],
  search: string,
  sort: { columnIndex: number; direction: 'asc' | 'desc' } | null,
  filter: { columnIndex: number; operator: string; value: string } | null,
) {
  const searchQuery = search.trim().toLowerCase();
  let result = rows.map((row, rowIndex) => ({ row, rowIndex }));

  if (searchQuery) {
    result = result.filter(({ row }) =>
      row.some((cell, cellIndex) => {
        const column = columns[cellIndex];
        if (!column || !isSearchableTableColumn(column.type)) return false;
        return tableCellText(cell, column, members).toLowerCase().includes(searchQuery);
      }),
    );
  }

  if (filter) {
    const column = columns[filter.columnIndex];
    if (column) {
      result = result.filter(({ row }) => tableCellMatchesFilter(row[filter.columnIndex] ?? '', column, members, filter.operator, filter.value));
    }
  }

  if (sort) {
    const column = columns[sort.columnIndex];
    if (column) {
      result = [...result].sort((left, right) => {
        const order = compareTableCells(left.row[sort.columnIndex] ?? '', right.row[sort.columnIndex] ?? '', column, members);
        return sort.direction === 'asc' ? order : -order;
      });
    }
  }

  return result;
}

function isSearchableTableColumn(type: TableColumnType) {
  return ['text', 'person', 'status', 'priority', 'tags', 'select'].includes(type);
}

function tableCellText(value: string, column: TableColumn, members: ProjectMember[]) {
  if (column.type === 'person') return memberDisplayName(value, members);
  return String(value ?? '');
}

function memberDisplayName(value: string, members: ProjectMember[]) {
  const resolvedValue = resolvePersonCellValue(value, members) || value;
  const member = members.find((item) => String(item.userId) === String(resolvedValue));
  const fullName = [member?.user?.firstName, member?.user?.lastName].filter(Boolean).join(' ');
  return fullName || member?.user?.username || value;
}

function memberTelegramLabel(value: string, members: ProjectMember[]) {
  const resolvedValue = resolvePersonCellValue(value, members) || value;
  const member = members.find((item) => String(item.userId) === String(resolvedValue));
  const username = member?.user?.username?.replace(/^@/, '').trim();
  if (username) return `@${username}`;
  const fullName = memberFullName(resolvedValue, members);
  return fullName || `ID ${resolvedValue}`;
}

function memberFullName(value: string, members: ProjectMember[]) {
  const resolvedValue = resolvePersonCellValue(value, members) || value;
  const member = members.find((item) => String(item.userId) === String(resolvedValue));
  return [member?.user?.firstName, member?.user?.lastName].filter(Boolean).join(' ');
}

function compareTableCells(left: string, right: string, column: TableColumn, members: ProjectMember[]) {
  if (column.type === 'number' || column.type === 'money') {
    return parseTableNumber(left) - parseTableNumber(right);
  }
  if (column.type === 'date') {
    return parseTableDate(left) - parseTableDate(right);
  }
  return tableCellText(left, column, members).localeCompare(tableCellText(right, column, members), 'ru', { numeric: true });
}

function tableCellMatchesFilter(value: string, column: TableColumn, members: ProjectMember[], operator: string, expected: string) {
  const text = tableCellText(value, column, members).toLowerCase();
  const filterText = expected.toLowerCase();
  if (operator === 'contains') return text.includes(filterText);
  if (operator === 'not_contains') return !text.includes(filterText);
  if (operator === 'equals') return text === filterText;
  if (operator === 'gt') return parseTableNumber(value) > parseTableNumber(expected);
  if (operator === 'lt') return parseTableNumber(value) < parseTableNumber(expected);
  if (operator === 'before') return parseTableDate(value) < parseTableDate(expected);
  if (operator === 'after') return parseTableDate(value) > parseTableDate(expected);
  if (operator === 'today') return isSameDay(parseTableDate(value), Date.now());
  if (operator === 'week') return isThisWeek(parseTableDate(value));
  if (operator === 'checked') return value === 'true';
  if (operator === 'unchecked') return value !== 'true';
  return true;
}

function parseTableNumber(value: string) {
  const parsed = Number(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTableDate(value: string) {
  const [day, month, year] = String(value ?? '').split('-').map((part) => Number(part));
  if (!day || !month || !year) return 0;
  return new Date(year, month - 1, day).getTime();
}

function isSameDay(left: number, right: number) {
  if (!left) return false;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return leftDate.toDateString() === rightDate.toDateString();
}

function isThisWeek(value: number) {
  if (!value) return false;
  const now = new Date();
  const day = now.getDay() || 7;
  const start = new Date(now);
  start.setDate(now.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return value >= start.getTime() && value < end.getTime();
}

function tableSummaryCell(column: TableColumn, columnIndex: number, visibleRows: Array<{ row: string[]; rowIndex: number }>) {
  if (columnIndex === 0) return `Всего: ${visibleRows.length}`;
  const values = visibleRows.map(({ row }) => row[columnIndex] ?? '');
  if (column.type === 'checkbox') return `${values.filter((value) => value === 'true').length}/${values.length}`;
  if (column.type === 'money') {
    const sum = values.reduce((total, value) => total + parseTableNumber(value), 0);
    return sum ? `Сумма: ${sum.toLocaleString('ru-RU')}` : '';
  }
  if (column.type === 'status') {
    const counts = values.filter(Boolean).reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(', ');
  }
  return '';
}

function normalizeTableColumns(columns: TableColumn[] | undefined, count: number, tableKind?: unknown): TableColumn[] {
  return Array.from({ length: count }, (_, index) => ({
    key: columns?.[index]?.key,
    title: normalizeTableColumnTitle(columns?.[index]?.title, index, tableKind),
    type: normalizeTableColumnType(columns?.[index]?.type, columns?.[index]?.title, tableKind),
    options: columns?.[index]?.options,
    optionColors: normalizeSelectOptionColors(columns?.[index]?.options, columns?.[index]?.optionColors),
    personColors: columns?.[index]?.personColors,
    width: columns?.[index]?.width ?? (index === 0 ? 180 : 112),
  }));
}

function normalizeTableColumnTitle(title: string | undefined, index: number, tableKind?: unknown) {
  if (tableKind === 'duty_schedule' && isDutyAssigneeColumnTitle(title)) return 'Ответственный';
  if (tableKind === 'duty_schedule' && index === 0 && (!title || title === 'Дата')) return 'Дата дежурства';
  return title ?? `Столбец ${index + 1}`;
}

function normalizeTableColumnType(type: unknown, title?: string, tableKind?: unknown): TableColumnType {
  if (tableKind === 'duty_schedule' && isDutyAssigneeColumnTitle(title)) return 'person';
  return TABLE_COLUMN_TYPES.some((option) => option.value === type)
    ? type as TableColumnType
    : 'text';
}

function isDutyAssigneeColumnTitle(title: string | undefined) {
  return Boolean(title && title.toLowerCase().includes('ответствен'));
}

function resolvePersonCellValue(value: string, members: ProjectMember[]) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const direct = members.find((member) => String(member.userId) === text);
  if (direct) return String(direct.userId);
  const normalized = text.replace(/^@/, '').toLowerCase();
  const byUsername = members.find((member) => member.user?.username?.replace(/^@/, '').toLowerCase() === normalized);
  if (byUsername) return String(byUsername.userId);
  const byName = members.find((member) => {
    const fullName = [member.user?.firstName, member.user?.lastName].filter(Boolean).join(' ').toLowerCase();
    return fullName === normalized || member.user?.firstName?.toLowerCase() === normalized;
  });
  return byName ? String(byName.userId) : '';
}

function normalizeSelectOptionColors(options: string[] | undefined, colors: Record<string, string> | undefined) {
  if (!options?.length && !colors) return undefined;
  const nextColors = { ...(colors ?? {}) };
  options?.forEach((option, index) => {
    if (!nextColors[option]) nextColors[option] = SELECT_OPTION_COLORS[index % SELECT_OPTION_COLORS.length];
  });
  return nextColors;
}

function normalizePersonColors(members: ProjectMember[], colors: Record<string, string> | undefined) {
  const nextColors = { ...(colors ?? {}) };
  members.forEach((member, index) => {
    const id = String(member.userId);
    if (!nextColors[id]) nextColors[id] = SELECT_OPTION_COLORS[index % SELECT_OPTION_COLORS.length];
  });
  return nextColors;
}

function startColumnResize(
  event: ReactMouseEvent | ReactTouchEvent,
  initialWidth: number,
  onResize: (width: number) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  const startX = 'touches' in event ? event.touches[0]?.clientX ?? 0 : event.clientX;

  const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
    const currentX = 'touches' in moveEvent ? moveEvent.touches[0]?.clientX ?? startX : moveEvent.clientX;
    onResize(initialWidth + currentX - startX);
  };
  const handleEnd = () => {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleEnd);
    window.removeEventListener('touchmove', handleMove);
    window.removeEventListener('touchend', handleEnd);
  };

  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);
  window.addEventListener('touchmove', handleMove);
  window.addEventListener('touchend', handleEnd);
}

function parsePastedTable(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  if (!normalized.includes('\n') && !normalized.includes('\t')) return [];
  return normalized
    .split('\n')
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function parsePeopleRows(text: string, columnCount: number) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|;|,/)[0]?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => [name, ...Array.from({ length: Math.max(0, columnCount - 1) }, () => '')]);
}

function attendanceCount(rows: string[][], columnIndex: number) {
  return rows.filter((row) => row[columnIndex] === 'true').length;
}

function SmartSummary({
  projectId,
  blocks,
  members,
}: {
  projectId: string;
  blocks: Block[];
  members: ProjectMember[];
}) {
  const [activeTasks, setActiveTasks] = useState<Array<{ deadlineAt?: string }>>([]);
  const pageText = blocks.map((block) => extractBlockText(block.content)).join(' ');
  useEffect(() => {
    const pid = Number(projectId);
    if (!Number.isFinite(pid)) {
      setActiveTasks([]);
      return;
    }
    let cancelled = false;
    tasksApi
      .getAllProjectTasks(pid)
      .then((tasks) => {
        if (!cancelled) setActiveTasks(tasks.filter((task) => !task.isArchived));
      })
      .catch(() => {
        if (!cancelled) setActiveTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const deadlines = activeTasks.filter((task) => task.deadlineAt).length;
  const checked = blocks.filter((block) => block.type === 'todo' && block.content?.checked).length;
  const todos = blocks.filter((block) => block.type === 'todo').length;
  const mentioned = members
    .filter((member) => {
      const username = member.user?.username;
      const firstName = member.user?.firstName;
      return (username && pageText.includes(`@${username}`)) || (firstName && pageText.includes(`@${firstName}`));
    })
    .map((member) => member.user?.firstName ?? member.user?.username)
    .filter(Boolean);

  return (
    <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4 text-sm text-[var(--tg-theme-text-color)]">
      <p className="mb-2 font-semibold">🧠 Краткое содержание</p>
      <ul className="space-y-1 text-[var(--tg-theme-hint-color)]">
        <li>• {activeTasks.length} активных задач</li>
        <li>• {deadlines} дедлайна</li>
        <li>• checklist: {checked}/{todos}</li>
        <li>• упоминания: {mentioned.length ? mentioned.join(', ') : 'нет'}</li>
      </ul>
    </div>
  );
}

function extractBlockText(content: any) {
  if (!content) return '';
  if (typeof content.text === 'string') return content.text;
  if (typeof content.title === 'string') return content.title;
  if (typeof content.url === 'string') return content.title || content.url;
  if (Array.isArray(content.rows)) return content.rows.flat().join(' ');
  return '';
}

function blockToPlainText(block: Block) {
  const content = block.content ?? {};
  if (block.type === 'simple_table' && Array.isArray(content.rows)) {
    return content.rows.map((row: unknown[]) => row.map((cell) => String(cell ?? '')).join('\t')).join('\n');
  }
  if (block.type === 'todo') return `${content.checked ? '[x]' : '[ ]'} ${content.text ?? ''}`.trim();
  if (block.type === 'bulleted_list') return `• ${content.text ?? ''}`.trim();
  if (block.type === 'numbered_list') return `1. ${content.text ?? ''}`.trim();
  if (block.type === 'link_to_page') return content.displayText ?? content.targetPageId ?? '';
  if (block.type === 'kanban_embed') return 'Kanban-доска';
  if (block.type === 'web_embed') return content.url ?? '';
  return extractBlockText(content);
}

function cloneContent<T>(content: T): T {
  if (typeof structuredClone === 'function') return structuredClone(content);
  return JSON.parse(JSON.stringify(content));
}

function isInteractiveSelectionTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, label'));
}

function normalizeInlineDates(value: string) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600000);
  return value
    .replace(/@tomorrow\b/gi, `📅 ${tomorrow.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}`)
    .replace(/@friday\b/gi, () => {
      const date = nextWeekday(now, 5);
      return `📅 ${date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}`;
    })
    .replace(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi, '📅 $1 $2');
}

function nextWeekday(from: Date, weekday: number) {
  const date = new Date(from);
  const diff = (weekday + 7 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return date;
}

function detectTaskSuggestion(text: string) {
  const clean = text.trim();
  if (!/(должен|нужно|надо|сделать|подготовить)/i.test(clean)) return null;
  const deadlineAt = /до пятниц/i.test(clean) ? nextWeekday(new Date(), 5).toISOString() : undefined;
  const title = clean
    .replace(/^(.*?)(должен|нужно|надо)\s+/i, '')
    .replace(/\s+до\s+.+$/i, '')
    .trim();
  if (title.length < 4) return null;
  return {
    title: title[0].toUpperCase() + title.slice(1),
    deadlineAt,
    priority: /срочно|важно|горит/i.test(clean) ? 'HIGH' as const : 'MEDIUM' as const,
  };
}

function defaultContentFor(type: BlockType, projectId: string, pageId: string) {
  if (type === 'todo') return { text: '', checked: false };
  if (type === 'simple_table') return { rows: [['', ''], ['', '']] };
  if (type === 'link_to_page') return { displayText: '', targetPageId: '' };
  if (type === 'kanban_embed') return { projectId, pageId };
  if (type === 'web_embed') return { url: '', mode: 'auto', provider: 'generic', height: 280 };
  if (type === 'smart_summary') return {};
  if (type === 'collapsible') return { title: 'Новый раздел', text: '', collapsed: false };
  if (type === 'page_properties') return {};
  return { text: '' };
}
