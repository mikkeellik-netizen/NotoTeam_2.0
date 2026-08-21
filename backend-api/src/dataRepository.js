import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NORMALIZED_SCHEMA_MIGRATION_ID = "0002_normalized_workspace_tables";

// Куда складывать данные. Приоритет:
//   1) APP_DATA_DIR (если задан),
//   2) /data — постоянный том Railway, если он смонтирован (определяем по наличию каталога),
//   3) локальная папка app-data (для разработки).
// Пункт (2) делает хранилище устойчивым к пропаже переменной APP_DATA_DIR в Railway.
export function resolveAppDataDir() {
  const fromEnv = process.env.APP_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (existsSync("/data")) return "/data";
  return path.resolve(path.join(__dirname, "../../app-data"));
}

export function createDataRepository({ createDefaultDb }) {
  // Если задан DATABASE_URL — используем Postgres (переживает деплои без диска,
  // например на бесплатном тарифе Render). Иначе — прежнее файловое хранилище.
  if (process.env.DATABASE_URL?.trim()) {
    return createPostgresDataRepository({ createDefaultDb });
  }
  const storage = (process.env.WORKSPACE_STORAGE ?? "sqlite").trim().toLowerCase();
  if (storage === "json") return createJsonDataRepository({ createDefaultDb });
  return createSqliteDataRepository({ createDefaultDb });
}

export function createPostgresDataRepository({ createDefaultDb }) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  let initialized = false;

  async function ensureTable() {
    if (initialized) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS app_state (
        id TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await ensurePostgresNormalizedSchema(pool);
    const { rows } = await pool.query("SELECT 1 FROM app_state WHERE id = $1", ["workspace"]);
    if (rows.length === 0 && !usesNormalizedPrimary()) {
      await pool.query(
        "INSERT INTO app_state (id, value, updated_at) VALUES ($1, $2, now())",
        ["workspace", JSON.stringify(createDefaultDb())],
      );
    }
    initialized = true;
  }

  return {
    paths: {
      // Бэкапы для Postgres не нужны на диске — есть отдельный /system/db-backup.
      backupDir: null,
    },

    async read() {
      await ensureTable();
      if (usesNormalizedPrimary()) {
        const normalizedDb = await readPostgresNormalizedDb(pool, createDefaultDb);
        if (normalizedDb) return normalizedDb;
      }
      const { rows } = await pool.query("SELECT value FROM app_state WHERE id = $1", ["workspace"]);
      const db = rows[0]?.value ?? createDefaultDb();
      if (writesNormalizedTables()) await syncPostgresNormalizedTables(pool, db);
      return db;
    },

    async write(db) {
      await ensureTable();
      if (usesNormalizedPrimary()) {
        await syncPostgresNormalizedTables(pool, db);
        return;
      }
      await pool.query(
        "INSERT INTO app_state (id, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        ["workspace", JSON.stringify(db)],
      );
      if (writesNormalizedTables()) await syncPostgresNormalizedTables(pool, db);
    },
  };
}

export function createJsonDataRepository({ createDefaultDb }) {
  const appDataDir = resolveAppDataDir();
  const dataDir = path.join(appDataDir, "database");
  const migrationsDir = path.join(dataDir, "migrations");
  const backupDir = path.join(appDataDir, "backups", "database");
  const dbFile = path.join(dataDir, "app.json");
  const legacyDbFile = path.resolve(__dirname, "../data/db.json");

  return {
    paths: {
      appDataDir,
      dataDir,
      migrationsDir,
      backupDir,
      dbFile,
      legacyDbFile,
    },

    async read() {
      await ensureDb();
      return JSON.parse(await readFile(dbFile, "utf8"));
    },

    async write(db) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(dbFile, JSON.stringify(db, null, 2), "utf8");
    },
  };

  async function ensureDb() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(migrationsDir, { recursive: true });
    await mkdir(backupDir, { recursive: true });
    if (existsSync(dbFile)) return;

    if (existsSync(legacyDbFile)) {
      const backupName = `app_${timestampForFile()}_before_app_data_migration.json`;
      await copyFile(legacyDbFile, path.join(backupDir, backupName));
      await copyFile(legacyDbFile, dbFile);
      return;
    }

    await writeFile(dbFile, JSON.stringify(createDefaultDb(), null, 2), "utf8");
  }
}

