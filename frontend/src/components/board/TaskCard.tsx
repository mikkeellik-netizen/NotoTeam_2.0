import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../../types';
import { PRIORITY_COLOR, calculateTaskSignificanceScore, getDeadlineZone } from '../../types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Props {
  task: Task;
  onClick: () => void;
}

export default function TaskCard({ task, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { type: 'task', task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const zone = getDeadlineZone(task.deadlineAt);
  const zoneColor = zone === 'red' ? '#EF4444' : zone === 'yellow' ? '#F59E0B' : '#22C55E';

  const subtasks = task.subtasks ?? [];
  const completedSubs = subtasks.filter((s) => s.isCompleted).length;
  const tags = task.tags ?? [];
  const priorityColor = PRIORITY_COLOR[task.priority];
  const significanceScore = calculateTaskSignificanceScore(task);
  const showSignificance = zone === 'red' || significanceScore >= 7;

  return (
    <div
      ref={setNodeRef}
      data-kanban-task-id={task.id}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-[var(--tg-theme-bg-color)] rounded-[10px] p-3 shadow-sm active:scale-[0.97] transition-transform cursor-pointer select-none touch-none"
    >
      {/* Цветовая полоска */}
      {task.colorLabel && (
        <div
          className="h-1 rounded-full mb-2 -mx-3 -mt-3 rounded-t-[10px]"
          style={{ backgroundColor: task.colorLabel }}
        />
      )}

      {/* Заголовок */}
      <p className="text-sm font-medium text-[var(--tg-theme-text-color)] leading-snug mb-2">
        {task.title}
      </p>

      {/* Теги */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.slice(0, 3).map((tag: any) => (
            <span
              key={tag.id}
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: tag.color + '30', color: tag.color }}
            >
              {tag.title}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-xs text-[var(--tg-theme-hint-color)]">+{tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Нижняя строка */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Приоритет */}
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: priorityColor }}
        />

        {/* Дедлайн */}
        {task.deadlineAt && (
          <span
            className="text-xs font-medium"
            style={{ color: zone !== 'none' ? zoneColor : 'var(--tg-theme-hint-color)' }}
          >
            {format(new Date(task.deadlineAt), 'd MMM', { locale: ru })}
          </span>
        )}

        {showSignificance && (
          <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-red-400">
            {significanceScore}/10
          </span>
        )}

        {/* Подзадачи */}
        {subtasks.length > 0 && (
          <span className="text-xs text-[var(--tg-theme-hint-color)] ml-auto flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {completedSubs}/{subtasks.length}
          </span>
        )}

        {/* Исполнитель */}
        {task.assignee && (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ml-auto shrink-0"
            style={{
              backgroundColor: 'var(--tg-theme-button-color)',
              color: 'var(--tg-theme-button-text-color)',
            }}
          >
            {(task.assignee.firstName?.[0] || task.assignee.username?.[0] || '?').toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}
