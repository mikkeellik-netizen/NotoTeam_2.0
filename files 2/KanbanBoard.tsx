import { useState, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import KanbanColumn from './KanbanColumn';
import TaskCard from './TaskCard';
import type { Column, Task } from '../../types';
import { useTaskStore } from '../../store/taskStore';

interface Props {
  columns: Column[];
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onAddTask: (columnId: number) => void;
}

export default function KanbanBoard({ columns, tasks, onTaskClick, onAddTask }: Props) {
  const { moveTask, reorderTasks } = useTaskStore();
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  // Локальное состояние для оптимистичного UI во время перетаскивания
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);

  // Синхронизируем если tasks снаружи изменился
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  // Сенсоры — поддержка и мыши и тач
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const getTasksByColumn = useCallback(
    (columnId: number) =>
      localTasks
        .filter((t) => t.columnId === columnId)
        .sort((a, b) => a.position - b.position),
    [localTasks],
  );

  // ─── Начало перетаскивания ─────────────────────────────────
  const onDragStart = ({ active }: DragStartEvent) => {
    const task = localTasks.find((t) => t.id === active.id);
    if (task) setActiveDragTask(task);
  };

  // ─── Перетаскивание над новой колонкой ─────────────────────
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;

    const activeTask = localTasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = over.id;
    const overData = over.data.current;

    let targetColumnId: number;

    if (overData?.type === 'column') {
      targetColumnId = overData.columnId;
    } else if (overData?.type === 'task') {
      targetColumnId = overData.task.columnId;
    } else {
      return;
    }

    if (activeTask.columnId === targetColumnId) return;

    // Оптимистично перемещаем карточку
    setLocalTasks((prev) =>
      prev.map((t) =>
        t.id === activeTask.id ? { ...t, columnId: targetColumnId } : t,
      ),
    );
  };

  // ─── Конец перетаскивания ──────────────────────────────────
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDragTask(null);
    if (!over) return;

    const activeTask = localTasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = over.id;
    const overData = over.data.current;

    let targetColumnId = activeTask.columnId;
    let targetPosition: number | undefined;

    if (overData?.type === 'column') {
      targetColumnId = overData.columnId;
    } else if (overData?.type === 'task') {
      const overTask = localTasks.find((t) => t.id === overId);
      if (overTask) {
        targetColumnId = overTask.columnId;
        // Переупорядочивание внутри колонки
        const colTasks = getTasksByColumn(targetColumnId);
        const oldIdx = colTasks.findIndex((t) => t.id === active.id);
        const newIdx = colTasks.findIndex((t) => t.id === overId);

        if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
          const reordered = arrayMove(colTasks, oldIdx, newIdx);
          const orderedIds = reordered.map((t) => t.id);

          setLocalTasks((prev) => {
            const others = prev.filter((t) => t.columnId !== targetColumnId);
            return [...others, ...reordered.map((t, i) => ({ ...t, position: i }))];
          });

          await reorderTasks(targetColumnId, orderedIds);
          return;
        }
      }
    }

    // Перемещение между колонками
    if (targetColumnId !== activeTask.columnId || targetPosition !== undefined) {
      const colTasks = getTasksByColumn(targetColumnId).filter((t) => t.id !== activeTask.id);
      targetPosition = colTasks.length;

      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === activeTask.id
            ? { ...t, columnId: targetColumnId, position: targetPosition! }
            : t,
        ),
      );

      await moveTask(activeTask.id, targetColumnId, targetPosition);
    }
  };

  const visibleColumns = columns.filter((c) => !c.isHidden);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      {/* Горизонтальный скролл */}
      <div className="flex gap-3 overflow-x-auto pb-4 px-4 snap-x snap-mandatory h-full">
        {visibleColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={getTasksByColumn(column.id)}
            onTaskClick={onTaskClick}
            onAddTask={onAddTask}
          />
        ))}

        {/* Кнопка добавить колонку — TODO в SettingsPage */}
      </div>

      {/* Overlay — карточка во время перетаскивания */}
      <DragOverlay>
        {activeDragTask && (
          <div className="rotate-2 scale-105 shadow-2xl">
            <TaskCard task={activeDragTask} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
