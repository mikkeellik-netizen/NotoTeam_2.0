# Telegram Workspace API

Small backend data gateway for the Mini App and Telegram bot.

## Calendar notifications

The API process includes a calendar notification worker. When an event has an enabled notification, the worker sends it to the event owner through the configured Telegram bot. Temporary Telegram errors are retried and the delivery status is stored with the event.

Set `BOT_TOKEN` (or `TELEGRAM_BOT_TOKEN`) to the token from BotFather. Set `TELEGRAM_WEB_APP_URL` to the public HTTPS address of NotoTime to add an **Open calendar** button to the message. A user must have started the bot at least once before Telegram allows the bot to send messages.

Run only one API replica while using the built-in worker. Multiple replicas require a distributed job lock to prevent duplicate deliveries.

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

## Project file storage

Uploaded project files use a storage adapter and are not kept inside the database. The default remains local storage:

```env
FILE_STORAGE=local
APP_DATA_DIR=/data
```

Local objects are stored under `APP_DATA_DIR/project-files`. To use a private S3-compatible service (AWS S3, Cloudflare R2, Selectel, Yandex Object Storage, or MinIO), configure:

```env
FILE_STORAGE=s3
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=private-project-files
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=replace-with-storage-access-key
S3_SECRET_ACCESS_KEY=replace-with-storage-secret-key
S3_PREFIX=project-files
S3_FORCE_PATH_STYLE=false
```

Keep the bucket private. Files continue to be downloaded through this API, so existing frontend URLs and project permission checks do not change. `S3_ENDPOINT` may be omitted for AWS S3. MinIO commonly requires `S3_FORCE_PATH_STYLE=true`.

To copy existing local files before switching `FILE_STORAGE` to `s3`, fill in the S3 variables while leaving the application stopped, then run:

```bash
npm run migrate:files-to-s3
```

The command is repeatable and skips objects already present in S3. It keeps local files as a rollback copy. After verification, they can be removed during migration with:

```bash
npm run migrate:files-to-s3 -- --delete-local
```

Recommended transition order:

1. Stop the backend to prevent uploads during migration.
2. Back up `APP_DATA_DIR`.
3. Configure all `S3_*` variables, but keep `FILE_STORAGE=local`.
4. Run `npm run migrate:files-to-s3`.
5. Set `FILE_STORAGE=s3` and restart the backend.
6. Upload and download a test file before deleting the local rollback copy.

## Purpose

- Keep users, projects, columns, tasks, blocks, bot settings, and notifications outside frontend code.
- Let the Telegram bot and Mini App read/write the same data.
- Provide a migration path from localStorage/JSON to SQLite and then PostgreSQL if needed.

## Important

This backend is still local/prototype-grade. For production, add real Telegram `initData` auth checks, request validation, and either normalize the SQLite schema or move the repository to PostgreSQL.
