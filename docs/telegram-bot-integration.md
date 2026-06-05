# Telegram Bot integration

## Goal

Connect the Telegram Mini App with a real Telegram bot through a backend service and shared database.

The bot must not read data from frontend localStorage. Tasks, pages, tables, users, mentions, and notification events must live in backend storage so both the Mini App and bot see the same state.

## Required architecture

```text
Telegram Bot
  <-> Backend API
  <-> Database
  <-> Telegram Mini App
```

## Core bot commands

### /start

- Link Telegram user by `telegramId`.
- Show a button to open the Mini App.
- Show quick buttons:
  - `📋 Мои задачи`
  - `➕ Создать задачу`
  - `⚙ Настройки уведомлений`

### 📋 Мои задачи

The user receives active assigned tasks grouped by urgency:

- `🔴 Просрочены или осталось < 12 часов`
- `🟡 12–48 часов`
- `🟢 Больше 48 часов`

Rules:

- Only tasks assigned to the current Telegram user are shown.
- Archived tasks are hidden.
- Tasks in the final Kanban column are treated as completed and hidden from active lists.
- Tasks are sorted by urgency and then by deadline.
- Deadlines are displayed in Moscow time.

At the end of the response, the bot adds a 7-day progress summary:

- tasks with deadlines during the last 7 days;
- how many were completed;
- completion percentage;
- 10-level emoji bar chart.

Example:

```text
📊 Прогресс за 7 дней
Завершено: 6 из 10
🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ 60%
```

### /new

- Create a task from free text.
- Parse title, assignee, priority, and deadline locally.
- Ask for confirmation before creating the task.
- After creation, notify the assignee if the assignee is not the creator.

## Performer notifications

The bot automatically sends soft, motivating notifications to the responsible user at four points:

1. When a new task is assigned.
2. 15 hours before the deadline.
3. 2 hours before the deadline.
4. At the deadline moment.

Notification content:

- task title;
- description if present;
- deadline in Moscow time;
- project name;
- button to open the task in the Mini App.

Tone:

- calm;
- encouraging;
- no blame;
- short enough for Telegram.

Example:

```text
✨ Новая задача для тебя

Подготовить презентацию
Описание: собрать материалы и оформить 5 слайдов
Дедлайн: 26.05.2026, 19:00 МСК

Можно спокойно начать с первого маленького шага.
```

## Mention notifications

The bot sends a notification when a user is mentioned by Telegram username in:

- page text;
- folder/page content;
- Kanban task title;
- Kanban task description;
- subtasks;
- duty schedule tables;
- comments or future discussion blocks.

Mention detection:

- mentions use `@username`;
- matching must be case-insensitive;
- one event should not send duplicate notifications for the same user and same entity update.

## Duty schedule notifications

For duty schedule tables, the bot reads:

- responsible Telegram username;
- duty date;
- reminder settings.

Default reminders:

- 4 days before duty date at 12:00 MSK;
- 1 day before duty date at 12:00 MSK.

The reminders should be configurable per row later.

## Admin reports

Admin reports are optional and can be enabled or disabled per project.

### Weekly admin report

Schedule:

- Tuesday, 19:00 MSK.

Report period:

- last 7 days.

Report includes:

- all completed tasks;
- completion distribution by day;
- stats per assignee;
- percentage completed early;
- percentage completed on time;
- percentage completed late.

### Systematic overdue report

Schedule:

- every 2 weeks;
- Thursday, 20:00 MSK.

Report period:

- last 14 days.

Report includes:

- users with at least 3 overdue tasks;
- overdue task count per user;
- short recommendation for admin action.

## Mini App admin bot settings

The bot is configured from the Mini App project admin menu. These settings are available only to:

- project owner;
- project admins with bot/settings permission.

Recommended admin menu section:

```text
Администратор
  -> Настройки бота
```

### Auto reports

The admin can enable or disable:

- weekly report;
- two-week overdue report.

Each report has its own schedule and content settings.

Weekly report settings:

- enabled/disabled;
- recipients: owner, admins, selected users;
- day of week;
- time in Moscow time;
- sections included:
  - created tasks;
  - completed tasks;
  - overdue tasks;
  - approaching deadlines;
  - inactive users;
  - user activity;
  - Kanban movement summary;
  - mentions summary.

