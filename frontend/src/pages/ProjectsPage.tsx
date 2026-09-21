import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderKanban,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { projectsApi } from '../api/projects';
import { systemApi } from '../api/system';
import UserAvatarImage from '../components/UserAvatarImage';
import { Button, IconButton, Modal, Surface, TextArea, TextField } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';
import type { Project, ProjectMember } from '../types';

type ProjectWithStats = Project & { overdueCount?: number };

const PROJECT_ACCENTS = [
  {
    icon: 'text-[var(--nt-color-project-blue)]',
    background: 'bg-[color-mix(in_srgb,var(--nt-color-project-blue)_16%,var(--nt-color-surface))]',
  },
  {
    icon: 'text-[var(--nt-color-project-green)]',
    background: 'bg-[color-mix(in_srgb,var(--nt-color-project-green)_16%,var(--nt-color-surface))]',
  },
  {
    icon: 'text-[var(--nt-color-project-violet)]',
    background: 'bg-[color-mix(in_srgb,var(--nt-color-project-violet)_16%,var(--nt-color-surface))]',
  },
  {
    icon: 'text-[var(--nt-color-project-amber)]',
    background: 'bg-[color-mix(in_srgb,var(--nt-color-project-amber)_16%,var(--nt-color-surface))]',
  },
] as const;

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const { projects, isLoading, fetchProjects, createProject } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState('');
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isSystemOwner, setIsSystemOwner] = useState(false);
  const [query, setQuery] = useState('');

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

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    setCreateError('');
    setShowCreate(true);
  }, [searchParams]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru');
    if (!normalizedQuery) return projects;
    return projects.filter((project) => (
      project.title.toLocaleLowerCase('ru').includes(normalizedQuery)
      || project.description?.toLocaleLowerCase('ru').includes(normalizedQuery)
    ));
  }, [projects, query]);

  const openCreate = () => {
    setCreateError('');
    setShowCreate(true);
  };

  const openJoin = () => {
    setJoinStatus('');
    setJoinSubmitted(false);
    setShowJoin(true);
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const project = await createProject({ title: title.trim(), description: description.trim() });
      setShowCreate(false);
      setTitle('');
      setDescription('');
      navigate(`/project/${project.id}/workspace`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Не удалось создать проект.');
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
      setJoinStatus('Владелец проекта получил заявку.');
      setJoinSubmitted(true);
      await fetchProjects();
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Не удалось отправить заявку.');
      setJoinSubmitted(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--nt-color-canvas)] text-[var(--nt-color-text)]">
      <div className="mx-auto w-full max-w-[var(--nt-content-lg)] px-4 py-5 sm:px-6 sm:py-6">
        <header className="flex flex-col gap-4 border-b border-[var(--nt-color-border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-[var(--nt-color-text-muted)]">Рабочее пространство</p>
            <h1 className="mt-1 text-2xl font-bold">Мои проекты</h1>
            <p className="mt-1 text-sm text-[var(--nt-color-text-muted)]">
              {projects.length > 0 ? `${formatProjectCount(projects.length)} в вашем доступе` : 'Создайте первый проект или подключитесь по коду'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" startIcon={<KeyRound size={17} />} onClick={openJoin}>
              По коду
            </Button>
            <Button startIcon={<Plus size={18} />} onClick={openCreate}>
              Новый проект
            </Button>
            {isSystemOwner && (
              <IconButton
                variant="secondary"
                aria-label="Открыть системную панель"
                title="Системная панель"
                onClick={() => navigate('/system-admin')}
              >
                <ShieldCheck size={19} />
              </IconButton>
            )}
          </div>
        </header>

        {projects.length > 0 && (
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <TextField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти проект"
              aria-label="Поиск проектов"
              startAdornment={<Search size={16} />}
              containerClassName="w-full sm:max-w-sm"
            />
            <p className="shrink-0 text-xs text-[var(--nt-color-text-muted)]" aria-live="polite">
              {query.trim() ? `Найдено: ${visibleProjects.length}` : `Всего: ${projects.length}`}
            </p>
          </div>
        )}

        <main className={projects.length > 0 ? '' : 'pt-5'}>
          {isLoading ? (
            <LoadingProjectsState />
          ) : projects.length === 0 ? (
            <EmptyProjectsState onCreate={openCreate} onJoin={openJoin} />
          ) : visibleProjects.length === 0 ? (
            <NoSearchResults query={query} onReset={() => setQuery('')} />
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))' }}
            >
              {visibleProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => navigate(`/project/${project.id}/workspace`)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <ProjectCreateModal
        open={showCreate}
        title={title}
        description={description}
        error={createError}
        creating={creating}
        onTitleChange={setTitle}
        onDescriptionChange={setDescription}
        onCancel={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

      <JoinProjectModal
        open={showJoin}
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
    </div>
  );
}

function LoadingProjectsState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-[var(--nt-color-text-muted)]" role="status">
      <LoaderCircle className="animate-spin text-[var(--nt-color-accent)]" size={28} />
      <p className="text-sm">Загружаем проекты...</p>
    </div>
  );
}

