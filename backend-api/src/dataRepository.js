import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDataRepository({ createDefaultDb }) {
  const storage = (process.env.WORKSPACE_STORAGE ?? "sqlite").trim().toLowerCase();
  if (storage === "json") return createJsonDataRepository({ createDefaultDb });
  return createSqliteDataRepository({ createDefaultDb });
}

export function createJsonDataRepository({ createDefaultDb }) {
  const appDataDir = path.resolve(process.env.APP_DATA_DIR ?? path.join(__dirname, "../../app-data"));
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
  const appDataDir = path.resolve(process.env.APP_DATA_DIR ?? path.join(__dirname, "../../app-data"));
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
      const row = sqlite.prepare("SELECT value FROM app_state WHERE id = ?").get("workspace");
      return row?.value ? JSON.parse(row.value) : createDefaultDb();
    },

    async write(db) {
      await ensureDb();
      const payload = JSON.stringify(db, null, 2);
      sqlite
        .prepare("INSERT INTO app_state (id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run("workspace", payload, new Date().toISOString());
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

    const hasState = sqlite.prepare("SELECT 1 FROM app_state WHERE id = ?").get("workspace");
    if (!hasState) {
      const initialDb = await readInitialDb();
      sqlite
        .prepare("INSERT INTO app_state (id, value, updated_at) VALUES (?, ?, ?)")
        .run("workspace", JSON.stringify(initialDb, null, 2), new Date().toISOString());
      sqlite
        .prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run("0001_sqlite_app_state", new Date().toISOString());
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
