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
  // Р›РѕРєР°Р»СЊРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ РґР»СЏ РѕРїС‚РёРјРёСЃС‚РёС‡РЅРѕРіРѕ UI РІРѕ РІСЂРµРјСЏ РїРµСЂРµС‚Р°СЃРєРёРІР°РЅРёСЏ
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);

  // РЎРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµРј РµСЃР»Рё tasks СЃРЅР°СЂСѓР¶Рё РёР·РјРµРЅРёР»СЃСЏ
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

  // РЎРµРЅСЃРѕСЂС‹ вЂ” РїРѕРґРґРµСЂР¶РєР° Рё РјС‹С€Рё Рё С‚Р°С‡
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

  // в”Ђв”Ђв”Ђ РќР°С‡Р°Р»Рѕ РїРµСЂРµС‚Р°СЃРєРёРІР°РЅРёСЏ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const task = localTasks.find((t) => t.id === active.id);
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

    const columnNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-kanban-column-id]'));
    const hit = columnNodes.find((node) => {
      const rect = node.getBoundingClientRect();
      const isInsideX = pointerX >= rect.left && pointerX <= rect.right;
      const isInsideY = pointerY === null || (pointerY >= rect.top - 24 && pointerY <= rect.bottom + 24);
      return isInsideX && isInsideY;
    });
    if (hit?.dataset.kanbanColumnId) return Number(hit.dataset.kanbanColumnId);

    const nearest = columnNodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        return { id: Number(node.dataset.kanbanColumnId), distance: Math.abs(pointerX - centerX) };
      })
      .filter((item) => Number.isFinite(item.id))
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest?.id;
  };

  // в”Ђв”Ђв”Ђ РџРµСЂРµС‚Р°СЃРєРёРІР°РЅРёРµ РЅР°Рґ РЅРѕРІРѕР№ РєРѕР»РѕРЅРєРѕР№ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const originalTask = activeDragTask;
    setActiveDragTask(null);
    setIsDragging(false);
    if (!over) return;

    const activeTask = originalTask ?? localTasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = over.id;
    const overData = over.data.current;

    let targetColumnId = activeTask.columnId;
    let targetPosition: number | undefined;
    const pointerColumnId = getPointerColumnId();

    if (overData?.type === 'task') {
      const overTask = localTasks.find((t) => t.id === overId);
      if (overTask) {
        targetColumnId = pointerColumnId ?? overTask.columnId;
        // РџРµСЂРµСѓРїРѕСЂСЏРґРѕС‡РёРІР°РЅРёРµ РІРЅСѓС‚СЂРё РєРѕР»РѕРЅРєРё
        const colTasks = getTasksByColumn(targetColumnId);
        const oldIdx = colTasks.findIndex((t) => t.id === active.id);
        const newIdx = colTasks.findIndex((t) => t.id === overId);

        if (activeTask.columnId === overTask.columnId && targetColumnId === overTask.columnId && oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
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
    } else if (pointerColumnId !== undefined) {
      targetColumnId = pointerColumnId;
    } else if (overData?.type === 'column') {
      targetColumnId = overData.columnId;
    }

    // РџРµСЂРµРјРµС‰РµРЅРёРµ РјРµР¶РґСѓ РєРѕР»РѕРЅРєР°РјРё
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
      {/* Р“РѕСЂРёР·РѕРЅС‚Р°Р»СЊРЅС‹Р№ СЃРєСЂРѕР»Р» */}
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
            onAddTask={onAddTask}
            onRenameColumn={onRenameColumn}
            onDuplicateColumn={onDuplicateColumn}
            onMoveColumn={onMoveColumn}
            onDeleteColumn={onDeleteColumn}
            canDeleteColumn={visibleColumns.length > 1}
          />
        ))}

        {onAddColumn && (
          <button
            type="button"
            onClick={() => onAddColumn()}
            className="mt-8 flex h-10 w-10 shrink-0 snap-start items-center justify-center rounded-[12px] border border-dashed border-[var(--tg-theme-hint-color)]/35 bg-[var(--tg-theme-secondary-bg-color)]/60 text-xl font-light text-[var(--tg-theme-hint-color)] transition-colors active:scale-95 hover:border-[var(--tg-theme-button-color)] hover:text-[var(--tg-theme-button-color)]"
            title="Р”РѕР±Р°РІРёС‚СЊ СЃС‚РѕР»Р±РµС†"
            aria-label="Р”РѕР±Р°РІРёС‚СЊ СЃС‚РѕР»Р±РµС†"
          >
            +
          </button>
        )}
      </div>

      {/* Overlay вЂ” РєР°СЂС‚РѕС‡РєР° РІРѕ РІСЂРµРјСЏ РїРµСЂРµС‚Р°СЃРєРёРІР°РЅРёСЏ */}
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

