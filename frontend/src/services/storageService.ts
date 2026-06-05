const APP_STORAGE_VERSION = 2;
const VERSION_KEY = 'workspace-storage-version';
const BACKUP_PREFIX = 'workspace-backup-v';

const DATA_KEYS = [
  'notion-lite-kanban-db-v1',
  'notion-lite-pages-v1',
  'notion-lite-activity-v1',
  'notion-lite-user-settings-v1',
  'kanban-archive-cleanup-mode-v1',
  'kanban-show-only-my-tasks-v1',
];

export function prepareLocalStorageForAppUpdate() {
  const currentVersion = Number(localStorage.getItem(VERSION_KEY) ?? '0');
  if (currentVersion >= APP_STORAGE_VERSION) return;

  createStorageBackup(currentVersion);
  runStorageMigrations(currentVersion);
  localStorage.setItem(VERSION_KEY, String(APP_STORAGE_VERSION));
}

export function createStorageBackup(fromVersion?: number) {
  const snapshot: Record<string, string | null> = {};
  for (const key of DATA_KEYS) snapshot[key] = localStorage.getItem(key);

  const backup = {
    createdAt: new Date().toISOString(),
    fromVersion: fromVersion ?? Number(localStorage.getItem(VERSION_KEY) ?? '0'),
    toVersion: APP_STORAGE_VERSION,
    data: snapshot,
  };

  localStorage.setItem(`${BACKUP_PREFIX}${Date.now()}`, JSON.stringify(backup));
  pruneOldBackups();
}

function runStorageMigrations(fromVersion: number) {
  if (fromVersion < 1) {
    const dbRaw = localStorage.getItem('notion-lite-kanban-db-v1');
    if (dbRaw) {
      const db = JSON.parse(dbRaw);
      db.joinRequests = db.joinRequests ?? [];
      localStorage.setItem('notion-lite-kanban-db-v1', JSON.stringify(db));
    }
  }

  if (fromVersion < 2) {
    const dbRaw = localStorage.getItem('notion-lite-kanban-db-v1');
    if (dbRaw) {
      const db = JSON.parse(dbRaw);
      db.projects = (db.projects ?? []).map((project: any) => ({
        ...project,
        inviteCode: project.inviteCode ?? `P${project.id}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      }));
      db.joinRequests = db.joinRequests ?? [];
      localStorage.setItem('notion-lite-kanban-db-v1', JSON.stringify(db));
    }
  }
}

function pruneOldBackups() {
  const backupKeys = Object.keys(localStorage)
    .filter((key) => key.startsWith(BACKUP_PREFIX))
    .sort()
    .reverse();

  for (const key of backupKeys.slice(5)) localStorage.removeItem(key);
}
