# Telegram Workspace Bot

Backend bot module for the Telegram Mini App.

The bot is intentionally separated from the frontend. A Telegram bot cannot read frontend `localStorage` or send messages from the browser. It must run on a server and use shared backend data.

## Features

- `/start` with Mini App button.
- `Мои задачи` command/button.
- `/new` task creation from free text.
- Task assignment notifications.
- Deadline reminders:
  - when task is assigned;
  - 15 hours before deadline;
  - 2 hours before deadline;
  - at deadline time.
- Mention notifications for `@username`.
- Duty schedule reminders from table-like blocks.
- Weekly admin report.
- Two-week overdue report.
- Configurable bot settings per project.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

## Integration point

The bot uses the `WorkspaceRepository` port from `src/ports.ts`.

For production, replace `InMemoryWorkspaceRepository` with an adapter that talks to the real backend API or database.

For the local MVP backend in this repository, set:

```text
WORKSPACE_API_URL=http://127.0.0.1:8787
```

Then the bot will use `HttpWorkspaceRepository` and share data with `backend-api`.