function EmptyProjectsState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <Surface tone="raised" padding="lg" className="mx-auto max-w-xl text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--nt-radius-control)] bg-[var(--nt-color-success-soft)] text-[var(--nt-color-success)]">
        <FolderKanban size={25} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-bold">Начните с первого проекта</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--nt-color-text-muted)]">
        Создайте собственное рабочее пространство или подключитесь к существующему проекту по коду приглашения.
      </p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        <Button startIcon={<Plus size={18} />} onClick={onCreate}>Создать проект</Button>
        <Button variant="secondary" startIcon={<KeyRound size={17} />} onClick={onJoin}>Ввести код</Button>
      </div>
    </Surface>
  );
}

function NoSearchResults({ query, onReset }: { query: string; onReset: () => void }) {
  return (
    <Surface tone="muted" padding="lg" className="text-center">
      <Search className="mx-auto text-[var(--nt-color-text-muted)]" size={24} aria-hidden="true" />
      <h2 className="mt-3 text-base font-bold">Проекты не найдены</h2>
      <p className="mt-1 text-sm text-[var(--nt-color-text-muted)]">По запросу «{query.trim()}» ничего нет.</p>
      <Button variant="ghost" className="mt-3" onClick={onReset}>Сбросить поиск</Button>
    </Surface>
  );
}

function ProjectCreateModal(props: {
  open: boolean;
  title: string;
  description: string;
  error: string;
  creating: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      title="Новый проект"
      description="Название можно изменить позднее в настройках проекта."
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={props.onCancel}>Отмена</Button>
          <Button type="submit" form="create-project-form" loading={props.creating} disabled={!props.title.trim()}>
            Создать
          </Button>
        </>
      )}
    >
      <form id="create-project-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); props.onCreate(); }}>
        <TextField
          autoFocus
          label="Название"
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          placeholder="Например, запуск нового продукта"
          maxLength={100}
          required
        />
        <TextArea
          label="Описание"
          hint="Необязательно, до 500 символов"
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          placeholder="Коротко о цели проекта"
          rows={4}
          maxLength={500}
        />
        {props.error && <p className="text-sm text-[var(--nt-color-danger)]" role="alert">{props.error}</p>}
      </form>
    </Modal>
  );
}

function JoinProjectModal(props: {
  open: boolean;
  code: string;
  status: string;
  submitted: boolean;
  onCodeChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      title={props.submitted ? 'Заявка отправлена' : 'Подключиться к проекту'}
      description={props.submitted ? undefined : 'Введите код, который вы получили от владельца проекта.'}
      size="sm"
      footer={props.submitted ? (
        <>
          <Button variant="secondary" onClick={props.onCancel}>Закрыть</Button>
          <Button onClick={props.onRefresh}>Обновить проекты</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={props.onCancel}>Отмена</Button>
          <Button type="submit" form="join-project-form" disabled={!props.code.trim()}>Отправить заявку</Button>
        </>
      )}
    >
      {props.submitted ? (
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--nt-color-success)]" size={22} aria-hidden="true" />
          <p className="text-sm leading-6 text-[var(--nt-color-text-muted)]">
            {props.status || 'После подтверждения владельцем проект появится в вашем списке.'}
          </p>
        </div>
      ) : (
        <form id="join-project-form" className="space-y-3" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
          <TextField
            autoFocus
            label="Код проекта"
            value={props.code}
            onChange={(event) => props.onCodeChange(event.target.value.toUpperCase())}
            placeholder="Например, P1-8W13TF"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
          {props.status && <p className="text-sm text-[var(--nt-color-danger)]" role="alert">{props.status}</p>}
        </form>
      )}
    </Modal>
  );
}

