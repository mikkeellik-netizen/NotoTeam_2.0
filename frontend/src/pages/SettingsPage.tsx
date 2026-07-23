import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { activityApi } from '../api/activity';
import { botSettingsApi, defaultProjectBotSettings } from '../api/botSettings';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import { LANGUAGE_OPTIONS } from '../localization/languages';
import {
  createProjectExport,
  downloadExportResult,
  exportLabel,
  getProjectExportTargets,
  openPrintableExport,
  type ExportFormat,
  type ExportResult,
  type ExportScope,
} from '../services/exportService';
import { useAuthStore } from '../store/authStore';
import { usePageStore } from '../store/pageStore';
import { useProjectStore } from '../store/projectStore';
import { type LanguageCode, useSettingsStore } from '../store/settingsStore';
import type { ActivityEvent, Block, PageNode, Project, ProjectBotSettings, ProjectJoinRequest, ProjectMember, Task } from '../types';
import { copyPlainText } from '../utils/clipboard';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const selectedProjectId = projectId ? Number(projectId) : undefined;
  const currentUser = useAuthStore((state) => state.user);
  const { projects, fetchProjects, fetchProject, createProject, removeProject, restoreProject } = useProjectStore();
  const { displayName, theme, language, loadSettings, setDisplayName, setTheme, setLanguage } = useSettingsStore();
  const [nameDraft, setNameDraft] = useState(displayName);
  const [memberUsername, setMemberUsername] = useState('');
  const [activeProjectId, setActiveProjectId] = useState<number | undefined>(selectedProjectId);
  const [savingMember, setSavingMember] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectToPurge, setProjectToPurge] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deletedProjects, setDeletedProjects] = useState<Project[]>([]);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [memberActionId, setMemberActionId] = useState<number | null>(null);
  const [memberConfirm, setMemberConfirm] = useState<{
    type: 'remove' | 'transfer' | 'leave';
    member?: ProjectMember;
    project?: Project;
  } | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTasks, setAdminTasks] = useState<Task[]>([]);
  const [adminEvents, setAdminEvents] = useState<ActivityEvent[]>([]);
  const [activityRetentionDays, setActivityRetentionDays] = useState(7);
  const [exportingProject, setExportingProject] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>('project');
  const [exportTargetId, setExportTargetId] = useState('');
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [joinRequests, setJoinRequests] = useState<ProjectJoinRequest[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [accessNotice, setAccessNotice] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);

  useEffect(() => {
    loadSettings();
    fetchProjects();
    loadDeletedProjects();
  }, []);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!activeProjectId && projects[0]) setActiveProjectId(projects[0].id);
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (selectedProjectId) setActiveProjectId(selectedProjectId);
  }, [selectedProjectId]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId, projects],
  );
  // Сравниваем как строки: с бэкенда userId/ownerId могут прийти строкой, а currentUser.id — числом.
  const isActiveProjectOwner = String(activeProject?.ownerId ?? '') === String(currentUser?.id ?? '_');
  const currentMember = activeProject?.members?.find(
    (member) => String(member.userId) === String(currentUser?.id ?? '_'),
  );
  const canOpenAdminPanel = isActiveProjectOwner || currentMember?.role?.name === 'admin';
  const inviteLink = useMemo(
    () => (inviteCode ? `${window.location.origin}/?join=${encodeURIComponent(inviteCode)}` : ''),
    [inviteCode],
  );

  useEffect(() => {
    if (!activeProject?.id || !currentUser?.id || !isActiveProjectOwner) {
      setInviteCode('');
      setJoinRequests([]);
      return;
    }
    let cancelled = false;
    const loadAccess = async () => {
      const [code, requests] = await Promise.all([
        projectsApi.getInviteCode(activeProject.id, currentUser.id),
        projectsApi.getJoinRequests(activeProject.id, currentUser.id),
      ]);
      if (!cancelled) {
        setInviteCode(code);
        setJoinRequests(requests);
      }
    };
    loadAccess();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, currentUser?.id, isActiveProjectOwner]);

  const selectProject = (id: number) => {
    setActiveProjectId(id);
    navigate(`/project/${id}/settings`, { replace: true });
  };

  const leaveSettings = () => {
    if (activeProject?.id) {
      navigate(`/project/${activeProject.id}/workspace`);
      return;
    }
    navigate('/');
  };

  const saveName = () => {
    const next = nameDraft.trim() || 'Local User';
    setDisplayName(next);
  };

  const addMember = async () => {
    if (!activeProject?.id || !memberUsername.trim()) return;
    setSavingMember(true);
    try {
      await projectsApi.addMember(activeProject.id, memberUsername);
      await fetchProjects();
      await fetchProject(activeProject.id);
      setMemberUsername('');
    } finally {
      setSavingMember(false);
    }
  };

  const refreshActiveProject = async () => {
    await fetchProjects();
    if (activeProject?.id) await fetchProject(activeProject.id);
  };

  const refreshProjectAccess = async () => {
    if (!activeProject?.id || !currentUser?.id || !isActiveProjectOwner) return;
    setInviteCode(await projectsApi.getInviteCode(activeProject.id, currentUser.id));
    setJoinRequests(await projectsApi.getJoinRequests(activeProject.id, currentUser.id));
  };

  const rotateInviteCode = async () => {
    if (!activeProject?.id || !currentUser?.id) return;
    setAccessLoading(true);
    try {
      setInviteCode(await projectsApi.rotateInviteCode(activeProject.id, currentUser.id));
      setJoinRequests(await projectsApi.getJoinRequests(activeProject.id, currentUser.id));
      setAccessNotice('Код обновлен');
    } finally {
      setAccessLoading(false);
    }
  };

  const copyAccessText = async (value: string, label: string) => {
    if (!value) return;
    const copied = await copyPlainText(value);
    if (copied) {
      setAccessNotice(`${label} скопирован`);
    } else {
      setAccessNotice(`Не удалось скопировать ${label.toLowerCase()}`);
    }
  };

  const sendJoinRequest = async () => {
    if (!joinCode.trim() || !currentUser?.id) return;
    setAccessLoading(true);
    try {
      const username = currentUser.username ?? currentUser.telegramId;
      const displayName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(' ') || username;
      await projectsApi.requestJoinByCode(joinCode, username, displayName, currentUser.id);
      setJoinCode('');
      window.alert('Заявка отправлена владельцу проекта');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось отправить заявку');
    } finally {
      setAccessLoading(false);
    }
  };

  const resolveJoinRequest = async (requestId: number, approved: boolean) => {
    if (!activeProject?.id || !currentUser?.id) return;
    setAccessLoading(true);
    try {
      if (approved) {
        await projectsApi.approveJoinRequest(activeProject.id, requestId, currentUser.id);
        await refreshActiveProject();
      } else {
        await projectsApi.rejectJoinRequest(activeProject.id, requestId, currentUser.id);
      }
      await refreshProjectAccess();
    } finally {
      setAccessLoading(false);
    }
  };

  const removeMember = async (memberId: number) => {
    if (!activeProject?.id || !currentUser?.id) return;
    setMemberActionId(memberId);
    try {
      await projectsApi.removeMember(activeProject.id, memberId, currentUser.id);
      await refreshActiveProject();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось удалить участника');
    } finally {
      setMemberActionId(null);
    }
  };

  const transferOwnership = async (memberId: number) => {
    if (!activeProject?.id || !currentUser?.id) return;
    setMemberActionId(memberId);
    try {
      await projectsApi.transferOwnership(activeProject.id, memberId, currentUser.id);
      await refreshActiveProject();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось передать права владельца');
    } finally {
      setMemberActionId(null);
    }
  };

  const toggleAdmin = async (member: ProjectMember) => {
    if (!activeProject?.id || !currentUser?.id) return;
    const enabled = member.role?.name !== 'admin';
    setMemberActionId(member.id);
    try {
      await projectsApi.setMemberAdmin(activeProject.id, member.id, enabled, currentUser.id);
      await refreshActiveProject();
      setAccessNotice(enabled ? 'Администратор назначен' : 'Права администратора сняты');
    } catch (error) {
      setAccessNotice(error instanceof Error ? error.message : 'Не удалось изменить роль администратора');
    } finally {
      setMemberActionId(null);
    }
  };

  const confirmMemberAction = async () => {
    if (!memberConfirm) return;
    const action = memberConfirm;
    setMemberConfirm(null);
    if (action.type === 'leave') {
      await leaveProject(action.project);
      return;
    }
    if (!action.member) return;
    if (action.type === 'remove') {
      await removeMember(action.member.id);
      return;
    }
    await transferOwnership(action.member.id);
  };

  const leaveProject = async (projectOverride?: Project) => {
    const project = projectOverride ?? activeProject;
    if (!project?.id || !currentUser?.id) return;
    const member = project.members?.find((item) => String(item.userId) === String(currentUser.id));
    setMemberActionId(member?.id ?? -1);
    try {
      await projectsApi.leaveProject(project.id, currentUser.id);
      const nextProjects = await projectsApi.getAll(currentUser.id);
      await fetchProjects();
      const nextProject = nextProjects.find((item) => item.id !== project.id);
      navigate(nextProject ? `/project/${nextProject.id}/settings` : '/', { replace: true });
    } catch (error) {
      setAccessNotice(error instanceof Error ? error.message : 'Не удалось покинуть проект');
    } finally {
      setMemberActionId(null);
    }
  };

  const loadDeletedProjects = async () => {
    const trash = await projectsApi.getTrash();
    setDeletedProjects(trash.filter((project) => project.ownerId === currentUser?.id));
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    setDeletingProject(true);
    try {
      await removeProject(projectToDelete.id);
      await loadDeletedProjects();
      const remainingProjects = projects.filter((project) => project.id !== projectToDelete.id);
      setProjectToDelete(null);

      if (activeProjectId === projectToDelete.id) {
        const nextProject = remainingProjects[0];
        setActiveProjectId(nextProject?.id);
        if (!nextProject || selectedProjectId === projectToDelete.id) {
          navigate('/');
        }
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Удалить проект может только владелец');
    } finally {
      setDeletingProject(false);
    }
  };

  const restoreDeletedProject = async (project: Project) => {
    await restoreProject(project.id);
    await fetchProjects();
    await loadDeletedProjects();
    setActiveProjectId(project.id);
    navigate(`/project/${project.id}/settings`, { replace: true });
  };

  const purgeDeletedProject = async () => {
    if (!projectToPurge || !currentUser?.id) return;
    setDeletingProject(true);
    try {
      await projectsApi.purge(projectToPurge.id, currentUser.id);
      setProjectToPurge(null);
      await loadDeletedProjects();
      await fetchProjects();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Удалить проект навсегда может только владелец');
    } finally {
      setDeletingProject(false);
    }
  };

  const addProject = async () => {
    if (!newProjectTitle.trim()) return;
    setCreatingProject(true);
    try {
      const project = await createProject({
        title: newProjectTitle.trim(),
        description: newProjectDescription.trim() || 'Личный изолированный проект',
      });
      await fetchProjects();
      setActiveProjectId(project.id);
      navigate(`/project/${project.id}/settings`, { replace: true });
      setCreateProjectOpen(false);
      setNewProjectTitle('');
      setNewProjectDescription('');
    } finally {
      setCreatingProject(false);
    }
  };

  const openAdminPanel = async () => {
    if (!activeProject?.id) return;
    setAdminOpen(true);
    setAdminTasks(await tasksApi.getAllProjectTasks(activeProject.id));
    setActivityRetentionDays(activityApi.getRetentionDays(activeProject.id));
    setAdminEvents(await activityApi.load(activeProject.id));
  };

  const exportActiveProject = async () => {
    if (!activeProject) return;
    setExportingProject(true);
    try {
      const result = createProjectExport(activeProject, {
        format: exportFormat,
        scope: exportScope,
        targetId: exportTargetId || undefined,
      });
      if (exportFormat === 'pdf') openPrintableExport(result, result.fileName.replace(/\.html$/i, '.pdf'));
      else downloadExportResult(result);
      setExportResult(result);
    } finally {
      setExportingProject(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--tg-theme-bg-color)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <button onClick={leaveSettings} className="w-8 h-8 text-[var(--tg-theme-link-color)]">
          ‹
        </button>
        <h1 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Настройки</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)] mb-3">Профиль</h2>
          <label className="block text-xs text-[var(--tg-theme-hint-color)] mb-1">Ваше имя</label>
          <div className="flex gap-2">
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              className="min-w-0 flex-1 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-[var(--tg-theme-text-color)] outline-none"
              placeholder="Имя"
            />
            <button
              onClick={saveName}
              className="px-4 rounded-[10px] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] font-medium"
            >
              OK
            </button>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--tg-theme-hint-color)]">Тема</p>
              <label className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-text-color)]">
                <span aria-hidden="true">🌐</span>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as LanguageCode)}
                  className="bg-transparent text-xs outline-none"
                  aria-label="Язык"
                >
                  {LANGUAGE_OPTIONS.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.shortLabel}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'system', icon: '⚙', label: 'Системная' },
                { value: 'light', icon: '☀', label: 'Светлая' },
                { value: 'dark', icon: '☾', label: 'Темная' },
              ] as const).map((item) => (
                <button
                  key={item.value}
                  onClick={() => setTheme(item.value)}
                  className={`flex h-11 items-center justify-center rounded-[10px] text-xl font-medium ${
                    theme === item.value
                      ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                      : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                  }`}
                  aria-label={item.label}
                  title={item.label}
                >
                  {item.icon}
                </button>
              ))}
            </div>
          </div>
        </section>

        {canOpenAdminPanel && (
          <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Администратор</h2>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                  История, помощник, статистика и активность проекта.
                </p>
              </div>
              <button
                onClick={openAdminPanel}
                className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-4 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)]"
              >
                Открыть
              </button>
            </div>
          </section>
        )}

        <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Экспорт проекта</h2>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                Форматы, объём выгрузки, отдельные страницы, ветки и Kanban-доски.
              </p>
            </div>
            <button
              onClick={() => setExportOpen(true)}
              disabled={!activeProject}
              className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-4 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
            >
              Открыть
            </button>
          </div>
        </section>

        <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Проекты</h2>
            <button
              onClick={() => setCreateProjectOpen(true)}
              className="rounded-[9px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
            >
              + Добавить проект
            </button>
          </div>
          <p className="mb-3 text-xs text-[var(--tg-theme-hint-color)]">
            Новый проект создается изолированным: только владелец имеет доступ, пока вы не добавите участников.
          </p>
          <div className="space-y-2">
            {projects.map((project) => {
              const isActive = activeProject?.id === project.id;
              const canDeleteProject = String(project.ownerId) === String(currentUser?.id ?? '_');
              const projectMember = project.members?.find((member) => String(member.userId) === String(currentUser?.id ?? '_'));
              return (
              <div
                key={project.id}
                className={`flex items-center gap-2 rounded-[10px] p-2 ${
                  isActive
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                }`}
              >
                <button
                  onClick={() => selectProject(project.id)}
                  className="min-w-0 flex-1 text-left px-1"
                >
                  <span className="block truncate font-medium">{project.title}</span>
                  <span className="block text-xs opacity-80">{project._count?.tasks ?? 0} задач</span>
                </button>
                {canDeleteProject ? (
                  <button
                    onClick={() => setProjectToDelete(project)}
                    className={`h-9 w-9 shrink-0 rounded-[9px] text-base ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'bg-red-500/10 text-red-500'
                    }`}
                    aria-label={`Удалить проект ${project.title}`}
                  >
                    ×
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-[11px] opacity-70">
                      участник
                    </span>
                    <button
                      onClick={() => setMemberConfirm({ type: 'leave', member: projectMember, project })}
                      disabled={projectMember ? memberActionId === projectMember.id : memberActionId === -1}
                      className={`rounded-[9px] px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                        isActive ? 'bg-white/15 text-white' : 'bg-red-500/10 text-red-500'
                      }`}
                    >
                      Покинуть
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Участники</h2>
            {!isActiveProjectOwner && currentMember && (
              <button
                onClick={() => setMemberConfirm({ type: 'leave', member: currentMember })}
                disabled={memberActionId === currentMember.id}
                className="rounded-[9px] bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-500 disabled:opacity-50"
              >
                Покинуть проект
              </button>
            )}
          </div>
          {isActiveProjectOwner && (
            <>
              <label className="block text-xs text-[var(--tg-theme-hint-color)] mb-1">
                Добавить по Telegram username
              </label>
              <div className="flex gap-2 mb-3">
                <input
                  value={memberUsername}
                  onChange={(event) => setMemberUsername(event.target.value)}
                  className="min-w-0 flex-1 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-[var(--tg-theme-text-color)] outline-none"
                  placeholder="@username"
                />
                <button
                  onClick={addMember}
                  disabled={!memberUsername.trim() || savingMember}
                  className="px-4 rounded-[10px] bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] font-medium disabled:opacity-50"
                >
                  +
                </button>
              </div>
              <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--tg-theme-text-color)]">Доступ по коду</p>
                    <p className="truncate text-sm font-bold text-[var(--tg-theme-link-color)]">{inviteCode || '...'}</p>
                  </div>
                  <button
                    onClick={rotateInviteCode}
                    disabled={accessLoading}
                    className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-50"
                  >
                    Новый код
                  </button>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => copyAccessText(inviteCode, 'Код')}
                    disabled={!inviteCode}
                    className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-50"
                  >
                    Скопировать код
                  </button>
                  <button
                    onClick={() => copyAccessText(inviteLink, 'Ссылка')}
                    disabled={!inviteLink}
                    className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-50"
                  >
                    Скопировать ссылку
                  </button>
                </div>
                {inviteLink && (
                  <p className="mb-2 break-all rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                    {inviteLink}
                  </p>
                )}
                {accessNotice && (
                  <p className="mb-2 text-xs text-[var(--tg-theme-link-color)]">{accessNotice}</p>
                )}
                {joinRequests.length > 0 ? (
                  <div className="space-y-2">
                    {joinRequests.map((request) => (
                      <div key={request.id} className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--tg-theme-text-color)]">@{request.username}</p>
                          <p className="text-xs text-[var(--tg-theme-hint-color)]">просит доступ</p>
                        </div>
                        <button
                          onClick={() => resolveJoinRequest(request.id, false)}
                          disabled={accessLoading}
                          className="h-8 w-8 rounded-[8px] bg-red-500/10 text-red-500 disabled:opacity-50"
                        >
                          ×
                        </button>
                        <button
                          onClick={() => resolveJoinRequest(request.id, true)}
                          disabled={accessLoading}
                          className="rounded-[8px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
                        >
                          Принять
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--tg-theme-hint-color)]">Новых заявок нет.</p>
                )}
              </div>
            </>
          )}
          {!isActiveProjectOwner && (
            <div className="mb-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--tg-theme-text-color)]">Запросить доступ по коду</p>
              <div className="grid grid-cols-1 gap-2">
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-[var(--tg-theme-text-color)] outline-none"
                  placeholder="Код проекта"
                />
                <button
                  onClick={sendJoinRequest}
                  disabled={!joinCode.trim() || !currentUser?.id || accessLoading}
                  className="rounded-[10px] bg-[var(--tg-theme-button-color)] px-4 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
                >
                  Отправить заявку
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {(activeProject?.members ?? []).map((member) => (
              <div key={member.id} className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--tg-theme-text-color)]">
                    {member.user?.firstName ?? member.user?.username ?? `ID ${member.userId}`}
                  </p>
                  <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">
                    @{member.user?.username ?? member.user?.telegramId} · {member.role?.name ?? 'viewer'}
                  </p>
                </div>
                {isActiveProjectOwner && member.userId !== currentUser?.id && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => toggleAdmin(member)}
                      disabled={memberActionId === member.id}
                      className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-text-color)] disabled:opacity-50"
                    >
                      {member.role?.name === 'admin' ? 'Снять админ' : 'Админ'}
                    </button>
                    <button
                      onClick={() => setMemberConfirm({ type: 'transfer', member })}
                      disabled={memberActionId === member.id}
                      className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-text-color)] disabled:opacity-50"
                    >
                      Владелец
                    </button>
                    <button
                      onClick={() => setMemberConfirm({ type: 'remove', member })}
                      disabled={memberActionId === member.id}
                      className="h-9 w-9 rounded-[9px] bg-red-500/10 text-base text-red-500 disabled:opacity-50"
                      aria-label={`Удалить участника ${member.user?.username ?? member.userId}`}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {deletedProjects.length > 0 && (
          <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <h2 className="text-sm font-semibold text-[var(--tg-theme-text-color)] mb-3">Корзина проектов</h2>
            <div className="space-y-2">
              {deletedProjects.map((project) => (
                <div key={project.id} className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--tg-theme-text-color)]">{project.title}</p>
                    <p className="text-xs text-[var(--tg-theme-hint-color)]">
                      Будет удален навсегда через {daysLeft(project.deletedAt)} дн.
                    </p>
                  </div>
                  <button
                    onClick={() => restoreDeletedProject(project)}
                    className="rounded-[9px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-button-text-color)]"
                  >
                    Восстановить
                  </button>
                  <button
                    onClick={() => setProjectToPurge(project)}
                    className="h-9 w-9 shrink-0 rounded-[9px] bg-red-500/10 text-base font-semibold text-red-500"
                    aria-label={`Удалить навсегда проект ${project.title}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {projectToDelete && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" onClick={() => setProjectToDelete(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5 animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)] mb-2">
              Удалить проект?
            </h2>
            <p className="text-sm text-[var(--tg-theme-hint-color)] mb-4">
              Проект «{projectToDelete.title}» будет перенесен в корзину. Его можно восстановить в течение 30 дней, после этого он удалится автоматически.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setProjectToDelete(null)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={confirmDeleteProject}
                disabled={deletingProject}
                className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white disabled:opacity-50"
              >
                {deletingProject ? 'Переношу...' : 'В корзину'}
              </button>
            </div>
          </div>
        </div>
      )}

      {projectToPurge && (
        <div className="fixed inset-0 z-[105] bg-black/50 flex items-end" onClick={() => setProjectToPurge(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5 animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)] mb-2">
              Удалить навсегда?
            </h2>
            <p className="text-sm text-[var(--tg-theme-hint-color)] mb-4">
              Проект «{projectToPurge.title}» будет удален без возможности восстановления вместе с задачами и колонками.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setProjectToPurge(null)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={purgeDeletedProject}
                disabled={deletingProject}
                className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white disabled:opacity-50"
              >
                {deletingProject ? 'Удаляю...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createProjectOpen && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" onClick={() => setCreateProjectOpen(false)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5 animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)] mb-2">
              Добавить проект
            </h2>
            <p className="mb-4 text-sm text-[var(--tg-theme-hint-color)]">
              Проект будет приватным и полностью отдельным от остальных. Участников можно добавить позже по Telegram username.
            </p>
            <label className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Название</label>
            <input
              autoFocus
              value={newProjectTitle}
              onChange={(event) => setNewProjectTitle(event.target.value)}
              placeholder="Например, Личный проект"
              className="mb-3 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
              maxLength={100}
            />
            <label className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Описание</label>
            <textarea
              value={newProjectDescription}
              onChange={(event) => setNewProjectDescription(event.target.value)}
              placeholder="Необязательно"
              rows={3}
              className="mb-4 w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
              maxLength={500}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setCreateProjectOpen(false)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={addProject}
                disabled={!newProjectTitle.trim() || creatingProject}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
              >
                {creatingProject ? 'Создаю...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {memberConfirm && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex items-end" onClick={() => setMemberConfirm(null)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5 animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)] mb-2">
              {memberConfirm.type === 'remove'
                ? 'Удалить участника?'
                : memberConfirm.type === 'transfer'
                  ? 'Передать права владельца?'
                  : 'Покинуть проект?'}
            </h2>
            <p className="text-sm text-[var(--tg-theme-hint-color)] mb-4">
              {memberConfirm.type === 'remove'
                ? `${memberConfirm.member ? memberName(memberConfirm.member) : 'Участник'} потеряет доступ к этому проекту.`
                : memberConfirm.type === 'transfer'
                  ? `${memberConfirm.member ? memberName(memberConfirm.member) : 'Участник'} станет владельцем проекта, а вы станете редактором.`
                  : `Вы покинете проект «${memberConfirm.project?.title ?? activeProject?.title ?? 'Проект'}», и он исчезнет из вашего личного кабинета.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setMemberConfirm(null)}
                className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-medium text-[var(--tg-theme-text-color)]"
              >
                Отмена
              </button>
              <button
                onClick={confirmMemberAction}
                disabled={memberActionId === (memberConfirm.member?.id ?? -1)}
                className={`flex-1 rounded-[12px] py-3 font-semibold text-white disabled:opacity-50 ${
                  memberConfirm.type === 'remove' || memberConfirm.type === 'leave' ? 'bg-red-500' : 'bg-[var(--tg-theme-button-color)]'
                }`}
              >
                {memberConfirm.type === 'remove' ? 'Удалить' : memberConfirm.type === 'transfer' ? 'Передать' : 'Покинуть'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adminOpen && activeProject && (
        <AdminPanel
          project={activeProject}
          tasks={adminTasks}
          events={adminEvents}
          retentionDays={activityRetentionDays}
          onRetentionChange={async (days) => {
            activityApi.setRetentionDays(activeProject.id, days);
            setActivityRetentionDays(days);
            setAdminEvents(await activityApi.load(activeProject.id));
          }}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {exportOpen && activeProject && (
        <ExportPanel
          project={activeProject}
          format={exportFormat}
          scope={exportScope}
          targetId={exportTargetId}
          exporting={exportingProject}
          result={exportResult}
          onFormatChange={(format) => {
            setExportFormat(format);
            setExportResult(null);
          }}
          onScopeChange={(scope) => {
            setExportScope(scope);
            setExportTargetId('');
            setExportResult(null);
          }}
          onTargetChange={(id) => {
            setExportTargetId(id);
            setExportResult(null);
          }}
          onExport={exportActiveProject}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

function AdminPanel({
  project,
  tasks,
  events,
  retentionDays,
  onRetentionChange,
  onClose,
}: {
  project: Project;
  tasks: Task[];
  events: ActivityEvent[];
  retentionDays: number;
  onRetentionChange: (days: number) => void | Promise<void>;
  onClose: () => void;
}) {
  type AdminTab = 'overview' | 'people' | 'risks' | 'meeting' | 'reports' | 'bot';
  const navigate = useNavigate();
  const [openUserIds, setOpenUserIds] = useState<Set<number>>(new Set());
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('overview');
  const [selectedMember, setSelectedMember] = useState<ProjectMember | null>(null);
  const [digestText, setDigestText] = useState('');
  const [botSettings, setBotSettings] = useState<ProjectBotSettings>(
    project.botSettings ?? cloneBotSettings(defaultProjectBotSettings),
  );
  const { nodes, blocks, loadProjectSpace } = usePageStore();
  const [savingBotSettings, setSavingBotSettings] = useState(false);
  const [botSettingsSaved, setBotSettingsSaved] = useState(false);

  const openTaskInKanban = (task: Task) => {
    if (!task.pageId) {
      return;
    }

    onClose();
    navigate(`/project/${project.id}/workspace/page/${task.pageId}?taskId=${task.id}`);
  };

  useEffect(() => {
    let cancelled = false;
    botSettingsApi.get(project.id).then((settings) => {
      if (!cancelled) setBotSettings(settings);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    void loadProjectSpace(String(project.id), project.title);
  }, [loadProjectSpace, project.id, project.title]);

  const now = Date.now();
  const overdue = tasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now);
  const highPriority = tasks.filter((task) => task.priority === 'HIGH' || task.priority === 'CRITICAL');
  const dueSoon = tasks.filter((task) => {
    if (!task.deadlineAt) return false;
    const diffHours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
    return diffHours >= 0 && diffHours <= 48;
  });
  const unassigned = tasks.filter((task) => !task.assignee?.id && !task.assigneeId);
  const noDeadline = tasks.filter((task) => !task.deadlineAt);
  const weakTasks = tasks.filter((task) => !task.description?.trim() || !task.deadlineAt || (!task.assignee?.id && !task.assigneeId));
  const byUser = (project.members ?? []).map((member) => {
    const memberTasks = tasks.filter((task) => isTaskAssignedToMember(task, member.userId));
    return {
      member,
      total: memberTasks.length,
      overdue: memberTasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now).length,
      dueSoon: memberTasks.filter((task) => {
        if (!task.deadlineAt) return false;
        const diffHours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
        return diffHours >= 0 && diffHours <= 48;
      }).length,
      highPriority: memberTasks.filter((task) => task.priority === 'HIGH' || task.priority === 'CRITICAL').length,
      noDeadline: memberTasks.filter((task) => !task.deadlineAt).length,
    };
  });
  const maxLoad = Math.max(1, ...byUser.map((item) => item.total));
  const overloaded = byUser.filter((item) => item.total >= Math.max(4, Math.ceil(maxLoad * 0.7)) && item.total > 0);
  const inactiveMembers = (project.members ?? []).filter((member) => !tasks.some((task) => isTaskAssignedToMember(task, member.userId)));
  const riskTasks = [...tasks]
    .map((task) => ({ task, score: getTaskRiskScore(task, now) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        overdue.length * 18 -
        dueSoon.length * 8 -
        unassigned.length * 7 -
        noDeadline.length * 4 -
        weakTasks.length * 3,
    ),
  );
  const healthTone = healthScore >= 75 ? 'Проект в норме' : healthScore >= 45 ? 'Есть риски' : 'Нужен контроль';
  const assistantInsights = buildAssistantInsights({
    tasks,
    overdue,
    dueSoon,
    unassigned,
    noDeadline,
    weakTasks,
    highPriority,
    inactiveMembers,
    overloaded,
  });
  const actionPlan = buildActionPlan({
    overdue,
    dueSoon,
    unassigned,
    noDeadline,
    weakTasks,
    highPriority,
    overloaded,
  });
  const recentActivity = [...tasks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const projectNodes = nodes.filter((node) => node.projectId === String(project.id) && !node.isDeleted);
  const projectBlocks = blocks.filter((block) => projectNodes.some((node) => node.id === block.pageId));
  const changeSummary = buildChangeSummary({ tasks, events, nodes: projectNodes, blocks: projectBlocks, now });
  const qualityReport = buildTaskQualityReport(tasks, now);
  const meetingPlan = buildMeetingPlan({
    tasks,
    members: project.members ?? [],
    overdue,
    dueSoon,
    overloaded,
    events,
    now,
  });
  const digest = digestText || buildAutoDigest({
    project,
    tasks,
    overdue,
    dueSoon,
    unassigned,
    noDeadline,
    weakTasks,
    byUser,
    riskTasks,
    changeSummary,
  });
  const eventsByUser = groupActivityByUser(events, project.members ?? []);
  const toggleUserEvents = (userId: number) => {
    setOpenUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const updateReport = (report: 'weekly' | 'overdue', patch: Partial<ProjectBotSettings['reports']['weekly']>) => {
    setBotSettings((current) => ({
      ...current,
      reports: {
        ...current.reports,
        [report]: {
          ...current.reports[report],
          ...patch,
        },
      },
    }));
  };
  const toggleReminderPoint = (id: string) => {
    setBotSettings((current) => ({
      ...current,
      kanbanReminderPoints: current.kanbanReminderPoints.map((point) =>
        point.id === id ? { ...point, enabled: !point.enabled } : point,
      ),
    }));
  };
  const updateReminderOffset = (id: string, offsetMinutes: number) => {
    setBotSettings((current) => ({
      ...current,
      kanbanReminderPoints: current.kanbanReminderPoints.map((point) =>
        point.id === id ? { ...point, offsetMinutes } : point,
      ),
    }));
  };
  const saveBotSettings = async () => {
    setSavingBotSettings(true);
    setBotSettingsSaved(false);
    try {
      const saved = await botSettingsApi.update(project.id, botSettings);
      setBotSettings(saved);
      setBotSettingsSaved(true);
      window.setTimeout(() => setBotSettingsSaved(false), 1600);
    } finally {
      setSavingBotSettings(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[86vh] overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5 animate-slide-up"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Администратор</h2>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{project.title}</p>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">
            ×
          </button>
        </div>

        <div className="sticky top-0 z-10 -mx-1 mb-4 flex gap-2 overflow-x-auto bg-[var(--tg-theme-bg-color)] px-1 py-2">
          {([
            ['overview', 'Обзор'],
            ['people', 'Люди'],
            ['risks', 'Риски'],
            ['meeting', 'Планерка'],
            ['reports', 'Отчеты'],
            ['bot', 'Бот'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveAdminTab(tab)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeAdminTab === tab
                  ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={`${activeAdminTab === 'overview' ? 'grid' : 'hidden'} grid-cols-2 gap-2`}>
          <AdminMetric label={healthTone} value={healthScore} suffix="%" tone={healthScore < 45 ? 'danger' : healthScore < 75 ? 'warning' : undefined} />
          <AdminMetric label="Задач" value={tasks.length} />
          <AdminMetric label="Просрочено" value={overdue.length} tone="danger" />
          <AdminMetric label="Скоро дедлайн" value={dueSoon.length} tone="warning" />
          <AdminMetric label="Без исполнителя" value={unassigned.length} />
          <AdminMetric label="Без дедлайна" value={noDeadline.length} />
          <AdminMetric label="Высокий приоритет" value={highPriority.length} tone="warning" />
        </div>

        <section className={`${activeAdminTab === 'overview' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Умный помощник</h3>
          <div className="space-y-2 text-sm text-[var(--tg-theme-text-color)]">
            {assistantInsights.map((insight) => (
              <div key={insight.title} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <p className={`font-semibold ${insight.tone === 'danger' ? 'text-red-500' : insight.tone === 'warning' ? 'text-yellow-500' : 'text-[var(--tg-theme-text-color)]'}`}>
                  {insight.title}
                </p>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{insight.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${activeAdminTab === 'overview' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <h3 className="mb-3 text-sm font-semibold text-[var(--tg-theme-text-color)]">Что изменилось с прошлого раза</h3>
          <div className="grid grid-cols-2 gap-2">
            <AdminMetric label="новые задачи" value={changeSummary.newTasks.length} />
            <AdminMetric label="закрытые задачи" value={changeSummary.closedTasks.length} />
            <AdminMetric label="новые просрочки" value={changeSummary.newOverdueTasks.length} tone={changeSummary.newOverdueTasks.length ? 'danger' : undefined} />
            <AdminMetric label="активных людей" value={changeSummary.activePeople.length} />
            <AdminMetric label="обновлено страниц" value={changeSummary.updatedPages.length} />
            <AdminMetric label="без движения" value={changeSummary.staleTasks.length} tone={changeSummary.staleTasks.length ? 'warning' : undefined} />
          </div>
          <div className="mt-3 space-y-2">
            {changeSummary.highlights.map((item) => (
              <p key={item} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
                {item}
              </p>
            ))}
          </div>
        </section>

        <section className={`${activeAdminTab === 'overview' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Авто-дайджест</h3>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Текст можно отправить в Telegram-чат команды.</p>
            </div>
            <button
              onClick={() => setDigestText(buildAutoDigest({
                project,
                tasks,
                overdue,
                dueSoon,
                unassigned,
                noDeadline,
                weakTasks,
                byUser,
                riskTasks,
                changeSummary,
              }))}
              className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
            >
              Сформировать
            </button>
          </div>
          <textarea
            readOnly
            value={digest}
            className="h-44 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-xs text-[var(--tg-theme-text-color)] outline-none"
          />
        </section>

        <section className={`${activeAdminTab === 'bot' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Настройки Telegram-бота</h3>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Уведомления, напоминания и отчеты администраторам.</p>
            </div>
            <button
              onClick={saveBotSettings}
              disabled={savingBotSettings}
              className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
            >
              {savingBotSettings ? '...' : botSettingsSaved ? 'OK' : 'Сохранить'}
            </button>
          </div>
          {!botSettingsApi.enabled && (
            <p className="mb-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
              Для реальной отправки подключите backend API через VITE_WORKSPACE_API_URL.
            </p>
          )}
          <div className="space-y-2">
            <BotToggle label="Уведомления по задачам" checked={botSettings.taskDeadlineNotificationsEnabled} onChange={(checked) => setBotSettings((current) => ({ ...current, taskDeadlineNotificationsEnabled: checked }))} />
            <BotToggle label="Упоминания @username" checked={botSettings.mentionNotificationsEnabled} onChange={(checked) => setBotSettings((current) => ({ ...current, mentionNotificationsEnabled: checked }))} />
            <BotToggle label="Напоминания из дежурств" checked={botSettings.dutyNotificationsEnabled} onChange={(checked) => setBotSettings((current) => ({ ...current, dutyNotificationsEnabled: checked }))} />
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Точки Kanban</p>
            {botSettings.kanbanReminderPoints.map((point) => (
              <div key={point.id} className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[var(--tg-theme-text-color)]">
                  <input type="checkbox" checked={point.enabled} onChange={() => toggleReminderPoint(point.id)} />
                  <span className="truncate">{point.label}</span>
                </label>
                {point.kind === 'before_deadline' && (
                  <input
                    type="number"
                    min={1}
                    value={Math.round((point.offsetMinutes ?? 0) / 60)}
                    onChange={(event) => updateReminderOffset(point.id, Math.max(1, Number(event.target.value)) * 60)}
                    className="w-16 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-right text-sm text-[var(--tg-theme-text-color)] outline-none"
                    aria-label="Часов до дедлайна"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="hidden">
            <BotReportRow title="Еженедельный отчет" report={botSettings.reports.weekly} onChange={(patch) => updateReport('weekly', patch)} />
            <BotReportRow title="Просрочки раз в 2 недели" report={botSettings.reports.overdue} onChange={(patch) => updateReport('overdue', patch)} />
          </div>
        </section>

        <section className={`${activeAdminTab === 'reports' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Отчеты</h3>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Автоотчеты администратору и краткая сводка проекта.</p>
            </div>
            <button
              onClick={saveBotSettings}
              disabled={savingBotSettings}
              className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
            >
              {savingBotSettings ? '...' : botSettingsSaved ? 'OK' : 'Сохранить'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <AdminMetric label="задач всего" value={tasks.length} />
            <AdminMetric label="просрочено" value={overdue.length} tone="danger" />
            <AdminMetric label="скоро дедлайн" value={dueSoon.length} tone="warning" />
            <AdminMetric label="активность" value={events.length} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <BotReportRow title="Еженедельный отчет" report={botSettings.reports.weekly} onChange={(patch) => updateReport('weekly', patch)} />
            <BotReportRow title="Просрочки раз в 2 недели" report={botSettings.reports.overdue} onChange={(patch) => updateReport('overdue', patch)} />
          </div>
        </section>

        <section className={`${activeAdminTab === 'overview' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">План действий</h3>
          <div className="space-y-2">
            {actionPlan.map((action, index) => (
              <div key={action} className="flex gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)]">
                <span className="text-[var(--tg-theme-hint-color)]">{index + 1}.</span>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </section>

        {activeAdminTab === 'risks' && (
          <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Топ рисковых задач</h3>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <AdminMetric label="просрочено" value={overdue.length} tone="danger" />
              <AdminMetric label="скоро дедлайн" value={dueSoon.length} tone="warning" />
              <AdminMetric label="без исполнителя" value={unassigned.length} />
              <AdminMetric label="без дедлайна" value={noDeadline.length} />
            </div>

            <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Контроль качества задач</h4>
                <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)]">
                  {qualityReport.totalIssues}
                </span>
              </div>
              <div className="space-y-2">
                {qualityReport.groups.map((group) => (
                  <details key={group.id} className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
                    <summary className="cursor-pointer list-none text-sm font-medium text-[var(--tg-theme-text-color)]">
                      {group.title} · {group.tasks.length}
                    </summary>
                    <div className="mt-2 space-y-1">
                      {group.tasks.length === 0 ? (
                        <p className="text-xs text-[var(--tg-theme-hint-color)]">Все хорошо.</p>
                      ) : (
                        group.tasks.slice(0, 6).map((task) => (
                          <p key={task.id} className="truncate text-xs text-[var(--tg-theme-hint-color)]">{task.title}</p>
                        ))
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {riskTasks.length === 0 && <p className="text-sm text-[var(--tg-theme-hint-color)]">Критичных рисков сейчас нет.</p>}
              {riskTasks.map(({ task, score }) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openTaskInKanban(task)}
                  disabled={!task.pageId}
                  className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-60"
                >
                  <p className="truncate text-sm font-medium text-[var(--tg-theme-text-color)]">{task.title}</p>
                  <p className="text-xs text-[var(--tg-theme-hint-color)]">
                    риск: {score} · {task.assignee?.firstName ?? task.assignee?.username ?? 'без исполнителя'} · {task.deadlineAt ? new Date(task.deadlineAt).toLocaleDateString('ru-RU') : 'без дедлайна'}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {activeAdminTab === 'meeting' && (
          <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Режим планерки</h3>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Короткий экран для командной встречи: что закрыли, что в работе, где риски и какие решения зафиксировать.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <AdminMetric label="завершили" value={meetingPlan.completed.length} />
              <AdminMetric label="в работе" value={meetingPlan.inProgress.length} />
              <AdminMetric label="заблокировано" value={meetingPlan.blocked.length} tone={meetingPlan.blocked.length ? 'danger' : undefined} />
              <AdminMetric label="дедлайны недели" value={meetingPlan.weekDeadlines.length} tone={meetingPlan.weekDeadlines.length ? 'warning' : undefined} />
            </div>
            <MeetingList title="Что завершили" items={meetingPlan.completed.map((task) => task.title)} empty="Пока нет завершенных задач за период." />
            <MeetingList title="Что в работе" items={meetingPlan.inProgress.map((task) => task.title)} empty="Нет активных задач в работе." />
            <MeetingList title="Что заблокировано" items={meetingPlan.blocked.map((task) => task.title)} empty="Явных блокеров не найдено." />
            <MeetingList title="Дедлайны недели" items={meetingPlan.weekDeadlines.map((task) => `${task.title} · ${task.deadlineAt ? new Date(task.deadlineAt).toLocaleDateString('ru-RU') : ''}`)} empty="На ближайшую неделю дедлайнов нет." />
            <MeetingList title="Кого разгрузить" items={meetingPlan.unloadPeople} empty="Перегруза по людям не видно." />
            <div className="mt-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
              <h4 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Решения после встречи</h4>
              <textarea
                placeholder="Например: перенести дедлайн, назначить ответственного, создать новую задачу..."
                className="h-28 w-full resize-none rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
              />
            </div>
          </section>
        )}

        <section className={`${activeAdminTab === 'people' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Активность пользователей</h3>
          <div className="space-y-2">
            {byUser.map((item) => (
              <button
                key={item.member.id}
                onClick={() => setSelectedMember(item.member)}
                className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left text-sm active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-[var(--tg-theme-text-color)]">{memberName(item.member)}</p>
                  <span className="text-xs text-[var(--tg-theme-hint-color)]">{Math.round((item.total / maxLoad) * 100)}% нагрузки</span>
                </div>
                <p className="text-xs text-[var(--tg-theme-hint-color)]">
                  задач: {item.total} · просрочено: {item.overdue} · скоро дедлайн: {item.dueSoon} · важных: {item.highPriority}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--tg-theme-secondary-bg-color)]">
                  <div className="h-full rounded-full bg-[var(--tg-theme-button-color)]" style={{ width: `${Math.round((item.total / maxLoad) * 100)}%` }} />
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className={`${activeAdminTab === 'people' ? 'block' : 'hidden'} mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">История изменений по людям</h3>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Список по умолчанию свернут. Старые действия удаляются автоматически.</p>
            </div>
            <select
              value={retentionDays}
              onChange={(event) => onRetentionChange(Number(event.target.value))}
              className="shrink-0 rounded-[9px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none"
              aria-label="Срок хранения истории"
            >
              {[1, 3, 7, 10].map((days) => (
                <option key={days} value={days}>{days} дн.</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            {eventsByUser.length === 0 ? (
              <p className="text-sm text-[var(--tg-theme-hint-color)]">Пока нет записанных действий. Новые изменения начнут появляться здесь.</p>
            ) : (
              eventsByUser.map((group) => (
                <div key={group.userId} className="rounded-[10px] bg-[var(--tg-theme-bg-color)]">
                  <button
                    onClick={() => toggleUserEvents(group.userId)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{group.userName}</span>
                      <span className="block text-xs text-[var(--tg-theme-hint-color)]">{group.events.length} действий</span>
                    </span>
                    <span className="text-[var(--tg-theme-hint-color)]">{openUserIds.has(group.userId) ? '⌄' : '›'}</span>
                  </button>
                  {openUserIds.has(group.userId) && (
                    <div className="border-t border-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
                      {group.events.map((event) => (
                        <div key={event.id} className="border-b border-[var(--tg-theme-secondary-bg-color)] py-2 last:border-b-0">
                          <p className="text-sm font-medium text-[var(--tg-theme-text-color)]">{event.title}</p>
                          {event.details && <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{event.details}</p>}
                          <p className="mt-1 text-[11px] text-[var(--tg-theme-hint-color)]">
                            {event.context ? `${event.context} · ` : ''}{new Date(event.createdAt).toLocaleString('ru-RU')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {recentActivity.length > 0 && eventsByUser.length === 0 && (
            <p className="mt-3 text-xs text-[var(--tg-theme-hint-color)]">
              Старые задачи видны в аналитике, но подробная история начнет собираться с новых действий.
            </p>
          )}
        </section>
        {selectedMember && (
          <MemberProfileModal
            project={project}
            member={selectedMember}
            tasks={tasks}
            events={events}
            now={now}
            onClose={() => setSelectedMember(null)}
          />
        )}
      </div>
    </div>
  );
}

function AdminMetric({ label, value, suffix = '', tone }: { label: string; value: number; suffix?: string; tone?: 'danger' | 'warning' }) {
  const color = tone === 'danger' ? 'text-red-500' : tone === 'warning' ? 'text-yellow-500' : 'text-[var(--tg-theme-text-color)]';
  return (
    <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <p className={`text-2xl font-bold ${color}`}>{value}{suffix}</p>
      <p className="text-xs text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function MemberProfileModal({
  project,
  member,
  tasks,
  events,
  now,
  onClose,
}: {
  project: Project;
  member: ProjectMember;
  tasks: Task[];
  events: ActivityEvent[];
  now: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const userId = member.userId;
  const activeTasks = tasks
    .filter((task) => !task.isArchived && isTaskAssignedToMember(task, userId))
    .sort((a, b) => {
      const left = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      const right = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  const overdueTasks = activeTasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now);
  const memberEvents = events.filter((event) => String(event.userId) === String(userId));
  const isActive = activeTasks.length > 0 || memberEvents.length > 0;
  const zones = getResponsibilityZones(activeTasks);
  const notesKey = `workspace-admin-member-notes:${project.id}:${userId}`;
  const [notes, setNotes] = useState(() => localStorage.getItem(notesKey) ?? '');
  const photoUrl = (member.user as any)?.photoUrl || (member.user as any)?.avatarUrl;
  const username = member.user?.username ? `@${member.user.username}` : 'не указан';
  const addedAt = (member as any).createdAt || (member as any).joinedAt || project.createdAt;

  const saveNotes = (value: string) => {
    setNotes(value);
    localStorage.setItem(notesKey, value);
  };

  const openTaskInKanban = (task: Task) => {
    if (!task.pageId) {
      return;
    }

    onClose();
    navigate(`/project/${project.id}/workspace/page/${task.pageId}?taskId=${task.id}`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/55" onClick={onClose}>
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tg-theme-button-color)] text-xl font-bold text-[var(--tg-theme-button-text-color)]">
                {memberName(member).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-[var(--tg-theme-text-color)]">{memberName(member)}</h3>
              <p className="text-sm text-[var(--tg-theme-hint-color)]">{username}</p>
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 shrink-0 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">×</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MemberCardMetric label="Роль" value={member.role?.name ?? (String(project.ownerId) === String(userId) ? 'owner' : 'viewer')} />
          <MemberCardMetric label="Статус" value={isActive ? 'Активен' : 'Неактивен'} tone={isActive ? undefined : 'warning'} />
          <MemberCardMetric label="Добавлен" value={new Date(addedAt).toLocaleDateString('ru-RU')} />
          <MemberCardMetric label="Активных задач" value={String(activeTasks.length)} />
          <MemberCardMetric label="Просрочено" value={String(overdueTasks.length)} tone={overdueTasks.length ? 'danger' : undefined} />
          <MemberCardMetric label="Зон ответственности" value={String(zones.length)} />
        </div>

        <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <h4 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Зоны ответственности</h4>
          {zones.length ? (
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => (
                <span key={zone} className="rounded-full bg-[var(--tg-theme-bg-color)] px-3 py-1 text-xs text-[var(--tg-theme-text-color)]">{zone}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--tg-theme-hint-color)]">Пока не определены по активным задачам.</p>
          )}
        </section>

        <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <h4 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Активные задачи</h4>
          {activeTasks.length ? (
            <div className="space-y-2">
              {activeTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openTaskInKanban(task)}
                  disabled={!task.pageId}
                  className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-60"
                >
                  <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">{task.title}</p>
                  <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                    {task.priority} · {task.deadlineAt ? new Date(task.deadlineAt).toLocaleString('ru-RU') : 'без дедлайна'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--tg-theme-hint-color)]">Активных задач нет.</p>
          )}
        </section>

        <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <h4 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Заметки администратора</h4>
          <textarea
            value={notes}
            onChange={(event) => saveNotes(event.target.value)}
            placeholder="Внутренние заметки владельца или администратора"
            className="h-28 w-full resize-none rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3 text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
          />
        </section>
      </div>
    </div>
  );
}

function MemberCardMetric({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warning' }) {
  const toneClass = tone === 'danger' ? 'text-red-400' : tone === 'warning' ? 'text-yellow-300' : 'text-[var(--tg-theme-text-color)]';
  return (
    <div className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <p className={`truncate text-sm font-bold ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function getResponsibilityZones(tasks: Task[]) {
  const zones = new Set<string>();
  for (const task of tasks) {
    task.tags?.forEach((tag) => zones.add(tag.title));
    if (task.colorLabel) zones.add(task.colorLabel);
    if (task.pageId) zones.add('Kanban');
  }
  return Array.from(zones).slice(0, 8);
}

function MeetingList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mt-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">{title}</h4>
        <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)]">{items.length}</span>
      </div>
      <div className="space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-[var(--tg-theme-hint-color)]">{empty}</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <p key={item} className="truncate rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1.5 text-xs text-[var(--tg-theme-text-color)]">
              {item}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function BotToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function BotReportRow({
  title,
  report,
  onChange,
}: {
  title: string;
  report: ProjectBotSettings['reports']['weekly'];
  onChange: (patch: Partial<ProjectBotSettings['reports']['weekly']>) => void;
}) {
  const weekdayText = report.weekdays.join(', ');
  return (
    <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{title}</p>
          <p className="text-xs text-[var(--tg-theme-hint-color)]">дни: {weekdayText || '-'} · {report.time}</p>
        </div>
        <input type="checkbox" checked={report.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={report.weekdays.join(',')}
          onChange={(event) => onChange({ weekdays: parseWeekdays(event.target.value) })}
          className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
          placeholder="2,4"
          aria-label="Дни недели"
        />
        <input
          type="time"
          value={report.time}
          onChange={(event) => onChange({ time: event.target.value })}
          className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none"
          aria-label="Время отчета"
        />
      </div>
    </div>
  );
}

function cloneBotSettings(settings: ProjectBotSettings): ProjectBotSettings {
  return JSON.parse(JSON.stringify(settings));
}

function parseWeekdays(value: string) {
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
}

function getTaskRiskScore(task: Task, now: number) {
  let score = 0;
  if (task.priority === 'CRITICAL') score += 35;
  if (task.priority === 'HIGH') score += 22;
  if (!task.assignee?.id && !task.assigneeId) score += 18;
  if (!task.description?.trim()) score += 8;
  if (!task.deadlineAt) score += 10;
  if (task.deadlineAt) {
    const diffHours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
    if (diffHours < 0) score += 40;
    else if (diffHours <= 24) score += 24;
    else if (diffHours <= 48) score += 14;
  }
  return score;
}

function buildAssistantInsights({
  tasks,
  overdue,
  dueSoon,
  unassigned,
  noDeadline,
  weakTasks,
  highPriority,
  inactiveMembers,
  overloaded,
}: {
  tasks: Task[];
  overdue: Task[];
  dueSoon: Task[];
  unassigned: Task[];
  noDeadline: Task[];
  weakTasks: Task[];
  highPriority: Task[];
  inactiveMembers: ProjectMember[];
  overloaded: Array<{ member: ProjectMember; total: number }>;
}) {
  const insights: Array<{ title: string; text: string; tone?: 'danger' | 'warning' }> = [];
  if (overdue.length > 0) {
    insights.push({
      title: 'Срочный риск по срокам',
      text: `${overdue.length} задач уже просрочены. Начни с переноса дедлайнов или перераспределения ответственных.`,
      tone: 'danger',
    });
  }
  if (dueSoon.length > 0) {
    insights.push({
      title: 'Дедлайны близко',
      text: `${dueSoon.length} задач подходят к сроку за 48 часов. Их стоит вынести в ежедневный фокус.`,
      tone: 'warning',
    });
  }
  if (overloaded.length > 0) {
    insights.push({
      title: 'Нагрузка распределена неровно',
      text: `Больше всего задач у: ${overloaded.map((item) => memberName(item.member)).join(', ')}. Проверь, можно ли передать часть задач.`,
      tone: 'warning',
    });
  }
  if (unassigned.length > 0 || noDeadline.length > 0) {
    insights.push({
      title: 'Задачи требуют уточнения',
      text: `${unassigned.length} без исполнителя, ${noDeadline.length} без дедлайна. Это мешает контролю проекта.`,
      tone: 'warning',
    });
  }
  if (highPriority.length > 0) {
    insights.push({
      title: 'Важные задачи',
      text: `${highPriority.length} задач с высоким или критичным приоритетом. Проверь, есть ли у них исполнитель и срок.`,
    });
  }
  if (weakTasks.length > Math.max(2, tasks.length / 3)) {
    insights.push({
      title: 'Качество постановки задач низкое',
      text: 'Много задач без описания, срока или исполнителя. Помощник рекомендует сначала привести задачи к единому стандарту.',
      tone: 'warning',
    });
  }
  if (inactiveMembers.length > 0) {
    insights.push({
      title: 'Не все участники вовлечены',
      text: `Нет назначенных задач у: ${inactiveMembers.map(memberName).join(', ')}.`,
    });
  }
  if (insights.length === 0) {
    insights.push({
      title: 'Критичных сигналов нет',
      text: 'Проект выглядит спокойно. Следующий полезный шаг: проверить новые задачи и актуальность дедлайнов.',
    });
  }
  return insights;
}

function buildActionPlan({
  overdue,
  dueSoon,
  unassigned,
  noDeadline,
  weakTasks,
  highPriority,
  overloaded,
}: {
  overdue: Task[];
  dueSoon: Task[];
  unassigned: Task[];
  noDeadline: Task[];
  weakTasks: Task[];
  highPriority: Task[];
  overloaded: Array<{ member: ProjectMember; total: number }>;
}) {
  const actions: string[] = [];
  if (overdue.length > 0) actions.push(`Разобрать ${overdue.length} просроченных задач и обновить сроки.`);
  if (dueSoon.length > 0) actions.push(`Поставить в фокус ${dueSoon.length} задач с ближайшим дедлайном.`);
  if (unassigned.length > 0) actions.push(`Назначить ответственных для ${unassigned.length} задач.`);
  if (noDeadline.length > 0) actions.push(`Добавить дедлайны для ${noDeadline.length} задач.`);
  if (overloaded.length > 0) actions.push(`Снять перегруз с: ${overloaded.map((item) => memberName(item.member)).join(', ')}.`);
  if (highPriority.length > 0) actions.push('Проверить критичные и важные задачи отдельно.');
  if (weakTasks.length > 0) actions.push('Уточнить формулировки задач без описания или структуры.');
  return actions.slice(0, 5).length > 0 ? actions.slice(0, 5) : ['Поддерживать текущий ритм и обновлять статусы задач в конце дня.'];
}

function buildChangeSummary({
  tasks,
  events,
  nodes,
  blocks,
  now,
}: {
  tasks: Task[];
  events: ActivityEvent[];
  nodes: PageNode[];
  blocks: Block[];
  now: number;
}) {
  const since = now - 7 * 24 * 3600000;
  const newTasks = tasks.filter((task) => new Date(task.createdAt).getTime() >= since);
  const closedTasks = tasks.filter((task) => task.isArchived || hasRecentEvent(events, task.id, ['task_complete'], since));
  const newOverdueTasks = tasks.filter((task) => {
    if (!task.deadlineAt || task.isArchived) return false;
    const deadline = new Date(task.deadlineAt).getTime();
    return deadline < now && deadline >= since;
  });
  const activePeople = unique(
    events
      .filter((event) => new Date(event.createdAt).getTime() >= since)
      .map((event) => event.userName)
      .filter(Boolean),
  );
  const updatedPageIds = new Set(
    blocks
      .filter((block) => new Date(block.updatedAt).getTime() >= since)
      .map((block) => block.pageId),
  );
  const updatedPages = nodes.filter((node) => updatedPageIds.has(node.id) || new Date(node.updatedAt).getTime() >= since);
  const staleTasks = tasks.filter((task) => {
    if (task.isArchived) return false;
    const changedAt = new Date(task.updatedAt ?? task.createdAt).getTime();
    return now - changedAt > 7 * 24 * 3600000;
  });
  const highlights = [
    `${newTasks.length} новых задач за 7 дней.`,
    `${closedTasks.length} закрытых или архивированных задач.`,
    `${updatedPages.length} страниц обновлялись.`,
    `${staleTasks.length} задач без движения больше недели.`,
  ];

  return { newTasks, closedTasks, newOverdueTasks, activePeople, updatedPages, staleTasks, highlights };
}

function buildTaskQualityReport(tasks: Task[], now: number) {
  const genericWords = ['сделать', 'подготовить', 'обсудить', 'решить', 'разобраться'];
  const noDescription = tasks.filter((task) => !task.description?.trim());
  const noDeadline = tasks.filter((task) => !task.deadlineAt);
  const noAssignee = tasks.filter((task) => !task.assigneeId && !task.assignee?.id);
  const longWithoutSubtasks = tasks.filter((task) => {
    const textLength = `${task.title} ${task.description ?? ''}`.trim().length;
    return textLength > 160 && (task.subtasks?.length ?? 0) === 0;
  });
  const stuckInWork = tasks.filter((task) => {
    if (task.isArchived) return false;
    const changedAt = new Date(task.updatedAt ?? task.createdAt).getTime();
    return now - changedAt > 5 * 24 * 3600000;
  });
  const genericTitle = tasks.filter((task) => {
    const title = task.title.trim().toLowerCase();
    return genericWords.some((word) => title === word || title.startsWith(`${word} `));
  });
  const groups = [
    { id: 'no-description', title: 'Нет описания', tasks: noDescription },
    { id: 'no-deadline', title: 'Нет дедлайна', tasks: noDeadline },
    { id: 'no-assignee', title: 'Нет исполнителя', tasks: noAssignee },
    { id: 'long-no-subtasks', title: 'Большая задача без подзадач', tasks: longWithoutSubtasks },
    { id: 'stuck', title: 'Висит в работе больше 5 дней', tasks: stuckInWork },
    { id: 'generic-title', title: 'Слишком общее название', tasks: genericTitle },
  ];
  return {
    groups,
    totalIssues: groups.reduce((sum, group) => sum + group.tasks.length, 0),
  };
}

function buildMeetingPlan({
  tasks,
  members,
  overdue,
  dueSoon,
  overloaded,
  events,
  now,
}: {
  tasks: Task[];
  members: ProjectMember[];
  overdue: Task[];
  dueSoon: Task[];
  overloaded: Array<{ member: ProjectMember; total: number }>;
  events: ActivityEvent[];
  now: number;
}) {
  const since = now - 7 * 24 * 3600000;
  const completedIds = new Set(
    events
      .filter((event) => new Date(event.createdAt).getTime() >= since)
      .filter((event) => event.type === 'task_complete')
      .map((event) => Number(event.entityId)),
  );
  const completed = tasks.filter((task) => task.isArchived || completedIds.has(task.id)).slice(0, 12);
  const inProgress = tasks.filter((task) => !task.isArchived).slice(0, 12);
  const blocked = uniqueTasks([...overdue, ...tasks.filter((task) => !task.assigneeId && !task.assignee?.id)]).slice(0, 12);
  const weekDeadlines = tasks
    .filter((task) => {
      if (!task.deadlineAt || task.isArchived) return false;
      const deadline = new Date(task.deadlineAt).getTime();
      return deadline >= now && deadline <= now + 7 * 24 * 3600000;
    })
    .sort((a, b) => new Date(a.deadlineAt!).getTime() - new Date(b.deadlineAt!).getTime());
  const unloadPeople = overloaded.map((item) => memberName(item.member));
  const inactivePeople = members
    .filter((member) => !tasks.some((task) => isTaskAssignedToMember(task, member.userId)))
    .map(memberName);
  return {
    completed,
    inProgress,
    blocked,
    weekDeadlines: uniqueTasks([...dueSoon, ...weekDeadlines]),
    unloadPeople: unloadPeople.length ? unloadPeople : inactivePeople.slice(0, 4),
  };
}

function buildAutoDigest({
  project,
  tasks,
  overdue,
  dueSoon,
  unassigned,
  noDeadline,
  weakTasks,
  byUser,
  riskTasks,
  changeSummary,
}: {
  project: Project;
  tasks: Task[];
  overdue: Task[];
  dueSoon: Task[];
  unassigned: Task[];
  noDeadline: Task[];
  weakTasks: Task[];
  byUser: Array<{ member: ProjectMember; total: number; overdue: number; dueSoon: number }>;
  riskTasks: Array<{ task: Task; score: number }>;
  changeSummary: ReturnType<typeof buildChangeSummary>;
}) {
  const topPeople = [...byUser].sort((a, b) => b.total - a.total).slice(0, 3);
  const lines = [
    `Сводка проекта: ${project.title}`,
    '',
    `Задачи: ${tasks.length}`,
    `Новые за 7 дней: ${changeSummary.newTasks.length}`,
    `Закрытые: ${changeSummary.closedTasks.length}`,
    `Просроченные: ${overdue.length}`,
    `Дедлайны в ближайшие 48 часов: ${dueSoon.length}`,
    '',
    'Люди:',
    ...(topPeople.length ? topPeople.map((item) => `- ${memberName(item.member)}: ${item.total} задач, просрочек ${item.overdue}`) : ['- нет назначенных задач']),
    '',
    'Риски:',
    `- без исполнителя: ${unassigned.length}`,
    `- без дедлайна: ${noDeadline.length}`,
    `- требуют уточнения: ${weakTasks.length}`,
    ...(riskTasks.length ? riskTasks.slice(0, 3).map(({ task }) => `- ${task.title}`) : ['- критичных задач не найдено']),
    '',
    'Фокус:',
    dueSoon[0] ? `- ближайший дедлайн: ${dueSoon[0].title}` : '- ближайших дедлайнов нет',
    overdue[0] ? `- сначала разобрать просрочку: ${overdue[0].title}` : '- просрочек для срочного разбора нет',
  ];
  return lines.join('\n');
}

function hasRecentEvent(events: ActivityEvent[], taskId: number, types: string[], since: number) {
  return events.some((event) =>
    event.entityId === String(taskId) &&
    types.includes(event.type) &&
    new Date(event.createdAt).getTime() >= since,
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueTasks(tasks: Task[]) {
  const seen = new Set<number>();
  return tasks.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

function ExportPanel({
  project,
  format,
  scope,
  targetId,
  exporting,
  result,
  onFormatChange,
  onScopeChange,
  onTargetChange,
  onExport,
  onClose,
}: {
  project: Project;
  format: ExportFormat;
  scope: ExportScope;
  targetId: string;
  exporting: boolean;
  result: ExportResult | null;
  onFormatChange: (format: ExportFormat) => void;
  onScopeChange: (scope: ExportScope) => void;
  onTargetChange: (id: string) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const { branches, pages, kanbanPages } = getProjectExportTargets(project);
  const targetOptions =
    scope === 'branch' ? branches :
    scope === 'page' ? pages :
    scope === 'kanban' ? kanbanPages :
    [];
  const needsTarget = scope !== 'project';
  const canExport = !needsTarget || Boolean(targetId);

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[86vh] overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5 animate-slide-up"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Экспорт проекта</h2>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{project.title}</p>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">
            ×
          </button>
        </div>

        <section className="mb-4 rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--tg-theme-text-color)]">Формат</h3>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'markdown', label: 'Markdown', hint: 'для текста и заметок' },
              { value: 'json', label: 'JSON', hint: 'полные данные' },
              { value: 'pdf', label: 'PDF', hint: 'печать/отчёт' },
              { value: 'html', label: 'HTML', hint: 'страница архива' },
            ] as const).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onFormatChange(item.value)}
                className={`rounded-[12px] p-3 text-left ${
                  format === item.value
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                }`}
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="block text-xs opacity-75">{item.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-4 rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--tg-theme-text-color)]">Объём</h3>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'project', label: 'Весь проект' },
              { value: 'branch', label: 'Отдельная ветвь' },
              { value: 'page', label: 'Отдельная страница' },
              { value: 'kanban', label: 'Kanban-доска' },
            ] as const).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onScopeChange(item.value)}
                className={`rounded-[12px] px-3 py-3 text-left text-sm font-semibold ${
                  scope === item.value
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {needsTarget && (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Что выгрузить</span>
              <select
                value={targetId}
                onChange={(event) => onTargetChange(event.target.value)}
                className="w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
              >
                <option value="">Выбрать</option>
                {targetOptions.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.icon} {node.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <button
          onClick={onExport}
          disabled={!canExport || exporting}
          className="w-full rounded-[14px] bg-[var(--tg-theme-button-color)] px-4 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
        >
          {exporting ? 'Готовлю...' : `Скачать ${exportLabel(format)}`}
        </button>

        {result && (
          <section className="mt-4 rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">Файл сформирован</h3>
                <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{result.fileName}</p>
              </div>
              <button
                type="button"
                onClick={() => downloadExportResult(result)}
                className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
              >
                Ещё раз
              </button>
            </div>
            <textarea
              readOnly
              value={result.content}
              className="h-36 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-xs text-[var(--tg-theme-text-color)] outline-none"
            />
          </section>
        )}
      </div>
    </div>
  );
}

function groupActivityByUser(events: ActivityEvent[], members: ProjectMember[]) {
  const names = new Map<number, string>();
  for (const member of members) names.set(member.userId, memberName(member));

  const grouped = new Map<number, { userId: number; userName: string; events: ActivityEvent[] }>();
  for (const event of events) {
    const existing = grouped.get(event.userId);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    grouped.set(event.userId, {
      userId: event.userId,
      userName: names.get(event.userId) ?? event.userName,
      events: [event],
    });
  }

  return [...grouped.values()].sort((a, b) => {
    const aTime = new Date(a.events[0]?.createdAt ?? 0).getTime();
    const bTime = new Date(b.events[0]?.createdAt ?? 0).getTime();
    return bTime - aTime;
  });
}

function memberName(member: ProjectMember) {
  return member.user?.firstName ?? member.user?.username ?? `ID ${member.userId}`;
}

function isTaskAssignedToMember(task: Task, userId: number | string) {
  const assigneeId = task.assigneeId ?? task.assignee?.id;
  return assigneeId !== undefined && assigneeId !== null && String(assigneeId) === String(userId);
}

function daysLeft(deletedAt?: string) {
  if (!deletedAt) return 30;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((30 * 24 * 3600000 - elapsed) / (24 * 3600000)));
}
