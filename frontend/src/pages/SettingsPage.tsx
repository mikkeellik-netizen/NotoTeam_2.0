import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { activityApi } from '../api/activity';
import { adminSummaryApi, type AdminChangeSummary } from '../api/adminSummary';
import { aiConnectorApi, type AiConnectorAccessEvent, type AiConnectorToken, type AiContextExportOptions } from '../api/aiConnector';
import { avatarApi } from '../api/avatar';
import { botSettingsApi, defaultProjectBotSettings } from '../api/botSettings';
import { workspaceApiUrl } from '../api/httpClient';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import { workspaceApi } from '../api/workspace';
import { LANGUAGE_OPTIONS } from '../localization/languages';
import UserAvatarImage from '../components/UserAvatarImage';
import {
  createProjectExport,
  downloadExportResult,
  exportLabel,
  getProjectExportTargets,
  openPrintableExport,
  sendProjectExportToTelegram,
  type ExportFormat,
  type ExportResult,
  type ExportScope,
} from '../services/exportService';
import { useAuthStore } from '../store/authStore';
import { usePageStore } from '../store/pageStore';
import { useProjectStore } from '../store/projectStore';
import { type LanguageCode, useSettingsStore } from '../store/settingsStore';
import { calculateTaskSignificanceScore, getTaskSignificanceLabel, normalizeTaskSignificanceSettings } from '../types';
import type {
  ActivityEvent,
  Block,
  Column,
  PageNode,
  Project,
  ProjectBotSettings,
  ProjectJoinRequest,
  ProjectMember,
  ProjectRoleName,
  ResponsibilityArea,
  Task,
  TaskSignificanceSettings,
  User,
} from '../types';
import { copyPlainText } from '../utils/clipboard';
import { getProjectPermissions } from '../utils/projectPermissions';

type AdminTab = 'overview' | 'people' | 'responsibility' | 'risks' | 'meeting' | 'reports' | 'bot' | 'ai';
type AdminReturnSection = 'action-plan';

type AdminReturnState = {
  adminReturn?: {
    projectId: number | string;
    tab: AdminTab;
    section?: AdminReturnSection;
    label: string;
  };
};

const createDefaultAiContextOptions = (): AiContextExportOptions => ({
  scope: 'summary',
  includeTasks: true,
  includeWorkspace: true,
  includeCalendar: true,
  includeReminders: true,
  includeInbox: true,
  includeResponsibility: true,
  includeActivity: true,
  includeBlocks: false,
  includeArchived: false,
  maxTasks: 300,
  maxBlocks: 300,
  workspaceAccessMode: 'all',
  workspaceNodeIds: [],
});

type AiConnectorAccessPreset = {
  id: string;
  title: string;
  description: string;
  policy: AiContextExportOptions;
};

type AiMcpClient = 'claude' | 'codex';
type AiMcpPlatform = 'windows' | 'linux';

const AI_MCP_SERVER_PATHS: Record<AiMcpPlatform, string> = {
  windows: 'C:\\noto\\ai-connector-mcp\\src\\server.js',
  linux: '/opt/noto/ai-connector-mcp/src/server.js',
};

const detectAiMcpPlatform = (): AiMcpPlatform => (
  typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows') ? 'windows' : 'linux'
);

const AI_CONNECTOR_ACCESS_PRESETS: AiConnectorAccessPreset[] = [
  {
    id: 'overview',
    title: 'Только обзор',
    description: 'Краткая сводка, задачи, календарь и ответственность.',
    policy: {
      scope: 'summary',
      includeTasks: true,
      includeWorkspace: false,
      includeCalendar: true,
      includeReminders: false,
      includeInbox: true,
      includeResponsibility: true,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: false,
      maxTasks: 100,
      maxBlocks: 1,
    },
  },
  {
    id: 'tasks-calendar',
    title: 'Задачи и календарь',
    description: 'Рабочий режим для планирования без текста страниц.',
    policy: {
      scope: 'summary',
      includeTasks: true,
      includeWorkspace: false,
      includeCalendar: true,
      includeReminders: true,
      includeInbox: true,
      includeResponsibility: true,
      includeActivity: false,
      includeBlocks: false,
      includeArchived: false,
      maxTasks: 300,
      maxBlocks: 1,
    },
  },
  {
    id: 'project-no-archive',
    title: 'Проект без архива',
    description: 'Страницы, задачи и события без архивных данных.',
    policy: {
      scope: 'full',
      includeTasks: true,
      includeWorkspace: true,
      includeCalendar: true,
      includeReminders: true,
      includeInbox: true,
      includeResponsibility: true,
      includeActivity: true,
      includeBlocks: true,
      includeArchived: false,
      maxTasks: 1000,
      maxBlocks: 1000,
    },
  },
  {
    id: 'full-export',
    title: 'Полный экспорт',
    description: 'Максимальный доступ, включая блоки страниц и архив.',
    policy: {
      scope: 'full',
      includeTasks: true,
      includeWorkspace: true,
      includeCalendar: true,
      includeReminders: true,
      includeInbox: true,
      includeResponsibility: true,
      includeActivity: true,
      includeBlocks: true,
      includeArchived: true,
      maxTasks: 2000,
      maxBlocks: 2000,
    },
  },
];

const AI_CONTEXT_POLICY_KEYS: Array<keyof AiContextExportOptions> = [
  'scope',
  'includeTasks',
  'includeWorkspace',
  'includeCalendar',
  'includeReminders',
  'includeInbox',
  'includeResponsibility',
  'includeActivity',
  'includeBlocks',
  'includeArchived',
  'maxTasks',
  'maxBlocks',
  'workspaceAccessMode',
  'workspaceNodeIds',
];

