import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { activityApi } from '../../api/activity';
import { linkPreviewApi } from '../../api/linkPreview';
import { readDb } from '../../api/mockDb';
import { tasksApi } from '../../api/tasks';
import BoardPage from '../../pages/BoardPage';
import type { Block, BlockType, PageNode, ProjectMember, WebEmbedContent, WebEmbedProvider } from '../../types';
import { usePageStore } from '../../store/pageStore';
import SlashMenu from './SlashMenu';
import ContextMenu from '../common/ContextMenu';
import { copyPlainText } from '../../utils/clipboard';

interface Props {
  page: PageNode;
  projectId: string;
  members: ProjectMember[];
  onOpenPage: (pageId: string) => void;
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
  title: string;
  type: TableColumnType;
  options?: string[];
  optionColors?: Record<string, string>;
  personColors?: Record<string, string>;
  width?: number;
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

const SELECT_OPTION_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'];

export default function PageEditor({ page, projectId, members, onOpenPage }: Props) {
  const { nodes, createBlock, createBlockWithContent, updateBlock, moveBlock, deleteBlock, renameNode, updatePageProperties, getBlocksByPage } = usePageStore();
  const blocks = getBlocksByPage(page.id);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashBlockId, setSlashBlockId] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(page.title);
  const [contextBlock, setContextBlock] = useState<{ block: Block; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const pageOptions = useMemo(
    () => nodes.filter((n) => n.type !== 'folder' && n.id !== page.id),
    [nodes, page.id],
  );

  const insertBlock = (type: BlockType) => {
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

  const commitTitle = () => {
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
      const created = createBlock(page.id, 'paragraph', undefined, { skipHistory: true });
      setFocusedBlockId(created.id);
      return;
    }

    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock.type !== 'paragraph' || !isBlockEmpty(lastBlock)) {
      createBlock(page.id, 'paragraph', lastBlock.order + 1, { skipHistory: true });
    }
  }, [blocks, createBlock, page.id]);

  const createTextLineAfter = (block: Block, type: BlockType = 'paragraph') => {
    const created = createBlock(page.id, type, block.order + 1);
    setFocusedBlockId(created.id);
    setActiveBlockId(created.id);
  };

  const deleteTextLine = (block: Block) => {
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

  const startBlockLongPress = (block: Block, x: number, y: number) => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => openBlockMenu(block, x, y), 600);
  };

  const clearBlockLongPress = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
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
          <span className="text-2xl">{page.icon}</span>
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
                setTitleDraft(page.title);
                event.currentTarget.blur();
              }
            }}
            className="w-full bg-transparent text-2xl font-bold text-[var(--tg-theme-text-color)] outline-none"
          />
        </div>

        <div className="space-y-2 pb-24">
          {blocks.map((block) => (
            <div
              key={block.id}
              onContextMenu={(event) => {
                event.preventDefault();
                if (block.type === 'simple_table') return;
                openBlockMenu(block, event.clientX, event.clientY);
              }}
              onPointerDown={(event) => {
                if (block.type === 'simple_table') return;
                startBlockLongPress(block, event.clientX, event.clientY);
              }}
              onPointerUp={clearBlockLongPress}
              onPointerLeave={clearBlockLongPress}
              onPointerCancel={clearBlockLongPress}
            >
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
          ))}
        </div>
      </div>

      <button
        onClick={() => setPlusOpen(true)}
        className="fixed bottom-6 right-4 z-40 w-14 h-14 rounded-full bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] shadow-lg flex items-center justify-center text-2xl active:scale-90 transition-transform"
      >
        +
      </button>

      {(slashBlockId || plusOpen) && (
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
      {contextBlock && (
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
    const columns = normalizeTableColumns(block.content?.columns, rows[0]?.length ?? 2);
    const isAttendance = block.content?.tableKind === 'attendance';
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
    const tableHeaderLongPressRef = useRef<number | null>(null);
    const visibleRows = getVisibleTableRows(rows, columns, members, tableSearch, tableSort, tableFilter);
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
              {columns.map((column, columnIndex) => (
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
                      value={column.type}
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
                    {column.type === 'person' && (
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
                    {column.type === 'select' && (
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
                  {column.type === 'select' && (
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
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, rowIndex }) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openCellMenu(rowIndex, cellIndex, event.clientX, event.clientY);
                    }}
                    className={`border border-[var(--tg-theme-secondary-bg-color)] p-2 ${
                      stickyFirstColumn && cellIndex === 0 ? 'sticky left-0 z-10 min-w-[180px] bg-[var(--tg-theme-bg-color)]' : ''
                    }`}
                  >
                    <TableCellInput
                      value={cell}
                      type={columns[cellIndex]?.type ?? 'text'}
                      column={columns[cellIndex]}
                      options={columns[cellIndex]?.options}
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
                  </td>
                ))}
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
              updateTable(template.rows, template.columns);
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
        <BoardPage embedded boardPageId={block.content?.pageId || page.id} />
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
  const ref = useRef<HTMLTextAreaElement>(null);
  const focusValueRef = useRef(value);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionOptions = members.filter((member) => {
    const label = `${member.user?.firstName ?? ''} ${member.user?.username ?? ''}`.toLowerCase();
    return mentionQuery !== null && label.includes(mentionQuery.toLowerCase());
  });

  useEffect(() => {
    resizeTextarea(ref.current);
  }, [value]);

  useEffect(() => {
    if (!shouldFocus) return;
    ref.current?.focus();
    const length = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(length, length);
    onFocused();
  }, [onFocused, shouldFocus]);

  return (
    <>
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next);
        if (next.startsWith('/')) onSlash(next);
        const mention = next.match(/(?:^|\s)@([A-Za-zА-Яа-яЁё0-9_]*)$/);
        setMentionQuery(mention ? mention[1] : null);
        resizeTextarea(e.target);
      }}
      onBlur={() => {
        const normalized = normalizeInlineDates(value);
        onChange(normalized);
        if (focusValueRef.current.trim() !== normalized.trim()) onCommit(normalized);
      }}
      onFocus={() => {
        focusValueRef.current = value;
        onFocus();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
          return;
        }

        if ((e.key === 'Backspace' || e.key === 'Delete') && !value.trim()) {
          e.preventDefault();
          onDelete();
        }
      }}
      className={`w-full max-w-full bg-transparent text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none py-2 resize-none overflow-hidden whitespace-pre-wrap break-words leading-relaxed ${className}`}
    />
    {mentionOptions.length > 0 && (
      <div className="absolute z-[60] mt-10 max-h-44 w-56 overflow-y-auto rounded-[10px] bg-[var(--tg-theme-bg-color)] p-1 shadow-xl border border-[var(--tg-theme-secondary-bg-color)]">
        {mentionOptions.slice(0, 6).map((member) => {
          const username = member.user?.username ?? member.user?.firstName ?? `user${member.userId}`;
          return (
            <button
              key={member.id}
              onMouseDown={(event) => {
                event.preventDefault();
                const next = value.replace(/@([A-Za-zА-Яа-яЁё0-9_]*)$/, `@${username} `);
                onChange(next);
                setMentionQuery(null);
              }}
              className="w-full rounded-[8px] px-2 py-2 text-left text-sm text-[var(--tg-theme-text-color)] active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              @{username}
            </button>
          );
        })}
      </div>
    )}
    </>
  );
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
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
  const canEmbed = Boolean(content?.embedUrl || buildEmbedUrl(content?.url ?? '', provider));
  const shouldEmbed = content?.url && mode !== 'preview' && canEmbed;

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

      {content?.url && (
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
            src={content.embedUrl || buildEmbedUrl(content.url, provider)}
            style={{ height: content.height ?? defaultEmbedHeight(provider) }}
            className="block w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            loading="lazy"
          />
        </div>
      ) : content?.url ? (
        <a
          href={content.url}
          target="_blank"
          rel="noreferrer"
          className="flex gap-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-left active:scale-[0.99]"
        >
          {content.image ? (
            <img src={content.image} alt="" className="h-20 w-24 shrink-0 rounded-[10px] object-cover" />
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
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return '';
    }
  }
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
  const color = getPersonColor(column, value, members);
  const label = value ? memberDisplayName(value, members) : 'Не выбран';

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
        {label}
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
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onChange(id);
                    setMenuRect(null);
                  }}
                  className="mb-1 block w-full truncate rounded-full px-3 py-2 text-left text-xs font-semibold active:scale-[0.99]"
                  style={{ backgroundColor: `${memberColor}26`, color: memberColor }}
                >
                  {memberDisplayName(id, members)}
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
  onSelect: (template: { columns: TableColumn[]; rows: string[][] }) => void;
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

function tableTemplates() {
  const makeRows = (columns: TableColumn[]) => Array.from({ length: 3 }, () => columns.map(() => ''));
  const templates: Array<{ title: string; columns: TableColumn[]; rows: string[][] }> = [
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
      columns: [
        { title: 'Статья', type: 'text', width: 180 },
        { title: 'Сумма', type: 'money', width: 120 },
        { title: 'Дата', type: 'date', width: 130 },
        {
          title: 'Категория',
          type: 'select',
          width: 150,
          options: ['Доход', 'Расход', 'Пожертвование', 'Материалы', 'Транспорт'],
          optionColors: {
            'Доход': '#22C55E',
            'Расход': '#EF4444',
            'Пожертвование': '#3B82F6',
            'Материалы': '#F59E0B',
            'Транспорт': '#8B5CF6',
          },
        },
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
  const member = members.find((item) => String(item.userId) === String(value));
  return member?.user?.firstName || member?.user?.username || value;
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

function normalizeTableColumns(columns: TableColumn[] | undefined, count: number): TableColumn[] {
  return Array.from({ length: count }, (_, index) => ({
    title: columns?.[index]?.title ?? `Столбец ${index + 1}`,
    type: normalizeTableColumnType(columns?.[index]?.type),
    options: columns?.[index]?.options,
    optionColors: normalizeSelectOptionColors(columns?.[index]?.options, columns?.[index]?.optionColors),
    personColors: columns?.[index]?.personColors,
    width: columns?.[index]?.width ?? (index === 0 ? 180 : 112),
  }));
}

function normalizeTableColumnType(type: unknown): TableColumnType {
  return TABLE_COLUMN_TYPES.some((option) => option.value === type)
    ? type as TableColumnType
    : 'text';
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
  const db = readDb();
  const pageText = blocks.map((block) => extractBlockText(block.content)).join(' ');
  const activeTasks = db.tasks.filter((task) => task.projectId === Number(projectId) && !task.isArchived);
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