function ProjectCard({ project, onClick }: { project: ProjectWithStats; onClick: () => void }) {
  const members = project.members ?? [];
  const taskCount = project._count?.tasks ?? 0;
  const overdueCount = project.overdueCount ?? 0;
  const accent = PROJECT_ACCENTS[Math.abs(Number(project.id) || 0) % PROJECT_ACCENTS.length];

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-48 w-full flex-col rounded-[var(--nt-radius-surface)] border border-[var(--nt-color-border)] bg-[var(--nt-color-surface-raised)] p-4 text-left shadow-[var(--nt-shadow-sm)] transition-[border-color,background-color,transform,box-shadow] duration-[var(--nt-motion-fast)] hover:border-[var(--nt-color-border-strong)] hover:bg-[var(--nt-color-surface)] focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] active:scale-[0.99]"
      aria-label={`Открыть проект «${project.title}»`}
    >
      <div className="flex w-full items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--nt-radius-control)] ${accent.background} ${accent.icon}`}>
          <FolderKanban size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-base font-bold leading-5">{project.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--nt-color-text-muted)]">
            {project.description?.trim() || 'Рабочее пространство проекта'}
          </p>
        </div>
        <ArrowRight className="mt-1 shrink-0 text-[var(--nt-color-text-muted)] transition-transform group-hover:translate-x-0.5" size={18} aria-hidden="true" />
      </div>

      <div className="mt-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--nt-color-border)] pt-4 text-xs text-[var(--nt-color-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <ListChecks size={15} aria-hidden="true" />
          {formatTaskCount(taskCount)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={15} aria-hidden="true" />
          {formatMemberCount(members.length)}
        </span>
        {overdueCount > 0 && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--nt-color-danger)]">
            <AlertTriangle size={15} aria-hidden="true" />
            {overdueCount} просрочено
          </span>
        )}
      </div>

      {members.length > 0 && (
        <div className="mt-3 flex -space-x-1.5" aria-label={`Участников: ${members.length}`}>
          {members.slice(0, 5).map((member) => (
            <UserAvatarImage
              key={member.id}
              user={member.user}
              label={projectMemberLabel(member)}
              size="xs"
              className="border-2 border-[var(--nt-color-surface-raised)]"
            />
          ))}
          {members.length > 5 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--nt-color-surface-raised)] bg-[var(--nt-color-surface-hover)] text-[10px] font-bold text-[var(--nt-color-text-muted)]">
              +{members.length - 5}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function getInviteCodeFromParams(searchParams: URLSearchParams) {
  const raw =
    searchParams.get('join')
    ?? searchParams.get('code')
    ?? searchParams.get('startapp')
    ?? searchParams.get('tgWebAppStartParam');

  if (!raw) return '';
  return raw.trim().replace(/^join[_-]/i, '').toUpperCase();
}

function projectMemberLabel(member: ProjectMember) {
  const user = member.user;
  return (
    [user?.firstName, user?.lastName].filter(Boolean).join(' ')
    || user?.username
    || user?.telegramId
    || '?'
  );
}

function formatProjectCount(count: number) {
  return `${count} ${pluralize(count, 'проект', 'проекта', 'проектов')}`;
}

function formatTaskCount(count: number) {
  return `${count} ${pluralize(count, 'задача', 'задачи', 'задач')}`;
}

function formatMemberCount(count: number) {
  return `${count} ${pluralize(count, 'участник', 'участника', 'участников')}`;
}

function pluralize(count: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
