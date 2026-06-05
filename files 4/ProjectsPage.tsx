import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import type { Project } from '../types';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, isLoading, fetchProjects, createProject } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const project = await createProject({ title: title.trim(), description });
      setShowCreate(false);
      setTitle('');
      setDescription('');
      navigate(`/project/${project.id}/workspace`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--tg-theme-bg-color)]">
      {/* Шапка */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <h1 className="text-xl font-bold text-[var(--tg-theme-text-color)]">Мои проекты</h1>
        <button
          onClick={() => navigate('/my-tasks')}
          className="text-sm text-[var(--tg-theme-link-color)] font-medium"
        >
          Мои задачи
        </button>
      </div>

      {/* Список проектов */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--tg-theme-button-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-[var(--tg-theme-hint-color)] text-sm">Нет проектов</p>
            <p className="text-[var(--tg-theme-hint-color)] text-xs mt-1">Создай первый проект</p>
          </div>
        ) : (
          projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => navigate(`/project/${project.id}/workspace`)}
            />
          ))
        )}
      </div>

      {/* Кнопка создания */}
      <div className="px-4 pb-6 pt-2">
        <button
          onClick={() => setShowCreate(true)}
          className="w-full py-3.5 rounded-[12px] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] font-semibold text-base"
        >
          + Создать проект
        </button>
      </div>

      {/* Модалка создания */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="w-full bg-[var(--tg-theme-bg-color)] rounded-t-2xl p-5 animate-slide-up">
            <h2 className="text-lg font-bold mb-4 text-[var(--tg-theme-text-color)]">
              Новый проект
            </h2>

            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название проекта"
              className="w-full px-4 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none text-base mb-3"
              maxLength={100}
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Описание (необязательно)"
              rows={3}
              className="w-full px-4 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none text-base resize-none mb-4"
              maxLength={500}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)] font-medium"
              >
                Отмена
              </button>
              <button
                onClick={handleCreate}
                disabled={!title.trim() || creating}
                className="flex-1 py-3 rounded-[12px] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] font-semibold disabled:opacity-50"
              >
                {creating ? 'Создаю...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Карточка проекта ─────────────────────────────────────────
function ProjectCard({ project, onClick }: { project: Project & { overdueCount?: number }; onClick: () => void }) {
  const members = project.members ?? [];
  const taskCount = project._count?.tasks ?? 0;
  const overdueCount = (project as any).overdueCount ?? 0;

  return (
    <div
      onClick={onClick}
      className="bg-[var(--tg-theme-secondary-bg-color)] rounded-[12px] p-4 active:scale-[0.98] transition-transform cursor-pointer"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-[var(--tg-theme-text-color)] text-base leading-tight flex-1 mr-2">
          {project.title}
        </h3>
        <span className="text-xs text-[var(--tg-theme-hint-color)] shrink-0">›</span>
      </div>

      {project.description && (
        <p className="text-sm text-[var(--tg-theme-hint-color)] mb-3 line-clamp-2">
          {project.description}
        </p>
      )}

      <div className="flex items-center gap-3 text-xs">
        {/* Задачи */}
        <span className="text-[var(--tg-theme-hint-color)]">
          📋 {taskCount} задач
        </span>

        {/* Просрочки */}
        {overdueCount > 0 && (
          <span className="text-red-500 font-medium">
            🔴 {overdueCount} просрочено
          </span>
        )}

        {/* Участники */}
        {members.length > 0 && (
          <div className="flex -space-x-1 ml-auto">
            {members.slice(0, 4).map((m) => (
              <div
                key={m.id}
                className="w-6 h-6 rounded-full bg-[var(--tg-theme-button-color)] flex items-center justify-center text-[var(--tg-theme-button-text-color)] text-xs font-bold border-2 border-[var(--tg-theme-secondary-bg-color)]"
              >
                {(m.user?.firstName?.[0] || m.user?.username?.[0] || '?').toUpperCase()}
              </div>
            ))}
            {members.length > 4 && (
              <div className="w-6 h-6 rounded-full bg-[var(--tg-theme-hint-color)] flex items-center justify-center text-white text-xs border-2 border-[var(--tg-theme-secondary-bg-color)]">
                +{members.length - 4}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
