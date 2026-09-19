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
- Local Telegram voice recognition through the bundled `speech-recognition` service.
- Voice creation of tasks, Inbox notes, reminders and immediate notifications.

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
WEBAPP_URL=https://app.example.com
```

Then the bot will use `HttpWorkspaceRepository` and share data with `backend-api`.
`WEBAPP_URL` must point to the public HTTPS root of the frontend. Project buttons open this root first and then navigate inside the Mini App, so they also work behind an SPA reverse proxy.

## Voice recognition

For production, use the root `docker-compose.yml`. It starts a private Faster Whisper
service and sets `SPEECH_TO_TEXT_URL` automatically. Audio is downloaded into a temporary
directory, sent to the local service and deleted in a `finally` block after recognition.
Only the transcript and the resulting workspace entity are retained.

Before sending voice commands, select the default project and kanban board with `/switch`.
Examples:

- `Создай задачу подготовить отчёт до 20.09.2026 18:00`;
- `Запиши заметку: обсудить новый формат встречи`;
- `Напомни позвонить Ивану 20.09.2026 10:00`;
- `Уведоми @username о переносе планёрки`.

The following limits protect a shared server: `VOICE_MAX_DURATION_SECONDS`,
`VOICE_MAX_FILE_BYTES`, `VOICE_RATE_WINDOW_MS`, `VOICE_RATE_MAX` and
`VOICE_MAX_CONCURRENT`.
