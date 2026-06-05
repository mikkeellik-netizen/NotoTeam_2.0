# Backend + Telegram Bot runbook

## Local architecture

```text
Mini App frontend
  -> backend-api
  -> JSON data file
  <- backend-bot
  <- Telegram
```

## 1. Start backend API

```bash
cd backend-api
npm run dev
```

Default URL:

```text
http://127.0.0.1:8787
```

Health check:

```text
GET http://127.0.0.1:8787/health
```

## 2. Start Telegram bot

Create `backend-bot/.env`:

```text
BOT_TOKEN=token-from-botfather
WEBAPP_URL=http://127.0.0.1:5174
WORKSPACE_API_URL=http://127.0.0.1:8787
BOT_MODE=polling
BOT_TIMEZONE=Europe/Moscow
```

Then:

```bash
cd backend-bot
npm run dev
```

## 3. Start Mini App frontend

To make frontend use shared backend data, create `frontend/.env`:

```text
VITE_WORKSPACE_API_URL=http://127.0.0.1:8787
```

Without this variable, the frontend keeps using the old localStorage mock mode.

```bash
cd frontend
npm run dev
```

## Current status

The bot can already use `backend-api` through `HttpWorkspaceRepository`.

The frontend now has a backend mode controlled by `VITE_WORKSPACE_API_URL`.

Migrated first:

- projects;
- columns;
- tasks;
- subtasks;
- archive operations;
- member basics.
- pages and blocks project space;
- activity write mirror;
- bot settings API and admin-panel controls.

Still to migrate later:

1. full activity/history reads from backend;
2. inbox notifications;
3. Telegram `initData` auth;
4. durable production database and migrations.

## Production migration

Replace JSON-file storage in `backend-api` with PostgreSQL/Prisma. Keep the same API contracts so frontend and bot do not need another rewrite.
