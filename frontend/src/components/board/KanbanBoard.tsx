import { useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragStartEvent,
  type DragMoveEvent,
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
  onRenameColumn?: (columnId: number, title: string) => void | Promise<void>;
  onAddColumn?: () => void | Promise<void>;
  onDuplicateColumn?: (columnId: number) => void | Promise<void>;
  onMoveColumn?: (columnId: number, direction: -1 | 1) => void | Promise<void>;
  onDeleteColumn?: (columnId: number) => void | Promise<void>;
  canCreateTask?: boolean;
  canMoveTask?: boolean;
  canManageColumns?: boolean;
}

export default function KanbanBoard({
  columns,
  tasks,
  onTaskClick,
  onAddTask,
  onRenameColumn,
  onAddColumn,
  onDuplicateColumn,
  onMoveColumn,
  onDeleteColumn,
  canCreateTask = true,
  canMoveTask = true,
  canManageColumns = true,
}: Props) {
  const { moveTask, reorderTasks } = useTaskStore();
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const dragPointerXRef = useRef<number | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const dragStartPointerXRef = useRef<number | null>(null);
  const dragStartPointerYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  // Keep a local copy for optimistic updates while dragging.
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);

  // Resync when tasks change outside the board.
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (!isDragging) {
      dragPointerXRef.current = null;
      dragPointerYRef.current = null;
      dragStartPointerXRef.current = null;
      dragStartPointerYRef.current = null;
      if (autoScrollFrameRef.current) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      return;
    }

    const updatePointer = (event: PointerEvent) => {
      dragPointerXRef.current = event.clientX;
      dragPointerYRef.current = event.clientY;
    };
    const updateTouchPointer = (event: TouchEvent) => {
      dragPointerXRef.current = event.touches[0]?.clientX ?? null;
      dragPointerYRef.current = event.touches[0]?.clientY ?? null;
    };
    const tick = () => {
      const container = scrollContainerRef.current;
      const pointerX = dragPointerXRef.current;

      if (container && pointerX !== null) {
        const rect = container.getBoundingClientRect();
        const edgeSize = Math.min(120, rect.width * 0.28);
        let speed = 0;

        if (pointerX < rect.left + edgeSize) {
          const intensity = (rect.left + edgeSize - pointerX) / edgeSize;
          speed = -Math.min(1.45, 0.15 + intensity * intensity * 1.3);
        } else if (pointerX > rect.right - edgeSize) {
          const intensity = (pointerX - (rect.right - edgeSize)) / edgeSize;
          speed = Math.min(1.45, 0.15 + intensity * intensity * 1.3);
        }

        if (speed !== 0) {
          container.scrollLeft += speed;
        }
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', updatePointer);
    window.addEventListener('touchmove', updateTouchPointer, { passive: true });
    autoScrollFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', updatePointer);
      window.removeEventListener('touchmove', updateTouchPointer);
      if (autoScrollFrameRef.current) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [isDragging]);

  // Support both pointer and touch input.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const getTasksByColumn = useCallback(
    (columnId: number) =>
      localTasks
        .filter((t) => sameId(t.columnId, columnId))
        .sort((a, b) => Number(a.position) - Number(b.position)),
    [localTasks],
  );
  const visibleColumns = [...columns]
    .filter((c) => !c.isHidden && !c.isArchive)
    .sort((a, b) => Number(a.position) - Number(b.position));

  // Start dragging.
  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    if (!canMoveTask) return;
    const task = localTasks.find((t) => sameId(t.id, active.id));
    if (activatorEvent instanceof MouseEvent) {
      dragPointerXRef.current = activatorEvent.clientX;
      dragPointerYRef.current = activatorEvent.clientY;
      dragStartPointerXRef.current = activatorEvent.clientX;
      dragStartPointerYRef.current = activatorEvent.clientY;
    } else if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent) {
      dragPointerXRef.current = activatorEvent.touches[0]?.clientX ?? null;
      dragPointerYRef.current = activatorEvent.touches[0]?.clientY ?? null;
      dragStartPointerXRef.current = activatorEvent.touches[0]?.clientX ?? null;
      dragStartPointerYRef.current = activatorEvent.touches[0]?.clientY ?? null;
    }
    setIsDragging(true);
    if (task) setActiveDragTask(task);
  };

  const onDragMove = ({ delta }: DragMoveEvent) => {
    if (!canMoveTask) return;
    if (dragStartPointerXRef.current === null) return;
    dragPointerXRef.current = dragStartPointerXRef.current + delta.x;
    if (dragStartPointerYRef.current !== null) {
      dragPointerYRef.current = dragStartPointerYRef.current + delta.y;
    }
  };

  const getPointerColumnId = () => {
    const container = scrollContainerRef.current;
    const pointerX = dragPointerXRef.current;
    const pointerY = dragPointerYRef.current;
    if (!container || pointerX === null) return undefined;

    const visibleColumnIds = new Set(visibleColumns.map((column) => String(column.id)));
    const columnRects = Array.from(container.querySelectorAll<HTMLElement>('[data-kanban-column-id]'))
      .map((node) => ({
        id: Number(node.dataset.kanbanColumnId),
        rect: node.getBoundingClientRect(),
      }))
      .filter((item) => Number.isFinite(item.id) && visibleColumnIds.has(String(item.id)));

    const hit = columnRects.find(({ rect }) => {
      const isInsideX = pointerX >= rect.left && pointerX <= rect.right;
      const isInsideY = pointerY === null || (pointerY >= rect.top - 96 && pointerY <= rect.bottom + 96);
      return isInsideX && isInsideY;
    });
    if (hit) return hit.id;

    if (columnRects.length === 0) return undefined;
    const leftEdge = Math.min(...columnRects.map((item) => item.rect.left));
    const rightEdge = Math.max(...columnRects.map((item) => item.rect.right));
    const isBetweenColumns = pointerX >= leftEdge && pointerX <= rightEdge;
    const isNearColumnVertically = pointerY === null || columnRects.some(
      ({ rect }) => pointerY >= rect.top - 96 && pointerY <= rect.bottom + 96,
    );
    if (!isBetweenColumns || !isNearColumnVertically) return undefined;

    const nearest = columnRects
      .map(({ id, rect }) => ({ id, distance: Math.abs(pointerX - (rect.left + rect.width / 2)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest?.id;
  };

  const getTaskInsertPosition = (columnId: number, activeTaskId: number) => {
    const columnTasks = getTasksByColumn(columnId).filter((task) => !sameId(task.id, activeTaskId));
    const pointerY = dragPointerYRef.current;
    if (pointerY === null) return columnTasks.length;

    for (let index = 0; index < columnTasks.length; index += 1) {
      const task = columnTasks[index];
      const node = scrollContainerRef.current?.querySelector<HTMLElement>(
        `[data-kanban-task-id="${task.id}"]`,
      );
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) return index;
    }

    return columnTasks.length;
  };

  // Handle dragging over a new column.
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!canMoveTask) return;
    const originalTask = activeDragTask;
    setActiveDragTask(null);
    setIsDragging(false);

    const activeTask = originalTask ?? localTasks.find((t) => sameId(t.id, active.id));
    if (!activeTask) return;

    const pointerColumnId = getPointerColumnId();
    const overId = over?.id;
    const overData = over?.data.current;
    const overTask = overData?.type === 'task' && overId !== undefined
      ? localTasks.find((t) => sameId(t.id, overId))
      : undefined;
    const overColumnId = overData?.type === 'column' ? toNumberId(overData.columnId) : undefined;
    const targetColumnId = pointerColumnId ?? toNumberId(overTask?.columnId) ?? overColumnId ?? toNumberId(activeTask.columnId);

    if (targetColumnId === undefined || !visibleColumns.some((column) => sameId(column.id, targetColumnId))) return;

    const targetPosition = getTaskInsertPosition(targetColumnId, activeTask.id);

    // Move the task between columns.
    if (sameId(targetColumnId, activeTask.columnId)) {
      const colTasks = getTasksByColumn(targetColumnId);
      const oldIdx = colTasks.findIndex((task) => sameId(task.id, activeTask.id));
      const newIdx = Math.max(0, Math.min(targetPosition, Math.max(0, colTasks.length - 1)));

      if (oldIdx !== -1 && oldIdx !== newIdx) {
        const reordered = arrayMove(colTasks, oldIdx, newIdx);
        const orderedIds = reordered.map((task) => task.id);
        setLocalTasks((prev) => reindexColumnTasks(prev, targetColumnId, orderedIds));
        try {
          await reorderTasks(targetColumnId, orderedIds);
        } catch (error) {
          setLocalTasks(tasks);
          console.error('Failed to reorder task', error);
        }
      }
      return;
    }

    if (!sameId(targetColumnId, activeTask.columnId)) {
      const colTasks = getTasksByColumn(targetColumnId).filter((t) => !sameId(t.id, activeTask.id));
      const insertPosition = Math.max(0, Math.min(targetPosition, colTasks.length));

      setLocalTasks((prev) => moveTaskInList(prev, activeTask, targetColumnId, insertPosition));
      try {
        await moveTask(activeTask.id, targetColumnId, insertPosition);
      } catch (error) {
        setLocalTasks(tasks);
        console.error('Failed to move task', error);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveDragTask(null);
        setIsDragging(false);
      }}
    >
      {/* Horizontally scrollable board. */}
      <div
        ref={scrollContainerRef}
        className={`kanban-board-scroll flex min-h-full items-start gap-3 overflow-x-auto pb-4 px-4 ${isDragging ? 'snap-none' : 'snap-x snap-mandatory'}`}
      >
        {visibleColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={getTasksByColumn(column.id)}
            onTaskClick={onTaskClick}
            onAddTask={canCreateTask ? onAddTask : undefined}
            onRenameColumn={canManageColumns ? onRenameColumn : undefined}
            onDuplicateColumn={canManageColumns ? onDuplicateColumn : undefined}
            onMoveColumn={canManageColumns ? onMoveColumn : undefined}
            onDeleteColumn={canManageColumns ? onDeleteColumn : undefined}
            canDeleteColumn={visibleColumns.length > 1}
          />
        ))}

        {onAddColumn && canManageColumns && (
          <button
            type="button"
            onClick={() => onAddColumn()}
            className="mt-8 flex h-10 w-10 shrink-0 snap-start items-center justify-center rounded-[12px] border border-dashed border-[var(--tg-theme-hint-color)]/35 bg-[var(--tg-theme-secondary-bg-color)]/60 text-xl font-light text-[var(--tg-theme-hint-color)] transition-colors active:scale-95 hover:border-[var(--tg-theme-button-color)] hover:text-[var(--tg-theme-button-color)]"
            title="Добавить столбец"
            aria-label="Добавить столбец"
          >
            +
          </button>
        )}
      </div>

      {/* Drag preview. */}
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

