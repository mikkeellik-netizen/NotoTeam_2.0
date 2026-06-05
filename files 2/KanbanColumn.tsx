import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import TaskCard from './TaskCard';
import type { Column, Task } from '../../types';

interface Props {
  column: Column;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onAddTask: (columnId: number) => void;
}

export default function KanbanColumn({ column, tasks, onTaskClick, onAddTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  });

  const taskIds = tasks.map((t) => t.id);

  return (
    <div className="flex flex-col w-[260px] shrink-0 snap-start">
      {/* Заголовок колонки */}
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">
            {column.title}
          </h3>
          <span className="text-xs text-[var(--tg-theme-hint-color)] bg-[var(--tg-theme-secondary-bg-color)] px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => onAddTask(column.id)}
          className="w-6 h-6 flex items-center justify-center text-[var(--tg-theme-hint-color)] hover:text-[var(--tg-theme-button-color)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Зона дропа */}
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-[12px] p-2 min-h-[120px] transition-colors ${
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
    </div>
  );
}
