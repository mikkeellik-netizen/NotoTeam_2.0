import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { projectsApi } from '../api/projects';
import { systemApi } from '../api/system';
import UserAvatarImage from '../components/UserAvatarImage';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';
import type { Project, ProjectMember } from '../types';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const { projects, isLoading, fetchProjects, createProject } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState('');
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isSystemOwner, setIsSystemOwner] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    systemApi.access(user.id)
      .then((result) => setIsSystemOwner(result.isOwner))
      .catch(() => setIsSystemOwner(false));
  }, [user?.id]);

  useEffect(() => {
    const inviteCode = getInviteCodeFromParams(searchParams);
    if (!inviteCode) return;
    setJoinCode(inviteCode);
    setShowJoin(true);
  }, [searchParams]);

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

  const handleJoin = async () => {
    if (!joinCode.trim() || !user) return;
    setJoinStatus('');
    try {
      await projectsApi.requestJoinByCode(
        joinCode,
        user.username ?? user.telegramId,
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || user.telegramId,
        user.id,
      );
      setJoinCode('');
      setJoinStatus('Заявка отправлена владельцу проекта.');
      setJoinSubmitted(true);
      await fetchProjects();
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Не удалось отправить заявку.');
      setJoinSubmitted(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--tg-theme-bg-color)]">
      <div className="flex items-center justify-between border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--tg-theme-text-color)]">Мои проекты</h1>
          {user && (
            <p className="mt-0.5 text-xs text-[var(--tg-theme-hint-color)]">
              @{user.username ?? user.telegramId}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSystemOwner && (
            <button
              onClick={() => navigate('/system-admin')}
              className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-link-color)]"
              aria-label="Системная панель"
            >
              ◉
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyProjectsState onCreate={() => setShowCreate(true)} onJoin={() => setShowJoin(true)} />
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

      <div className="px-4 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-[12px] bg-[var(--tg-theme-button-color)] py-3.5 text-base font-semibold text-[var(--tg-theme-button-text-color)]"
          >
            + Создать
          </button>
          <button
            onClick={() => setShowJoin(true)}
            className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3.5 text-base font-semibold text-[var(--tg-theme-text-color)]"
          >
            Код проекта
          </button>
        </div>
      </div>

      {showCreate && (
        <ProjectCreateSheet
          title={title}
          description={description}
          creating={creating}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onCancel={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {showJoin && (
        <JoinProjectSheet
          code={joinCode}
          status={joinStatus}
          submitted={joinSubmitted}
          onCodeChange={setJoinCode}
          onCancel={() => {
            setShowJoin(false);
            setJoinSubmitted(false);
          }}
          onSubmit={handleJoin}
          onRefresh={fetchProjects}
        />
      )}
    </div>
  );
}

function EmptyProjectsState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="py-12">
      <div className="text-center">
        <div className="mb-3 text-4xl">📋</div>
        <p className="text-sm text-[var(--tg-theme-hint-color)]">Проектов пока нет</p>
        <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
          Создай личный проект или подключись к командному по коду
        </p>
      </div>
      <div className="mt-6 space-y-3">
        <button
          onClick={onCreate}
          className="w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3.5 font-semibold text-[var(--tg-theme-button-text-color)]"
        >
          + Создать проект
        </button>
        <button
          onClick={onJoin}
          className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3.5 font-semibold text-[var(--tg-theme-text-color)]"
        >
          Ввести код проекта
        </button>
      </div>
    </div>
  );
}

function ProjectCreateSheet(props: {
  title: string;
  description: string;
  creating: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50">
      <div className="w-full animate-slide-up rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5">
        <h2 className="mb-4 text-lg font-bold text-[var(--tg-theme-text-color)]">Новый проект</h2>
        <input
          autoFocus
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          placeholder="Название проекта"
          className="mb-3 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-base text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
          maxLength={100}
        />
        <textarea
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          placeholder="Описание, если нужно"
          rows={3}
          className="mb-4 w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-base text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
          maxLength={500}
        />
        <div className="flex gap-3">
          <button
            onClick={props.onCancel}
            className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
          >
            Отмена
          </button>
          <button
            onClick={props.onCreate}
            disabled={!props.title.trim() || props.creating}
            className="flex-1 rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
          >
            {props.creating ? 'Создаю...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

function JoinProjectSheet(props: {
  code: string;
  status: string;
  submitted: boolean;
  onCodeChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50">
      <div className="w-full animate-slide-up rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5">
        <h2 className="mb-4 text-lg font-bold text-[var(--tg-theme-text-color)]">
          {props.submitted ? 'Заявка отправлена' : 'Подключиться к проекту'}
        </h2>
        {props.submitted ? (
          <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <p className="text-sm text-[var(--tg-theme-text-color)]">
              Владелец проекта получил заявку. Когда он подтвердит доступ, проект появится в списке.
            </p>
          </div>
        ) : (
          <input
            autoFocus
            value={props.code}
            onChange={(event) => props.onCodeChange(event.target.value.toUpperCase())}
            placeholder="Код проекта"
            className="mb-3 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-base text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
          />
        )}
        {props.status && <p className="mb-3 text-sm text-[var(--tg-theme-hint-color)]">{props.status}</p>}
        <div className="flex gap-3">
          <button
            onClick={props.onCancel}
            className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
          >
            {props.submitted ? 'Закрыть' : 'Отмена'}
          </button>
          {props.submitted ? (
            <button
              onClick={props.onRefresh}
              className="flex-1 rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)]"
            >
              Обновить
            </button>
          ) : (
            <button
              onClick={props.onSubmit}
              disabled={!props.code.trim()}
              className="flex-1 rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
            >
              Отправить заявку
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: Project & { overdueCount?: number }; onClick: () => void }) {
  const members = project.members ?? [];
  const taskCount = project._count?.tasks ?? 0;
  const overdueCount = (project as any).overdueCount ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4 text-left transition-transform active:scale-[0.98]"
    >
      <div className="mb-2 flex items-start justify-between">
        <h3 className="mr-2 flex-1 text-base font-semibold leading-tight text-[var(--tg-theme-text-color)]">
          {project.title}
        </h3>
        <span className="shrink-0 text-xs text-[var(--tg-theme-hint-color)]">›</span>
      </div>

      {project.description && (
        <p className="mb-3 line-clamp-2 text-sm text-[var(--tg-theme-hint-color)]">
          {project.description}
        </p>
      )}

      <div className="flex items-center gap-3 text-xs">
        <span className="text-[var(--tg-theme-hint-color)]">📋 {taskCount} задач</span>
        {overdueCount > 0 && (
          <span className="font-medium text-red-500">🔴 {overdueCount} просрочено</span>
        )}
        {members.length > 0 && (
          <div className="ml-auto flex -space-x-1">
            {members.slice(0, 4).map((member) => (
              <UserAvatarImage
                key={member.id}
                user={member.user}
                label={projectMemberLabel(member)}
                size="xs"
                className="border-2 border-[var(--tg-theme-secondary-bg-color)]"
              />
            ))}
            {members.length > 4 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-hint-color)] text-xs text-white">
                +{members.length - 4}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function getInviteCodeFromParams(searchParams: URLSearchParams) {
  const raw =
    searchParams.get('join') ??
    searchParams.get('code') ??
    searchParams.get('startapp') ??
    searchParams.get('tgWebAppStartParam');

  if (!raw) return '';
  return raw.trim().replace(/^join[_-]/i, '').toUpperCase();
}

function projectMemberLabel(member: ProjectMember) {
  const user = member.user;
  return (
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.username ||
    user?.telegramId ||
    '?'
  );
}
