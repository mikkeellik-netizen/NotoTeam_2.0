# Bot settings API contracts

These endpoints should be implemented in the real backend and used by the Mini App admin menu.

## GET /projects/:projectId/bot-settings

Returns `ProjectBotSettings`.

## PATCH /projects/:projectId/bot-settings

Updates bot settings.

Only project owner/admin can call it.

Body example:

```json
{
  "taskDeadlineNotificationsEnabled": true,
  "kanbanReminderTone": "soft",
  "kanbanReminderPoints": [
    { "id": "on_assign", "enabled": true, "kind": "on_assign", "label": "Новая задача" },
    { "id": "before_15h", "enabled": true, "kind": "before_deadline", "offsetMinutes": 900, "label": "За 15 часов" },
    { "id": "before_2h", "enabled": true, "kind": "before_deadline", "offsetMinutes": 120, "label": "За 2 часа" },
    { "id": "at_deadline", "enabled": true, "kind": "at_deadline", "label": "В момент дедлайна" }
  ],
  "reports": {
    "weekly": {
      "enabled": true,
      "weekdays": [2],
      "time": "19:00",
      "sections": {
        "createdTasks": true,
        "completedTasks": true,
        "overdueTasks": true,
        "approachingDeadlines": true,
        "inactiveUsers": true,
        "userActivity": true,
        "kanbanMovement": true,
        "mentions": true,
        "recommendations": true
      }
    },
    "overdue": {
      "enabled": true,
      "weekdays": [4],
      "time": "20:00"
    }
  }
}
```

After changing reminder settings, backend should recalculate only pending future `NotificationEvent` rows.
