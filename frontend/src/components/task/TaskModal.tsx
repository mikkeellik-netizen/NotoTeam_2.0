import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTaskStore } from '../../store/taskStore';
import { usePageStore } from '../../store/pageStore';
import { useProjectStore } from '../../store/projectStore';
import SubtaskList from './SubtaskList';
import type { Task, Priority, ProjectMember } from '../../types';
import { PRIORITY_LABEL, PRIORITY_COLOR, getDeadlineZone } from '../../types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Props {
  task: Task;
  members: ProjectMember[];
  onClose: () => void;
}

const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const COLOR_LABELS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
];

export default function TaskModal({ task, members, onClose }: Props) {
  const { updateTask, moveTask, archiveTask } = useTaskStore();
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const nodes = usePageStore((state) => state.nodes);
  const columns = useProjectStore((state) => state.columns);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [assigneeId, setAssigneeId] = useState<number | undefined>(task.assigneeId ?? task.assignee?.id);
  const [deadlineAt, setDeadlineAt] = useState(
    task.deadlineAt ? task.deadlineAt.slice(0, 16) : '',
  );
  const [colorLabel, setColorLabel] = useState(task.colorLabel ?? '');
  const [linkedPageIds, setLinkedPageIds] = useState<string[]>(task.linkedPageIds ?? []);
  const [saving, setSaving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const zone = getDeadlineZone(task.deadlineAt);
  const zoneColor = zone === 'red' ? '#EF4444' : zone === 'yellow' ? '#F59E0B' : '#22C55E';
  const visibleColumns = [...columns]
    .filter((column) => !column.isHidden)
    .sort((a, b) => a.position - b.position);
  const finalColumn = visibleColumns[visibleColumns.length - 1];
  const isInFinalColumn = Boolean(finalColumn && task.columnId === finalColumn.id);
  const finalColumnActionLabel = finalColumn ? `В ${finalColumn.title}` : 'В последний столбец';

  const isDirty =
    title !== task.title ||
    description !== (task.description ?? '') ||
    priority !== task.priority ||
    assigneeId !== (task.assigneeId ?? task.assignee?.id) ||
    deadlineAt !== (task.deadlineAt ? task.deadlineAt.slice(0, 16) : '') ||
    colorLabel !== (task.colorLabel ?? '') ||
    JSON.stringify(linkedPageIds) !== JSON.stringify(task.linkedPageIds ?? []);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await updateTask(task.id, {
        title: title.trim(),
        description,
        priority,
        assigneeId,
        deadlineAt: deadlineAt || undefined,
        colorLabel: colorLabel || undefined,
        linkedPageIds,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleMoveToFinalColumn = async () => {
    if (finalColumn) {
      await moveTask(task.id, finalColumn.id);
    }
    onClose();
  };

  const handleArchiveAction = async () => {
    await archiveTask(task.id);
    onClose();
  };

  const subtasks = task.subtasks ?? [];
  const completedSubtasks = subtasks.filter((s) => s.isCompleted).length;
  const linkablePages = nodes.filter((node) => node.type !== 'folder');
  const linkedPages = linkedPageIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={onClose}>
      <div
        className="w-full bg-[var(--tg-theme-bg-color)] rounded-t-2xl max-h-[92vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Хэндл */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--tg-theme-hint-color)] opacity-30" />
        </div>

        {/* Цветовая полоска */}
        {colorLabel && (
          <div className="h-1 mx-4 rounded-full" style={{ backgroundColor: colorLabel }} />
        )}

        {/* Контент */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Название */}
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            rows={2}
            className="w-full text-lg font-bold text-[var(--tg-theme-text-color)] bg-transparent resize-none outline-none leading-tight"
            placeholder="Название задачи"
          />

          {/* Мета-строка */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Приоритет */}
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="text-xs px-2.5 py-1 rounded-full font-medium border-0 outline-none"
              style={{
                backgroundColor: PRIORITY_COLOR[priority] + '20',
                color: PRIORITY_COLOR[priority],
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>

            {/* Дедлайн */}
            {task.deadlineAt && (
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ backgroundColor: zoneColor + '20', color: zoneColor }}
              >
                📅 {format(new Date(task.deadlineAt), 'd MMM, HH:mm', { locale: ru })}
              </span>
            )}
          </div>

          {/* Описание */}
          <div>
            <label className="text-xs text-[var(--tg-theme-hint-color)] font-medium mb-1 block">
              Описание
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Добавь описание..."
              className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none text-sm resize-none"
            />
          </div>

          {/* Подзадачи */}
          <div className="pb-1">
            <label className="text-xs text-[var(--tg-theme-hint-color)] font-medium mb-2 block">
              Подзадачи {subtasks.length > 0 && `(${completedSubtasks}/${subtasks.length})`}
            </label>
            <SubtaskList taskId={task.id} subtasks={subtasks} />
          </div>

          {/* Исполнитель */}
          <div>
            <label className="text-xs text-[var(--tg-theme-hint-color)] font-medium mb-1 block">
              Исполнитель
            </label>
            <select
              value={assigneeId ?? ''}
              onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none text-sm"
            >
              <option value="">Не назначен</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user?.firstName
                    ? `${m.user.firstName}${m.user.lastName ? ' ' + m.user.lastName : ''}`
                    : m.user?.username ?? `ID ${m.userId}`}
                </option>
              ))}
            </select>
          </div>

          {/* Дедлайн */}
          <div>
            <label className="text-xs text-[var(--tg-theme-hint-color)] font-medium mb-1 block">
              Дедлайн
            </label>
            <input
              type="datetime-local"
              value={deadlineAt}
              onChange={(e) => setDeadlineAt(e.target.value)}
              className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none text-sm"
            />
          </div>

          {/* Цветовая метка */}
          <div>
            <label className="text-xs text-[var(--tg-theme-hint-color)] font-medium mb-2 block">
              Цветовая метка
            </label>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setColorLabel('')}
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                  !colorLabel ? 'border-[var(--tg-theme-button-color)]' : 'border-transparent'
                } bg-[var(--tg-theme-secondary-bg-color)]`}
              >
                <svg className="w-3.5 h-3.5 text-[var(--tg-theme-hint-color)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {COLOR_LABELS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColorLabel(c)}
                  className="w-7 h-7 rounded-full border-2 transition-transform active:scale-90"
                  style={{
                    backgroundColor: c,
                    borderColor: colorLabel === c ? 'var(--tg-theme-text-color)' : 'transparent',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Связанные страницы */}
          <div>
            <label className="text-xs text-[var(--tg-theme-hint-color)] font-medium mb-2 block">
              Связанные страницы
            </label>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) return;
                setLinkedPageIds((ids) => [...new Set([...ids, event.target.value])]);
              }}
              className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none text-sm"
            >
              <option value="">Прикрепить страницу</option>
              {linkablePages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.icon} {page.title}
                </option>
              ))}
            </select>
            <div className="mt-2 space-y-1">
              {linkedPages.map((page: any) => (
                <div key={page.id} className="flex items-center gap-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/project/${projectId ?? task.projectId}/workspace/page/${page.id}`);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm text-[var(--tg-theme-link-color)]"
                  >
                    {page.icon} {page.title}
                  </button>
                  <button
                    onClick={() => setLinkedPageIds((ids) => ids.filter((id) => id !== page.id))}
                    className="text-[var(--tg-theme-hint-color)]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Кнопки действий */}
        <div className="px-4 pb-6 pt-3 space-y-2 border-t border-[var(--tg-theme-secondary-bg-color)]">
          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="w-full py-3 rounded-[12px] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] font-semibold disabled:opacity-50"
            >
              {saving ? 'Сохраняю...' : 'Сохранить изменения'}
            </button>
          )}

          {showArchiveConfirm ? (
            <div className="flex gap-2">
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="flex-1 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] font-medium"
              >
                Отмена
              </button>
              {!isInFinalColumn && (
                <button
                  onClick={handleMoveToFinalColumn}
                  className="flex-1 py-3 rounded-[12px] bg-green-500 text-white font-semibold"
                >
                  {finalColumnActionLabel}
                </button>
              )}
              <button
                onClick={handleArchiveAction}
                className="flex-1 py-3 rounded-[12px] bg-red-500 text-white font-semibold"
              >
                В архив
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              className="w-full py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] font-medium"
            >
              {isInFinalColumn ? 'В архив' : 'Закрыть задачу'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
