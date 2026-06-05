import type { Column, Priority, Project, ProjectJoinRequest, ProjectMember, Subtask, Task, User } from '../types';
import { useWorkspaceBackend } from './httpClient';

const STORAGE_KEY = 'notion-lite-kanban-db-v1';
const LAST_GOOD_STORAGE_KEY = 'notion-lite-kanban-db-v1-last-good';
const BACKUP_PREFIX = 'workspace-backup-v';

interface MockDb {
  users: User[];
  projects: Project[];
  columns: Column[];
  tasks: Task[];
  subtasks: Subtask[];
  joinRequests?: ProjectJoinRequest[];
}

const currentUser: User = {
  id: 1,
  telegramId: 'local-dev',
  username: 'local_user',
  firstName: 'Local',
  lastName: 'User',
};

export function readDb(): MockDb {
  if (useWorkspaceBackend) return createEmptyDb();

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const db = JSON.parse(raw) as MockDb;
    const recovered = recoverRicherBackup(db);
    if (recovered) return recovered;
    const recoveredFromPages = recoverProjectsFromPageSpaces(db);
    if (recoveredFromPages) return recoveredFromPages;
    purgeExpiredDeletedProjects(db);
    writeDb(db);
    return db;
  }

  const recovered = recoverRicherBackup();
  if (recovered) return recovered;

  const now = new Date().toISOString();
  const member: ProjectMember = {
    id: 1,
    projectId: 1,
    userId: 1,
    user: currentUser,
    role: {
      id: 1,
      projectId: 1,
      name: 'owner',
      permissions: {
        createTask: true,
        deleteTask: true,
        manageColumns: true,
        manageMembers: true,
        viewAnalytics: true,
        manageProject: true,
      },
    },
  };
  const projects: Project[] = [
    {
      id: 1,
      ownerId: 1,
      title: 'Командный проект',
      description: 'Default project для Notion-like workspace и Kanban-доски.',
      aiToneStyle: 'FRIENDLY',
      isArchived: false,
      createdAt: now,
      members: [member],
      _count: { tasks: 3 },
    },
  ];
  const columns: Column[] = [
    { id: 1, projectId: 1, title: 'Идея', position: 0, isDefault: false, isArchive: false, isHidden: false },
    { id: 2, projectId: 1, title: 'В работе', position: 1, isDefault: true, isArchive: false, isHidden: false },
    { id: 3, projectId: 1, title: 'Готово', position: 2, isDefault: false, isArchive: true, isHidden: false },
  ];
  const subtasks: Subtask[] = [
    { id: 1, taskId: 2, title: 'Проверить старый drag & drop', isCompleted: true, position: 0 },
    { id: 2, taskId: 2, title: 'Открыть задачу в модалке', isCompleted: false, position: 1 },
  ];
  const tasks: Task[] = [
    createTaskSeed(1, 1, 1, 'Описать структуру workspace', 'Обычная страница, дерево, блоки и Kanban-page.', 'HIGH', 0, now),
    createTaskSeed(2, 1, 2, 'Интегрировать Kanban как страницу', 'Не переписывать доску, а рендерить существующий BoardPage.', 'CRITICAL', 0, now, subtasks),
    createTaskSeed(3, 1, 2, 'Добавить Link to page', 'Блок ссылки должен открывать страницу внутри приложения.', 'MEDIUM', 1, now),
  ];

  const db = { users: [currentUser], projects, columns, tasks, subtasks, joinRequests: [] };
  writeDb(db);
  return db;
}

export function writeDb(db: MockDb) {
  if (useWorkspaceBackend) return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  if (countVisibleProjects(db) > 1) {
    localStorage.setItem(LAST_GOOD_STORAGE_KEY, JSON.stringify({
      createdAt: new Date().toISOString(),
      db,
    }));
  }
}

function createEmptyDb(): MockDb {
  return {
    users: [currentUser],
    projects: [],
    columns: [],
    tasks: [],
    subtasks: [],
    joinRequests: [],
  };
}

export function nextId(items: Array<{ id: number }>) {
  return (items.reduce((max, item) => Math.max(max, item.id), 0) || 0) + 1;
}

export function hydrateTask(db: MockDb, task: Task): Task {
  return {
    ...task,
    assignee: task.assigneeId
      ? db.users.find((user) => user.id === task.assigneeId) ?? task.assignee
      : task.assignee,
    subtasks: db.subtasks.filter((subtask) => subtask.taskId === task.id).sort((a, b) => a.position - b.position),
    tags: task.tags ?? [],
  };
}

export function refreshProjectCounts(db: MockDb) {
  db.projects = db.projects.map((project) => ({
    ...project,
    columns: db.columns.filter((column) => column.projectId === project.id),
    _count: {
      tasks: db.tasks.filter((task) => task.projectId === project.id && !task.isArchived).length,
    },
  }));
}

function purgeExpiredDeletedProjects(db: MockDb) {
  const expiredIds = db.projects
    .filter((project) => project.isDeleted && isOlderThan30Days(project.deletedAt))
    .map((project) => project.id);
  if (expiredIds.length === 0) return;
  db.projects = db.projects.filter((project) => !expiredIds.includes(project.id));
  db.columns = db.columns.filter((column) => !expiredIds.includes(column.projectId));
  db.tasks = db.tasks.filter((task) => !expiredIds.includes(task.projectId));
  db.subtasks = db.subtasks.filter((subtask) => db.tasks.some((task) => task.id === subtask.taskId));
}

