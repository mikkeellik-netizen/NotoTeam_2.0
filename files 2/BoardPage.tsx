import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useTaskStore } from '../store/taskStore';
import KanbanBoard from '../components/board/KanbanBoard';
import TaskModal from '../components/task/TaskModal';
import CreateTaskModal from '../components/board/CreateTaskModal';
import type { Task } from '../types';

export default function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);

  const { currentProject, columns, fetchProject } = useProjectStore();
  const { tasks, fetchTasks, openTask, closeTask, selectedTask, createTask } = useTaskStore();

  const [createColumnId, setCreateColumnId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    fetchProject(pid);
    fetchTasks(pid);
  }, [pid]);

  const members = currentProject?.members ?? [];

  const handleAddTask = (columnId: number) => {
    setCreateColumnId(columnId);
  };

  const handleTaskClick = async (task: Task) => {
    await openTask(task.id);
  };

  const handleCreateTask = async (data: any) => {
    await createTask(pid, data);
  };

  const filteredTasks = searchQuery
    ? tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : tasks;

  return (
    <div className="flex flex-col h-full bg-[var(--tg-theme-bg-color)]">
      {/* Шапка */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
        {/* Назад */}
        <button
          onClick={() => navigate('/')}
          className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-link-color)]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Название проекта */}
        {showSearch ? (
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск задач..."
            className="flex-1 bg-[var(--tg-theme-secondary-bg-color)] px-3 py-1.5 rounded-[8px] text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
            onBlur={() => {
              if (!searchQuery) setShowSearch(false);
            }}
          />
        ) : (
          <h1 className="flex-1 font-bold text-[var(--tg-theme-text-color)] truncate">
            {currentProject?.title ?? '...'}
          </h1>
        )}

        {/* Поиск */}
        <button
          onClick={() => {
            if (showSearch && searchQuery) { setSearchQuery(''); }
            setShowSearch((v) => !v);
          }}
          className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-hint-color)]"
        >
          {showSearch && searchQuery ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </button>

        {/* Настройки */}
        <button
          onClick={() => navigate(`/project/${pid}/settings`)}
          className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-hint-color)]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Нижняя навигация */}
      <div className="flex border-b border-[var(--tg-theme-secondary-bg-color)]">
        {[
          { label: 'Доска', active: true },
          { label: 'Участники', onClick: () => navigate(`/project/${pid}/members`) },
          { label: 'Архив', onClick: () => navigate(`/project/${pid}/archive`) },
        ].map(({ label, active, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors ${
              active
                ? 'border-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-color)]'
                : 'border-transparent text-[var(--tg-theme-hint-color)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Kanban доска */}
      <div className="flex-1 overflow-hidden py-3">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-[var(--tg-theme-button-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <KanbanBoard
            columns={columns}
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
            onAddTask={handleAddTask}
          />
        )}
      </div>

      {/* FAB — добавить задачу */}
      <button
        onClick={() => {
          const defaultCol = columns.find((c) => c.isDefault) ?? columns[0];
          if (defaultCol) setCreateColumnId(defaultCol.id);
        }}
        className="fixed bottom-6 right-4 w-14 h-14 rounded-full bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] shadow-lg flex items-center justify-center text-2xl z-40 active:scale-90 transition-transform"
      >
        +
      </button>

      {/* Модалка задачи */}
      {selectedTask && (
        <TaskModal
          task={selectedTask}
          members={members}
          onClose={closeTask}
        />
      )}

      {/* Модалка создания задачи */}
      {createColumnId !== null && (
        <CreateTaskModal
          columns={columns}
          members={members}
          defaultColumnId={createColumnId}
          onConfirm={handleCreateTask}
          onClose={() => setCreateColumnId(null)}
        />
      )}
    </div>
  );
}