export function createSqliteDataRepository({ createDefaultDb }) {
  const appDataDir = resolveAppDataDir();
  const dataDir = path.join(appDataDir, "database");
  const migrationsDir = path.join(dataDir, "migrations");
  const backupDir = path.join(appDataDir, "backups", "database");
  const dbFile = path.join(dataDir, "app.db");
  const jsonDbFile = path.join(dataDir, "app.json");
  const legacyDbFile = path.resolve(__dirname, "../data/db.json");

  let sqlite;
  let initialized = false;

  return {
    paths: {
      appDataDir,
      dataDir,
      migrationsDir,
      backupDir,
      dbFile,
      jsonDbFile,
      legacyDbFile,
    },

    async read() {
      await ensureDb();
      if (usesNormalizedPrimary()) {
        const normalizedDb = readSqliteNormalizedDb(sqlite, createDefaultDb);
        if (normalizedDb) return normalizedDb;
      }
      const row = sqlite.prepare("SELECT value FROM app_state WHERE id = ?").get("workspace");
      const db = row?.value ? JSON.parse(row.value) : createDefaultDb();
      if (writesNormalizedTables()) syncSqliteNormalizedTables(sqlite, db);
      return db;
    },

    async write(db) {
      await ensureDb();
      if (usesNormalizedPrimary()) {
        syncSqliteNormalizedTables(sqlite, db);
        return;
      }
      const payload = JSON.stringify(db, null, 2);
      sqlite
        .prepare("INSERT INTO app_state (id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run("workspace", payload, new Date().toISOString());
      if (writesNormalizedTables()) syncSqliteNormalizedTables(sqlite, db);
    },
  };

  async function ensureDb() {
    if (initialized) return;
    await mkdir(dataDir, { recursive: true });
    await mkdir(migrationsDir, { recursive: true });
    await mkdir(backupDir, { recursive: true });

    sqlite = new DatabaseSync(dbFile);
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_state (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    ensureSqliteNormalizedSchema(sqlite);

    const hasState = sqlite.prepare("SELECT 1 FROM app_state WHERE id = ?").get("workspace");
    if (!hasState) {
      const initialDb = await readInitialDb();
      if (!usesNormalizedPrimary()) {
        sqlite
          .prepare("INSERT INTO app_state (id, value, updated_at) VALUES (?, ?, ?)")
          .run("workspace", JSON.stringify(initialDb, null, 2), new Date().toISOString());
      }
      sqlite
        .prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run("0001_sqlite_app_state", new Date().toISOString());
      if (writesNormalizedTables() && !hasSqliteNormalizedRows(sqlite)) syncSqliteNormalizedTables(sqlite, initialDb);
    }

    initialized = true;
  }

  async function readInitialDb() {
    if (existsSync(jsonDbFile)) {
      const backupName = `app_${timestampForFile()}_before_sqlite_import.json`;
      await copyFile(jsonDbFile, path.join(backupDir, backupName));
      return JSON.parse(await readFile(jsonDbFile, "utf8"));
    }

    if (existsSync(legacyDbFile)) {
      const backupName = `app_${timestampForFile()}_before_sqlite_import_legacy.json`;
      await copyFile(legacyDbFile, path.join(backupDir, backupName));
      return JSON.parse(await readFile(legacyDbFile, "utf8"));
    }

    return createDefaultDb();
  }
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizedTablesMode() {
  const mode = String(process.env.WORKSPACE_NORMALIZED_TABLES ?? "").trim().toLowerCase();
  if (mode === "primary" || mode === "tables") return "primary";
  if (mode === "1" || mode === "true" || mode === "mirror") return "mirror";
  return "off";
}

function writesNormalizedTables() {
  return normalizedTablesMode() !== "off";
}

function usesNormalizedPrimary() {
  return normalizedTablesMode() === "primary";
}

function hasSqliteNormalizedRows(sqlite) {
  const tables = ["projects", "nodes", "blocks", "tasks", "events", "records"];
  return tables.some((table) => {
    try {
      return Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0) > 0;
    } catch {
      return false;
    }
  });
}

function ensureSqliteNormalizedSchema(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_id TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      type TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT,
      column_id TEXT,
      assignee_id TEXT,
      title TEXT NOT NULL,
      deadline_at TEXT,
      completed_at TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      updated_at TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_project_parent ON nodes(project_id, parent_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_blocks_project_page ON blocks(project_id, page_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_page ON tasks(project_id, page_id, column_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee_deadline ON tasks(assignee_id, deadline_at);
    CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_records_collection_project ON records(collection, project_id);
  `);
  sqlite
    .prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
    .run(NORMALIZED_SCHEMA_MIGRATION_ID, new Date().toISOString());
}

async function ensurePostgresNormalizedSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_id TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      type TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT,
      column_id TEXT,
      assignee_id TEXT,
      title TEXT NOT NULL,
      deadline_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      created_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_project_parent ON nodes(project_id, parent_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_blocks_project_page ON blocks(project_id, page_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_page ON tasks(project_id, page_id, column_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee_deadline ON tasks(assignee_id, deadline_at);
    CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_records_collection_project ON records(collection, project_id);
  `);
  await pool.query(
    "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, now()) ON CONFLICT (id) DO NOTHING",
    [NORMALIZED_SCHEMA_MIGRATION_ID],
  );
}

function syncSqliteNormalizedTables(sqlite, db) {
  const rows = createNormalizedRows(db);
  sqlite.exec("BEGIN");
  try {
    sqlite.exec("DELETE FROM records; DELETE FROM events; DELETE FROM tasks; DELETE FROM blocks; DELETE FROM nodes; DELETE FROM projects;");
    const projectStmt = sqlite.prepare("INSERT INTO projects (id, title, owner_id, is_deleted, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)");
    const nodeStmt = sqlite.prepare("INSERT INTO nodes (id, project_id, parent_id, type, title, order_index, is_deleted, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const blockStmt = sqlite.prepare("INSERT INTO blocks (id, project_id, page_id, type, order_index, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const taskStmt = sqlite.prepare("INSERT INTO tasks (id, project_id, page_id, column_id, assignee_id, title, deadline_at, completed_at, is_archived, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const eventStmt = sqlite.prepare("INSERT INTO events (id, project_id, user_id, type, entity_type, entity_id, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const recordStmt = sqlite.prepare("INSERT INTO records (collection, id, project_id, user_id, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)");

    for (const row of rows.projects) projectStmt.run(row.id, row.title, row.ownerId, row.isDeleted ? 1 : 0, row.updatedAt, row.payload);
    for (const row of rows.nodes) nodeStmt.run(row.id, row.projectId, row.parentId, row.type, row.title, row.order, row.isDeleted ? 1 : 0, row.updatedAt, row.payload);
    for (const row of rows.blocks) blockStmt.run(row.id, row.projectId, row.pageId, row.type, row.order, row.updatedAt, row.payload);
    for (const row of rows.tasks) taskStmt.run(row.id, row.projectId, row.pageId, row.columnId, row.assigneeId, row.title, row.deadlineAt, row.completedAt, row.isArchived ? 1 : 0, row.updatedAt, row.payload);
    for (const row of rows.events) eventStmt.run(row.id, row.projectId, row.userId, row.type, row.entityType, row.entityId, row.createdAt, row.payload);
    for (const row of rows.records) recordStmt.run(row.collection, row.id, row.projectId, row.userId, row.updatedAt, row.payload);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

async function syncPostgresNormalizedTables(pool, db) {
  const rows = createNormalizedRows(db);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM records; DELETE FROM events; DELETE FROM tasks; DELETE FROM blocks; DELETE FROM nodes; DELETE FROM projects;");

    for (const row of rows.projects) {
      await client.query(
        "INSERT INTO projects (id, title, owner_id, is_deleted, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6)",
        [row.id, row.title, row.ownerId, row.isDeleted, toDateOrNull(row.updatedAt), row.payload],
      );
    }
    for (const row of rows.nodes) {
      await client.query(
        "INSERT INTO nodes (id, project_id, parent_id, type, title, order_index, is_deleted, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [row.id, row.projectId, row.parentId, row.type, row.title, row.order, row.isDeleted, toDateOrNull(row.updatedAt), row.payload],
      );
    }
    for (const row of rows.blocks) {
      await client.query(
        "INSERT INTO blocks (id, project_id, page_id, type, order_index, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [row.id, row.projectId, row.pageId, row.type, row.order, toDateOrNull(row.updatedAt), row.payload],
      );
    }
    for (const row of rows.tasks) {
      await client.query(
        "INSERT INTO tasks (id, project_id, page_id, column_id, assignee_id, title, deadline_at, completed_at, is_archived, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [row.id, row.projectId, row.pageId, row.columnId, row.assigneeId, row.title, toDateOrNull(row.deadlineAt), toDateOrNull(row.completedAt), row.isArchived, toDateOrNull(row.updatedAt), row.payload],
      );
    }
    for (const row of rows.events) {
      await client.query(
        "INSERT INTO events (id, project_id, user_id, type, entity_type, entity_id, created_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [row.id, row.projectId, row.userId, row.type, row.entityType, row.entityId, toDateOrNull(row.createdAt), row.payload],
      );
    }
    for (const row of rows.records) {
      await client.query(
        "INSERT INTO records (collection, id, project_id, user_id, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6)",
        [row.collection, row.id, row.projectId, row.userId, toDateOrNull(row.updatedAt), row.payload],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function readSqliteNormalizedDb(sqlite, createDefaultDb) {
  if (!hasSqliteNormalizedRows(sqlite)) return null;
  return buildDbFromNormalizedRows(createDefaultDb, {
    projects: sqlite.prepare("SELECT id, title, owner_id, is_deleted, updated_at, payload FROM projects").all(),
    nodes: sqlite.prepare("SELECT id, project_id, parent_id, type, title, order_index, is_deleted, updated_at, payload FROM nodes").all(),
    blocks: sqlite.prepare("SELECT id, project_id, page_id, type, order_index, updated_at, payload FROM blocks").all(),
    tasks: sqlite.prepare("SELECT id, project_id, page_id, column_id, assignee_id, title, deadline_at, completed_at, is_archived, updated_at, payload FROM tasks").all(),
    events: sqlite.prepare("SELECT id, project_id, user_id, type, entity_type, entity_id, created_at, payload FROM events").all(),
    records: sqlite.prepare("SELECT collection, id, project_id, user_id, updated_at, payload FROM records").all(),
  });
}

async function readPostgresNormalizedDb(pool, createDefaultDb) {
  if (!(await hasPostgresNormalizedRows(pool))) return null;
  const [projects, nodes, blocks, tasks, events, records] = await Promise.all([
    pool.query("SELECT id, title, owner_id, is_deleted, updated_at, payload FROM projects"),
    pool.query("SELECT id, project_id, parent_id, type, title, order_index, is_deleted, updated_at, payload FROM nodes"),
    pool.query("SELECT id, project_id, page_id, type, order_index, updated_at, payload FROM blocks"),
    pool.query("SELECT id, project_id, page_id, column_id, assignee_id, title, deadline_at, completed_at, is_archived, updated_at, payload FROM tasks"),
    pool.query("SELECT id, project_id, user_id, type, entity_type, entity_id, created_at, payload FROM events"),
    pool.query("SELECT collection, id, project_id, user_id, updated_at, payload FROM records"),
  ]);
  return buildDbFromNormalizedRows(createDefaultDb, {
    projects: projects.rows,
    nodes: nodes.rows,
    blocks: blocks.rows,
    tasks: tasks.rows,
    events: events.rows,
    records: records.rows,
  });
}

async function hasPostgresNormalizedRows(pool) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM projects) +
      (SELECT COUNT(*) FROM nodes) +
      (SELECT COUNT(*) FROM blocks) +
      (SELECT COUNT(*) FROM tasks) +
      (SELECT COUNT(*) FROM events) +
      (SELECT COUNT(*) FROM records) AS count
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

function buildDbFromNormalizedRows(createDefaultDb, rows) {
  const db = createDefaultDb();
  const projects = rows.projects.map((row) => payloadFromRow(row, {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    isDeleted: Boolean(row.is_deleted),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  }));
  const nodes = rows.nodes.map((row) => payloadFromRow(row, {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    type: row.type,
    title: row.title,
    order: Number(row.order_index) || 0,
    isDeleted: Boolean(row.is_deleted),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  }));
  const blocks = rows.blocks.map((row) => payloadFromRow(row, {
    id: row.id,
    projectId: row.project_id,
    pageId: row.page_id,
    type: row.type,
    order: Number(row.order_index) || 0,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  }));
  const tasks = rows.tasks.map((row) => payloadFromRow(row, {
    id: row.id,
    projectId: row.project_id,
    pageId: row.page_id,
    columnId: row.column_id,
    assigneeId: row.assignee_id,
    title: row.title,
    deadlineAt: row.deadline_at ? String(row.deadline_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    isArchived: Boolean(row.is_archived),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  }));

  const spaceMetaByProjectId = new Map();
  for (const row of rows.records) {
    const collection = String(row.collection ?? "");
    const value = payloadFromRow(row, { id: row.id, projectId: row.project_id, userId: row.user_id });
    if (collection === "spaces_meta") {
      spaceMetaByProjectId.set(String(row.id), value);
      continue;
    }
    if (!Array.isArray(db[collection])) db[collection] = [];
    db[collection].push(value);
  }

  db.projects = projects;
  db.tasks = tasks;
  db.blocks = blocks;
  db.spaces = {};

  const projectIds = new Set([
    ...projects.map((project) => String(project.id)),
    ...nodes.map((node) => String(node.projectId)),
    ...blocks.map((block) => String(block.projectId)),
    ...spaceMetaByProjectId.keys(),
  ]);

  for (const projectId of projectIds) {
    const meta = spaceMetaByProjectId.get(projectId) ?? {};
    db.spaces[projectId] = {
      nodes: nodes
        .filter((node) => String(node.projectId) === projectId)
        .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0)),
      blocks: blocks
        .filter((block) => String(block.projectId) === projectId)
        .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
        .map((block) => {
          const { projectId: _projectId, ...spaceBlock } = block;
          return spaceBlock;
        }),
      collapsedIds: Array.isArray(meta.collapsedIds) ? meta.collapsedIds : [],
      recentPages: Array.isArray(meta.recentPages) ? meta.recentPages : [],
      dailyNotes: meta.dailyNotes ?? {},
    };
  }

  db.activity = [];
  db.securityEvents = [];
  db.notifications = [];
  db.calendarEvents = [];
  db.reminders = [];

  for (const row of rows.events) {
    const event = payloadFromRow(row, {
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      type: row.type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at ? String(row.created_at) : undefined,
    });
    const rowId = String(row.id ?? event.id ?? "");
    if (rowId.startsWith("activity:")) db.activity.push(restoreEventId(event, rowId, "activity"));
    else if (rowId.startsWith("security:")) db.securityEvents.push(restoreEventId(event, rowId, "security"));
    else if (rowId.startsWith("notification:")) db.notifications.push(restoreEventId(event, rowId, "notification"));
    else if (rowId.startsWith("calendar:")) db.calendarEvents.push(restoreEventId(event, rowId, "calendar"));
    else if (rowId.startsWith("reminder:")) db.reminders.push(restoreEventId(event, rowId, "reminder"));
  }

  return db;
}

function payloadFromRow(row, fallback = {}) {
  const payload = parseStoredPayload(row.payload);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...fallback, ...payload }
    : fallback;
}

function parseStoredPayload(payload) {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(String(payload));
  } catch {
    return null;
  }
}

function restoreEventId(event, rowId, prefix) {
  const restored = { ...event };
  const id = String(restored.id ?? "");
  if (!id || id.startsWith(`${prefix}:`)) {
    restored.id = rowId.slice(prefix.length + 1);
  }
  return restored;
}

function createNormalizedRows(db) {
  const nodes = flattenNodes(db);
  const blocks = flattenBlocks(db, nodes);
  return {
    projects: (db.projects ?? []).map((project) => ({
      id: asString(project.id),
      title: String(project.title ?? ""),
      ownerId: nullableString(project.ownerId),
      isDeleted: Boolean(project.isDeleted),
      updatedAt: nullableString(project.updatedAt ?? project.createdAt),
      payload: JSON.stringify(project),
    })),
    nodes: nodes.map((node) => ({
      id: asString(node.id),
      projectId: asString(node.projectId),
      parentId: nullableString(node.parentId),
      type: String(node.type ?? "page"),
      title: String(node.title ?? ""),
      order: Number.isFinite(Number(node.order)) ? Number(node.order) : 0,
      isDeleted: Boolean(node.isDeleted),
      updatedAt: nullableString(node.updatedAt ?? node.createdAt),
      payload: JSON.stringify(node),
    })),
    blocks: blocks.map((block) => ({
      id: asString(block.id),
      projectId: asString(block.projectId),
      pageId: asString(block.pageId),
      type: String(block.type ?? "paragraph"),
      order: Number.isFinite(Number(block.order)) ? Number(block.order) : 0,
      updatedAt: nullableString(block.updatedAt ?? block.createdAt),
      payload: JSON.stringify(block),
    })),
    tasks: (db.tasks ?? []).map((task) => ({
      id: asString(task.id),
      projectId: asString(task.projectId),
      pageId: nullableString(task.pageId),
      columnId: nullableString(task.columnId),
      assigneeId: nullableString(task.assigneeId),
      title: String(task.title ?? ""),
      deadlineAt: nullableString(task.deadlineAt),
      completedAt: nullableString(task.completedAt ?? task.archivedAt),
      isArchived: Boolean(task.isArchived),
      updatedAt: nullableString(task.updatedAt ?? task.createdAt),
      payload: JSON.stringify(task),
    })),
    events: flattenEvents(db).map((event) => ({
      id: asString(event.id),
      projectId: nullableString(event.projectId),
      userId: nullableString(event.userId),
      type: String(event.type ?? event.source ?? "event"),
      entityType: nullableString(event.entityType),
      entityId: nullableString(event.entityId ?? event.sourceId),
      createdAt: nullableString(event.createdAt ?? event.sendAt ?? event.startsAt),
      payload: JSON.stringify(event),
    })),
    records: createNormalizedRecords(db),
  };
}

function createNormalizedRecords(db) {
  const collections = ["users", "columns", "subtasks", "templates", "joinRequests", "sessions", "authCodes", "outbox"];
  const records = [];

  for (const collection of collections) {
    const values = Array.isArray(db[collection]) ? db[collection] : [];
    for (const [index, item] of values.entries()) {
      const id = asString(item?.id ?? `${collection}_${index}`);
      records.push({
        collection,
        id,
        projectId: nullableString(item?.projectId),
        userId: nullableString(item?.userId ?? item?.assigneeId ?? item?.creatorId),
        updatedAt: nullableString(item?.updatedAt ?? item?.createdAt ?? item?.expiresAt),
        payload: JSON.stringify(item),
      });
    }
  }

  for (const [projectId, space] of Object.entries(db.spaces ?? {})) {
    records.push({
      collection: "spaces_meta",
      id: asString(projectId),
      projectId: asString(projectId),
      userId: null,
      updatedAt: nullableString(space?.updatedAt),
      payload: JSON.stringify({
        collapsedIds: Array.isArray(space?.collapsedIds) ? space.collapsedIds : [],
        recentPages: Array.isArray(space?.recentPages) ? space.recentPages : [],
        dailyNotes: space?.dailyNotes ?? {},
      }),
    });
  }

  return records;
}

function flattenNodes(db) {
  return Object.values(db.spaces ?? {}).flatMap((space) => Array.isArray(space.nodes) ? space.nodes : []);
}

function flattenBlocks(db, nodes) {
  const nodeProjectByPageId = new Map(nodes.map((node) => [String(node.id), String(node.projectId)]));
  const byId = new Map();
  for (const block of db.blocks ?? []) {
    const projectId = block.projectId ?? nodeProjectByPageId.get(String(block.pageId));
    if (block.id && projectId && block.pageId) byId.set(String(block.id), { ...block, projectId });
  }
  for (const space of Object.values(db.spaces ?? {})) {
    for (const block of space.blocks ?? []) {
      const projectId = block.projectId ?? nodeProjectByPageId.get(String(block.pageId));
      if (block.id && projectId && block.pageId) byId.set(String(block.id), { ...block, projectId });
    }
  }
  return [...byId.values()];
}

function flattenEvents(db) {
  return [
    ...(db.activity ?? []).map((item) => ({ ...item, id: item.id ? `activity:${item.id}` : `activity:${item.createdAt}:${item.entityId}` })),
    ...(db.securityEvents ?? []).map((item) => ({ ...item, id: item.id ? `security:${item.id}` : `security:${item.createdAt}:${item.type}`, entityType: "security_event", entityId: item.id })),
    ...(db.notifications ?? []).map((item) => ({ ...item, id: item.id ? `notification:${item.id}` : `notification:${item.sendAt}:${item.entityId}` })),
    ...(db.calendarEvents ?? []).map((item) => ({ ...item, id: item.id ? `calendar:${item.id}` : `calendar:${item.startsAt}:${item.title}`, type: item.type ?? "calendar_event", entityType: "calendar_event", entityId: item.id })),
    ...(db.reminders ?? []).map((item) => ({ ...item, id: item.id ? `reminder:${item.id}` : `reminder:${item.nextRunAt}:${item.title}`, type: "reminder", entityType: "reminder", entityId: item.id, createdAt: item.createdAt ?? item.nextRunAt })),
  ];
}

function asString(value) {
  return String(value ?? "");
}

function nullableString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
