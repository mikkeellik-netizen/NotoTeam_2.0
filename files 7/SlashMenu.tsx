import type { BlockType } from '../types';

const BLOCK_OPTIONS: Array<{
  type: BlockType;
  title: string;
  hint: string;
  keywords: string;
}> = [
  { type: 'paragraph', title: 'Текст', hint: 'Обычный абзац', keywords: 'text paragraph p' },
  { type: 'heading_1', title: 'Заголовок 1', hint: 'Крупный заголовок', keywords: 'h h1 heading' },
  { type: 'heading_2', title: 'Заголовок 2', hint: 'Средний заголовок', keywords: 'h h2 heading' },
  { type: 'heading_3', title: 'Заголовок 3', hint: 'Малый заголовок', keywords: 'h h3 heading' },
  { type: 'todo', title: 'To-do', hint: 'Чеклист', keywords: 'todo checklist check' },
  { type: 'bulleted_list', title: 'Маркированный список', hint: 'Пункт списка', keywords: 'list bullet ul' },
  { type: 'numbered_list', title: 'Нумерованный список', hint: 'Пункт с номером', keywords: 'list number ol' },
  { type: 'simple_table', title: 'Таблица', hint: 'Простая таблица', keywords: 'table grid' },
  { type: 'code', title: 'Код', hint: 'Моноширинный блок', keywords: 'code snippet' },
  { type: 'link_to_page', title: 'Link to page', hint: 'Ссылка на страницу', keywords: 'link page' },
  { type: 'kanban_embed', title: 'Kanban embed', hint: 'Встроить доску', keywords: 'kanban board embed' },
];

interface Props {
  query: string;
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}

export default function SlashMenu({ query, onSelect, onClose }: Props) {
  const normalized = query.toLowerCase().replace('/', '').trim();
  const options = BLOCK_OPTIONS.filter((option) => {
    if (!normalized) return true;
    return `${option.title} ${option.hint} ${option.keywords}`.toLowerCase().includes(normalized);
  });

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-4 right-4 bottom-24 max-h-[52vh] overflow-y-auto rounded-[12px] bg-[var(--tg-theme-bg-color)] shadow-2xl border border-[var(--tg-theme-secondary-bg-color)]"
        onClick={(e) => e.stopPropagation()}
      >
        {options.length === 0 ? (
          <div className="px-4 py-3 text-sm text-[var(--tg-theme-hint-color)]">
            Ничего не найдено
          </div>
        ) : (
          options.map((option) => (
            <button
              key={option.type}
              onClick={() => onSelect(option.type)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-[var(--tg-theme-secondary-bg-color)]"
            >
              <span>
                <span className="block text-sm font-medium text-[var(--tg-theme-text-color)]">
                  {option.title}
                </span>
                <span className="block text-xs text-[var(--tg-theme-hint-color)]">
                  {option.hint}
                </span>
              </span>
              <span className="text-[var(--tg-theme-hint-color)]">›</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