Two-week overdue report settings:

- enabled/disabled;
- recipients: owner, admins, selected users;
- day of week;
- time in Moscow time;
- overdue threshold, for example `3+ overdue tasks`;
- sections included:
  - users with repeated overdue tasks;
  - overdue task list;
  - task owners;
  - deadlines;
  - recommended admin action.

### Kanban notifications

The admin can configure the default Kanban notifications for assigned users.

Default notification points:

- when a new task is assigned;
- 15 hours before deadline;
- 2 hours before deadline;
- at the deadline moment.

Settings:

- enable/disable all Kanban task notifications;
- enable/disable each notification point separately;
- change offsets before deadline, for example `24h`, `15h`, `2h`, `30m`;
- add extra reminder points;
- remove reminder points;
- choose whether overdue reminders continue after the deadline;
- choose notification tone:
  - soft;
  - neutral;
  - strict;
  - pastoral/team-care.

The UI should show these reminders as compact rows:

```text
✓ Новая задача
✓ За 15 часов
✓ За 2 часа
✓ В момент дедлайна
+ Добавить напоминание
```

### Report content and schedule

Reports should be configurable without editing code.

The admin can choose:

- what is included in reports;
- which weekdays reports are sent;
- report time;
- timezone, default `Europe/Moscow`;
- recipients;
- whether reports are sent only if there are changes;
- whether empty reports are skipped;
- whether urgent reports are sent immediately.

### Safety rules

- Changing settings must not delete already created tasks or notifications.
- If a reminder time is changed, only pending future notifications are recalculated.
- Already sent notifications stay in history.
- Settings are stored per project.
- Users can mute personal bot notifications later, but admin-critical notifications remain visible inside the Mini App.

## Data model additions

Recommended backend entities:

```ts
NotificationEvent = {
  id: string;
  projectId: string;
  userId: string;
  type:
    | "task_assigned"
    | "task_deadline_15h"
    | "task_deadline_2h"
    | "task_deadline_now"
    | "mention"
    | "duty_reminder"
    | "admin_weekly_report"
    | "admin_overdue_report";
  entityType: "task" | "page" | "block" | "table" | "duty" | "project";
  entityId: string;
  sendAt: string;
  sentAt?: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  payload: Record<string, unknown>;
};
```

```ts
ProjectBotSettings = {
  projectId: string;
  weeklyAdminReportEnabled: boolean;
  overdueAdminReportEnabled: boolean;
  taskDeadlineNotificationsEnabled: boolean;
  mentionNotificationsEnabled: boolean;
  dutyNotificationsEnabled: boolean;
  timezone: "Europe/Moscow";
  kanbanReminderTone: "soft" | "neutral" | "strict" | "pastoral";
  kanbanReminderPoints: Array<{
    id: string;
    enabled: boolean;
    kind: "on_assign" | "before_deadline" | "at_deadline" | "after_deadline";
    offsetMinutes?: number;
    label: string;
  }>;
  reports: {
    weekly: BotReportSettings;
    overdue: BotReportSettings;
  };
};

BotReportSettings = {
  enabled: boolean;
  recipientUserIds: string[];
  weekdays: number[];
  time: string;
  skipEmpty: boolean;
  sendOnlyIfChanged: boolean;
  sections: {
    createdTasks: boolean;
    completedTasks: boolean;
    overdueTasks: boolean;
    approachingDeadlines: boolean;
    inactiveUsers: boolean;
    userActivity: boolean;
    kanbanMovement: boolean;
    mentions: boolean;
    recommendations: boolean;
  };
};
```

## Implementation order

1. Add backend database and API.
2. Move users, projects, pages, blocks, Kanban tasks, subtasks, and tables from localStorage to backend storage.
3. Add Telegram auth through Mini App `initData`.
4. Add Bot service with `/start`, `/my`, `/new`.
5. Add notification scheduler and `NotificationEvent`.
6. Add task assignment notifications.
7. Add deadline notifications: 15h, 2h, deadline moment.
8. Add mention scanning.
9. Add duty schedule reminders.
10. Add admin reports and settings toggles.
11. Add Mini App admin screen for bot settings.
12. Recalculate pending future notifications when bot settings are changed.
