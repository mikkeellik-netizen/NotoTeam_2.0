import { useState } from 'react';
import { templatesApi } from '../../api/templates';
import type { BlockType, Template } from '../../types';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: (template: Template) => void;
}

const BLOCK_OPTIONS: Array<{ type: BlockType; label: string }> = [
  { type: 'paragraph', label: 'Текст' },
  { type: 'heading_1', label: 'Заголовок 1' },
  { type: 'heading_2', label: 'Заголовок 2' },
  { type: 'heading_3', label: 'Заголовок 3' },
  { type: 'todo', label: 'To-do' },
  { type: 'bulleted_list', label: 'Маркированный список' },
  { type: 'numbered_list', label: 'Нумерованный список' },
  { type: 'simple_table', label: 'Таблица' },
  { type: 'code', label: 'Код' },
  { type: 'page_properties', label: 'Свойства страницы' },
  { type: 'smart_summary', label: 'Краткое содержание' },
  { type: 'collapsible', label: 'Сворачиваемый блок' },
  { type: 'kanban_embed', label: 'Kanban embed' },
];

interface DraftBlock {
  id: string;
  type: BlockType;
  text: string;
}

export default function TemplateBuilderModal({ projectId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('Новый шаблон');
  const [icon, setIcon] = useState('📄');
  const [description, setDescription] = useState('');
  const [blocks, setBlocks] = useState<DraftBlock[]>([
    { id: makeDraftId(), type: 'heading_1', text: 'Заголовок' },
    { id: makeDraftId(), type: 'paragraph', text: '' },
  ]);
  const [saving, setSaving] = useState(false);

  const addBlock = () => {
    setBlocks((items) => [...items, { id: makeDraftId(), type: 'paragraph', text: '' }]);
  };

  const removeBlock = (id: string) => {
    setBlocks((items) => items.filter((item) => item.id !== id));
  };

  const saveTemplate = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle || saving) return;
    setSaving(true);
    try {
      const created = await templatesApi.create(projectId, {
        title: cleanTitle,
        icon: icon.trim() || '📄',
        description: description.trim(),
        nodeType: 'page',
        blocks: blocks.map((block) => ({
          type: block.type,
          content: contentForBlock(block.type, block.text),
        })),
      });
      onCreated(created);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/50" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--tg-theme-text-color)]">Конструктор шаблона</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Собери структуру, которую можно создавать повторно.</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
          >
            x
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-[64px_1fr] gap-2">
            <input
              value={icon}
              onChange={(event) => setIcon(event.target.value.slice(0, 4))}
              className="h-12 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-center text-2xl text-[var(--tg-theme-text-color)] outline-none"
              aria-label="Иконка"
            />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-12 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
              placeholder="Название шаблона"
            />
          </div>

          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="h-20 w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
            placeholder="Описание: когда использовать этот шаблон"
          />

          <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Структура страницы</p>
              <button
                onClick={addBlock}
                className="rounded-[9px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
              >
                + Блок
              </button>
            </div>

            <div className="space-y-2">
              {blocks.map((block, index) => (
                <div key={block.id} className="rounded-[12px] bg-[var(--tg-theme-bg-color)] p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="w-5 text-xs text-[var(--tg-theme-hint-color)]">{index + 1}</span>
                    <select
                      value={block.type}
                      onChange={(event) =>
                        setBlocks((items) =>
                          items.map((item) => (item.id === block.id ? { ...item, type: event.target.value as BlockType } : item)),
                        )
                      }
                      className="min-w-0 flex-1 rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none"
                    >
                      {BLOCK_OPTIONS.map((option) => (
                        <option key={option.type} value={option.type}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeBlock(block.id)}
                      disabled={blocks.length <= 1}
                      className="h-8 w-8 rounded-full bg-red-500/15 text-red-400 disabled:opacity-30"
                      aria-label="Удалить блок"
                    >
                      x
                    </button>
                  </div>
                  <input
                    value={block.text}
                    onChange={(event) =>
                      setBlocks((items) =>
                        items.map((item) => (item.id === block.id ? { ...item, text: event.target.value } : item)),
                      )
                    }
                    className="w-full rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
                    placeholder={placeholderFor(block.type)}
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={saveTemplate}
            disabled={saving || !title.trim()}
            className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
          >
            {saving ? 'Сохраняю...' : 'Сохранить шаблон'}
          </button>
        </div>
      </div>
    </div>
  );
}

function contentForBlock(type: BlockType, text: string) {
  if (type === 'todo') return { text, checked: false };
  if (type === 'simple_table') return { rows: [['Колонка 1', 'Колонка 2'], ['', '']] };
  if (type === 'link_to_page') return { displayText: text, targetPageId: '' };
  if (type === 'kanban_embed') return { pageId: '' };
  if (type === 'smart_summary') return {};
  if (type === 'page_properties') return {};
  if (type === 'collapsible') return { title: text || 'Новый раздел', text: '', collapsed: false };
  return { text };
}

function placeholderFor(type: BlockType) {
  if (type === 'simple_table') return 'Таблица создастся автоматически';
  if (type === 'kanban_embed') return 'Kanban embed';
  if (type === 'smart_summary') return 'Автоматический блок';
  if (type === 'page_properties') return 'Метаданные страницы';
  if (type === 'collapsible') return 'Название раздела';
  return 'Текст блока';
}

function makeDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
