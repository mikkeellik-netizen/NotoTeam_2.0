import { useMemo, useState } from 'react';
import type { Block, BlockType, PageNode } from '../types';
import { usePageStore } from './pageStore';
import SlashMenu from './SlashMenu';

interface Props {
  page: PageNode;
  projectId: string;
  onOpenPage: (pageId: string) => void;
}

export default function PageEditor({ page, projectId, onOpenPage }: Props) {
  const { nodes, createBlock, updateBlock, getBlocksByPage } = usePageStore();
  const blocks = getBlocksByPage(page.id);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashBlockId, setSlashBlockId] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);

  const pageOptions = useMemo(
    () => nodes.filter((n) => n.type !== 'folder' && n.id !== page.id),
    [nodes, page.id],
  );

  const insertBlock = (type: BlockType) => {
    const block = slashBlockId ? blocks.find((b) => b.id === slashBlockId) : null;
    if (block) {
      updateBlock(block.id, defaultContentFor(type, projectId, page.id), type);
    } else {
      createBlock(page.id, type);
    }
    setSlashBlockId(null);
    setSlashQuery('');
    setPlusOpen(false);
  };

  return (
    <main className="relative h-full flex flex-col bg-[var(--tg-theme-bg-color)]">
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">{page.icon}</span>
          <input
            value={page.title}
            readOnly
            className="w-full bg-transparent text-2xl font-bold text-[var(--tg-theme-text-color)] outline-none"
          />
        </div>

        <div className="space-y-2 pb-24">
          {blocks.map((block) => (
            <BlockEditor
              key={block.id}
              block={block}
              pageOptions={pageOptions}
              onOpenPage={onOpenPage}
              onUpdate={(content) => updateBlock(block.id, content)}
              onSlash={(query) => {
                setSlashBlockId(block.id);
                setSlashQuery(query);
              }}
            />
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
    </main>
  );
}

function BlockEditor({
  block,
  pageOptions,
  onOpenPage,
  onUpdate,
  onSlash,
}: {
  block: Block;
  pageOptions: PageNode[];
  onOpenPage: (pageId: string) => void;
  onUpdate: (content: any) => void;
  onSlash: (query: string) => void;
}) {
  const text = block.content?.text ?? '';

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
          placeholder="To-do"
          className={block.content?.checked ? 'line-through text-[var(--tg-theme-hint-color)]' : ''}
          onChange={(value) => onUpdate({ ...block.content, text: value })}
          onSlash={onSlash}
        />
      </div>
    );
  }

  if (block.type === 'link_to_page') {
    const target = pageOptions.find((p) => p.id === block.content?.targetPageId);
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
            className="mt-2 text-sm font-medium text-[var(--tg-theme-link-color)]"
          >
            {target.icon} {block.content?.displayText || target.title}
          </button>
        )}
      </div>
    );
  }

  if (block.type === 'simple_table') {
    const rows: string[][] = block.content?.rows ?? [['', ''], ['', '']];
    return (
      <div className="overflow-x-auto rounded-[10px] border border-[var(--tg-theme-secondary-bg-color)]">
        <table className="w-full text-sm text-[var(--tg-theme-text-color)]">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-[var(--tg-theme-secondary-bg-color)] p-2">
                    <input
                      value={cell}
                      onChange={(e) => {
                        const nextRows = rows.map((r) => [...r]);
                        nextRows[rowIndex][cellIndex] = e.target.value;
                        onUpdate({ rows: nextRows });
                      }}
                      className="w-full bg-transparent outline-none"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === 'kanban_embed') {
    return (
      <div className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-sm text-[var(--tg-theme-text-color)]">
        Kanban embed подготовлен. Для MVP доска открывается как отдельная kanban-страница.
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

  const prefix = block.type === 'bulleted_list' ? '•' : block.type === 'numbered_list' ? '1.' : null;

  return (
    <div className="flex items-start gap-2">
      {prefix && <span className="pt-2 text-[var(--tg-theme-hint-color)]">{prefix}</span>}
      <TextInput
        value={text}
        placeholder="Напиши что-нибудь или / для команд"
        className={className}
        onChange={(value) => onUpdate({ ...block.content, text: value })}
        onSlash={onSlash}
      />
    </div>
  );
}

function TextInput({
  value,
  placeholder,
  className = '',
  onChange,
  onSlash,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onChange: (value: string) => void;
  onSlash: (query: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next);
        if (next.startsWith('/')) onSlash(next);
      }}
      className={`w-full bg-transparent text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none py-2 ${className}`}
    />
  );
}

function defaultContentFor(type: BlockType, projectId: string, pageId: string) {
  if (type === 'todo') return { text: '', checked: false };
  if (type === 'simple_table') return { rows: [['', ''], ['', '']] };
  if (type === 'link_to_page') return { displayText: '', targetPageId: '' };
  if (type === 'kanban_embed') return { projectId, pageId };
  return { text: '' };
}
