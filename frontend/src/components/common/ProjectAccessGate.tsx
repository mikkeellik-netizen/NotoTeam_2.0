import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectsApi } from '../../api/projects';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import type { RolePermissions } from '../../types';
import { getProjectPermissions } from '../../utils/projectPermissions';

type AccessStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'missing' | 'error';

interface ProjectAccessGateProps {
  children: ReactNode;
  requireAny?: Array<keyof RolePermissions>;
  title?: string;
  description?: string;
}

export default function ProjectAccessGate({
  children,
  requireAny = ['viewProject'],
  title,
  description,
}: ProjectAccessGateProps) {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const currentProject = useProjectStore((state) => state.currentProject);
  const fetchProject = useProjectStore((state) => state.fetchProject);
  const [status, setStatus] = useState<AccessStatus>('idle');
  const [message, setMessage] = useState('');
  const presenceSessionId = useRef(createPresenceSessionId());
  const pid = Number(projectId);

  useEffect(() => {
    if (!Number.isFinite(pid) || pid <= 0) {
      setStatus('missing');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setMessage('');

    fetchProject(pid)
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        setMessage(errorMessage);
        if (errorMessage.includes('403')) setStatus('denied');
        else if (errorMessage.includes('404')) setStatus('missing');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [fetchProject, pid]);

  const project = currentProject && String(currentProject.id) === String(pid) ? currentProject : null;
  const permissions = useMemo(
    () => getProjectPermissions(project, currentUser?.id),
    [project, currentUser?.id],
  );
  const hasRequiredPermission =
    requireAny.length === 0 || requireAny.some((permission) => Boolean(permissions[permission]));
  const isOwner = Boolean(project && currentUser && String(project.ownerId) === String(currentUser.id));
  const isMember = Boolean(
    project &&
      currentUser &&
      (project.members ?? []).some((member) => String(member.userId) === String(currentUser.id)),
  );
  const hasMembership = isOwner || isMember;

  useEffect(() => {
    if (status !== 'ready' || !hasMembership || !currentUser?.id) return;

    let stopped = false;
    const sessionId = presenceSessionId.current;
    const touch = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      void projectsApi.touchPresence(pid, sessionId).catch(() => undefined);
    };
    const onVisibilityChange = () => touch();

    touch();
    const intervalId = window.setInterval(touch, 20_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', touch);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', touch);
      void projectsApi.leavePresence(pid, sessionId).catch(() => undefined);
    };
  }, [currentUser?.id, hasMembership, pid, status]);

  if (status === 'loading' || status === 'idle' || (status === 'ready' && !project)) {
    return <ProjectAccessLoading />;
  }

  if (status === 'missing') {
    return (
      <ProjectAccessState
        icon="?"
        title="Проект не найден"
        description="Возможно, проект удалили, переместили в корзину или ссылка устарела."
        onBack={() => navigate(-1)}
        onProjects={() => navigate('/')}
      />
    );
  }

  if (status === 'error') {
    return (
      <ProjectAccessState
        icon="!"
        title="Не удалось открыть проект"
        description={message || 'Проверьте соединение с backend и попробуйте еще раз.'}
        onBack={() => navigate(-1)}
        onProjects={() => navigate('/')}
      />
    );
  }

  if (status === 'denied' || !hasMembership || !hasRequiredPermission) {
    return (
      <ProjectAccessState
        icon="!"
        title={title ?? 'Нет доступа'}
        description={
          description ??
          'У вас нет прав открыть этот раздел проекта. Попросите владельца изменить роль или вернитесь к своим проектам.'
        }
        onBack={() => navigate(-1)}
        onProjects={() => navigate('/')}
      />
    );
  }

  return <>{children}</>;
}

function createPresenceSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `presence_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function ProjectAccessLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--tg-theme-bg-color)] px-5">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color)] border-t-transparent" />
        <p className="text-sm text-[var(--tg-theme-hint-color)]">Проверяем доступ...</p>
      </div>
    </div>
  );
}

function ProjectAccessState({
  icon,
  title,
  description,
  onBack,
  onProjects,
}: {
  icon: string;
  title: string;
  description: string;
  onBack: () => void;
  onProjects: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--tg-theme-bg-color)] px-5 text-[var(--tg-theme-text-color)]">
      <section className="w-full max-w-sm rounded-[16px] bg-[var(--tg-theme-secondary-bg-color)] p-5 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--tg-theme-button-color)] text-xl font-bold text-[var(--tg-theme-button-text-color)]">
          {icon}
        </div>
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-2 text-sm leading-5 text-[var(--tg-theme-hint-color)]">{description}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onBack}
            className="rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)]"
          >
            Назад
          </button>
          <button
            onClick={onProjects}
            className="rounded-[12px] bg-[var(--tg-theme-button-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)]"
          >
            К проектам
          </button>
        </div>
      </section>
    </div>
  );
}
