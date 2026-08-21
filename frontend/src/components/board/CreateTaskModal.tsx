import { useState } from 'react';
import type { Column, Priority, ProjectMember, Task, TaskImportanceScore } from '../../types';
import { TASK_IMPORTANCE_LABEL } from '../../types';

interface Props {
  columns: Column[];
  members: ProjectMember[];
  defaultColumnId: number;
  onConfirm: (data: Partial<Task>) => Promise<void>;
  onClose: () => void;
}

const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function CreateTaskModal({
  columns,
  members,
  defaultColumnId,
  onConfirm,
  onClose,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId);
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [importanceScore, setImportanceScore] = useState<TaskImportanceScore>(3);
  const [isBlocking, setIsBlocking] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [deferOpen, setDeferOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const member = members.find((item) => String(item.userId) === assigneeId);
      await onConfirm({
        title: title.trim(),
        description,
        columnId,
        priority,
        importanceScore,
        isBlocking,
        deadlineAt: deadlineAt || undefined,
        scheduledAt: scheduledAt || undefined,
        assigneeId: member?.userId,
        assignee: member?.user,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50" onClick={onClose}>
      <div
        className="w-full bg-[var(--tg-theme-bg-color)] rounded-t-2xl p-5 animate-slide-up"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4 text-[var(--tg-theme-text-color)]">Новая задача</h2>

        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Название задачи"
          className="w-full px-4 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none mb-3"
        />

        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Описание"
          rows={3}
          className="w-full px-4 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none resize-none mb-3"
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <select
            value={columnId}
            onChange={(event) => setColumnId(Number(event.target.value))}
            className="px-3 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none"
          >
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.title}
              </option>
            ))}
          </select>

          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
            className="px-3 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none"
          >
            {PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <input
            type="datetime-local"
            value={deadlineAt}
            onChange={(event) => setDeadlineAt(event.target.value)}
            className="min-w-0 px-3 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none"
          />

          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="min-w-0 px-3 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] outline-none"
          >
            <option value="">Без исполнителя</option>
            {members.map((member) => (
              <option key={member.id} value={member.userId}>
                {member.user?.firstName ?? member.user?.username ?? `ID ${member.userId}`}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Значимость</span>
            <span className="rounded-full bg-[var(--tg-theme-bg-color)] px-2 py-1 text-xs font-semibold text-[var(--tg-theme-hint-color)]">
              {importanceScore}/5
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {([1, 2, 3, 4, 5] as TaskImportanceScore[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setImportanceScore(value)}
                className={`rounded-[9px] px-1 py-2 text-xs font-semibold ${
                  importanceScore === value
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                }`}
                title={TASK_IMPORTANCE_LABEL[value]}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)]">
            <span>Блокирует других</span>
            <input type="checkbox" checked={isBlocking} onChange={(event) => setIsBlocking(event.target.checked)} />
          </label>
        </div>

        <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <button
            type="button"
            onClick={() => setDeferOpen((value) => !value)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-[var(--tg-theme-text-color)]"
          >
            <span>Отложить задачу</span>
            <span className="text-[var(--tg-theme-hint-color)]">{scheduledAt ? 'задано' : '+'}</span>
          </button>
          {deferOpen && (
            <div className="mt-3">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-[var(--tg-theme-text-color)] outline-none"
              />
              {scheduledAt && (
                <button
                  type="button"
                  onClick={() => setScheduledAt('')}
                  className="mt-2 text-xs font-medium text-red-400"
                >
                  Убрать отложенный старт
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] font-medium"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="flex-1 py-3 rounded-[12px] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] font-semibold disabled:opacity-50"
          >
            {saving ? 'Создаю...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