function isOlderThan30Days(date?: string) {
  if (!date) return false;
  return Date.now() - new Date(date).getTime() > 30 * 24 * 3600000;
}

function recoverRicherBackup(currentDb?: MockDb): MockDb | null {
  const currentCount = countVisibleProjects(currentDb);
  const lastGood = recoverLastGood(currentCount);
  if (lastGood) return lastGood;
  const backups = Object.keys(localStorage)
    .filter((key) => key.startsWith(BACKUP_PREFIX))
    .sort()
    .reverse();

  for (const key of backups) {
    try {
      const backup = JSON.parse(localStorage.getItem(key) ?? '{}');
      const dbRaw = backup?.data?.[STORAGE_KEY];
      if (!dbRaw) continue;
      const backupDb = JSON.parse(dbRaw) as MockDb;
      const backupCount = countVisibleProjects(backupDb);
      if (backupCount <= currentCount) continue;

      localStorage.setItem(STORAGE_KEY, JSON.stringify(backupDb));
      const pagesRaw = backup?.data?.['notion-lite-pages-v1'];
      const activityRaw = backup?.data?.['notion-lite-activity-v1'];
      if (pagesRaw) localStorage.setItem('notion-lite-pages-v1', pagesRaw);
      if (activityRaw) localStorage.setItem('notion-lite-activity-v1', activityRaw);

      purgeExpiredDeletedProjects(backupDb);
      writeDb(backupDb);
      return backupDb;
    } catch {
      continue;
    }
  }

  return null;
}

function recoverLastGood(currentCount: number): MockDb | null {
  try {
    const raw = localStorage.getItem(LAST_GOOD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const db = parsed.db as MockDb;
    if (countVisibleProjects(db) <= currentCount) return null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    return db;
  } catch {
    return null;
  }
}

function countVisibleProjects(db?: MockDb) {
  return (db?.projects ?? []).filter((project) => !project.isDeleted && !project.isArchived).length;
}

function recoverProjectsFromPageSpaces(db: MockDb): MockDb | null {
  if (countVisibleProjects(db) > 1) return null;

  try {
    const raw = localStorage.getItem('notion-lite-pages-v1');
    if (!raw) return null;
    const spaces = JSON.parse(raw) as Record<string, { nodes?: Array<{ projectId?: string; parentId?: string | null; title?: string; type?: string; order?: number }> }>;
    const knownIds = new Set((db.projects ?? []).map((project) => String(project.id)));
    let changed = false;

    for (const [projectIdText, space] of Object.entries(spaces)) {
      const projectId = Number(projectIdText);
      if (!Number.isFinite(projectId) || knownIds.has(String(projectId))) continue;

      const root = (space.nodes ?? [])
        .filter((node) => node.projectId === projectIdText && node.parentId === null)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
      const title = root?.title?.trim() || `Проект ${projectId}`;

      db.projects.push({
        id: projectId,
        ownerId: 1,
        title,
        description: 'Восстановлено из дерева страниц.',
        aiToneStyle: 'FRIENDLY',
        isArchived: false,
        createdAt: new Date().toISOString(),
        members: [
          {
            id: 1,
            projectId,
            userId: 1,
            user: currentUser,
            role: createRecoveredOwnerRole(projectId),
          },
        ],
        _count: { tasks: 0 },
      });

      if (!db.columns.some((column) => column.projectId === projectId)) {
        const baseId = nextId(db.columns);
        db.columns.push(
          { id: baseId, projectId, title: 'Идея', position: 0, isDefault: false, isArchive: false, isHidden: false },
          { id: baseId + 1, projectId, title: 'В работе', position: 1, isDefault: true, isArchive: false, isHidden: false },
          { id: baseId + 2, projectId, title: 'Готово', position: 2, isDefault: false, isArchive: false, isHidden: false },
        );
      }

      changed = true;
    }

    if (!changed) return null;
    refreshProjectCounts(db);
    writeDb(db);
    return db;
  } catch {
    return null;
  }
}

function createRecoveredOwnerRole(projectId: number) {
  return {
    id: 1,
    projectId,
    name: 'owner' as const,
    permissions: {
      createTask: true,
      deleteTask: true,
      manageColumns: true,
      manageMembers: true,
      viewAnalytics: true,
      manageProject: true,
    },
  };
}

function createTaskSeed(
  id: number,
  projectId: number,
  columnId: number,
  title: string,
  description: string,
  priority: Priority,
  position: number,
  now: string,
  subtasks: Subtask[] = [],
): Task {
  return {
    id,
    projectId,
    columnId,
    title,
    description,
    priority,
    deadlineAt: new Date(Date.now() + (id + 1) * 24 * 3600000).toISOString(),
    colorLabel: id === 2 ? '#3B82F6' : undefined,
    isRepeating: false,
    position,
    isArchived: false,
    createdAt: now,
    assignee: currentUser,
    subtasks,
    tags: [],
  };
}
