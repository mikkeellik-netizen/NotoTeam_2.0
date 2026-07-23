import { useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PageNode } from '../../types';

// Порог смещения по горизонтали для вложения (вправо) / извлечения (влево).
const NEST_THRESHOLD = 40;

function isDescendant(nodes: PageNode[], possibleChildId: string, ancestorId: string): boolean {
  let current = nodes.find((node) => node.id === possibleChildId);
  while (current) {
    if (current.id === ancestorId) return true;
    if (current.parentId === ancestorId) return true;
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) : undefined;
  }
  return false;
}

interface Props {
  items: PageNode[];
  parentId: string | null;
  allNodes: PageNode[];
  onReorder: (id: string, index: number) => void;
  onNest: (id: string, targetId: string) => void;
  onOutdent?: (id: string) => void;
  renderRow: (node: PageNode, isNestTarget: boolean) => ReactNode;
}

// Перетаскивание на телефоне: удержать ~1с, затем
//   вверх/вниз — переставить, вправо на элемент — вложить, влево — вытащить на уровень выше.
export default function HierarchyDnd({ items, parentId, allNodes, onReorder, onNest, onOutdent, renderRow }: Props) {
  const sensors = useSensors(
    // MouseSensor — только для ПК (мышь). TouchSensor — для касаний с задержкой ~1с.
    // Важно: НЕ используем PointerSensor, иначе он перехватывает касания сразу,
    // и задержка TouchSensor не срабатывает (drag стартует слишком быстро).
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 8 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [nesting, setNesting] = useState(false);
  const [deltaX, setDeltaX] = useState(0);

  const activeNode = items.find((node) => node.id === activeId) ?? allNodes.find((node) => node.id === activeId);

  const handleStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDeltaX(0);
    setNesting(false);
  };

  const handleMove = (event: DragMoveEvent) => {
    const dx = event.delta.x;
    setDeltaX(dx);
    const over = event.over?.id ? String(event.over.id) : null;
    setOverId(over);
    const canNest =
      dx > NEST_THRESHOLD && over != null && over !== activeId && !isDescendant(allNodes, over, String(activeId));
    setNesting(canNest);
  };

  const handleEnd = (event: DragEndEvent) => {
    const active = String(event.active.id);
    const over = event.over?.id ? String(event.over.id) : null;
    const dx = event.delta.x;
    const wasNesting = dx > NEST_THRESHOLD && over != null && over !== active && !isDescendant(allNodes, over, active);
    const wantsOutdent = dx < -NEST_THRESHOLD && parentId !== null && onOutdent;

    if (wasNesting && over) {
      onNest(active, over);
    } else if (wantsOutdent && onOutdent) {
      onOutdent(active);
    } else if (over && over !== active) {
      const index = items.findIndex((node) => node.id === over);
      if (index >= 0) onReorder(active, index);
    }

    setActiveId(null);
    setOverId(null);
    setNesting(false);
    setDeltaX(0);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleStart}
      onDragMove={handleMove}
      onDragEnd={handleEnd}
      onDragCancel={() => {
        setActiveId(null);
        setOverId(null);
        setNesting(false);
      }}
    >
      <SortableContext items={items.map((node) => node.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1">
          {items.map((node) => (
            <SortableRow key={node.id} id={node.id}>
              {(handleProps) => (
                // Вся строка — область перетаскивания (долгое нажатие начинает drag).
                // Быстрый тап проходит на кнопки внутри (открыть/иконка/★/✎/×).
                <div {...handleProps.attributes} {...handleProps.listeners} className="touch-none">
                  {renderRow(node, activeId != null && overId === node.id && nesting && node.id !== activeId)}
                </div>
              )}
            </SortableRow>
          ))}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeNode ? (
          <div className="flex items-center gap-2 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 shadow-lg opacity-95">
            <span className="text-xl">{activeNode.icon}</span>
            <span className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{activeNode.title}</span>
            {deltaX > NEST_THRESHOLD && (
              <span className="ml-1 shrink-0 rounded-full bg-[var(--tg-theme-button-color)]/20 px-2 py-0.5 text-[11px] text-[var(--tg-theme-button-color)]">
                вложить →
              </span>
            )}
            {deltaX < -NEST_THRESHOLD && parentId !== null && (
              <span className="ml-1 shrink-0 rounded-full bg-[var(--tg-theme-button-color)]/20 px-2 py-0.5 text-[11px] text-[var(--tg-theme-button-color)]">
                ← вытащить
              </span>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handle: { attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown> | undefined,
      })}
    </div>
  );
}
