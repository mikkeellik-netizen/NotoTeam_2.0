import { useState } from 'react';
import { tasksApi } from '../../api/tasks';
import { usePageStore } from '../../store/pageStore';

interface Props {
  projectId: string;
  onOpenPage: (pageId: string) => void;
  onClose: () => void;
}

export default function QuickCaptureModal({ projectId, onOpenPage, onClose }: Props) {
  const { createNode, createBlockWithContent, ensureInbox } = usePageStore();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'note' | 'task' | 'idea'>('note');

  const save = async () => {
    const clean = text.trim();
    if (!clean) return;

    if (mode === 'task') {
      await tasksApi.create(Number(projectId), { title: clean, priority: 'MEDIUM' });
      onClose();
      return;
    }

    const inbox = ensureInbox(projectId);
    const node = createNode({
      projectId,
      parentId: inbox.id,
      type: 'page',
      title: mode === 'idea' ? `Идея: ${clean.slice(0, 32)}` : `Заметка: ${clean.slice(0, 32)}`,
      icon: mode === 'idea' ? '💡' : '📥',
    });
    createBlockWithContent(node.id, 'paragraph', { text: clean }, 0);
    onOpenPage(node.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-[var(--tg-theme-text-color)] mb-3">Quick Capture</h3>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {(['note', 'task', 'idea'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={`rounded-[10px] py-2 text-sm font-medium ${
                mode === item
                  ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
              }`}
            >
              {item === 'note' ? 'Заметка' : item === 'task' ? 'Задача' : 'Идея'}
            </button>
          ))}
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder="Быстро сохранить..."
          className="w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-[var(--tg-theme-text-color)] outline-none"
        />
        <button
          onClick={save}
          disabled={!text.trim()}
          className="mt-3 w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
