import { useState, useRef } from 'react';
import { useTaskStore } from '../../store/taskStore';
import type { Subtask } from '../../types';

interface Props {
  taskId: number;
  subtasks: Subtask[];
}

export default function SubtaskList({ taskId, subtasks }: Props) {
  const { createSubtask, toggleSubtask, updateSubtask, deleteSubtask } = useTaskStore();
  const [newTitle, setNewTitle] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const completed = subtasks.filter((s) => s.isCompleted).length;
  const total = subtasks.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    await createSubtask(taskId, newTitle.trim());
    setNewTitle('');
    setShowInput(false);
  };

  const handleEdit = async (id: number) => {
    if (!editTitle.trim()) return;
    await updateSubtask(taskId, id, editTitle.trim());
    setEditingId(null);
  };

  const startEdit = (s: Subtask) => {
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  return (
    <div>
      {/* Заголовок + прогресс */}
      {total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[var(--tg-theme-hint-color)]">
              Подзадачи
            </span>
            <span className="text-xs text-[var(--tg-theme-hint-color)]">
              {completed}/{total}
            </span>
          </div>
          {/* Прогресс-бар */}
          <div className="w-full h-1.5 rounded-full bg-[var(--tg-theme-secondary-bg-color)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${percent}%`,
                backgroundColor: percent === 100 ? '#22C55E' : 'var(--tg-theme-button-color)',
              }}
            />
          </div>
        </div>
      )}

      {/* Список подзадач */}
      <div className="space-y-1 mb-2">
        {subtasks.map((s) => (
          <div key={s.id} className="flex items-center gap-2 group py-1">
            {/* Checkbox */}
            <button
              onClick={() => toggleSubtask(taskId, s.id)}
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                s.isCompleted
                  ? 'bg-green-500 border-green-500'
                  : 'border-[var(--tg-theme-hint-color)]'
              }`}
            >
              {s.isCompleted && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Текст / редактирование */}
            {editingId === s.id ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => handleEdit(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEdit(s.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="flex-1 bg-transparent text-sm text-[var(--tg-theme-text-color)] outline-none border-b border-[var(--tg-theme-button-color)]"
              />
            ) : (
              <span
                onClick={() => startEdit(s)}
                className={`flex-1 text-sm cursor-pointer ${
                  s.isCompleted
                    ? 'line-through text-[var(--tg-theme-hint-color)]'
                    : 'text-[var(--tg-theme-text-color)]'
                }`}
              >
                {s.title}
              </span>
            )}

            {/* Удалить */}
            <button
              onClick={() => deleteSubtask(taskId, s.id)}
              className="opacity-0 group-hover:opacity-100 active:opacity-100 text-[var(--tg-theme-hint-color)] p-1 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Добавить подзадачу */}
      {showInput ? (
        <div className="flex items-center gap-2 mt-2">
          <div className="w-5 h-5 rounded-md border-2 border-dashed border-[var(--tg-theme-hint-color)] shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setShowInput(false); setNewTitle(''); }
            }}
            placeholder="Текст подзадачи..."
            className="flex-1 bg-transparent text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={!newTitle.trim()}
            className="text-xs text-[var(--tg-theme-button-color)] font-medium disabled:opacity-40"
          >
            Добавить
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className="flex items-center gap-1.5 text-sm text-[var(--tg-theme-link-color)] mt-1 py-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Добавить подзадачу
        </button>
      )}

      {/* 100% — предложение закрыть */}
      {percent === 100 && total > 0 && (
        <div className="mt-3 p-3 rounded-[10px] bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <p className="text-sm text-green-700 dark:text-green-400 font-medium">
            🎉 Все подзадачи выполнены!
          </p>
          <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
            Можно закрыть основную задачу
          </p>
        </div>
      )}
    </div>
  );
}