function sameId(a: unknown, b: unknown) {
  return String(a) === String(b);
}

function toNumberId(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = typeof value === 'string' && value.startsWith('column:') ? value.slice('column:'.length) : value;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function reindexColumnTasks(tasks: Task[], columnId: number, orderedIds: number[]) {
  const order = new Map(orderedIds.map((id, index) => [String(id), index]));
  return tasks.map((task) => {
    const position = order.get(String(task.id));
    return position === undefined ? task : { ...task, columnId, position };
  });
}

function moveTaskInList(tasks: Task[], activeTask: Task, targetColumnId: number, targetPosition: number) {
  const sourceColumnId = activeTask.columnId;
  const withoutActive = tasks.filter((task) => !sameId(task.id, activeTask.id));
  const targetTasks = withoutActive
    .filter((task) => sameId(task.columnId, targetColumnId))
    .sort((a, b) => Number(a.position) - Number(b.position));
  const insertPosition = Math.max(0, Math.min(targetPosition, targetTasks.length));
  const movedTask = { ...activeTask, columnId: targetColumnId, position: insertPosition };
  targetTasks.splice(insertPosition, 0, movedTask);

  const changed = new Map<string, Task>();
  targetTasks.forEach((task, index) => {
    changed.set(String(task.id), { ...task, columnId: targetColumnId, position: index });
  });

  if (!sameId(sourceColumnId, targetColumnId)) {
    withoutActive
      .filter((task) => sameId(task.columnId, sourceColumnId))
      .sort((a, b) => Number(a.position) - Number(b.position))
      .forEach((task, index) => {
        changed.set(String(task.id), { ...task, position: index });
      });
  }

  return [...withoutActive, movedTask].map((task) => changed.get(String(task.id)) ?? task);
}

