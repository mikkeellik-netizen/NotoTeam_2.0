# Telegram Workspace API

Small backend data gateway for the Mini App and Telegram bot.

The backend uses a repository layer, so app logic does not depend on a concrete storage format. The current default storage is SQLite.

## Data storage

User data is stored outside application code:

```text
../app-data/database/app.db
../app-data/database/app.json
../app-data/database/migrations
../app-data/backups/database
```

You can override the location:

```bash
APP_DATA_DIR=C:\workspace-data npm run dev
```

On first SQLite start, the backend imports `app-data/database/app.json` into `app-data/database/app.db` and creates a backup in `app-data/backups/database`. The JSON file is not deleted, but it is no longer the primary working database after SQLite is initialized.

Emergency JSON fallback:

```bash
WORKSPACE_STORAGE=json npm run dev
```

Default storage:

```bash
WORKSPACE_STORAGE=sqlite npm run dev
```

## Run

```bash
npm run dev
```

Default URL:

```text
http://127.0.0.1:8787
```

## Purpose

- Keep users, projects, columns, tasks, blocks, bot settings, and notifications outside frontend code.
- Let the Telegram bot and Mini App read/write the same data.
- Provide a migration path from localStorage/JSON to SQLite and then PostgreSQL if needed.

## Important

This backend is still local/prototype-grade. For production, add real Telegram `initData` auth checks, request validation, and either normalize the SQLite schema or move the repository to PostgreSQL.
