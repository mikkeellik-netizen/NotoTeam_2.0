import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import TaskCard from './TaskCard';
import type { Column, Task } from '../../types';
import { copyPlainText } from '../../utils/clipboard';

interface Props {
  column: Column;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onAddTask?: (columnId: number) => void;
  onRenameColumn?: (columnId: number, title: string) => void | Promise<void>;
  onDuplicateColumn?: (columnId: number) => void | Promise<void>;
  onMoveColumn?: (columnId: number, direction: -1 | 1) => void | Promise<void>;
  onDeleteColumn?: (columnId: number) => void | Promise<void>;
  canDeleteColumn?: boolean;
}

export default function KanbanColumn({
  column,
  tasks,
  onTaskClick,
  onAddTask,
  onRenameColumn,
  onDuplicateColumn,
  onMoveColumn,
  onDeleteColumn,
  canDeleteColumn = true,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(column.title);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const taskIds = tasks.map((t) => t.id);
  const hasColumnActions = Boolean(onRenameColumn || onDuplicateColumn || onMoveColumn || onDeleteColumn);

  useEffect(() => {
    if (!isEditingTitle) setDraftTitle(column.title);
  }, [column.title, isEditingTitle]);

  useEffect(() => {
    if (isEditingTitle) inputRef.current?.focus();
  }, [isEditingTitle]);

  const saveTitle = async () => {
    const nextTitle = draftTitle.trim();
    setIsEditingTitle(false);
    if (!nextTitle || nextTitle === column.title) {
      setDraftTitle(column.title);
      return;
    }

    await onRenameColumn?.(column.id, nextTitle);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    if (isEditingTitle || !hasColumnActions) return;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      setShowColumnMenu(true);
    }, 650);
  };

  const handleDeleteColumn = async () => {
    if (!onDeleteColumn || !canDeleteColumn) return;
    await onDeleteColumn(column.id);
    setConfirmDelete(false);
    setShowColumnMenu(false);
  };

  return (
    <div
      data-kanban-column-id={column.id}
      className="flex w-[260px] shrink-0 snap-start flex-col self-start"
    >
      {/* Заголовок колонки */}
      <div
        className="flex items-center justify-between px-1 mb-2"
        onContextMenu={(event) => {
          if (!hasColumnActions) return;
          event.preventDefault();
          setShowColumnMenu(true);
        }}
        onPointerDown={startLongPress}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        onPointerCancel={clearLongPress}
      >
        <div
          className="flex min-w-0 items-center gap-2"
        >
          {isEditingTitle ? (
            <input
              ref={inputRef}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setDraftTitle(column.title);
                  setIsEditingTitle(false);
                }
              }}
              className="min-w-0 max-w-[150px] rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none ring-1 ring-[var(--tg-theme-button-color)]"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                if (didLongPressRef.current) {
                  didLongPressRef.current = false;
                  return;
                }
                onRenameColumn && setIsEditingTitle(true);
              }}
              className="min-w-0 truncate rounded-[6px] text-left text-sm font-semibold text-[var(--tg-theme-text-color)]"
              title="Переименовать колонку"
            >
              {column.title}
            </button>
          )}
          <span className="text-xs text-[var(--tg-theme-hint-color)] bg-[var(--tg-theme-secondary-bg-color)] px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (hasColumnActions) setShowColumnMenu(true);
            }}
            className={`${hasColumnActions ? 'flex' : 'hidden'} h-6 w-6 items-center justify-center rounded-full text-lg leading-none text-[var(--tg-theme-hint-color)] transition-colors hover:bg-[var(--tg-theme-secondary-bg-color)] hover:text-[var(--tg-theme-button-color)]`}
            title="Действия со столбцом"
            aria-label="Действия со столбцом"
          >
            ⋯
          </button>
        {onAddTask && (
        <button
          onClick={() => onAddTask(column.id)}
          className="w-6 h-6 flex items-center justify-center text-[var(--tg-theme-hint-color)] hover:text-[var(--tg-theme-button-color)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        )}
        </div>
      </div>

      {/* Зона дропа */}
      <div
        ref={setNodeRef}
        className={`rounded-[12px] p-2 min-h-[240px] transition-colors ${
          isOver
            ? 'bg-[var(--tg-theme-button-color)]/10 ring-2 ring-[var(--tg-theme-button-color)]/30'
            : 'bg-[var(--tg-theme-secondary-bg-color)]'
        }`}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
              />
            ))}
          </div>
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-16">
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Нет задач</p>
          </div>
        )}
      </div>

      {showColumnMenu && hasColumnActions && (
        <div
          className="fixed inset-0 z-[80] flex items-end bg-black/50"
          onClick={() => {
            setShowColumnMenu(false);
            setConfirmDelete(false);
          }}
        >
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">{column.title}</p>
              <p className="text-xs text-[var(--tg-theme-hint-color)]">Действия со столбцом</p>
            </div>

            {!confirmDelete ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowColumnMenu(false);
                    setIsEditingTitle(true);
                  }}
                  className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
                >
                  Переименовать
                </button>
                <button
                  type="button"
                  onClick={() => copyPlainText(column.title)}
                  className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)]"
                >
                  Копировать название
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicateColumn?.(column.id)}
                  disabled={!onDuplicateColumn}
                  className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)] disabled:opacity-40"
                >
                  Дублировать столбец
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onMoveColumn?.(column.id, -1)}
                    disabled={!onMoveColumn}
                    className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)] disabled:opacity-40"
                  >
                    Влево
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveColumn?.(column.id, 1)}
                    disabled={!onMoveColumn}
                    className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-left text-sm font-medium text-[var(--tg-theme-text-color)] disabled:opacity-40"
                  >
                    Вправо
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!onDeleteColumn || !canDeleteColumn}
                  className="w-full rounded-[12px] bg-red-500/15 px-4 py-3 text-left text-sm font-semibold text-red-400 disabled:opacity-40"
                >
                  Удалить столбец
                </button>
                {!canDeleteColumn && (
                  <p className="px-1 text-xs text-[var(--tg-theme-hint-color)]">
                    Последний столбец удалить нельзя.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[var(--tg-theme-hint-color)]">
                  Удалить столбец? Все карточки из него перейдут в соседний столбец.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteColumn}
                    className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