function sameAiContextOptions(left: AiContextExportOptions, right: AiContextExportOptions) {
  return AI_CONTEXT_POLICY_KEYS.every((key) => {
    if (key === 'workspaceAccessMode') return (left[key] ?? 'all') === (right[key] ?? 'all');
    if (key === 'workspaceNodeIds') {
      const leftIds = [...(left[key] ?? [])].sort();
      const rightIds = [...(right[key] ?? [])].sort();
      return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
    }
    return left[key] === right[key];
  });
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams<{ projectId?: string }>();
  const selectedProjectId = projectId ? Number(projectId) : undefined;
  const currentUser = useAuthStore((state) => state.user);
  const setAuthUser = useAuthStore((state) => state.setUser);
  const {
    projects,
    fetchProjects,
    fetchProject,
    createProject,
    removeProject,
    restoreProject,
    leaveProject: leaveProjectInStore,
  } = useProjectStore();
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
  const [memberActionId, setMemberActionId] = useState<number | string | null>(null);
  const [memberConfirm, setMemberConfirm] = useState<{
    type: 'remove' | 'transfer' | 'leave';
    member?: ProjectMember;
    project?: Project;
  } | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>('overview');
  const [adminInitialSection, setAdminInitialSection] = useState<AdminReturnSection | undefined>();
  const [adminTasks, setAdminTasks] = useState<Task[]>([]);
  const [adminColumns, setAdminColumns] = useState<Column[]>([]);
  const [adminEvents, setAdminEvents] = useState<ActivityEvent[]>([]);
  const [activityRetentionDays, setActivityRetentionDays] = useState(7);
  const [exportingProject, setExportingProject] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>('project');
  const [exportTargetId, setExportTargetId] = useState('');
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportMessage, setExportMessage] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [joinRequests, setJoinRequests] = useState<ProjectJoinRequest[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [accessNotice, setAccessNotice] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [appDialog, setAppDialog] = useState<{
    title: string;
    message: string;
    tone?: 'info' | 'success' | 'danger';
  } | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState('');
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0);
  const [avatarTelegramConsentOpen, setAvatarTelegramConsentOpen] = useState(false);

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
    () => projects.find((project) => String(project.id) === String(activeProjectId)) ?? projects[0],
    [activeProjectId, projects],
  );
  // Сравниваем как строки: с бэкенда userId/ownerId могут прийти строкой, а currentUser.id — числом.
  const isActiveProjectOwner = String(activeProject?.ownerId ?? '') === String(currentUser?.id ?? '_');
  const currentMember = activeProject?.members?.find(
    (member) => String(member.userId) === String(currentUser?.id ?? '_'),
  );
  const currentPermissions = getProjectPermissions(activeProject, currentUser?.id);
  const canOpenAdminPanel = Boolean(currentPermissions.viewAnalytics || currentPermissions.manageBot || currentPermissions.manageProject);
  const canManageMembers = Boolean(currentPermissions.manageMembers);
  const canExportProject = Boolean(currentPermissions.exportProject);
  const isMemberActionLoading = (id: number | string | undefined) =>
    memberActionId !== null && String(memberActionId) === String(id ?? -1);
  const inviteLink = useMemo(
    () => (inviteCode ? `${window.location.origin}/?join=${encodeURIComponent(inviteCode)}` : ''),
    [inviteCode],
  );

  useEffect(() => {
    if (!activeProject?.id || !currentUser?.id || !canManageMembers) {
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
  }, [activeProject?.id, currentUser?.id, canManageMembers]);

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

  const applyUpdatedAvatarUser = async (user: User, message: string) => {
    setAuthUser(user);
    setAvatarNotice(message);
    setAvatarRefreshKey((value) => value + 1);
    if (activeProject?.id) await fetchProject(activeProject.id);
    else await fetchProjects();
  };

  const useTelegramAvatar = async () => {
    if (!currentUser?.id) return;
    setAvatarBusy(true);
    setAvatarNotice('');
    try {
      const user = await avatarApi.useTelegram(currentUser.id);
      const message = user.avatarStatus === 'ready'
        ? 'Фото из Telegram подключено.'
        : 'Фото Telegram недоступно из-за приватности. Можно загрузить вручную.';
      await applyUpdatedAvatarUser(user, message);
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : 'Не удалось получить фото Telegram');
    } finally {
      setAvatarBusy(false);
      setAvatarTelegramConsentOpen(false);
    }
  };

  const disableAvatar = async () => {
    if (!currentUser?.id) return;
    setAvatarBusy(true);
    setAvatarNotice('');
    try {
      const user = await avatarApi.disable(currentUser.id);
      await applyUpdatedAvatarUser(user, 'Фото отключено. Будут показаны инициалы.');
    } catch (error) {
      setAvatarNotice(error instanceof Error ? error.message : 'Не удалось отключить фото');
    } finally {
      setAvatarBusy(false);
    }
  };

  const uploadManualAvatar = async (file: File | undefined) => {
    if (!file || !currentUser?.id) return;
    setAvatarBusy(true);
    setAvatarNotice('');
    try {
      const dataUrl = await prepareAvatarDataUrl(file);
      const user = await avatarApi.uploadManual(currentUser.id, dataUrl);
      await applyUpdatedAvatarUser(user, 'Фото загружено вручную.');
    } catch (error) {
      setAvatarNotice(humanAvatarError(error, 'Не удалось загрузить фото'));
    } finally {
      setAvatarBusy(false);
    }
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
    if (!activeProject?.id || !currentUser?.id || !canManageMembers) return;
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

  const showAppDialog = (
    message: string,
    title = 'Сообщение',
    tone: 'info' | 'success' | 'danger' = 'info',
  ) => {
    setAppDialog({ title, message, tone });
  };

  const sendJoinRequest = async () => {
    if (!joinCode.trim() || !currentUser?.id) return;
    setAccessLoading(true);
    try {
      const username = currentUser.username ?? currentUser.telegramId;
      const displayName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(' ') || username;
      await projectsApi.requestJoinByCode(joinCode, username, displayName, currentUser.id);
      setJoinCode('');
      showAppDialog('Заявка отправлена владельцу проекта.', 'Заявка отправлена', 'success');
    } catch (error) {
      showAppDialog(error instanceof Error ? error.message : 'Не удалось отправить заявку.', 'Не удалось отправить заявку', 'danger');
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
      showAppDialog(error instanceof Error ? error.message : 'Не удалось удалить участника.', 'Ошибка удаления', 'danger');
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
      showAppDialog(error instanceof Error ? error.message : 'Не удалось передать права владельца.', 'Ошибка передачи прав', 'danger');
    } finally {
      setMemberActionId(null);
    }
  };

  const changeMemberRole = async (member: ProjectMember, role: ProjectRoleName) => {
    if (!activeProject?.id || !currentUser?.id) return;
    const currentRole = member.role?.name ?? 'editor';
    if (role === currentRole || role === 'owner') return;
    setMemberActionId(member.id);
    try {
      await projectsApi.setMemberRole(activeProject.id, member.id, role, currentUser.id);
      await refreshActiveProject();
      setAccessNotice(`Роль обновлена: ${projectRoleLabel(role)}`);
    } catch (error) {
      setAccessNotice(error instanceof Error ? error.message : 'Не удалось изменить роль участника');
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
    const leavingActiveProject = String(activeProject?.id ?? activeProjectId ?? '') === String(project.id);
    setMemberActionId(member?.id ?? -1);
    try {
      const nextProjects = await leaveProjectInStore(project.id);
      const nextProject = nextProjects.find((item) => String(item.id) !== String(project.id)) ?? nextProjects[0];
      if (leavingActiveProject) {
        setActiveProjectId(nextProject?.id);
        navigate(nextProject ? `/project/${nextProject.id}/settings` : '/', { replace: true });
      } else {
        await fetchProjects();
      }
    } catch (error) {
      showAppDialog(error instanceof Error ? error.message : 'Не удалось покинуть проект.', 'Не удалось покинуть проект', 'danger');
    } finally {
      setMemberActionId(null);
    }
  };

  const loadDeletedProjects = async () => {
    const trash = await projectsApi.getTrash();
    setDeletedProjects(trash.filter((project) => String(project.ownerId) === String(currentUser?.id ?? '_')));
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    setDeletingProject(true);
    try {
      await removeProject(projectToDelete.id);
      await loadDeletedProjects();
      const remainingProjects = projects.filter((project) => String(project.id) !== String(projectToDelete.id));
      setProjectToDelete(null);

      if (String(activeProjectId) === String(projectToDelete.id)) {
        const nextProject = remainingProjects[0];
        setActiveProjectId(nextProject?.id);
        if (!nextProject || String(selectedProjectId) === String(projectToDelete.id)) {
          navigate('/');
        }
      }
    } catch (error) {
      showAppDialog(error instanceof Error ? error.message : 'Удалить проект может только владелец.', 'Не удалось удалить проект', 'danger');
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
      showAppDialog(error instanceof Error ? error.message : 'Удалить проект навсегда может только владелец.', 'Не удалось удалить проект', 'danger');
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
    if (!activeProject?.id || !canOpenAdminPanel) return;
    setAdminOpen(true);
    const [tasks, columns] = await Promise.all([
      tasksApi.getByProject(activeProject.id, undefined, true),
      projectsApi.getAllColumns(activeProject.id),
    ]);
    setAdminTasks(tasks);
    setAdminColumns(columns);
    setActivityRetentionDays(activityApi.getRetentionDays(activeProject.id));
    setAdminEvents(await activityApi.load(activeProject.id));
  };

  useEffect(() => {
    const returnTarget = (location.state as AdminReturnState | null)?.adminReturn;
    if (
      !returnTarget ||
      !activeProject ||
      String(returnTarget.projectId) !== String(activeProject.id) ||
      !canOpenAdminPanel
    ) {
      return;
    }

    setAdminInitialTab(returnTarget.tab);
    setAdminInitialSection(returnTarget.section);
    void openAdminPanel();
    navigate(location.pathname, { replace: true, state: null });
  }, [activeProject?.id, canOpenAdminPanel, location.pathname, location.state]);

  const exportActiveProject = async (delivery: 'download' | 'telegram') => {
    if (!activeProject || !canExportProject) return;
    setExportingProject(true);
    setExportMessage('');
    try {
      const options = {
        format: exportFormat,
        scope: exportScope,
        targetId: exportTargetId || undefined,
      };
      if (delivery === 'telegram') {
        const response = await sendProjectExportToTelegram(activeProject, options);
        setExportMessage(response.message || `Файл ${response.fileName} отправится в Telegram-бота.`);
        setExportResult(null);
      } else {
        const result = await createProjectExport(activeProject, options);
        if (exportFormat === 'pdf') openPrintableExport(result, result.fileName.replace(/\.html$/i, '.pdf'));
        else downloadExportResult(result);
        setExportResult(result);
      }
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Не удалось сформировать экспорт');
    } finally {
      setExportingProject(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--tg-theme-bg-color)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <button onClick={leaveSettings} className={`h-8 w-8 text-[var(--tg-theme-link-color)] ${projectId ? '' : 'md:hidden'}`} aria-label="Назад">
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
          {currentUser && (
            <AvatarSettingsBlock
              user={currentUser}
              busy={avatarBusy}
              notice={avatarNotice}
              refreshKey={avatarRefreshKey}
              onAskTelegram={() => setAvatarTelegramConsentOpen(true)}
              onDisable={disableAvatar}
              onUpload={uploadManualAvatar}
            />
          )}
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

        {canExportProject && (
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
        )}

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
                      disabled={projectMember ? isMemberActionLoading(projectMember.id) : isMemberActionLoading(-1)}
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
                disabled={isMemberActionLoading(currentMember.id)}
                className="rounded-[9px] bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-500 disabled:opacity-50"
              >
                Покинуть проект
              </button>
            )}
          </div>
          {canManageMembers && (
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
          {!canManageMembers && (
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
                    @{member.user?.username ?? member.user?.telegramId} · {projectRoleLabel(member.role?.name)}
                  </p>
                </div>
                {canManageMembers && member.userId !== currentUser?.id && (
                  <div className="flex shrink-0 items-center gap-2">
                    {!isProjectMemberOwner(activeProject, member) && (isActiveProjectOwner || !isAdminMember(member)) && (
                      <select
                        value={member.role?.name ?? 'editor'}
                        onChange={(event) => changeMemberRole(member, event.target.value as ProjectRoleName)}
                        disabled={isMemberActionLoading(member.id)}
                        className="max-w-[116px] rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs font-medium text-[var(--tg-theme-text-color)] outline-none disabled:opacity-50"
                        aria-label={`Роль участника ${memberName(member)}`}
                      >
                        <option value="viewer">Наблюдатель</option>
                        <option value="editor">Редактор</option>
                        {isActiveProjectOwner && <option value="admin">Админ</option>}
                      </select>
                    )}
                    {!isActiveProjectOwner && isAdminMember(member) && (
                      <span className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-hint-color)]">
                        Админ
                      </span>
                    )}
                    {isActiveProjectOwner && !isProjectMemberOwner(activeProject, member) && (
                      <button
                        onClick={() => setMemberConfirm({ type: 'transfer', member })}
                        disabled={isMemberActionLoading(member.id)}
                        className="rounded-[9px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-medium text-[var(--tg-theme-text-color)] disabled:opacity-50"
                      >
                        Владелец
                      </button>
                    )}
                    {!isProjectMemberOwner(activeProject, member) && (!isAdminMember(member) || isActiveProjectOwner) && (
                      <button
                        onClick={() => setMemberConfirm({ type: 'remove', member })}
                        disabled={isMemberActionLoading(member.id)}
                        className="h-9 w-9 rounded-[9px] bg-red-500/10 text-base text-red-500 disabled:opacity-50"
                        aria-label={`Удалить участника ${member.user?.username ?? member.userId}`}
                      >
                        ×
                      </button>
                    )}
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
                disabled={isMemberActionLoading(memberConfirm.member?.id ?? -1)}
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

      {avatarTelegramConsentOpen && (
        <TelegramAvatarConsentModal
          busy={avatarBusy}
          onCancel={() => setAvatarTelegramConsentOpen(false)}
          onConfirm={useTelegramAvatar}
        />
      )}

      {appDialog && (
        <SettingsMessageDialog
          title={appDialog.title}
          message={appDialog.message}
          tone={appDialog.tone}
          onClose={() => setAppDialog(null)}
        />
      )}

      {adminOpen && activeProject && (
        <AdminPanel
          project={activeProject}
          initialTab={adminInitialTab}
          initialSection={adminInitialSection}
          tasks={adminTasks}
          columns={adminColumns}
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

      {exportOpen && activeProject && canExportProject && (
        <ExportPanel
          project={activeProject}
          format={exportFormat}
          scope={exportScope}
          targetId={exportTargetId}
          exporting={exportingProject}
          result={exportResult}
          message={exportMessage}
          onFormatChange={(format) => {
            setExportFormat(format);
            setExportResult(null);
            setExportMessage('');
          }}
          onScopeChange={(scope) => {
            setExportScope(scope);
            setExportTargetId('');
            setExportResult(null);
            setExportMessage('');
          }}
          onTargetChange={(id) => {
            setExportTargetId(id);
            setExportResult(null);
            setExportMessage('');
          }}
          onExport={exportActiveProject}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

function AvatarSettingsBlock({
  user,
  busy,
  notice,
  refreshKey,
  onAskTelegram,
  onDisable,
  onUpload,
}: {
  user: User;
  busy: boolean;
  notice: string;
  refreshKey: number;
  onAskTelegram: () => void;
  onDisable: () => void;
  onUpload: (file: File | undefined) => void;
}) {
  const statusText =
    user.avatarStatus === 'ready'
      ? user.avatarMode === 'telegram'
        ? 'Фото Telegram подключено'
        : 'Фото загружено вручную'
      : user.avatarStatus === 'unavailable'
        ? 'Фото Telegram недоступно'
        : 'Показаны инициалы';

  return (
    <div className="mt-4 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
      <div className="flex items-start gap-3">
        <UserAvatarImage user={user} label={userDisplayName(user)} size="md" refreshKey={refreshKey} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Фото профиля</p>
              <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{statusText}</p>
            </div>
            {busy && <span className="text-xs text-[var(--tg-theme-hint-color)]">...</span>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onAskTelegram}
              disabled={busy}
              className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-50"
            >
              Telegram
            </button>
            <label className={`cursor-pointer rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-center text-xs font-semibold text-[var(--tg-theme-text-color)] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              Вручную
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  onUpload(event.target.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={onDisable}
              disabled={busy}
              className="rounded-[10px] bg-red-500/15 px-2 py-2 text-xs font-semibold text-red-200 disabled:opacity-50"
            >
              Выкл.
            </button>
          </div>
          {notice && <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">{notice}</p>}
        </div>
      </div>
    </div>
  );
}

function TelegramAvatarConsentModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-black/55 px-4 pb-4" onClick={onCancel}>
      <section
        className="w-full rounded-[18px] bg-[var(--tg-theme-bg-color)] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--tg-theme-button-color)]/15 text-2xl">
          🖼️
        </div>
        <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Использовать фото Telegram?</h2>
        <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
          Приложение попробует получить вашу аватарку через Telegram-бота и сохранит уменьшенную копию. Если фото скрыто настройками приватности, останутся инициалы.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
          >
            {busy ? 'Получаю...' : 'Разрешаю'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsMessageDialog({
  title,
  message,
  tone = 'info',
  onClose,
}: {
  title: string;
  message: string;
  tone?: 'info' | 'success' | 'danger';
  onClose: () => void;
}) {
  const badgeClass =
    tone === 'danger'
      ? 'bg-red-500/15 text-red-300'
      : tone === 'success'
        ? 'bg-emerald-500/15 text-emerald-300'
        : 'bg-[var(--tg-theme-button-color)]/15 text-[var(--tg-theme-button-color)]';
  const icon = tone === 'danger' ? '!' : tone === 'success' ? '✓' : 'i';

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end bg-black/55 px-4 pb-4 sm:items-center sm:justify-center sm:pb-0"
      onClick={onClose}
    >
      <section
        className="w-full max-w-md rounded-[18px] bg-[var(--tg-theme-secondary-bg-color)] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold ${badgeClass}`}>
          {icon}
        </div>
        <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)]">{title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[var(--tg-theme-hint-color)]">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)]"
        >
          OK
        </button>
      </section>
    </div>
  );
}

function AdminPanel({
  project,
  initialTab,
  initialSection,
  tasks,
  columns,
  events,
  retentionDays,
  onRetentionChange,
  onClose,
}: {
  project: Project;
  initialTab: AdminTab;
  initialSection?: AdminReturnSection;
  tasks: Task[];
  columns: Column[];
  events: ActivityEvent[];
  retentionDays: number;
  onRetentionChange: (days: number) => void | Promise<void>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { createNode, ensureInbox } = usePageStore();
  const [openUserIds, setOpenUserIds] = useState<Set<number>>(new Set());
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>(initialTab);
  const [selectedMember, setSelectedMember] = useState<ProjectMember | null>(null);
  const [responsibilityAreas, setResponsibilityAreas] = useState<ResponsibilityArea[]>(project.responsibilityAreas ?? []);
  const [editingResponsibilityArea, setEditingResponsibilityArea] = useState<ResponsibilityArea | null>(null);
  const [responsibilityFormOpen, setResponsibilityFormOpen] = useState(false);
  const [responsibilityAreaToDelete, setResponsibilityAreaToDelete] = useState<ResponsibilityArea | null>(null);
  const [responsibilitySaving, setResponsibilitySaving] = useState(false);
  const [digestText, setDigestText] = useState('');
  const [digestCopied, setDigestCopied] = useState(false);
  const [botSettings, setBotSettings] = useState<ProjectBotSettings>(
    project.botSettings ?? cloneBotSettings(defaultProjectBotSettings),
  );
  const [changeSummary, setChangeSummary] = useState<AdminChangeSummary>(() => createEmptyAdminChangeSummary());
  const [savingBotSettings, setSavingBotSettings] = useState(false);
  const [botSettingsSaved, setBotSettingsSaved] = useState(false);
  const [aiContextOptions, setAiContextOptions] = useState<AiContextExportOptions>(() => createDefaultAiContextOptions());
  const [aiContextText, setAiContextText] = useState('');
  const [aiContextLoading, setAiContextLoading] = useState(false);
  const [aiContextCopied, setAiContextCopied] = useState(false);
  const [aiPromptCopied, setAiPromptCopied] = useState(false);
  const [aiContextError, setAiContextError] = useState('');
  const [aiTokens, setAiTokens] = useState<AiConnectorToken[]>([]);
  const [aiTokensLoading, setAiTokensLoading] = useState(false);
  const [aiTokenName, setAiTokenName] = useState('AI Connector');
  const [aiTokenDays, setAiTokenDays] = useState(90);
  const [aiTokenAccessPolicy, setAiTokenAccessPolicy] = useState<AiContextExportOptions>(() => createDefaultAiContextOptions());
  const [aiTokenSecret, setAiTokenSecret] = useState('');
  const [aiTokenCopied, setAiTokenCopied] = useState(false);
  const [aiTokenError, setAiTokenError] = useState('');
  const [aiMcpClient, setAiMcpClient] = useState<AiMcpClient>('claude');
  const [aiMcpPlatform, setAiMcpPlatform] = useState<AiMcpPlatform>(() => detectAiMcpPlatform());
  const [aiMcpApiUrl, setAiMcpApiUrl] = useState(workspaceApiUrl);
  const [aiMcpServerPath, setAiMcpServerPath] = useState(() => AI_MCP_SERVER_PATHS[detectAiMcpPlatform()]);
  const [aiMcpConfigCopied, setAiMcpConfigCopied] = useState(false);
  const [aiTokenTesting, setAiTokenTesting] = useState(false);
  const [aiTokenTestResult, setAiTokenTestResult] = useState('');
  const [aiAccessEvents, setAiAccessEvents] = useState<AiConnectorAccessEvent[]>([]);
  const [aiAccessEventsLoading, setAiAccessEventsLoading] = useState(false);
  const [aiAccessEventsError, setAiAccessEventsError] = useState('');
  const [aiWorkspaceNodes, setAiWorkspaceNodes] = useState<PageNode[]>([]);
  const [aiWorkspaceNodesLoading, setAiWorkspaceNodesLoading] = useState(false);
  const [aiWorkspaceNodesError, setAiWorkspaceNodesError] = useState('');
  const [meetingStartDate, setMeetingStartDate] = useState(() => formatDateInput(new Date(Date.now() - 6 * 24 * 3600000)));
  const [meetingEndDate, setMeetingEndDate] = useState(() => formatDateInput(new Date()));
  const [meetingDecisionText, setMeetingDecisionText] = useState('');
  const [meetingDecisionStatus, setMeetingDecisionStatus] = useState<'idle' | 'saved'>('idle');
  const aiTokenAccessPresetId = useMemo(() => {
    return AI_CONNECTOR_ACCESS_PRESETS.find((preset) => sameAiContextOptions(aiTokenAccessPolicy, preset.policy))?.id ?? 'custom';
  }, [aiTokenAccessPolicy]);
  const aiWorkspaceTree = useMemo(() => {
    const activeNodes = aiWorkspaceNodes.filter((node) => !node.isDeleted);
    const children = new Map<string | null, PageNode[]>();
    for (const node of activeNodes) {
      const parentId = node.parentId && activeNodes.some((item) => item.id === node.parentId) ? node.parentId : null;
      children.set(parentId, [...(children.get(parentId) ?? []), node]);
    }
    for (const items of children.values()) items.sort((left, right) => left.order - right.order);
    const flattened: Array<{ node: PageNode; depth: number }> = [];
    const visit = (parentId: string | null, depth: number) => {
      for (const node of children.get(parentId) ?? []) {
        flattened.push({ node, depth });
        visit(node.id, depth + 1);
      }
    };
    visit(null, 0);
    return flattened;
  }, [aiWorkspaceNodes]);

  const openTaskInKanban = (task: Task, section?: AdminReturnSection) => {
    if (!task.pageId) {
      return;
    }

    onClose();
    navigate(`/project/${project.id}/workspace/page/${task.pageId}?taskId=${encodeURIComponent(String(task.id))}`, {
      state: {
        adminReturn: {
          projectId: project.id,
          tab: activeAdminTab,
          section,
          label: section === 'action-plan' ? 'План действий' : activeAdminTab === 'risks' ? 'Риски' : 'Ответственность',
        },
      } satisfies AdminReturnState,
    });
  };

  useEffect(() => {
    if (initialSection !== 'action-plan' || activeAdminTab !== 'overview') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('admin-action-plan')?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAdminTab, initialSection]);

  const saveMeetingDecision = () => {
    const text = meetingDecisionText.trim();
    if (!text) return;
    const inbox = ensureInbox(String(project.id));
    createNode({
      projectId: String(project.id),
      parentId: inbox.id,
      type: 'page',
      title: `Решение планерки: ${text.slice(0, 48)}`,
      icon: '📥',
      initialBlocks: [{ type: 'paragraph', content: { text, source: 'meeting' }, order: 0 }],
    });
    setMeetingDecisionText('');
    setMeetingDecisionStatus('saved');
    window.setTimeout(() => setMeetingDecisionStatus('idle'), 1800);
  };

  const refreshAiAccessEvents = async () => {
    setAiAccessEventsLoading(true);
    setAiAccessEventsError('');
    try {
      const events = await aiConnectorApi.listAccessEvents(project.id, 50);
      setAiAccessEvents(events);
    } catch (error) {
      setAiAccessEvents([]);
      setAiAccessEventsError(error instanceof Error ? error.message : 'Не удалось загрузить журнал AI Connector');
    } finally {
      setAiAccessEventsLoading(false);
    }
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
    let cancelled = false;
    setAiWorkspaceNodesLoading(true);
    setAiWorkspaceNodesError('');
    workspaceApi.getNodes(project.id)
      .then(({ nodes }) => {
        if (!cancelled) setAiWorkspaceNodes(nodes);
      })
      .catch((error) => {
        if (!cancelled) {
          setAiWorkspaceNodes([]);
          setAiWorkspaceNodesError(error instanceof Error ? error.message : 'Не удалось загрузить дерево проекта');
        }
      })
      .finally(() => {
        if (!cancelled) setAiWorkspaceNodesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setAiTokensLoading(true);
    setAiTokenError('');
    setAiTokenSecret('');
    aiConnectorApi
      .listTokens(project.id)
      .then((tokens) => {
        if (!cancelled) setAiTokens(tokens);
      })
      .catch((error) => {
        if (!cancelled) {
          setAiTokens([]);
          setAiTokenError(error instanceof Error ? error.message : 'Не удалось загрузить AI-токены');
        }
      })
      .finally(() => {
        if (!cancelled) setAiTokensLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setAiAccessEventsLoading(true);
    setAiAccessEventsError('');
    aiConnectorApi
      .listAccessEvents(project.id, 50)
      .then((events) => {
        if (!cancelled) setAiAccessEvents(events);
      })
      .catch((error) => {
        if (!cancelled) {
          setAiAccessEvents([]);
          setAiAccessEventsError(error instanceof Error ? error.message : 'Не удалось загрузить журнал AI Connector');
        }
      })
      .finally(() => {
        if (!cancelled) setAiAccessEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    adminSummaryApi
      .get(project.id)
      .then((summary) => {
        if (!cancelled) setChangeSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setChangeSummary(createEmptyAdminChangeSummary());
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, tasks.length, events.length]);

  useEffect(() => {
    let cancelled = false;
    setResponsibilityAreas(project.responsibilityAreas ?? []);
    projectsApi
      .getResponsibilityAreas(project.id)
      .then((areas) => {
        if (!cancelled) setResponsibilityAreas(areas);
      })
      .catch(() => {
        if (!cancelled) setResponsibilityAreas(project.responsibilityAreas ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const now = Date.now();
  const activeTasks = tasks.filter((task) => isTaskActiveForAdmin(task, columns, now));
  const completedTasks = tasks.filter((task) => isTaskCompletedForAdmin(task, columns));
  const deferredTasks = tasks.filter((task) => isTaskDeferredForAdmin(task, now) && !isTaskCompletedForAdmin(task, columns));
  const significanceSettings = normalizeTaskSignificanceSettings(botSettings.taskSignificance);
  const overdue = activeTasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now);
  const highPriority = activeTasks.filter((task) => task.priority === 'HIGH' || task.priority === 'CRITICAL');
  const dueSoon = activeTasks.filter((task) => {
    if (!task.deadlineAt) return false;
    const diffHours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
    return diffHours >= 0 && diffHours <= 48;
  });
  const unassigned = activeTasks.filter((task) => !task.assignee?.id && !task.assigneeId);
  const noDeadline = activeTasks.filter((task) => !task.deadlineAt);
  const weakTasks = activeTasks.filter((task) => !task.description?.trim() || !task.deadlineAt || (!task.assignee?.id && !task.assigneeId));
  const activeSignificanceWeight = activeTasks.reduce((sum, task) => sum + calculateTaskSignificanceScore(task, now, significanceSettings), 0);
  const overdueSignificanceWeight = overdue.reduce((sum, task) => sum + calculateTaskSignificanceScore(task, now, significanceSettings), 0);
  const highSignificanceTasks = activeTasks.filter((task) => calculateTaskSignificanceScore(task, now, significanceSettings) >= significanceSettings.attentionThreshold);
  const byUser = (project.members ?? []).map((member) => {
    const memberTasks = activeTasks.filter((task) => isTaskAssignedToMember(task, member.userId));
    const significance = memberTasks.reduce((sum, task) => sum + calculateTaskSignificanceScore(task, now, significanceSettings), 0);
    const overdueSignificance = memberTasks.reduce((sum, task) => {
      if (!task.deadlineAt || new Date(task.deadlineAt).getTime() >= now) return sum;
      return sum + calculateTaskSignificanceScore(task, now, significanceSettings);
    }, 0);
    return {
      member,
      total: memberTasks.length,
      significance,
      overdueSignificance,
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
  const responsibilitySummaries = buildResponsibilityAreaSummaries({
    areas: responsibilityAreas,
    members: project.members ?? [],
    tasks,
    activeTasks,
    completedTasks,
    now,
  });
  const coveredActiveTaskIds = new Set(
    responsibilitySummaries.flatMap((summary) => summary.activeTasks.map((task) => String(task.id))),
  );
  const uncoveredActiveTasks = activeTasks.filter((task) => !coveredActiveTaskIds.has(String(task.id)));
  const maxLoad = Math.max(1, ...byUser.map((item) => item.total));
  const maxWeightedLoad = Math.max(1, ...byUser.map((item) => item.significance));
  const overloaded = byUser.filter((item) => item.total >= Math.max(4, Math.ceil(maxLoad * 0.7)) && item.total > 0);
  const workloadPlan = buildWorkloadRedistributionPlan({
    byUser,
    activeTasks,
    now,
    settings: significanceSettings,
  });
  const deadlineForecast = buildDeadlineForecast({
    activeTasks,
    byUser,
    now,
    settings: significanceSettings,
  });
  const inactiveMembers = (project.members ?? []).filter((member) => !activeTasks.some((task) => isTaskAssignedToMember(task, member.userId)));
  const riskTasks = [...activeTasks]
    .map((task) => ({ task, score: getTaskRiskScore(task, now, significanceSettings) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const attentionQueue = buildTaskAttentionQueue(activeTasks, now, significanceSettings);
  const reactionRules = buildAdminReactionRules(attentionQueue, significanceSettings);
  const assistantInsights = buildAssistantInsights({
    tasks: activeTasks,
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
  const recentActivity = [...activeTasks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const qualityReport = buildTaskQualityReport(activeTasks, now);
  const meetingPlan = buildMeetingPlan({
    tasks,
    columns,
    members: project.members ?? [],
    overdue,
    dueSoon,
    overloaded,
    events,
    now,
    periodStart: meetingStartDate,
    periodEnd: meetingEndDate,
  });
  const digest = digestText || buildAutoDigest({
    project,
    tasks: activeTasks,
    overdue,
    dueSoon,
    unassigned,
    noDeadline,
    weakTasks,
    byUser,
    riskTasks,
    changeSummary,
    deadlineForecast,
    workloadPlan,
    reactionRules,
  });
  const generateDigest = () => {
    setDigestCopied(false);
    setDigestText(buildAutoDigest({
      project,
      tasks: activeTasks,
      overdue,
      dueSoon,
      unassigned,
      noDeadline,
      weakTasks,
      byUser,
      riskTasks,
      changeSummary,
      deadlineForecast,
      workloadPlan,
      reactionRules,
    }));
  };
  const copyDigest = async () => {
    const copied = await copyPlainText(digest);
    if (!copied) return;
    setDigestCopied(true);
    window.setTimeout(() => setDigestCopied(false), 1600);
  };
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
  const updateReminderLabel = (id: string, label: string) => {
    setBotSettings((current) => ({
      ...current,
      kanbanReminderPoints: current.kanbanReminderPoints.map((point) =>
        point.id === id ? { ...point, label } : point,
      ),
    }));
  };
  const addReminderPoint = () => {
    const id = `before_${Date.now()}`;
    setBotSettings((current) => ({
      ...current,
      kanbanReminderPoints: [
        ...current.kanbanReminderPoints,
        {
          id,
          enabled: true,
          kind: 'before_deadline',
          offsetMinutes: 24 * 60,
          label: 'За 24 часа',
        },
      ],
    }));
  };
  const removeReminderPoint = (id: string) => {
    setBotSettings((current) => ({
      ...current,
      kanbanReminderPoints: current.kanbanReminderPoints.filter((point) => point.id !== id),
    }));
  };
  const toggleReportWeekday = (report: 'weekly' | 'overdue', day: number) => {
    const currentDays = botSettings.reports[report].weekdays;
    updateReport(report, {
      weekdays: currentDays.includes(day)
        ? currentDays.filter((item) => item !== day)
        : [...currentDays, day].sort((left, right) => left - right),
    });
  };
  const toggleReportRecipient = (report: 'weekly' | 'overdue', userId: number) => {
    const currentRecipients = botSettings.reports[report].recipientUserIds ?? [];
    updateReport(report, {
      recipientUserIds: currentRecipients.includes(userId)
        ? currentRecipients.filter((item) => item !== userId)
        : [...currentRecipients, userId],
    });
  };
  const toggleReportSection = (
    report: 'weekly' | 'overdue',
    section: keyof ProjectBotSettings['reports']['weekly']['sections'],
  ) => {
    updateReport(report, {
      sections: {
        ...botSettings.reports[report].sections,
        [section]: !botSettings.reports[report].sections[section],
      },
    });
  };
  const updateSignificanceSettings = (patch: Partial<TaskSignificanceSettings>) => {
    setBotSettings((current) => ({
      ...current,
      taskSignificance: normalizeTaskSignificanceSettings({
        ...normalizeTaskSignificanceSettings(current.taskSignificance),
        ...patch,
      }),
    }));
  };
  const updateSignificancePriorityBonus = (priority: keyof TaskSignificanceSettings['priorityBonus'], value: number) => {
    setBotSettings((current) => {
      const currentSignificance = normalizeTaskSignificanceSettings(current.taskSignificance);
      return {
        ...current,
        taskSignificance: normalizeTaskSignificanceSettings({
          ...currentSignificance,
          priorityBonus: {
            ...currentSignificance.priorityBonus,
            [priority]: value,
          },
        }),
      };
    });
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
  const openCreateResponsibilityArea = () => {
    setEditingResponsibilityArea(null);
    setResponsibilityFormOpen(true);
  };
  const openEditResponsibilityArea = (area: ResponsibilityArea) => {
    setEditingResponsibilityArea(area);
    setResponsibilityFormOpen(true);
  };
  const saveResponsibilityArea = async (draft: Partial<ResponsibilityArea>) => {
    const actorUserId = currentUserId ?? project.ownerId;
    setResponsibilitySaving(true);
    try {
      const saved = editingResponsibilityArea
        ? await projectsApi.updateResponsibilityArea(project.id, editingResponsibilityArea.id, draft, actorUserId)
        : await projectsApi.createResponsibilityArea(project.id, draft, actorUserId);
      setResponsibilityAreas((current) =>
        editingResponsibilityArea
          ? current.map((area) => (String(area.id) === String(saved.id) ? saved : area))
          : [...current, saved],
      );
      setResponsibilityFormOpen(false);
      setEditingResponsibilityArea(null);
    } finally {
      setResponsibilitySaving(false);
    }
  };
  const confirmDeleteResponsibilityArea = async () => {
    if (!responsibilityAreaToDelete) return;
    const actorUserId = currentUserId ?? project.ownerId;
    const areaId = responsibilityAreaToDelete.id;
    setResponsibilityAreaToDelete(null);
    await projectsApi.deleteResponsibilityArea(project.id, areaId, actorUserId);
    setResponsibilityAreas((current) => current.filter((area) => String(area.id) !== String(areaId)));
  };
  const buildAiContextText = async () => {
    setAiContextLoading(true);
    setAiContextError('');
    try {
      const context = await aiConnectorApi.getProjectContext(project.id, aiContextOptions);
      const text = JSON.stringify(context, null, 2);
      setAiContextText(text);
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сформировать контекст';
      setAiContextError(message);
      return '';
    } finally {
      setAiContextLoading(false);
    }
  };
  const copyAiContext = async () => {
    const text = aiContextText || await buildAiContextText();
    if (!text) return;
    const copied = await copyPlainText(text);
    if (!copied) return;
    setAiContextCopied(true);
    window.setTimeout(() => setAiContextCopied(false), 1600);
  };
  const buildAiPromptText = async () => {
    const text = aiContextText || await buildAiContextText();
    if (!text) return '';
    return [
      'Ты работаешь как проектный AI-ассистент Noto.',
      'Ниже передан JSON-контекст проекта. Используй только данные из него, не выдумывай отсутствующие факты.',
      '',
      'Что нужно сделать:',
      '1. Кратко оцени состояние проекта.',
      '2. Найди риски по срокам, нагрузке, ответственности и незавершенным задачам.',
      '3. Дай список практичных действий на ближайшую неделю.',
      '4. Отдельно отметь, каких данных не хватает для точного вывода.',
      '',
      'Формат ответа:',
      '- Сводка проекта.',
      '- Главные риски.',
      '- Рекомендации.',
      '- Вопросы к владельцу проекта.',
      '',
      'JSON-контекст:',
      '```json',
      text,
      '```',
    ].join('\n');
  };
  const copyAiPrompt = async () => {
    const prompt = await buildAiPromptText();
    if (!prompt) return;
    const copied = await copyPlainText(prompt);
    if (!copied) return;
    setAiPromptCopied(true);
    window.setTimeout(() => setAiPromptCopied(false), 1600);
  };
  const downloadAiContext = async () => {
    const text = aiContextText || await buildAiContextText();
    if (!text) return;
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `project-${project.id}-ai-context.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };
  const updateAiContextOptions = (patch: Partial<AiContextExportOptions>) => {
    setAiContextText('');
    setAiContextCopied(false);
    setAiPromptCopied(false);
    setAiContextError('');
    setAiContextOptions((current) => ({ ...current, ...patch }));
  };
  const updateAiTokenAccessPolicy = (patch: Partial<AiContextExportOptions>) => {
    setAiTokenSecret('');
    setAiTokenCopied(false);
    setAiMcpConfigCopied(false);
    setAiTokenTestResult('');
    setAiTokenAccessPolicy((current) => ({ ...current, ...patch }));
  };
  const applyAiTokenAccessPreset = (preset: AiConnectorAccessPreset) => {
    setAiTokenSecret('');
    setAiTokenCopied(false);
    setAiMcpConfigCopied(false);
    setAiTokenTestResult('');
    setAiTokenAccessPolicy({ ...preset.policy });
  };
  const updateAiWorkspaceAccessMode = (mode: NonNullable<AiContextExportOptions['workspaceAccessMode']>) => {
    updateAiTokenAccessPolicy({
      workspaceAccessMode: mode,
      workspaceNodeIds: mode === 'all' ? [] : aiTokenAccessPolicy.workspaceNodeIds ?? [],
    });
  };
  const toggleAiWorkspaceNode = (nodeId: string) => {
    const selected = new Set(aiTokenAccessPolicy.workspaceNodeIds ?? []);
    if (selected.has(nodeId)) selected.delete(nodeId);
    else selected.add(nodeId);
    updateAiTokenAccessPolicy({ workspaceNodeIds: [...selected] });
  };
  const formatAiAccessPolicy = (policy?: AiContextExportOptions) => {
    const current = policy ?? createDefaultAiContextOptions();
    const sections = [
      current.includeTasks !== false ? 'задачи' : '',
      current.includeWorkspace !== false ? 'страницы' : '',
      current.includeCalendar !== false ? 'календарь проекта' : '',
      current.includeReminders !== false ? 'напоминания проекта' : '',
      current.includeInbox !== false ? 'входящие проекта' : '',
      current.includeResponsibility !== false ? 'ответственность' : '',
      current.includeActivity !== false ? 'активность' : '',
      current.includeBlocks ? 'блоки' : '',
      current.includeArchived ? 'архив' : '',
    ].filter(Boolean);
    const workspaceMode = current.workspaceAccessMode ?? 'all';
    const workspaceAccess = workspaceMode === 'all'
      ? 'весь проект'
      : workspaceMode === 'include'
        ? `только выбранное (${current.workspaceNodeIds?.length ?? 0})`
        : `кроме выбранного (${current.workspaceNodeIds?.length ?? 0})`;
    return `${current.scope === 'full' ? 'полный' : 'краткий'} · ${sections.join(', ') || 'без разделов'} · ${workspaceAccess} · до ${current.maxTasks ?? 300} задач / ${current.maxBlocks ?? 300} блоков`;
  };
  const formatAiTokenDate = (value?: string) => {
    if (!value) return 'нет';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'нет';
    return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const createAiToken = async () => {
    if ((aiTokenAccessPolicy.workspaceAccessMode ?? 'all') !== 'all' && !aiTokenAccessPolicy.workspaceNodeIds?.length) {
      setAiTokenError('Выберите хотя бы одну папку, страницу или Kanban-доску.');
      return;
    }
    setAiTokensLoading(true);
    setAiTokenError('');
    setAiTokenSecret('');
    try {
      const created = await aiConnectorApi.createToken(project.id, {
        name: aiTokenName,
        expiresInDays: aiTokenDays,
        accessPolicy: aiTokenAccessPolicy,
      });
      setAiTokenSecret(created.token);
      setAiTokenCopied(false);
      setAiMcpConfigCopied(false);
      setAiTokens((current) => [
        created.tokenRecord,
        ...current.filter((token) => String(token.id) !== String(created.tokenRecord.id)),
      ]);
    } catch (error) {
      setAiTokenError(error instanceof Error ? error.message : 'Не удалось создать AI-токен');
    } finally {
      setAiTokensLoading(false);
    }
  };
  const revokeAiToken = async (tokenId: string) => {
    setAiTokensLoading(true);
    setAiTokenError('');
    try {
      const revoked = await aiConnectorApi.revokeToken(project.id, tokenId);
      setAiTokens((current) => current.map((token) => (String(token.id) === String(tokenId) ? revoked : token)));
    } catch (error) {
      setAiTokenError(error instanceof Error ? error.message : 'Не удалось отозвать AI-токен');
    } finally {
      setAiTokensLoading(false);
    }
  };
  const copyAiTokenSecret = async () => {
    if (!aiTokenSecret) return;
    const copied = await copyPlainText(aiTokenSecret);
    if (!copied) return;
    setAiTokenCopied(true);
    window.setTimeout(() => setAiTokenCopied(false), 1600);
  };
  const selectAiMcpPlatform = (platform: AiMcpPlatform) => {
    setAiMcpPlatform(platform);
    setAiMcpServerPath(AI_MCP_SERVER_PATHS[platform]);
    setAiMcpConfigCopied(false);
  };
  const buildAiMcpConfig = () => {
    const apiUrl = aiMcpApiUrl.trim() || 'https://api.example.com';
    const serverPath = aiMcpServerPath.trim() || AI_MCP_SERVER_PATHS[aiMcpPlatform];
    if (aiMcpClient === 'codex') {
      return [
        '[mcp_servers.noto_ai_connector]',
        'command = "node"',
        `args = [${JSON.stringify(serverPath)}]`,
        'enabled = true',
        'required = false',
        'startup_timeout_sec = 15',
        'tool_timeout_sec = 60',
        'default_tools_approval_mode = "auto"',
        `env = { AI_CONNECTOR_API_URL = ${JSON.stringify(apiUrl)}, AI_CONNECTOR_AUTH_TOKEN = ${JSON.stringify(aiTokenSecret)}, AI_CONNECTOR_PROJECT_ID = ${JSON.stringify(String(project.id))} }`,
      ].join('\n');
    }
    return JSON.stringify({
      mcpServers: {
        'noto-ai-connector': {
          command: 'node',
          args: [serverPath],
          env: {
            AI_CONNECTOR_API_URL: apiUrl,
            AI_CONNECTOR_AUTH_TOKEN: aiTokenSecret,
            AI_CONNECTOR_PROJECT_ID: String(project.id),
          },
        },
      },
    }, null, 2);
  };
  const copyAiMcpConfig = async () => {
    if (!aiTokenSecret) return;
    const copied = await copyPlainText(buildAiMcpConfig());
    if (!copied) return;
    setAiMcpConfigCopied(true);
    window.setTimeout(() => setAiMcpConfigCopied(false), 1600);
  };
  const testAiToken = async () => {
    if (!aiTokenSecret) return;
    setAiTokenTesting(true);
    setAiTokenError('');
    setAiTokenTestResult('');
    try {
      const tokenTestOptions = {
        ...aiTokenAccessPolicy,
        maxTasks: Math.min(aiTokenAccessPolicy.maxTasks ?? 300, 1),
        maxBlocks: Math.min(aiTokenAccessPolicy.maxBlocks ?? 300, 1),
      };
      const connection = await aiConnectorApi.testConnection({
        apiUrl: aiMcpApiUrl,
        projectId: project.id,
        token: aiTokenSecret,
        options: tokenTestOptions,
      });
      const context = connection.context;
      const summary = context.summary as { activeTasks?: number; completedTasks?: number } | undefined;
      setAiTokenTestResult(`Подключение работает · ${connection.latencyMs} мс · активных задач ${summary?.activeTasks ?? 0}, завершенных ${summary?.completedTasks ?? 0}.`);
      const [tokens] = await Promise.all([
        aiConnectorApi.listTokens(project.id),
        refreshAiAccessEvents(),
      ]);
      setAiTokens(tokens);
    } catch (error) {
      setAiTokenError(error instanceof Error ? error.message : 'Не удалось проверить AI-токен');
    } finally {
      setAiTokenTesting(false);
    }
  };
  const adminNavigationGroups: Array<{
    title: string;
    items: Array<{ id: AdminTab; label: string; description: string }>;
  }> = [
    {
      title: 'Контроль проекта',
      items: [
        { id: 'overview', label: 'Обзор', description: 'Состояние и ближайшие действия' },
        { id: 'risks', label: 'Риски', description: 'Просрочки и качество задач' },
        { id: 'people', label: 'Команда', description: 'Нагрузка и активность' },
        { id: 'responsibility', label: 'Ответственность', description: 'Зоны и владельцы процессов' },
      ],
    },
    {
      title: 'Работа команды',
      items: [
        { id: 'meeting', label: 'Планерка', description: 'Повестка командной встречи' },
        { id: 'reports', label: 'Отчеты', description: 'Сводки и расписание отправки' },
      ],
    },
    {
      title: 'Автоматизация',
      items: [
        { id: 'bot', label: 'Telegram-бот', description: 'Уведомления и напоминания' },
        { id: 'ai', label: 'AI Connector', description: 'Доступ внешнего ИИ к проекту' },
      ],
    },
  ];
  const activeAdminItem = adminNavigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === activeAdminTab) ?? adminNavigationGroups[0].items[0];
  const adminHighlights: Array<{
    tab: AdminTab;
    title: string;
    value: string | number;
    detail: string;
    tone?: 'danger' | 'warning' | 'success';
  }> = [
    {
      tab: 'overview',
      title: 'Активные задачи',
      value: activeTasks.length,
      detail: `${overdue.length} просрочено · ${dueSoon.length} скоро`,
      tone: overdue.length ? 'danger' : dueSoon.length ? 'warning' : 'success',
    },
    {
      tab: 'people',
      title: 'Люди',
      value: project.members?.length ?? 0,
      detail: overloaded.length ? `${overloaded.length} перегружено` : 'нагрузка спокойная',
      tone: overloaded.length ? 'warning' : 'success',
    },
    {
      tab: 'risks',
      title: 'Риски',
      value: highSignificanceTasks.length,
      detail: `вес просрочки ${overdueSignificanceWeight}`,
      tone: overdueSignificanceWeight ? 'danger' : highSignificanceTasks.length ? 'warning' : 'success',
    },
    {
      tab: 'bot',
      title: 'Бот',
      value: botSettings.taskDeadlineNotificationsEnabled ? 'вкл' : 'выкл',
      detail: botSettings.mentionNotificationsEnabled ? 'упоминания включены' : 'упоминания выключены',
      tone: botSettings.taskDeadlineNotificationsEnabled ? 'success' : 'warning',
    },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-black/55 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[94vh] w-full flex-col overflow-hidden rounded-t-[14px] bg-[var(--tg-theme-bg-color)] shadow-2xl animate-slide-up sm:max-w-6xl sm:rounded-[14px]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--tg-theme-secondary-bg-color)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Администратор</h2>
            <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{project.title} · {activeAdminItem.label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-lg text-[var(--tg-theme-text-color)]"
            aria-label="Закрыть панель администратора"
          >
            ×
          </button>
        </header>

        <nav
          className="admin-tab-strip shrink-0 scroll-smooth overflow-x-auto overscroll-x-contain border-b border-[var(--tg-theme-secondary-bg-color)] px-3 py-2 md:hidden"
          aria-label="Разделы панели администратора"
        >
          <div className="flex w-max gap-1">
            {adminNavigationGroups.flatMap((group) => group.items).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={(event) => {
                  const button = event.currentTarget;
                  setActiveAdminTab(item.id);
                  window.requestAnimationFrame(() => button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
                }}
                className={`whitespace-nowrap rounded-[8px] px-3 py-2 text-sm font-semibold transition ${
                  activeAdminTab === item.id
                    ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                    : 'text-[var(--tg-theme-hint-color)]'
                }`}
                aria-current={activeAdminTab === item.id ? 'page' : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-[var(--tg-theme-secondary-bg-color)] p-3 md:block">
            {adminNavigationGroups.map((group) => (
              <div key={group.title} className="mb-5 last:mb-0">
                <p className="mb-2 px-2 text-[11px] font-semibold uppercase text-[var(--tg-theme-hint-color)]">{group.title}</p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveAdminTab(item.id)}
                      className={`w-full rounded-[8px] px-3 py-2 text-left transition ${
                        activeAdminTab === item.id
                          ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                          : 'text-[var(--tg-theme-text-color)] hover:bg-[var(--tg-theme-secondary-bg-color)]'
                      }`}
                    >
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className={`mt-0.5 block text-[11px] ${activeAdminTab === item.id ? 'opacity-80' : 'text-[var(--tg-theme-hint-color)]'}`}>
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-5 md:px-6">
            <div className="mx-auto w-full max-w-4xl">
              <div className="mb-4 mt-5">
                <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">{activeAdminItem.label}</h3>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{activeAdminItem.description}</p>
              </div>

              {activeAdminTab === 'overview' && (
                <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {adminHighlights.map((item) => {
                    const toneClass =
                      item.tone === 'danger'
                        ? 'border-red-500/40 text-red-300'
                        : item.tone === 'warning'
                          ? 'border-yellow-500/40 text-yellow-200'
                          : item.tone === 'success'
                            ? 'border-emerald-500/40 text-emerald-200'
                            : 'border-transparent text-[var(--tg-theme-text-color)]';
                    return (
              <button
                key={item.title}
                type="button"
                onClick={() => setActiveAdminTab(item.tab)}
                        className={`rounded-[8px] border bg-[var(--tg-theme-secondary-bg-color)] p-3 text-left transition active:scale-[0.99] ${toneClass}`}
              >
                <p className="text-xs font-semibold uppercase opacity-80">{item.title}</p>
                <p className="mt-1 text-xl font-bold">{item.value}</p>
                <p className="mt-1 truncate text-xs text-[var(--tg-theme-hint-color)]">{item.detail}</p>
              </button>
            );
          })}
                </section>
              )}

        <div className={`${activeAdminTab === 'overview' ? 'block' : 'hidden'}`}>
        </div>

        <div className={`${activeAdminTab === 'overview' ? 'grid' : 'hidden'} mt-4 grid-cols-2 gap-2`}>
          <AdminMetric label="Задач" value={activeTasks.length} />
          <AdminMetric label="Просрочено" value={overdue.length} tone="danger" />
          <AdminMetric label="Скоро дедлайн" value={dueSoon.length} tone="warning" />
          <AdminMetric label="Без исполнителя" value={unassigned.length} />
          <AdminMetric label="Без дедлайна" value={noDeadline.length} />
          <AdminMetric label="Высокий приоритет" value={highPriority.length} tone="warning" />
          <AdminMetric label="Вес активных" value={activeSignificanceWeight} tone={activeSignificanceWeight >= 30 ? 'warning' : undefined} />
          <AdminMetric label="Существенных" value={highSignificanceTasks.length} tone={highSignificanceTasks.length ? 'warning' : undefined} />
          <AdminMetric label="Вес просрочки" value={overdueSignificanceWeight} tone={overdueSignificanceWeight ? 'danger' : undefined} />
        </div>

        {activeAdminTab === 'overview' && (
          <DeadlineForecastPanel forecast={deadlineForecast} onOpenTask={openTaskInKanban} />
        )}

        <AdminDetailsSection active={activeAdminTab === 'overview'} title="Умный помощник">
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
        </AdminDetailsSection>

        <AdminDetailsSection active={activeAdminTab === 'overview'} title="Что изменилось за последние 7 дней">
          <div className="grid grid-cols-2 gap-2">
            <AdminMetric label="новые задачи" value={changeSummary.newTasks.length} />
            <AdminMetric label="закрытые задачи" value={changeSummary.closedTasks.length} />
            <AdminMetric label="новые просрочки" value={changeSummary.newOverdueTasks.length} tone={changeSummary.newOverdueTasks.length ? 'danger' : undefined} />
            <AdminMetric label="активных людей" value={changeSummary.activePeople.length} />
            <AdminMetric label="обновлено страниц" value={changeSummary.updatedPages.length} />
            <AdminMetric label="без движения" value={changeSummary.staleTasks.length} tone={changeSummary.staleTasks.length ? 'warning' : undefined} />
          </div>
          <div className="mt-3 space-y-2">
            {[`${changeSummary.newTasks.length} новых задач за последние 7 дней.`, `${changeSummary.closedTasks.length} завершённых задач за последние 7 дней.`, `${changeSummary.updatedPages.length} обновлённых страниц.`, `${changeSummary.staleTasks.length} задач без движения больше недели.`].map((item) => (
              <p key={item} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
                {item}
              </p>
            ))}
          </div>
        </AdminDetailsSection>

        <AdminDetailsSection active={activeAdminTab === 'overview'} title="Авто-дайджест">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Текст можно отправить в Telegram-чат команды.</p>
            </div>
            <button
              onClick={generateDigest}
              className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
            >
              Сформировать
            </button>
            <button
              onClick={copyDigest}
              className="shrink-0 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)]"
            >
              {digestCopied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <textarea
            readOnly
            value={digest}
            className="h-44 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-xs text-[var(--tg-theme-text-color)] outline-none"
          />
        </AdminDetailsSection>

        <section className={`${activeAdminTab === 'bot' ? 'block' : 'hidden'} mt-4 space-y-4`}>
          <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-[var(--tg-theme-hint-color)]">
                  Управление уведомлениями, напоминаниями, отчетами и поведением бота в этом проекте.
                </p>
              </div>
              <button
                onClick={saveBotSettings}
                disabled={savingBotSettings}
                className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
              >
                {savingBotSettings ? '...' : botSettingsSaved ? 'OK' : 'Сохранить'}
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <p className="text-xs text-[var(--tg-theme-hint-color)]">Статус</p>
                <p className="text-sm font-semibold text-[var(--tg-theme-text-color)]">{botSettingsApi.enabled ? 'API подключен' : 'Локальный режим'}</p>
              </div>
              <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Тон сообщений</span>
                <select
                  value={botSettings.kanbanReminderTone}
                  onChange={(event) => setBotSettings((current) => ({ ...current, kanbanReminderTone: event.target.value as ProjectBotSettings['kanbanReminderTone'] }))}
                  className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                >
                  <option value="soft">Мягкий</option>
                  <option value="neutral">Нейтральный</option>
                  <option value="strict">Строгий</option>
                  <option value="pastoral">Пасторский</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <BotToggle label="Уведомления по задачам Kanban" checked={botSettings.taskDeadlineNotificationsEnabled} onChange={(checked) => setBotSettings((current) => ({ ...current, taskDeadlineNotificationsEnabled: checked }))} />
              <BotToggle label="Уведомления об упоминаниях @username" checked={botSettings.mentionNotificationsEnabled} onChange={(checked) => setBotSettings((current) => ({ ...current, mentionNotificationsEnabled: checked }))} />
              <BotToggle label="Напоминания из графиков дежурств" checked={botSettings.dutyNotificationsEnabled} onChange={(checked) => setBotSettings((current) => ({ ...current, dutyNotificationsEnabled: checked }))} />
            </div>
          </section>

          <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Точки уведомлений Kanban</h3>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Новая задача, часы до дедлайна и момент дедлайна.</p>
              </div>
              <button
                type="button"
                onClick={addReminderPoint}
                className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
              >
                + точка
              </button>
            </div>
            <div className="space-y-2">
              {botSettings.kanbanReminderPoints.map((point) => {
                const canDelete = point.kind === 'before_deadline' && !['before_15h', 'before_2h'].includes(point.id);
                return (
                  <div key={point.id} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <input type="checkbox" checked={point.enabled} onChange={() => toggleReminderPoint(point.id)} />
                      <input
                        value={point.label}
                        onChange={(event) => updateReminderLabel(point.id, event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                        aria-label="Название точки уведомления"
                      />
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => removeReminderPoint(point.id)}
                          className="h-8 w-8 rounded-full bg-red-500/15 text-red-500"
                          aria-label="Удалить точку уведомления"
                        >
                          x
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-hint-color)]">
                        {point.kind === 'on_assign' ? 'При назначении' : point.kind === 'at_deadline' ? 'В дедлайн' : 'До дедлайна'}
                      </div>
                      {point.kind === 'before_deadline' ? (
                        <label className="flex items-center gap-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-hint-color)]">
                          <span>часов</span>
                          <input
                            type="number"
                            min={1}
                            value={Math.max(1, Math.round((point.offsetMinutes ?? 60) / 60))}
                            onChange={(event) => updateReminderOffset(point.id, Math.max(1, Number(event.target.value) || 1) * 60)}
                            className="min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                          />
                        </label>
                      ) : (
                        <div className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-hint-color)]">
                          без задержки
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Очистка архива Kanban</span>
              <select
                value={botSettings.archiveCleanupMode}
                onChange={(event) => setBotSettings((current) => ({ ...current, archiveCleanupMode: event.target.value as ProjectBotSettings['archiveCleanupMode'] }))}
                className="w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
              >
                <option value="never">Не удалять автоматически</option>
                <option value="2weeks">Раз в две недели</option>
                <option value="1month">Раз в месяц</option>
                <option value="3months">Раз в три месяца</option>
              </select>
            </label>
          </section>
        </section>

        {activeAdminTab === 'risks' && (
          <details className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--tg-theme-text-color)]">Формула значимости</summary>
            <div className="mt-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Формула значимости</h3>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                  Настрой, как проект оценивает тяжелые задачи, просрочки и блокеры.
                </p>
              </div>
              <button
                type="button"
                onClick={saveBotSettings}
                disabled={savingBotSettings}
                className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
              >
                {savingBotSettings ? '...' : botSettingsSaved ? 'OK' : 'Сохранить'}
              </button>
            </div>

            <div className="mb-3">
              <BotToggle
                label="Умные уведомления админу"
                checked={botSettings.smartAdminNotificationsEnabled}
                onChange={(checked) => setBotSettings((current) => ({ ...current, smartAdminNotificationsEnabled: checked }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SignificanceNumberInput label="Порог внимания" value={significanceSettings.attentionThreshold} min={1} max={10} onChange={(value) => updateSignificanceSettings({ attentionThreshold: value })} />
              <SignificanceNumberInput label="Критичный порог" value={significanceSettings.criticalThreshold} min={1} max={10} onChange={(value) => updateSignificanceSettings({ criticalThreshold: value })} />
              <SignificanceNumberInput label="Просрочка" value={significanceSettings.overdueBonus} min={0} max={5} onChange={(value) => updateSignificanceSettings({ overdueBonus: value })} />
              <SignificanceNumberInput label="Долгая просрочка" value={significanceSettings.longOverdueBonus} min={0} max={5} onChange={(value) => updateSignificanceSettings({ longOverdueBonus: value })} />
              <SignificanceNumberInput label="Часов до долгой" value={significanceSettings.longOverdueHours} min={1} max={720} onChange={(value) => updateSignificanceSettings({ longOverdueHours: value })} />
              <SignificanceNumberInput label="Блокер" value={significanceSettings.blockingBonus} min={0} max={5} onChange={(value) => updateSignificanceSettings({ blockingBonus: value })} />
            </div>

            <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Бонус приоритета</p>
              <div className="grid grid-cols-2 gap-2">
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((priority) => (
                  <SignificanceNumberInput
                    key={priority}
                    label={priority}
                    value={significanceSettings.priorityBonus[priority]}
                    min={0}
                    max={5}
                    onChange={(value) => updateSignificancePriorityBonus(priority, value)}
                  />
                ))}
              </div>
            </div>
            </div>
          </details>
        )}

        {activeAdminTab === 'ai' && (
          <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="mb-3">
              <p className="text-xs text-[var(--tg-theme-hint-color)]">
                Ручной read-only контекст проекта для внешнего ИИ-чата или MCP. Данные формируются только по кнопке.
              </p>
            </div>

            <details className="mb-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--tg-theme-link-color)]">
                Как подключить MCP
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-[var(--tg-theme-hint-color)]">
                <li>Выберите карту доступа нового токена.</li>
                <li>Нажмите «Создать» и сразу скопируйте секрет.</li>
                <li>Скопируйте MCP config в Claude Desktop, Codex или другой MCP-клиент.</li>
                <li>Запустите проверку токена кнопкой «Проверить».</li>
                <li>После подключения обновите журнал: там будет видно имя токена, инструмент и объем выданных данных.</li>
              </ol>
              <p className="mt-2 rounded-[8px] bg-amber-500/10 px-2 py-2 text-[11px] text-amber-200">
                Токен read-only и работает только с этим проектом. Для отключения нажмите «Отозвать».
              </p>
            </details>

            <details className="mb-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--tg-theme-link-color)]">
                Как AI получает обновления проекта
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-[var(--tg-theme-hint-color)]">
                <li>Для первого анализа агент вызывает полный контекст проекта.</li>
                <li>Ответ содержит время <code>generatedAt</code>, которое используется как точка следующей проверки.</li>
                <li>При повторном анализе агент запрашивает только изменения после этой даты.</li>
                <li>Глубоко перечитываются только изменённые страницы, задачи и зоны ответственности.</li>
              </ol>
              <p className="mt-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                Снимки проекта не создаются: delta-режим строится по датам сущностей и журналу активности.
              </p>
            </details>

            <div className="mb-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
              Для ручного режима нажмите «Промт для ИИ» и вставьте текст в Claude, Codex или другой чат. JSON можно скачать отдельно для архива или передачи разработчику.
            </div>

            <details className="mb-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--tg-theme-text-color)]">
                Токены MCP
                <span className="float-right ml-3 rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs font-normal text-[var(--tg-theme-hint-color)]">
                  {aiTokens.filter((token) => token.isActive).length} активных
                </span>
              </summary>
              <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">Read-only доступ только к AI-контексту этого проекта.</p>
              <div className="mt-3 grid grid-cols-[1fr_84px_auto] gap-2">
                <input
                  value={aiTokenName}
                  onChange={(event) => setAiTokenName(event.target.value)}
                  placeholder="Название токена"
                  className="min-w-0 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none"
                />
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={aiTokenDays}
                  onChange={(event) => setAiTokenDays(Math.max(1, Math.min(365, Number(event.target.value) || 90)))}
                  className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none"
                  title="Срок, дней"
                />
                <button
                  type="button"
                  onClick={createAiToken}
                  disabled={aiTokensLoading}
                  className="rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
                >
                  Создать
                </button>
              </div>

              <details className="mt-3 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--tg-theme-link-color)]">
                  Карта доступа нового токена
                </summary>
                <p className="mt-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                  Эти ограничения сохраняются на backend и принудительно применяются к каждому MCP-запросу.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {AI_CONNECTOR_ACCESS_PRESETS.map((preset) => {
                    const active = aiTokenAccessPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyAiTokenAccessPreset(preset)}
                        className={`rounded-[10px] px-3 py-2 text-left ${
                          active
                            ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                            : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
                        }`}
                      >
                        <span className="block text-xs font-semibold">{preset.title}</span>
                        <span className={`mt-1 block text-[11px] ${active ? 'opacity-80' : 'text-[var(--tg-theme-hint-color)]'}`}>
                          {preset.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {aiTokenAccessPresetId === 'custom' && (
                  <p className="mt-2 rounded-[8px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                    Выбран ручной режим: настройки отличаются от готовых пресетов.
                  </p>
                )}
                <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[var(--tg-theme-text-color)]">Доступ к дереву проекта</p>
                      <p className="mt-1 text-[11px] text-[var(--tg-theme-hint-color)]">Папка включает все вложенные страницы, таблицы, файлы и Kanban-доски.</p>
                    </div>
                    <select
                      value={aiTokenAccessPolicy.workspaceAccessMode ?? 'all'}
                      onChange={(event) => updateAiWorkspaceAccessMode(event.target.value as NonNullable<AiContextExportOptions['workspaceAccessMode']>)}
                      className="max-w-[180px] rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] outline-none"
                    >
                      <option value="all">Весь проект</option>
                      <option value="include">Только выбранное</option>
                      <option value="exclude">Кроме выбранного</option>
                    </select>
                  </div>

                  {(aiTokenAccessPolicy.workspaceAccessMode ?? 'all') !== 'all' && (
                    <div className="mt-3">
                      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                        <span>Выбрано: {aiTokenAccessPolicy.workspaceNodeIds?.length ?? 0}</span>
                        <button
                          type="button"
                          onClick={() => updateAiTokenAccessPolicy({ workspaceNodeIds: [] })}
                          className="font-semibold text-[var(--tg-theme-link-color)]"
                        >
                          Очистить
                        </button>
                      </div>
                      <div className="max-h-64 space-y-1 overflow-y-auto rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-2">
                        {aiWorkspaceNodesLoading ? (
                          <p className="px-2 py-3 text-xs text-[var(--tg-theme-hint-color)]">Загружаю дерево проекта...</p>
                        ) : aiWorkspaceNodesError ? (
                          <p className="px-2 py-3 text-xs text-red-300">{aiWorkspaceNodesError}</p>
                        ) : aiWorkspaceTree.length ? (
                          aiWorkspaceTree.map(({ node, depth }) => (
                            <label
                              key={node.id}
                              className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-2 hover:bg-[var(--tg-theme-bg-color)]"
                              style={{ paddingLeft: `${8 + Math.min(depth, 6) * 16}px` }}
                            >
                              <input
                                type="checkbox"
                                checked={(aiTokenAccessPolicy.workspaceNodeIds ?? []).includes(node.id)}
                                onChange={() => toggleAiWorkspaceNode(node.id)}
                                className="h-4 w-4 shrink-0 accent-[var(--tg-theme-button-color)]"
                              />
                              <span className="shrink-0">{node.icon || (node.type === 'folder' ? '📁' : node.type === 'kanban' ? '▦' : '📄')}</span>
                              <span className="min-w-0 flex-1 truncate text-xs text-[var(--tg-theme-text-color)]">{node.title}</span>
                              <span className="shrink-0 text-[10px] text-[var(--tg-theme-hint-color)]">
                                {node.type === 'folder' ? 'папка' : node.type === 'kanban' ? 'kanban' : 'страница'}
                              </span>
                            </label>
                          ))
                        ) : (
                          <p className="px-2 py-3 text-xs text-[var(--tg-theme-hint-color)]">В проекте пока нет страниц.</p>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                        В режиме «Только выбранное» задачи с других Kanban-досок и содержимое других страниц также не выдаются.
                      </p>
                    </div>
                  )}
                </div>
                <p className="mt-2 rounded-[8px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                  Для загруженных файлов AI получает название, тип, размер и связь со страницей. Содержимое PDF, Word, изображений и аудио пока не извлекается автоматически.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                    <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Объем</span>
                    <select
                      value={aiTokenAccessPolicy.scope ?? 'summary'}
                      onChange={(event) => updateAiTokenAccessPolicy({ scope: event.target.value as AiContextExportOptions['scope'] })}
                      className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                    >
                      <option value="summary">Кратко</option>
                      <option value="full">Полнее</option>
                    </select>
                  </label>
                  <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                    <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Задач максимум</span>
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={aiTokenAccessPolicy.maxTasks ?? 300}
                      onChange={(event) => updateAiTokenAccessPolicy({ maxTasks: Math.max(1, Math.min(2000, Number(event.target.value) || 300)) })}
                      className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                    />
                  </label>
                  <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                    <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Блоков максимум</span>
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={aiTokenAccessPolicy.maxBlocks ?? 300}
                      onChange={(event) => updateAiTokenAccessPolicy({ maxBlocks: Math.max(1, Math.min(2000, Number(event.target.value) || 300)) })}
                      className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                    />
                  </label>
                  <div className="space-y-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-2">
                    <BotToggle
                      label="Блоки страниц"
                      checked={Boolean(aiTokenAccessPolicy.includeBlocks)}
                      onChange={(checked) => updateAiTokenAccessPolicy({ includeBlocks: checked })}
                    />
                    <BotToggle
                      label="Архив задач"
                      checked={Boolean(aiTokenAccessPolicy.includeArchived)}
                      onChange={(checked) => updateAiTokenAccessPolicy({ includeArchived: checked })}
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <BotToggle
                    label="Задачи"
                    checked={aiTokenAccessPolicy.includeTasks !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeTasks: checked })}
                  />
                  <BotToggle
                    label="Страницы"
                    checked={aiTokenAccessPolicy.includeWorkspace !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeWorkspace: checked, includeBlocks: checked ? aiTokenAccessPolicy.includeBlocks : false })}
                  />
                  <BotToggle
                    label="Календарь проекта"
                    checked={aiTokenAccessPolicy.includeCalendar !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeCalendar: checked })}
                  />
                  <BotToggle
                    label="Напоминания проекта"
                    checked={aiTokenAccessPolicy.includeReminders !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeReminders: checked })}
                  />
                  <BotToggle
                    label="Входящие проекта"
                    checked={aiTokenAccessPolicy.includeInbox !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeInbox: checked })}
                  />
                  <BotToggle
                    label="Ответственность"
                    checked={aiTokenAccessPolicy.includeResponsibility !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeResponsibility: checked })}
                  />
                  <BotToggle
                    label="Активность"
                    checked={aiTokenAccessPolicy.includeActivity !== false}
                    onChange={(checked) => updateAiTokenAccessPolicy({ includeActivity: checked })}
                  />
                </div>
                <p className="mt-2 text-[11px] text-[var(--tg-theme-hint-color)]">{formatAiAccessPolicy(aiTokenAccessPolicy)}</p>
              </details>

              {aiTokenSecret && (
                <div className="mt-3 rounded-[10px] bg-amber-500/10 p-3">
                  <p className="mb-2 text-xs text-amber-200">Секрет показан один раз. Скопируйте его сейчас.</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-[8px] bg-black/20 px-2 py-2 text-[11px] text-[var(--tg-theme-text-color)]">
                      {aiTokenSecret}
                    </code>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        onClick={copyAiTokenSecret}
                        className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)]"
                      >
                        {aiTokenCopied ? 'OK' : 'Копировать'}
                      </button>
                      <button
                        type="button"
                        onClick={testAiToken}
                        disabled={aiTokenTesting}
                        className="rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
                      >
                        {aiTokenTesting ? '...' : 'Проверить связь'}
                      </button>
                    </div>
                  </div>
                  {aiTokenTestResult && (
                    <p className="mt-2 rounded-[8px] bg-emerald-500/10 px-2 py-2 text-xs text-emerald-300">
                      {aiTokenTestResult}
                    </p>
                  )}
                </div>
              )}

              {aiTokenSecret && (
                <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Подключение MCP</h4>
                    <button
                      type="button"
                      onClick={copyAiMcpConfig}
                      className="shrink-0 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)]"
                    >
                      {aiMcpConfigCopied ? 'OK' : 'Копировать'}
                    </button>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <div className="flex rounded-[8px] bg-[var(--tg-theme-bg-color)] p-1">
                      {(['claude', 'codex'] as AiMcpClient[]).map((client) => (
                        <button
                          key={client}
                          type="button"
                          onClick={() => {
                            setAiMcpClient(client);
                            setAiMcpConfigCopied(false);
                          }}
                          className={`min-w-0 flex-1 rounded-[6px] px-2 py-1.5 text-xs font-semibold ${
                            aiMcpClient === client
                              ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                              : 'text-[var(--tg-theme-hint-color)]'
                          }`}
                        >
                          {client === 'claude' ? 'Claude' : 'Codex'}
                        </button>
                      ))}
                    </div>
                    <div className="flex rounded-[8px] bg-[var(--tg-theme-bg-color)] p-1">
                      {(['windows', 'linux'] as AiMcpPlatform[]).map((platform) => (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => selectAiMcpPlatform(platform)}
                          className={`min-w-0 flex-1 rounded-[6px] px-2 py-1.5 text-xs font-semibold ${
                            aiMcpPlatform === platform
                              ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                              : 'text-[var(--tg-theme-hint-color)]'
                          }`}
                        >
                          {platform === 'windows' ? 'Windows' : 'Linux'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-[var(--tg-theme-hint-color)]">Публичный Backend API URL</span>
                      <input
                        value={aiMcpApiUrl}
                        onChange={(event) => setAiMcpApiUrl(event.target.value)}
                        placeholder="https://api.example.com"
                        className="w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-[var(--tg-theme-hint-color)]">Путь к MCP server.js</span>
                      <input
                        value={aiMcpServerPath}
                        onChange={(event) => setAiMcpServerPath(event.target.value)}
                        placeholder={AI_MCP_SERVER_PATHS[aiMcpPlatform]}
                        className="w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                    Вставьте в {aiMcpClient === 'codex'
                      ? (aiMcpPlatform === 'windows' ? '%USERPROFILE%\\.codex\\config.toml' : '~/.codex/config.toml')
                      : (aiMcpPlatform === 'windows' ? '%APPDATA%\\Claude\\claude_desktop_config.json' : '.mcp.json для Claude Code')} и перезапустите клиент.
                  </p>
                  <textarea
                    readOnly
                    value={buildAiMcpConfig()}
                    className="mt-2 h-48 w-full resize-none rounded-[8px] bg-[var(--tg-theme-bg-color)] p-2 font-mono text-[11px] text-[var(--tg-theme-text-color)] outline-none"
                  />
                </div>
              )}

              {aiTokenError && (
                <p className="mt-3 rounded-[10px] bg-red-500/10 px-3 py-2 text-xs text-red-300">{aiTokenError}</p>
              )}

              <div className="mt-3 space-y-2">
                {aiTokensLoading && !aiTokens.length ? (
                  <div className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
                    Загружаю токены...
                  </div>
                ) : aiTokens.length ? (
                  aiTokens.map((token) => (
                    <div key={token.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{token.name}</p>
                        <p className="text-[11px] text-[var(--tg-theme-hint-color)]">
                          до {formatAiTokenDate(token.expiresAt)} · использован {formatAiTokenDate(token.lastUsedAt)} · {token.useCount ?? 0} раз
                        </p>
                        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--tg-theme-hint-color)]">
                          {formatAiAccessPolicy(token.accessPolicy)}
                        </p>
                      </div>
                      {token.isActive ? (
                        <button
                          type="button"
                          onClick={() => revokeAiToken(String(token.id))}
                          disabled={aiTokensLoading}
                          className="shrink-0 rounded-[10px] bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-60"
                        >
                          Отозвать
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-full bg-black/10 px-2 py-1 text-[11px] text-[var(--tg-theme-hint-color)]">
                          выключен
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
                    Токенов пока нет.
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Журнал AI Connector</h4>
                    <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Последние реальные обращения MCP к контексту проекта.</p>
                  </div>
                  <button
                    type="button"
                    onClick={refreshAiAccessEvents}
                    disabled={aiAccessEventsLoading}
                    className="shrink-0 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)] disabled:opacity-60"
                  >
                    {aiAccessEventsLoading ? '...' : 'Обновить'}
                  </button>
                </div>
                {aiAccessEventsError && (
                  <p className="mb-2 rounded-[8px] bg-red-500/10 px-2 py-2 text-xs text-red-300">{aiAccessEventsError}</p>
                )}
                {aiAccessEventsLoading && !aiAccessEvents.length ? (
                  <p className="text-xs text-[var(--tg-theme-hint-color)]">Загружаю журнал...</p>
                ) : aiAccessEvents.length ? (
                  <div className="space-y-2">
                    {aiAccessEvents.slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-[9px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-xs font-semibold text-[var(--tg-theme-text-color)]">
                            {event.tokenName || 'AI Connector'} · {event.toolName || 'manual'} · {event.scope === 'full' ? 'full' : 'summary'}
                          </p>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
                            event.status === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
                          }`}>
                            {event.status === 'success' ? 'OK' : 'Ошибка'}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--tg-theme-hint-color)]">
                          {formatAiTokenDate(event.createdAt)} · задач {event.tasksReturned ?? 0}/{event.tasksTotal ?? 0} · блоков {event.blocksReturned ?? 0}/{event.blocksTotal ?? 0}
                        </p>
                        {event.error && <p className="mt-1 text-[11px] text-red-300">{event.error}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--tg-theme-hint-color)]">Обращений пока нет. Нажмите «Проверить» после создания токена.</p>
                )}
              </div>
            </details>

            <div className="grid grid-cols-2 gap-2">
              <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Объем</span>
                <select
                  value={aiContextOptions.scope ?? 'summary'}
                  onChange={(event) => updateAiContextOptions({ scope: event.target.value as AiContextExportOptions['scope'] })}
                  className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                >
                  <option value="summary">Кратко</option>
                  <option value="full">Полнее</option>
                </select>
              </label>
              <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Задач максимум</span>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={aiContextOptions.maxTasks ?? 300}
                  onChange={(event) => updateAiContextOptions({ maxTasks: Math.max(50, Number(event.target.value) || 300) })}
                  className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                />
              </label>
              <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
                <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Блоков максимум</span>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={aiContextOptions.maxBlocks ?? 300}
                  onChange={(event) => updateAiContextOptions({ maxBlocks: Math.max(50, Number(event.target.value) || 300) })}
                  className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
                />
              </label>
              <div className="space-y-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-2">
                <BotToggle
                  label="Блоки страниц"
                  checked={Boolean(aiContextOptions.includeBlocks)}
                  onChange={(checked) => updateAiContextOptions({ includeBlocks: checked })}
                />
                <BotToggle
                  label="Архив задач"
                  checked={Boolean(aiContextOptions.includeArchived)}
                  onChange={(checked) => updateAiContextOptions({ includeArchived: checked })}
                />
              </div>
            </div>

            <div className="mt-3 rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--tg-theme-hint-color)]">Разделы контекста</p>
              <div className="grid grid-cols-2 gap-2">
                <BotToggle
                  label="Задачи"
                  checked={aiContextOptions.includeTasks !== false}
                  onChange={(checked) => updateAiContextOptions({ includeTasks: checked })}
                />
                <BotToggle
                  label="Страницы"
                  checked={aiContextOptions.includeWorkspace !== false}
                  onChange={(checked) => updateAiContextOptions({ includeWorkspace: checked })}
                />
                <BotToggle
                  label="Календарь проекта"
                  checked={aiContextOptions.includeCalendar !== false}
                  onChange={(checked) => updateAiContextOptions({ includeCalendar: checked })}
                />
                <BotToggle
                  label="Напоминания проекта"
                  checked={aiContextOptions.includeReminders !== false}
                  onChange={(checked) => updateAiContextOptions({ includeReminders: checked })}
                />
                <BotToggle
                  label="Входящие проекта"
                  checked={aiContextOptions.includeInbox !== false}
                  onChange={(checked) => updateAiContextOptions({ includeInbox: checked })}
                />
                <BotToggle
                  label="Ответственность"
                  checked={aiContextOptions.includeResponsibility !== false}
                  onChange={(checked) => updateAiContextOptions({ includeResponsibility: checked })}
                />
                <BotToggle
                  label="Активность"
                  checked={aiContextOptions.includeActivity !== false}
                  onChange={(checked) => updateAiContextOptions({ includeActivity: checked })}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={buildAiContextText}
                disabled={aiContextLoading}
                className="rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
              >
                {aiContextLoading ? 'Готовлю...' : 'Сформировать'}
              </button>
              <button
                type="button"
                onClick={copyAiContext}
                disabled={aiContextLoading}
                className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)] disabled:opacity-60"
              >
                {aiContextCopied ? 'JSON скопирован' : 'Копировать JSON'}
              </button>
              <button
                type="button"
                onClick={copyAiPrompt}
                disabled={aiContextLoading}
                className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)] disabled:opacity-60"
              >
                {aiPromptCopied ? 'Промт скопирован' : 'Промт для ИИ'}
              </button>
              <button
                type="button"
                onClick={downloadAiContext}
                disabled={aiContextLoading}
                className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-link-color)] disabled:opacity-60"
              >
                Скачать JSON
              </button>
            </div>

            {aiContextError && (
              <p className="mt-3 rounded-[10px] bg-red-500/10 px-3 py-2 text-xs text-red-300">{aiContextError}</p>
            )}

            <textarea
              readOnly
              value={aiContextText || 'Нажмите «Сформировать», чтобы получить контекст проекта для внешнего ИИ.'}
              className="mt-3 h-52 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-xs text-[var(--tg-theme-text-color)] outline-none"
            />
          </section>
        )}

        <section className={`${activeAdminTab === 'reports' ? 'block' : 'hidden'} mt-4 space-y-4`}>
          <section className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Сводка и расписание</h3>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Настройки всех автоматических отчетов проекта собраны здесь.</p>
              </div>
              <button
                onClick={saveBotSettings}
                disabled={savingBotSettings}
                className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
              >
                {savingBotSettings ? '...' : botSettingsSaved ? 'OK' : 'Сохранить'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <AdminMetric label="задач всего" value={activeTasks.length} />
              <AdminMetric label="просрочено" value={overdue.length} tone="danger" />
              <AdminMetric label="скоро дедлайн" value={dueSoon.length} tone="warning" />
              <AdminMetric label="событий активности" value={events.length} />
            </div>
          </section>

          <BotReportCard
            title="Еженедельный отчет"
            description="Завершенные задачи, статистика по людям, дедлайны и рекомендации за 7 дней."
            report={botSettings.reports.weekly}
            members={project.members ?? []}
            onChange={(patch) => updateReport('weekly', patch)}
            onToggleWeekday={(day) => toggleReportWeekday('weekly', day)}
            onToggleRecipient={(userId) => toggleReportRecipient('weekly', userId)}
            onToggleSection={(section) => toggleReportSection('weekly', section)}
          />

          <BotReportCard
            title="Системные просрочки"
            description="В выбранные дни показывает участников с повторяющимися просрочками."
            report={botSettings.reports.overdue}
            members={project.members ?? []}
            onChange={(patch) => updateReport('overdue', patch)}
            onToggleWeekday={(day) => toggleReportWeekday('overdue', day)}
            onToggleRecipient={(userId) => toggleReportRecipient('overdue', userId)}
            onToggleSection={(section) => toggleReportSection('overdue', section)}
          />
        </section>

        <AdminDetailsSection
          active={activeAdminTab === 'overview'}
          title="План действий"
          id="admin-action-plan"
          initiallyOpen={initialSection === 'action-plan'}
        >
          <div className="space-y-2">
            {actionPlan.map((action, index) => (
              <div key={action.text} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)]">
                <div className="flex gap-2">
                  <span className="text-[var(--tg-theme-hint-color)]">{index + 1}.</span>
                  <span>{action.text}</span>
                </div>
                {action.tasks.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
                    {action.tasks.slice(0, 4).map((task) => (
                      <button key={task.id} type="button" onClick={() => openTaskInKanban(task, 'action-plan')} disabled={!task.pageId} className="max-w-full truncate rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-xs font-semibold text-[var(--tg-theme-link-color)] disabled:opacity-50">
                        {task.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </AdminDetailsSection>

        {activeAdminTab === 'risks' && (
          <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Топ рисковых задач</h3>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <AdminMetric label="просрочено" value={overdue.length} tone="danger" />
              <AdminMetric label="скоро дедлайн" value={dueSoon.length} tone="warning" />
              <AdminMetric label="без исполнителя" value={unassigned.length} />
              <AdminMetric label="без дедлайна" value={noDeadline.length} />
              <AdminMetric label="существенных" value={highSignificanceTasks.length} tone={highSignificanceTasks.length ? 'warning' : undefined} />
              <AdminMetric label="вес просрочки" value={overdueSignificanceWeight} tone={overdueSignificanceWeight ? 'danger' : undefined} />
            </div>

            <TaskAttentionQueuePanel queue={attentionQueue} onOpenTask={openTaskInKanban} />

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
                    существенность: {score}/10 · {getTaskSignificanceLabel(score)} · {task.assignee?.firstName ?? task.assignee?.username ?? 'без исполнителя'} · {task.deadlineAt ? new Date(task.deadlineAt).toLocaleDateString('ru-RU') : 'без дедлайна'}
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
              <label className="text-xs text-[var(--tg-theme-hint-color)]">
                <span className="mb-1 block">С</span>
                <input type="date" value={meetingStartDate} onChange={(event) => setMeetingStartDate(event.target.value)} className="w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none" />
              </label>
              <label className="text-xs text-[var(--tg-theme-hint-color)]">
                <span className="mb-1 block">По</span>
                <input type="date" value={meetingEndDate} onChange={(event) => setMeetingEndDate(event.target.value)} className="w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-2 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none" />
              </label>
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
                value={meetingDecisionText}
                onChange={(event) => setMeetingDecisionText(event.target.value)}
                placeholder="Например: перенести дедлайн, назначить ответственного, создать новую задачу..."
                className="h-28 w-full resize-none rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3 text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-emerald-300">{meetingDecisionStatus === 'saved' ? 'Сохранено во Входящие' : ''}</span>
                <button type="button" onClick={saveMeetingDecision} disabled={!meetingDecisionText.trim()} className="rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50">
                  Сохранить во Входящие
                </button>
              </div>
            </div>
          </section>
        )}

        {activeAdminTab === 'responsibility' && (
          <ResponsibilityMapPanel
            summaries={responsibilitySummaries}
            uncoveredTasks={uncoveredActiveTasks}
            onCreate={openCreateResponsibilityArea}
            onEdit={openEditResponsibilityArea}
            onDelete={setResponsibilityAreaToDelete}
            onOpenTask={openTaskInKanban}
          />
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
                  <span className="text-xs text-[var(--tg-theme-hint-color)]">{Math.round((item.significance / maxWeightedLoad) * 100)}% веса</span>
                </div>
                <p className="text-xs text-[var(--tg-theme-hint-color)]">
                  задач: {item.total} · вес: {item.significance} · просрочка: {item.overdueSignificance} · скоро дедлайн: {item.dueSoon}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--tg-theme-secondary-bg-color)]">
                  <div className="h-full rounded-full bg-[var(--tg-theme-button-color)]" style={{ width: `${Math.round((item.significance / maxWeightedLoad) * 100)}%` }} />
                </div>
              </button>
            ))}
          </div>
        </section>

        {activeAdminTab === 'people' && (
          <WorkloadRedistributionPanel plan={workloadPlan} onOpenTask={openTaskInKanban} />
        )}

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
            </div>
          </main>
        </div>

        {responsibilityFormOpen && (
          <ResponsibilityAreaModal
            area={editingResponsibilityArea}
            members={project.members ?? []}
            saving={responsibilitySaving}
            onSave={saveResponsibilityArea}
            onClose={() => {
              setResponsibilityFormOpen(false);
              setEditingResponsibilityArea(null);
            }}
          />
        )}

        {responsibilityAreaToDelete && (
          <div className="fixed inset-0 z-[140] flex items-end bg-black/55" onClick={() => setResponsibilityAreaToDelete(null)}>
            <section
              className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Удалить зону?</h3>
              <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
                Зона «{responsibilityAreaToDelete.title}» исчезнет из карты ответственности. Задачи и участники не удалятся.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setResponsibilityAreaToDelete(null)}
                  className="flex-1 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] py-3 font-semibold text-[var(--tg-theme-text-color)]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteResponsibilityArea}
                  className="flex-1 rounded-[12px] bg-red-500 py-3 font-semibold text-white"
                >
                  Удалить
                </button>
              </div>
            </section>
          </div>
        )}

        {selectedMember && (
          <MemberProfileModal
            project={project}
            member={selectedMember}
            tasks={tasks}
            columns={columns}
            events={events}
            now={now}
            taskSignificanceSettings={significanceSettings}
            onClose={() => setSelectedMember(null)}
          />
        )}
      </div>
    </div>
  );
}

type ResponsibilityAreaSummary = {
  area: ResponsibilityArea;
  owners: ProjectMember[];
  activeTasks: Task[];
  completedTasks: Task[];
  overdueTasks: Task[];
  dueSoonTasks: Task[];
  tone: 'good' | 'warning' | 'danger';
  status: string;
};

const RESPONSIBILITY_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#64748B'];
const RESPONSIBILITY_ICONS = ['📌', '🎯', '🧭', '🛠', '📣', '📚', '💬', '⚙'];

function ResponsibilityMapPanel({
  summaries,
  uncoveredTasks,
  onCreate,
  onEdit,
  onDelete,
  onOpenTask,
}: {
  summaries: ResponsibilityAreaSummary[];
  uncoveredTasks: Task[];
  onCreate: () => void;
  onEdit: (area: ResponsibilityArea) => void;
  onDelete: (area: ResponsibilityArea) => void;
  onOpenTask: (task: Task) => void;
}) {
  const dangerCount = summaries.filter((summary) => summary.tone === 'danger').length;
  const warningCount = summaries.filter((summary) => summary.tone === 'warning').length;
  const coveredTasksCount = summaries.reduce((sum, summary) => sum + summary.activeTasks.length, 0);

  return (
    <section className="mt-4 space-y-4">
      <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[var(--tg-theme-text-color)]">Карта ответственности</h3>
            <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
              Зоны показывают, кто за что отвечает, где есть перегруз и какие задачи выпадают из поля внимания.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="shrink-0 rounded-[10px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
          >
            + Зона
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <AdminMetric label="зон" value={summaries.length} />
          <AdminMetric label="задач в зонах" value={coveredTasksCount} />
          <AdminMetric label="риски" value={dangerCount} tone={dangerCount ? 'danger' : undefined} />
          <AdminMetric label="внимание" value={warningCount + uncoveredTasks.length} tone={warningCount || uncoveredTasks.length ? 'warning' : undefined} />
        </div>
      </div>

      {summaries.length === 0 ? (
        <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4 text-sm text-[var(--tg-theme-hint-color)]">
          Создайте первую зону, например «Медиа», «Встречи», «Финансы» или «Подростки», и назначьте ответственных.
        </div>
      ) : (
        <div className="space-y-3">
          {summaries.map((summary) => (
            <ResponsibilityAreaCard
              key={summary.area.id}
              summary={summary}
              onEdit={() => onEdit(summary.area)}
              onDelete={() => onDelete(summary.area)}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}

      <div className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-bold text-[var(--tg-theme-text-color)]">Задачи вне зон</h4>
          <span className="rounded-full bg-yellow-500/15 px-2 py-1 text-xs font-semibold text-yellow-300">{uncoveredTasks.length}</span>
        </div>
        {uncoveredTasks.length === 0 ? (
          <p className="text-sm text-[var(--tg-theme-hint-color)]">Все активные задачи покрыты зонами ответственности.</p>
        ) : (
          <div className="space-y-2">
            {uncoveredTasks.slice(0, 8).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task)}
                disabled={!task.pageId}
                className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left text-sm transition active:scale-[0.99] disabled:opacity-60"
              >
                <p className="truncate font-semibold text-[var(--tg-theme-text-color)]">{task.title}</p>
                <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                  {task.assignee?.firstName ?? task.assignee?.username ?? 'без исполнителя'} · {task.deadlineAt ? new Date(task.deadlineAt).toLocaleDateString('ru-RU') : 'без дедлайна'}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ResponsibilityAreaCard({
  summary,
  onEdit,
  onDelete,
  onOpenTask,
}: {
  summary: ResponsibilityAreaSummary;
  onEdit: () => void;
  onDelete: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const toneClass =
    summary.tone === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : summary.tone === 'warning'
        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';

  return (
    <article className="overflow-hidden rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)]">
      <div className="h-1.5" style={{ backgroundColor: summary.area.color }} />
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">{summary.area.icon}</span>
              <h4 className="truncate text-base font-bold text-[var(--tg-theme-text-color)]">{summary.area.title}</h4>
            </div>
            {summary.area.description && (
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{summary.area.description}</p>
            )}
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${toneClass}`}>
            {summary.status}
          </span>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {summary.owners.length ? (
            summary.owners.map((owner) => (
              <span key={owner.id} className="rounded-full bg-[var(--tg-theme-bg-color)] px-3 py-1 text-xs text-[var(--tg-theme-text-color)]">
                {memberName(owner)}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs text-red-300">нет ответственного</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <AdminMetric label="активных" value={summary.activeTasks.length} />
          <AdminMetric label="просрочено" value={summary.overdueTasks.length} tone={summary.overdueTasks.length ? 'danger' : undefined} />
          <AdminMetric label="закрыто" value={summary.completedTasks.length} />
        </div>

        <div className="mt-3 space-y-2">
          {summary.activeTasks.slice(0, 5).map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task)}
              disabled={!task.pageId}
              className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-60"
            >
              <p className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{task.title}</p>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                {task.priority} · {task.deadlineAt ? new Date(task.deadlineAt).toLocaleDateString('ru-RU') : 'без дедлайна'}
              </p>
            </button>
          ))}
          {summary.activeTasks.length === 0 && (
            <p className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-hint-color)]">
              Активных задач в этой зоне нет.
            </p>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-[10px] bg-[var(--tg-theme-bg-color)] py-2 text-sm font-semibold text-[var(--tg-theme-text-color)]"
          >
            Редактировать
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="h-10 w-10 rounded-[10px] bg-red-500/15 font-bold text-red-400"
            aria-label="Удалить зону"
          >
            x
          </button>
        </div>
      </div>
    </article>
  );
}

function ResponsibilityAreaModal({
  area,
  members,
  saving,
  onSave,
  onClose,
}: {
  area: ResponsibilityArea | null;
  members: ProjectMember[];
  saving: boolean;
  onSave: (draft: Partial<ResponsibilityArea>) => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(area?.title ?? '');
  const [description, setDescription] = useState(area?.description ?? '');
  const [color, setColor] = useState(area?.color ?? RESPONSIBILITY_COLORS[0]);
  const [icon, setIcon] = useState(area?.icon ?? RESPONSIBILITY_ICONS[0]);
  const [ownerUserIds, setOwnerUserIds] = useState<string[]>((area?.ownerUserIds ?? []).map(String));
  const toggleOwner = (userId: number | string) => {
    const id = String(userId);
    setOwnerUserIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end bg-black/55" onClick={onClose}>
      <section
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)]">{area ? 'Редактировать зону' : 'Новая зона'}</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Ответственные, цвет и смысл зоны ответственности.</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]">
            x
          </button>
        </div>

        <div className="space-y-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название зоны"
            className="w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Что входит в эту зону"
            className="h-24 w-full resize-none rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
          />

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Иконка</p>
            <div className="flex flex-wrap gap-2">
              {RESPONSIBILITY_ICONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setIcon(item)}
                  className={`h-10 w-10 rounded-[10px] text-lg ${icon === item ? 'bg-[var(--tg-theme-button-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Цвет</p>
            <div className="flex flex-wrap gap-2">
              {RESPONSIBILITY_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  className={`h-9 w-9 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: item }}
                  aria-label={`Цвет ${item}`}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Ответственные</p>
            <div className="space-y-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleOwner(member.userId)}
                  className={`flex w-full items-center justify-between rounded-[10px] px-3 py-3 text-left text-sm ${
                    ownerUserIds.includes(String(member.userId))
                      ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                      : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
                  }`}
                >
                  <span>{memberName(member)}</span>
                  <span>{ownerUserIds.includes(String(member.userId)) ? 'OK' : '+'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSave({ title, description, color, icon, ownerUserIds })}
          disabled={!title.trim() || saving}
          className="mt-5 w-full rounded-[12px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
        >
          {saving ? 'Сохраняю...' : 'Сохранить'}
        </button>
      </section>
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

function AdminDetailsSection({
  active,
  title,
  children,
  id,
  initiallyOpen = false,
}: {
  active: boolean;
  title: string;
  children: ReactNode;
  id?: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details id={id} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className={`${active ? 'block' : 'hidden'} mt-4 scroll-mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--tg-theme-text-color)]">
        <span>{title}</span>
        <span className="rounded-full bg-[var(--tg-theme-bg-color)] px-2 py-1 text-[11px] font-medium text-[var(--tg-theme-hint-color)]">
          {open ? 'закрыть' : 'открыть'}
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

type DeadlineForecast = ReturnType<typeof buildDeadlineForecast>;

function DeadlineForecastPanel({
  forecast,
  onOpenTask,
}: {
  forecast: DeadlineForecast;
  onOpenTask: (task: Task) => void;
}) {
  const toneClass =
    forecast.tone === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : forecast.tone === 'warning'
        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';

  return (
    <section className={`mt-4 rounded-[14px] border p-4 ${toneClass}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase opacity-80">Прогноз 7 дней</p>
          <h3 className="mt-1 text-base font-bold">{forecast.title}</h3>
          <p className="mt-1 text-xs opacity-90">{forecast.summary}</p>
        </div>
        <span className="shrink-0 rounded-full bg-black/15 px-3 py-1 text-xs font-bold">{forecast.riskScore}/10</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-center text-[var(--tg-theme-text-color)]">
          <p className="text-lg font-bold">{forecast.dueWeek.length}</p>
          <p className="text-[11px] text-[var(--tg-theme-hint-color)]">дедлайнов</p>
        </div>
        <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-center text-[var(--tg-theme-text-color)]">
          <p className="text-lg font-bold">{forecast.likelyOverdue.length}</p>
          <p className="text-[11px] text-[var(--tg-theme-hint-color)]">риск срыва</p>
        </div>
        <div className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-center text-[var(--tg-theme-text-color)]">
          <p className="text-lg font-bold">{forecast.peopleAtRisk.length}</p>
          <p className="text-[11px] text-[var(--tg-theme-hint-color)]">людей</p>
        </div>
      </div>

      <div className="mt-3 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-[var(--tg-theme-text-color)]">
        <p className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">Что сделать заранее</p>
        <p className="mt-1 text-sm font-semibold">{forecast.nextAction}</p>
      </div>

      {forecast.likelyOverdue.length > 0 && (
        <div className="mt-3 space-y-2">
          {forecast.likelyOverdue.slice(0, 4).map(({ task, score, reason }) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task)}
              disabled={!task.pageId}
              className="block w-full rounded-[10px] bg-black/10 px-3 py-2 text-left active:scale-[0.99] disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold">{task.title}</p>
                <span className="shrink-0 rounded-full bg-black/15 px-2 py-0.5 text-xs font-bold">{score}/10</span>
              </div>
              <p className="mt-1 text-xs opacity-85">{reason}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

type WorkloadRedistributionPlan = ReturnType<typeof buildWorkloadRedistributionPlan>;

function WorkloadRedistributionPanel({
  plan,
  onOpenTask,
}: {
  plan: WorkloadRedistributionPlan;
  onOpenTask: (task: Task) => void;
}) {
  return (
    <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Баланс нагрузки</h3>
        <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
          Считает не только количество задач, но и их значимость, просрочки и близкие дедлайны.
        </p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <AdminMetric label="перегружены" value={plan.overloaded.length} tone={plan.overloaded.length ? 'warning' : undefined} />
        <AdminMetric label="можно догрузить" value={plan.available.length} />
      </div>

      <div className="space-y-2">
        {plan.summary.map((line) => (
          <p key={line} className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-hint-color)]">
            {line}
          </p>
        ))}
      </div>

      {plan.suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          {plan.suggestions.map((suggestion) => (
            <button
              key={`${suggestion.from.member.id}-${suggestion.task.id}`}
              type="button"
              onClick={() => onOpenTask(suggestion.task)}
              disabled={!suggestion.task.pageId}
              className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left active:scale-[0.99] disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{suggestion.task.title}</p>
                <span className="shrink-0 rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-semibold text-yellow-300">
                  {suggestion.score}/10
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
                Передать от {memberName(suggestion.from.member)} к {suggestion.to ? memberName(suggestion.to.member) : 'менее загруженному участнику'}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TaskAttentionQueuePanel({
  queue,
  onOpenTask,
}: {
  queue: ReturnType<typeof buildTaskAttentionQueue>;
  onOpenTask: (task: Task) => void;
}) {
  const groups = [
    { id: 'now', title: 'Разобрать сейчас', tone: 'danger', items: queue.now },
    { id: 'today', title: 'Сегодня в фокус', tone: 'warning', items: queue.today },
    { id: 'plan', title: 'Планово', tone: 'neutral', items: queue.plan },
  ] as const;

  return (
    <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Очередь внимания</h4>
        <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
          Задачи разложены по существенности: важность, приоритет, дедлайн и блокировка других.
        </p>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <details key={group.id} className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2" open={group.id !== 'plan'}>
            <summary className="cursor-pointer list-none">
              <span
                className={
                  group.tone === 'danger'
                    ? 'text-sm font-semibold text-red-400'
                    : group.tone === 'warning'
                      ? 'text-sm font-semibold text-yellow-300'
                      : 'text-sm font-semibold text-[var(--tg-theme-text-color)]'
                }
              >
                {group.title} · {group.items.length}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {group.items.length === 0 ? (
                <p className="text-xs text-[var(--tg-theme-hint-color)]">Пока пусто.</p>
              ) : (
                group.items.map(({ task, score, reason }) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask(task)}
                    disabled={!task.pageId}
                    className="block w-full rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-[var(--tg-theme-text-color)]">{task.title}</p>
                      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">
                        {score}/10
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{reason}</p>
                  </button>
                ))
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

type AdminReactionRule = {
  id: string;
  title: string;
  timing: string;
  action: string;
  threshold: string;
  tone: 'danger' | 'warning' | 'good';
  items: ReturnType<typeof buildTaskAttentionQueue>['now'];
};

function AdminReactionRulesPanel({
  rules,
  onOpenTask,
}: {
  rules: AdminReactionRule[];
  onOpenTask: (task: Task) => void;
}) {
  const toneClass = (tone: AdminReactionRule['tone']) => {
    if (tone === 'danger') return 'border-red-500/35 bg-red-500/10 text-red-300';
    if (tone === 'warning') return 'border-yellow-500/35 bg-yellow-500/10 text-yellow-200';
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  };

  return (
    <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">Правила реакции</h4>
        <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">
          Подсказывает, как быстро администратору нужно вмешаться по задачам из очереди внимания.
        </p>
      </div>
      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className={`rounded-[12px] border p-3 ${toneClass(rule.tone)}`}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{rule.title}</p>
                <p className="mt-0.5 text-xs opacity-80">{rule.timing} · {rule.threshold}</p>
              </div>
              <span className="shrink-0 rounded-full bg-black/15 px-2 py-0.5 text-xs font-bold">{rule.items.length}</span>
            </div>
            <p className="text-xs leading-relaxed opacity-90">{rule.action}</p>
            {rule.items.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {rule.items.slice(0, 3).map(({ task, score }) => (
                  <button
                    key={`${rule.id}-${task.id}`}
                    type="button"
                    onClick={() => onOpenTask(task)}
                    disabled={!task.pageId}
                    className="max-w-full truncate rounded-full bg-black/15 px-2 py-1 text-left text-xs font-semibold active:scale-[0.98] disabled:opacity-60"
                  >
                    {task.title} · {score}/10
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type ProjectDiagnosticTone = 'good' | 'warning' | 'danger';

type ProjectDiagnostics = {
  title: string;
  summary: string;
  nextAction: string;
  tone: ProjectDiagnosticTone;
  dimensions: Array<{
    title: string;
    status: string;
    detail: string;
    action: string;
    tone: ProjectDiagnosticTone;
  }>;
};

function ProjectDiagnosticsPanel({ diagnostics }: { diagnostics: ProjectDiagnostics }) {
  const toneClass =
    diagnostics.tone === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : diagnostics.tone === 'warning'
        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';

  return (
    <section className={`rounded-[14px] border p-4 ${toneClass}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Состояние проекта</p>
          <h3 className="mt-1 text-lg font-bold">{diagnostics.title}</h3>
          <p className="mt-1 text-sm opacity-90">{diagnostics.summary}</p>
        </div>
        <span className="shrink-0 rounded-full bg-black/15 px-3 py-1 text-xs font-bold">
          {diagnostics.tone === 'danger' ? 'критично' : diagnostics.tone === 'warning' ? 'внимание' : 'спокойно'}
        </span>
      </div>

      <div className="mb-4 rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-[var(--tg-theme-text-color)]">
        <p className="text-xs font-semibold text-[var(--tg-theme-hint-color)]">Ближайшее действие</p>
        <p className="mt-1 text-sm font-semibold">{diagnostics.nextAction}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {diagnostics.dimensions.map((dimension) => (
          <div key={dimension.title} className="rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-[var(--tg-theme-text-color)]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-sm font-bold">{dimension.title}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                dimension.tone === 'danger'
                  ? 'bg-red-500/15 text-red-400'
                  : dimension.tone === 'warning'
                    ? 'bg-yellow-500/15 text-yellow-500'
                    : 'bg-emerald-500/15 text-emerald-500'
              }`}>
                {dimension.status}
              </span>
            </div>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{dimension.detail}</p>
            <p className="mt-2 text-xs font-semibold text-[var(--tg-theme-link-color)]">{dimension.action}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MemberProfileModal({
  project,
  member,
  tasks,
  columns,
  events,
  now,
  taskSignificanceSettings,
  onClose,
}: {
  project: Project;
  member: ProjectMember;
  tasks: Task[];
  columns: Column[];
  events: ActivityEvent[];
  now: number;
  taskSignificanceSettings: TaskSignificanceSettings;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const userId = member.userId;
  const activeTasks = tasks
    .filter((task) => isTaskActiveForAdmin(task, columns, now) && isTaskAssignedToMember(task, userId))
    .sort((a, b) => {
      const scoreDiff =
        calculateTaskSignificanceScore(b, now, taskSignificanceSettings) -
        calculateTaskSignificanceScore(a, now, taskSignificanceSettings);
      if (scoreDiff !== 0) return scoreDiff;
      const left = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      const right = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  const overdueTasks = activeTasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now);
  const activeSignificance = activeTasks.reduce((sum, task) => sum + calculateTaskSignificanceScore(task, now, taskSignificanceSettings), 0);
  const overdueSignificance = overdueTasks.reduce((sum, task) => sum + calculateTaskSignificanceScore(task, now, taskSignificanceSettings), 0);
  const memberEvents = events.filter((event) => String(event.userId) === String(userId));
  const isActive = activeTasks.length > 0 || memberEvents.length > 0;
  const zones = getResponsibilityZones(activeTasks);
  const canSeeAdminNotes =
    String(project.ownerId) === String(currentUserId) ||
    (project.members ?? []).some((item) => String(item.userId) === String(currentUserId) && item.role?.name === 'admin');
  const [notes, setNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const username = member.user?.username ? `@${member.user.username}` : 'не указан';
  const addedAt = (member as any).createdAt || (member as any).joinedAt || project.createdAt;

  useEffect(() => {
    if (!canSeeAdminNotes || !currentUserId) return;
    let cancelled = false;
    setNotesStatus('idle');
    projectsApi
      .getMemberAdminNotes(project.id, member.id, currentUserId)
      .then((value) => {
        if (!cancelled) setNotes(value);
      })
      .catch(() => {
        if (!cancelled) setNotesStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeAdminNotes, currentUserId, member.id, project.id]);

  const saveNotes = async () => {
    if (!canSeeAdminNotes || !currentUserId) return;
    setNotesStatus('saving');
    try {
      const savedNotes = await projectsApi.updateMemberAdminNotes(project.id, member.id, notes, currentUserId);
      setNotes(savedNotes);
      setNotesStatus('saved');
    } catch {
      setNotesStatus('error');
    }
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
            <UserAvatarImage user={member.user} label={memberName(member)} size="lg" />
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
          <MemberCardMetric label="Вес задач" value={String(activeSignificance)} tone={activeSignificance >= 20 ? 'warning' : undefined} />
          <MemberCardMetric label="Вес просрочки" value={String(overdueSignificance)} tone={overdueSignificance ? 'danger' : undefined} />
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
                    {task.priority} · {calculateTaskSignificanceScore(task, now, taskSignificanceSettings)}/10 · {task.deadlineAt ? new Date(task.deadlineAt).toLocaleString('ru-RU') : 'без дедлайна'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--tg-theme-hint-color)]">Активных задач нет.</p>
          )}
        </section>

        {canSeeAdminNotes && (
        <section className="mt-4 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
          <h4 className="mb-2 text-sm font-semibold text-[var(--tg-theme-text-color)]">Заметки администратора</h4>
          <textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setNotesStatus('idle');
            }}
            onBlur={saveNotes}
            placeholder="Внутренние заметки владельца или администратора"
            className="h-28 w-full resize-none rounded-[10px] bg-[var(--tg-theme-bg-color)] p-3 text-sm text-[var(--tg-theme-text-color)] placeholder:text-[var(--tg-theme-hint-color)] outline-none"
          />
        </section>
        )}
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

function SignificanceNumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const updateValue = (nextValue: number) => {
    onChange(Math.max(min, Math.min(max, Math.round(nextValue))));
  };
  return (
    <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
      <span className="mb-1 block truncate text-xs text-[var(--tg-theme-hint-color)]">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => updateValue(value - 1)}
          className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-sm font-bold text-[var(--tg-theme-text-color)]"
        >
          -
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => updateValue(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent text-center text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
        />
        <button
          type="button"
          onClick={() => updateValue(value + 1)}
          className="h-8 w-8 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-sm font-bold text-[var(--tg-theme-text-color)]"
        >
          +
        </button>
      </div>
    </label>
  );
}

function BotReportCard({
  title,
  description,
  report,
  members,
  onChange,
  onToggleWeekday,
  onToggleRecipient,
  onToggleSection,
}: {
  title: string;
  description: string;
  report: ProjectBotSettings['reports']['weekly'];
  members: ProjectMember[];
  onChange: (patch: Partial<ProjectBotSettings['reports']['weekly']>) => void;
  onToggleWeekday: (day: number) => void;
  onToggleRecipient: (userId: number) => void;
  onToggleSection: (section: keyof ProjectBotSettings['reports']['weekly']['sections']) => void;
}) {
  const weekdays = [
    [1, 'Пн'],
    [2, 'Вт'],
    [3, 'Ср'],
    [4, 'Чт'],
    [5, 'Пт'],
    [6, 'Сб'],
    [7, 'Вс'],
  ] as const;
  const sections = [
    ['createdTasks', 'Новые задачи'],
    ['completedTasks', 'Завершенные'],
    ['overdueTasks', 'Просрочки'],
    ['approachingDeadlines', 'Скоро дедлайн'],
    ['inactiveUsers', 'Неактивные'],
    ['userActivity', 'Активность'],
    ['kanbanMovement', 'Движение Kanban'],
    ['mentions', 'Упоминания'],
    ['recommendations', 'Рекомендации'],
  ] as const;

  return (
    <details className="rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] p-4">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color)]">{title}</h3>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">{description}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
          report.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-hint-color)]'
        }`}>
          {report.enabled ? 'включен' : 'выключен'}
        </span>
      </summary>

      <div className="mt-4">
        <BotToggle label="Автоматическая отправка" checked={report.enabled} onChange={(checked) => onChange({ enabled: checked })} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
          <span className="mb-1 block text-xs text-[var(--tg-theme-hint-color)]">Время МСК</span>
          <input
            type="time"
            value={report.time}
            onChange={(event) => onChange({ time: event.target.value })}
            className="w-full bg-transparent text-sm font-semibold text-[var(--tg-theme-text-color)] outline-none"
          />
        </label>
        <label className="flex items-center justify-between gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-text-color)]">
          <span>Только если есть изменения</span>
          <input type="checkbox" checked={report.sendOnlyIfChanged} onChange={(event) => onChange({ sendOnlyIfChanged: event.target.checked })} />
        </label>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Дни отправки</p>
        <div className="flex flex-wrap gap-2">
          {weekdays.map(([day, label]) => (
            <button
              key={day}
              type="button"
              onClick={() => onToggleWeekday(day)}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${
                report.weekdays.includes(day)
                  ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                  : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Получатели</p>
        <div className="flex flex-wrap gap-2">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => onToggleRecipient(member.userId)}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${
                report.recipientUserIds.includes(member.userId)
                  ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                  : 'bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]'
              }`}
            >
              {memberName(member)}
            </button>
          ))}
        </div>
        {!report.recipientUserIds.length && (
          <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">Если никого не выбрать, отчет уходит владельцу проекта.</p>
        )}
      </div>

      <div className="mt-3">
        <p className="mb-2 text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Что включать</p>
        <div className="grid grid-cols-2 gap-2">
          {sections.map(([section, label]) => (
            <label key={section} className="flex items-center gap-2 rounded-[10px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs text-[var(--tg-theme-text-color)]">
              <input type="checkbox" checked={report.sections[section]} onChange={() => onToggleSection(section)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function cloneBotSettings(settings: ProjectBotSettings): ProjectBotSettings {
  return JSON.parse(JSON.stringify(settings));
}

function buildProjectDiagnostics({
  activeTasks,
  overdue,
  dueSoon,
  unassigned,
  noDeadline,
  weakTasks,
  inactiveMembers,
  overloaded,
  changeSummary,
}: {
  activeTasks: Task[];
  overdue: Task[];
  dueSoon: Task[];
  unassigned: Task[];
  noDeadline: Task[];
  weakTasks: Task[];
  inactiveMembers: ProjectMember[];
  overloaded: Array<{ member: ProjectMember; total: number }>;
  changeSummary: AdminChangeSummary;
}): ProjectDiagnostics {
  const activeCount = activeTasks.length;
  const weakRatio = activeCount ? weakTasks.length / activeCount : 0;
  const inactiveRatio = inactiveMembers.length ? inactiveMembers.length / Math.max(1, inactiveMembers.length + overloaded.length) : 0;
  const closedCount = changeSummary.closedTasks.length;
  const newCount = changeSummary.newTasks.length;
  const staleCount = changeSummary.staleTasks.length;

  const dimensions: ProjectDiagnostics['dimensions'] = [
    {
      title: 'Сроки',
      status: overdue.length ? 'горит' : dueSoon.length ? 'скоро сроки' : 'чисто',
      tone: overdue.length ? 'danger' : dueSoon.length ? 'warning' : 'good',
      detail: `${overdue.length} просрочено, ${dueSoon.length} в ближайшие 48 часов.`,
      action: overdue.length
        ? 'Сначала пересмотреть просроченные задачи: закрыть, перенести срок или назначить ответственного.'
        : dueSoon.length
          ? 'Поставить ближайшие дедлайны в фокус дня.'
          : 'Дедлайны сейчас не требуют срочного вмешательства.',
    },
    {
      title: 'Поток работы',
      status: staleCount && !closedCount ? 'застой' : newCount > closedCount + 4 ? 'копится входящий поток' : 'движется',
      tone: staleCount && !closedCount ? 'danger' : newCount > closedCount + 4 || staleCount ? 'warning' : 'good',
      detail: `${newCount} новых, ${closedCount} закрытых, ${staleCount} без движения за период.`,
      action: staleCount
        ? 'Разобрать задачи без движения и решить: делать, делегировать, перенести или удалить.'
        : 'Поддерживать текущий темп и не копить новые задачи без разбора.',
    },
    {
      title: 'Качество задач',
      status: weakRatio >= 0.4 ? 'много неясного' : weakTasks.length ? 'есть пробелы' : 'понятно',
      tone: weakRatio >= 0.4 ? 'danger' : weakTasks.length ? 'warning' : 'good',
      detail: `${weakTasks.length} задач требуют уточнения: ${unassigned.length} без исполнителя, ${noDeadline.length} без дедлайна.`,
      action: weakTasks.length
        ? 'Привести задачи к стандарту: исполнитель, срок, описание результата.'
        : 'Формулировки задач выглядят достаточно ясными.',
    },
    {
      title: 'Нагрузка',
      status: overloaded.length ? 'перекос' : 'ровно',
      tone: overloaded.length ? 'warning' : 'good',
      detail: overloaded.length ? `Перегружены: ${overloaded.map((item) => memberName(item.member)).join(', ')}.` : 'Явного перегруза по людям не видно.',
      action: overloaded.length
        ? 'Передать часть задач людям с меньшей нагрузкой или снизить приоритеты.'
        : 'Нагрузка выглядит приемлемо.',
    },
    {
      title: 'Вовлеченность',
      status: inactiveMembers.length ? 'не все вовлечены' : 'команда в работе',
      tone: inactiveRatio > 0.5 ? 'warning' : 'good',
      detail: inactiveMembers.length ? `Без активных задач: ${inactiveMembers.map(memberName).join(', ')}.` : 'Участники вовлечены через задачи.',
      action: inactiveMembers.length
        ? 'Проверить роли людей: им нужны задачи, доступ или их стоит убрать из активной команды.'
        : 'Командная вовлеченность выглядит нормально.',
    },
  ];

  const dangerCount = dimensions.filter((dimension) => dimension.tone === 'danger').length;
  const warningCount = dimensions.filter((dimension) => dimension.tone === 'warning').length;
  const firstProblem = dimensions.find((dimension) => dimension.tone === 'danger') ?? dimensions.find((dimension) => dimension.tone === 'warning');

  if (dangerCount >= 2) {
    return {
      title: 'Проект требует немедленного разбора',
      summary: 'Проблемы есть сразу в нескольких зонах. Сейчас важнее не добавлять новые задачи, а стабилизировать текущие.',
      nextAction: firstProblem?.action ?? 'Провести короткую планерку и обновить задачи.',
      tone: 'danger',
      dimensions,
    };
  }
  if (dangerCount === 1) {
    return {
      title: 'Есть критический участок',
      summary: `Главная проблема сейчас: ${firstProblem?.title.toLowerCase()}. Остальные зоны можно смотреть после неё.`,
      nextAction: firstProblem?.action ?? 'Начать с самой проблемной зоны.',
      tone: 'danger',
      dimensions,
    };
  }
  if (warningCount > 0) {
    return {
      title: 'Проект рабочий, но требует настройки',
      summary: 'Критики нет, но есть места, где проект может начать буксовать через несколько дней.',
      nextAction: firstProblem?.action ?? 'Уточнить задачи и ближайшие дедлайны.',
      tone: 'warning',
      dimensions,
    };
  }
  return {
    title: 'Проект под контролем',
    summary: 'Нет явных сигналов, что проект проседает по срокам, нагрузке или качеству задач.',
    nextAction: 'Поддерживать текущий ритм и разбирать новые задачи без накопления.',
    tone: 'good',
    dimensions,
  };
}

function getTaskRiskScore(task: Task, now: number, settings?: TaskSignificanceSettings) {
  const hasAssignee = Boolean(task.assignee?.id || task.assigneeId);
  const hasDescription = Boolean(task.description?.trim());
  const deadlineTime = task.deadlineAt ? new Date(task.deadlineAt).getTime() : undefined;
  const diffHours = deadlineTime ? (deadlineTime - now) / 3600000 : undefined;
  const needsAttention =
    task.priority === 'CRITICAL' ||
    task.priority === 'HIGH' ||
    task.isBlocking ||
    !hasAssignee ||
    !hasDescription ||
    !task.deadlineAt ||
    (diffHours !== undefined && diffHours <= 48);

  return needsAttention ? calculateTaskSignificanceScore(task, now, settings) : 0;
}

function buildTaskAttentionQueue(tasks: Task[], now: number, settings: TaskSignificanceSettings) {
  const ranked = tasks
    .map((task) => {
      const score = calculateTaskSignificanceScore(task, now, settings);
      const deadlineTime = task.deadlineAt ? new Date(task.deadlineAt).getTime() : undefined;
      const diffHours = deadlineTime ? (deadlineTime - now) / 3600000 : undefined;
      return {
        task,
        score,
        diffHours,
        reason: buildTaskAttentionReason(task, score, diffHours),
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDeadline = left.task.deadlineAt ? new Date(left.task.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDeadline = right.task.deadlineAt ? new Date(right.task.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDeadline - rightDeadline;
    });
  const used = new Set<number>();
  const take = (predicate: (item: (typeof ranked)[number]) => boolean, limit: number) => {
    const items: typeof ranked = [];
    for (const item of ranked) {
      if (items.length >= limit) break;
      if (used.has(item.task.id) || !predicate(item)) continue;
      used.add(item.task.id);
      items.push(item);
    }
    return items;
  };

  return {
    now: take((item) => item.score >= settings.criticalThreshold || (item.diffHours !== undefined && item.diffHours < 0 && item.score >= settings.attentionThreshold), 6),
    today: take((item) => item.score >= settings.attentionThreshold || (item.diffHours !== undefined && item.diffHours >= 0 && item.diffHours <= 24), 6),
    plan: take((item) => item.score >= 4, 6),
  };
}

function buildDeadlineForecast({
  activeTasks,
  byUser,
  now,
  settings,
}: {
  activeTasks: Task[];
  byUser: Array<{ member: ProjectMember; significance: number; overdueSignificance: number; dueSoon: number }>;
  now: number;
  settings: TaskSignificanceSettings;
}) {
  const weekEnd = now + 7 * 24 * 3600000;
  const dueWeek = activeTasks
    .filter((task) => {
      if (!task.deadlineAt) return false;
      const deadline = new Date(task.deadlineAt).getTime();
      return deadline >= now && deadline <= weekEnd;
    })
    .sort((left, right) => new Date(left.deadlineAt!).getTime() - new Date(right.deadlineAt!).getTime());

  const likelyOverdue = dueWeek
    .map((task) => {
      const score = calculateTaskSignificanceScore(task, now, settings);
      const deadlineTime = new Date(task.deadlineAt!).getTime();
      const hoursLeft = (deadlineTime - now) / 3600000;
      const hasWeakSetup = !task.description?.trim() || (!task.assigneeId && !task.assignee?.id);
      const reasonParts = [
        `${formatHours(hoursLeft)} до срока`,
        `${score}/10 значимость`,
      ];
      if (hasWeakSetup) reasonParts.push('нужно уточнение');
      if (task.isBlocking) reasonParts.push('блокирует других');
      return {
        task,
        score,
        hoursLeft,
        reason: reasonParts.join(' · '),
        risky: score >= settings.attentionThreshold || hoursLeft <= 24 || hasWeakSetup || task.isBlocking,
      };
    })
    .filter((item) => item.risky)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.hoursLeft - right.hoursLeft;
    });

  const peopleAtRisk = byUser
    .filter((item) => item.dueSoon > 0 || item.overdueSignificance > 0)
    .sort((left, right) => right.overdueSignificance + right.significance - (left.overdueSignificance + left.significance));
  const riskScore = Math.min(10, Math.max(1, likelyOverdue.length * 2 + Math.ceil(dueWeek.length / 3) + peopleAtRisk.length));
  const tone: ProjectDiagnosticTone = riskScore >= 7 ? 'danger' : riskScore >= 4 ? 'warning' : 'good';
  const title =
    tone === 'danger'
      ? 'Неделя требует ручного контроля'
      : tone === 'warning'
        ? 'Есть риски на неделе'
        : 'Неделя выглядит спокойно';
  const summary =
    dueWeek.length > 0
      ? `${dueWeek.length} задач со сроком в ближайшие 7 дней, ${likelyOverdue.length} из них лучше проверить заранее.`
      : 'В ближайшие 7 дней нет активных задач с дедлайном.';
  const nextAction =
    likelyOverdue[0]
      ? `Начать с задачи «${likelyOverdue[0].task.title}»: ${likelyOverdue[0].reason}.`
      : peopleAtRisk[0]
        ? `Проверить нагрузку участника ${memberName(peopleAtRisk[0].member)}.`
        : 'Поддерживать текущий ритм и не копить задачи без дедлайна.';

  return {
    title,
    summary,
    nextAction,
    tone,
    riskScore,
    dueWeek,
    likelyOverdue,
    peopleAtRisk,
  };
}

function buildWorkloadRedistributionPlan({
  byUser,
  activeTasks,
  now,
  settings,
}: {
  byUser: Array<{
    member: ProjectMember;
    total: number;
    significance: number;
    overdueSignificance: number;
    overdue: number;
    dueSoon: number;
  }>;
  activeTasks: Task[];
  now: number;
  settings: TaskSignificanceSettings;
}) {
  const activeLoads = byUser.filter((item) => item.total > 0 || item.significance > 0);
  const averageWeight = activeLoads.length
    ? activeLoads.reduce((sum, item) => sum + item.significance, 0) / activeLoads.length
    : 0;
  const overloaded = [...byUser]
    .filter((item) => item.significance >= Math.max(6, averageWeight * 1.35) && item.total > 0)
    .sort((a, b) => b.significance - a.significance);
  const available = [...byUser]
    .filter((item) => item.significance <= Math.max(2, averageWeight * 0.7))
    .sort((a, b) => a.significance - b.significance);
  const candidates = overloaded.flatMap((from) => {
    const target = available.find((item) => item.member.userId !== from.member.userId);
    return activeTasks
      .filter((task) => isTaskAssignedToMember(task, from.member.userId))
      .map((task) => ({
        from,
        to: target,
        task,
        score: calculateTaskSignificanceScore(task, now, settings),
      }))
      .filter((item) => item.score >= settings.attentionThreshold || item.task.priority === 'HIGH' || item.task.priority === 'CRITICAL')
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
  });
  const suggestions = candidates.slice(0, 4);
  const summary = [
    overloaded.length
      ? `Есть перекос нагрузки: ${overloaded.map((item) => `${memberName(item.member)} (${item.significance})`).join(', ')}.`
      : 'Явного перегруза по значимости задач сейчас нет.',
    available.length
      ? `Резерв по нагрузке: ${available.slice(0, 3).map((item) => `${memberName(item.member)} (${item.significance})`).join(', ')}.`
      : 'Свободного резерва по участникам не видно.',
    suggestions.length
      ? 'Ниже показаны задачи, которые лучше проверить первыми для возможной передачи.'
      : 'Кандидатов на передачу задач по текущим правилам не найдено.',
  ];

  return {
    averageWeight,
    overloaded,
    available,
    suggestions,
    summary,
  };
}

function buildAdminReactionRules(
  queue: ReturnType<typeof buildTaskAttentionQueue>,
  settings: TaskSignificanceSettings,
): AdminReactionRule[] {
  return [
    {
      id: 'critical-now',
      title: 'Немедленно разобрать',
      timing: 'сегодня, без откладывания',
      threshold: `${settings.criticalThreshold}+ баллов или просрочка`,
      tone: queue.now.length ? 'danger' : 'good',
      items: queue.now,
      action: queue.now.length
        ? 'Открыть задачи, принять решение: закрыть, переназначить, перенести срок или снять блокер.'
        : 'Критичных задач для немедленного вмешательства сейчас нет.',
    },
    {
      id: 'daily-focus',
      title: 'Поставить в фокус дня',
      timing: 'в течение 24 часов',
      threshold: `${settings.attentionThreshold}+ баллов или близкий дедлайн`,
      tone: queue.today.length ? 'warning' : 'good',
      items: queue.today,
      action: queue.today.length
        ? 'Проверить исполнителя, ближайший следующий шаг и реальность дедлайна.'
        : 'На сегодня нет задач, которые требуют отдельного административного фокуса.',
    },
    {
      id: 'weekly-plan',
      title: 'Держать в недельном плане',
      timing: 'на планерке или при обзоре недели',
      threshold: '4+ балла',
      tone: queue.plan.length ? 'warning' : 'good',
      items: queue.plan,
      action: queue.plan.length
        ? 'Проверить, не превращаются ли эти задачи в будущую просрочку, и заранее уточнить формулировку.'
        : 'Плановая зона спокойная: значимых задач без срочной реакции нет.',
    },
  ];
}

function buildTaskAttentionReason(task: Task, score: number, diffHours?: number) {
  const reasons: string[] = [getTaskSignificanceLabel(score)];
  if (diffHours !== undefined) {
    if (diffHours < 0) reasons.push(`просрочено на ${formatHours(Math.abs(diffHours))}`);
    else if (diffHours <= 24) reasons.push(`дедлайн через ${formatHours(diffHours)}`);
    else if (diffHours <= 48) reasons.push('дедлайн в ближайшие 48 часов');
  } else {
    reasons.push('без дедлайна');
  }
  if (task.isBlocking) reasons.push('блокирует других');
  if (task.priority === 'CRITICAL') reasons.push('критичный приоритет');
  else if (task.priority === 'HIGH') reasons.push('высокий приоритет');
  if (!task.assigneeId && !task.assignee?.id) reasons.push('нет исполнителя');
  return reasons.join(' · ');
}

function formatHours(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} мин.`;
  if (hours < 48) return `${Math.round(hours)} ч.`;
  return `${Math.round(hours / 24)} дн.`;
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
  const actions: Array<{ text: string; tasks: Task[] }> = [];
  if (overdue.length > 0) actions.push({ text: `Разобрать ${overdue.length} просроченных задач и обновить сроки.`, tasks: overdue });
  if (dueSoon.length > 0) actions.push({ text: `Поставить в фокус ${dueSoon.length} задач с ближайшим дедлайном.`, tasks: dueSoon });
  if (unassigned.length > 0) actions.push({ text: `Назначить ответственных для ${unassigned.length} задач.`, tasks: unassigned });
  if (noDeadline.length > 0) actions.push({ text: `Добавить дедлайны для ${noDeadline.length} задач.`, tasks: noDeadline });
  if (overloaded.length > 0) actions.push({ text: `Снять перегруз с: ${overloaded.map((item) => memberName(item.member)).join(', ')}.`, tasks: [] });
  if (highPriority.length > 0) actions.push({ text: 'Проверить критичные и важные задачи отдельно.', tasks: highPriority });
  if (weakTasks.length > 0) actions.push({ text: 'Уточнить формулировки задач без описания или структуры.', tasks: weakTasks });
  return actions.slice(0, 5).length > 0 ? actions.slice(0, 5) : [{ text: 'Поддерживать текущий ритм и обновлять статусы задач в конце дня.', tasks: [] }];
}

function buildChangeSummary({
  tasks,
  columns,
  events,
  nodes,
  blocks,
  now,
}: {
  tasks: Task[];
  columns: Column[];
  events: ActivityEvent[];
  nodes: PageNode[];
  blocks: Block[];
  now: number;
}) {
  const since = now - 7 * 24 * 3600000;
  const newTasks = tasks.filter((task) => new Date(task.createdAt).getTime() >= since);
  const closedTasks = tasks.filter((task) => isTaskCompletedForAdmin(task, columns) || hasRecentEvent(events, task.id, ['task_complete'], since));
  const newOverdueTasks = tasks.filter((task) => {
    if (!task.deadlineAt || isTaskCompletedForAdmin(task, columns)) return false;
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
    if (isTaskCompletedForAdmin(task, columns) || isTaskDeferredForAdmin(task, now)) return false;
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

function createEmptyAdminChangeSummary(): AdminChangeSummary {
  return {
    days: 7,
    newTasks: [],
    closedTasks: [],
    newOverdueTasks: [],
    activePeople: [],
    updatedPages: [],
    staleTasks: [],
    highlights: [],
  };
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

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value?: string, endOfDay = false) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}

function buildMeetingPlan({
  tasks,
  columns,
  members,
  overdue,
  dueSoon,
  overloaded,
  events,
  now,
  periodStart,
  periodEnd,
}: {
  tasks: Task[];
  columns: Column[];
  members: ProjectMember[];
  overdue: Task[];
  dueSoon: Task[];
  overloaded: Array<{ member: ProjectMember; total: number }>;
  events: ActivityEvent[];
  now: number;
  periodStart?: string;
  periodEnd?: string;
}) {
  const since = parseDateInput(periodStart) ?? now - 7 * 24 * 3600000;
  const until = parseDateInput(periodEnd, true) ?? now;
  const lower = Math.min(since, until);
  const upper = Math.max(since, until);
  const inPeriod = (value: number) => Number.isFinite(value) && value >= lower && value <= upper;
  const completed = tasks.filter((task) => {
    const completedColumn = isTaskCompletedForAdmin(task, columns);
    if (!completedColumn && !task.isArchived) return false;
    const hasCompletionEvent = events.some((event) => {
      if (!inPeriod(new Date(event.createdAt).getTime())) return false;
      if (String(event.entityId) !== String(task.id)) return false;
      return event.type === 'task_complete' || (event.type === 'task_move' && completedColumn);
    });
    const completedAt = task.isArchived ? task.archivedAt : task.updatedAt;
    return hasCompletionEvent || (completedAt ? inPeriod(new Date(completedAt).getTime()) : false);
  }).slice(0, 12);
  const inProgress = tasks.filter((task) => !task.isArchived && !isTaskCompletedForAdmin(task, columns)).slice(0, 12);
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
  deadlineForecast,
  workloadPlan,
  reactionRules,
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
  changeSummary: AdminChangeSummary;
  deadlineForecast: DeadlineForecast;
  workloadPlan: WorkloadRedistributionPlan;
  reactionRules: AdminReactionRule[];
}) {
  const topPeople = [...byUser].sort((a, b) => b.total - a.total).slice(0, 3);
  const criticalReaction = reactionRules.find((rule) => rule.id === 'critical-now');
  const focusReaction = reactionRules.find((rule) => rule.id === 'daily-focus');
  const workloadSuggestion = workloadPlan.suggestions[0];
  const forecastTask = deadlineForecast.likelyOverdue[0];
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
    'Прогноз на 7 дней:',
    `- риск недели: ${deadlineForecast.riskScore}/10`,
    `- дедлайнов на неделе: ${deadlineForecast.dueWeek.length}`,
    `- риск срыва: ${deadlineForecast.likelyOverdue.length}`,
    forecastTask ? `- первая задача для проверки: ${forecastTask.task.title}` : '- срочных задач для прогноза нет',
    '',
    'Нагрузка:',
    `- перегружены: ${workloadPlan.overloaded.length ? workloadPlan.overloaded.map((item) => memberName(item.member)).join(', ') : 'нет'}`,
    `- можно догрузить: ${workloadPlan.available.length ? workloadPlan.available.slice(0, 3).map((item) => memberName(item.member)).join(', ') : 'нет'}`,
    workloadSuggestion
      ? `- кандидат на передачу: ${workloadSuggestion.task.title} от ${memberName(workloadSuggestion.from.member)} к ${workloadSuggestion.to ? memberName(workloadSuggestion.to.member) : 'менее загруженному участнику'}`
      : '- явных кандидатов на передачу нет',
    '',
    'Правила реакции:',
    `- немедленно: ${criticalReaction?.items.length ?? 0}`,
    `- фокус дня: ${focusReaction?.items.length ?? 0}`,
    `- действие: ${deadlineForecast.nextAction}`,
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
  message,
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
  message: string;
  onFormatChange: (format: ExportFormat) => void;
  onScopeChange: (scope: ExportScope) => void;
  onTargetChange: (id: string) => void;
  onExport: (delivery: 'download' | 'telegram') => void;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<{ branches: PageNode[]; pages: PageNode[]; kanbanPages: PageNode[] }>({
    branches: [],
    pages: [],
    kanbanPages: [],
  });
  const [targetsLoading, setTargetsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setTargetsLoading(true);
    getProjectExportTargets(project)
      .then((nextTargets) => {
        if (!cancelled) setTargets(nextTargets);
      })
      .catch(() => {
        if (!cancelled) setTargets({ branches: [], pages: [], kanbanPages: [] });
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const { branches, pages, kanbanPages } = targets;
  const targetOptions =
    scope === 'branch' ? branches :
    scope === 'page' ? pages :
    scope === 'kanban' ? kanbanPages :
    [];
  const needsTarget = scope !== 'project';
  const canExport = !targetsLoading && (!needsTarget || Boolean(targetId));

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
              { value: 'excel', label: 'Excel', hint: 'таблицы в CSV' },
              { value: 'backup', label: 'Backup', hint: 'резервная копия' },
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
                disabled={targetsLoading}
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

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onExport('download')}
            disabled={!canExport || exporting}
            className="rounded-[14px] bg-[var(--tg-theme-button-color)] px-4 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
          >
            {exporting ? 'Готовлю...' : 'Скачать здесь'}
          </button>
          <button
            onClick={() => onExport('telegram')}
            disabled={!canExport || exporting}
            className="rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-sm font-semibold text-[var(--tg-theme-link-color)] disabled:opacity-50"
          >
            Через Telegram-бота
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--tg-theme-hint-color)]">
          Формат: {exportLabel(format)}. PDF откроется как печатная версия.
        </p>

        {message && (
          <div className="mt-3 rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)]">
            {message}
          </div>
        )}

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
              value={result.content.length > 6000 ? `${result.content.slice(0, 6000)}\n\n...` : result.content}
              className="h-36 w-full resize-none rounded-[12px] bg-[var(--tg-theme-bg-color)] p-3 text-xs text-[var(--tg-theme-text-color)] outline-none"
            />
          </section>
        )}
      </div>
    </div>
  );
}

function buildResponsibilityAreaSummaries({
  areas,
  members,
  tasks,
  activeTasks,
  completedTasks,
  now,
}: {
  areas: ResponsibilityArea[];
  members: ProjectMember[];
  tasks: Task[];
  activeTasks: Task[];
  completedTasks: Task[];
  now: number;
}): ResponsibilityAreaSummary[] {
  return areas.map((area) => {
    const owners = members.filter((member) =>
      (area.ownerUserIds ?? []).some((userId) => String(userId) === String(member.userId)),
    );
    const areaActiveTasks = activeTasks
      .filter((task) => isTaskInResponsibilityArea(task, area))
      .sort((a, b) => {
        const left = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right;
      });
    const areaCompletedTasks = completedTasks.filter((task) => isTaskInResponsibilityArea(task, area));
    const overdueTasks = areaActiveTasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now);
    const dueSoonTasks = areaActiveTasks.filter((task) => {
      if (!task.deadlineAt) return false;
      const diffHours = (new Date(task.deadlineAt).getTime() - now) / 3600000;
      return diffHours >= 0 && diffHours <= 48;
    });
    const loadLimit = Math.max(4, owners.length * 4);
    const tone: ResponsibilityAreaSummary['tone'] =
      overdueTasks.length > 0 || owners.length === 0
        ? 'danger'
        : dueSoonTasks.length > 0 || areaActiveTasks.length > loadLimit
          ? 'warning'
          : 'good';
    const status =
      owners.length === 0
        ? 'нет владельца'
        : overdueTasks.length > 0
          ? 'риск'
          : dueSoonTasks.length > 0
            ? 'дедлайн'
            : areaActiveTasks.length > loadLimit
              ? 'перегруз'
              : 'норма';

    return {
      area,
      owners,
      activeTasks: areaActiveTasks,
      completedTasks: areaCompletedTasks,
      overdueTasks,
      dueSoonTasks,
      tone,
      status,
    };
  }).sort((left, right) => {
    const toneWeight = { danger: 0, warning: 1, good: 2 };
    return toneWeight[left.tone] - toneWeight[right.tone] || right.activeTasks.length - left.activeTasks.length;
  });
}

function isTaskInResponsibilityArea(task: Task, area: ResponsibilityArea) {
  const linkedTaskIds = area.linkedTaskIds ?? [];
  if (linkedTaskIds.some((taskId) => String(taskId) === String(task.id))) return true;
  return (area.ownerUserIds ?? []).some((userId) => isTaskAssignedToMember(task, userId));
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

function userDisplayName(user: Pick<User, 'firstName' | 'lastName' | 'username' | 'telegramId'>) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || user.telegramId || 'Пользователь';
}

async function prepareAvatarDataUrl(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Поддерживаются только JPG, PNG и WebP.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Выберите изображение до 8 МБ.');
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');

    context.fillStyle = '#111827';
    context.fillRect(0, 0, size, size);
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    image.src = src;
  });
}

function humanAvatarError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (/404|not found/i.test(message)) return 'Маршрут загрузки фото не найден. Обновите страницу или перезапустите локальный backend.';
  if (/413|too large/i.test(message)) return 'Фото слишком большое. Выберите изображение поменьше.';
  if (/unsupported/i.test(message)) return 'Поддерживаются только JPG, PNG и WebP.';
  return message || fallback;
}

function projectRoleLabel(role: ProjectRoleName | string | undefined) {
  if (role === 'owner') return 'Владелец';
  if (role === 'admin') return 'Админ';
  if (role === 'viewer') return 'Наблюдатель';
  return 'Редактор';
}

function isProjectMemberOwner(project: Project | null | undefined, member: ProjectMember) {
  return String(project?.ownerId ?? '') === String(member.userId);
}

function isAdminMember(member: ProjectMember) {
  return member.role?.name === 'admin';
}

function isTaskAssignedToMember(task: Task, userId: number | string) {
  const assigneeId = task.assigneeId ?? task.assignee?.id;
  return assigneeId !== undefined && assigneeId !== null && String(assigneeId) === String(userId);
}

function isTaskDeferredForAdmin(task: Task, now: number) {
  return Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() > now);
}

function isTaskCompletedForAdmin(task: Task, columns: Column[]) {
  if (task.isArchived) return true;
  const boardColumns = columns
    .filter((column) =>
      String(column.projectId) === String(task.projectId) &&
      String(column.pageId ?? '') === String(task.pageId ?? '') &&
      !column.isHidden &&
      !column.isArchive,
    )
    .sort((a, b) => a.position - b.position);
  const lastColumn = boardColumns[boardColumns.length - 1];
  return Boolean(lastColumn && String(task.columnId) === String(lastColumn.id));
}

function isTaskActiveForAdmin(task: Task, columns: Column[], now: number) {
  return !isTaskCompletedForAdmin(task, columns) && !isTaskDeferredForAdmin(task, now);
}

function daysLeft(deletedAt?: string) {
  if (!deletedAt) return 30;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((30 * 24 * 3600000 - elapsed) / (24 * 3600000)));
}
