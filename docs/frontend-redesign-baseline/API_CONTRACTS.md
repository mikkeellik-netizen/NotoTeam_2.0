# Контракты данных для редизайна frontend

Дата фиксации: 2026-09-19.

Этот документ задаёт границу этапа 1 редизайна. Визуальные компоненты можно менять, но перечисленные маршруты, связи и обязательные поля должны оставаться совместимыми. Данные проектов не мигрируются и не копируются ради нового интерфейса.

## Правила совместимости

- Backend остаётся единственным источником проектов, страниц, блоков, задач, календарей, файлов и настроек.
- Новые необязательные поля можно добавлять без изменения версии API.
- Удаление поля, переименование, смена типа или значения enum считается несовместимым изменением.
- Идентификаторы могут приходить как `string` или `number`; frontend нормализует их при сравнении.
- Даты передаются строкой ISO 8601, денежные и числовые значения остаются числами.
- Коллекции всегда возвращаются массивами, даже когда они пусты.
- Ошибки возвращаются с HTTP-статусом и JSON-полем `error`.
- Права доступа проверяются на backend. Скрытие элемента в интерфейсе не является защитой.
- Секретные поля не должны попадать в обычные клиентские ответы.

## Уровни доступа

| Контекст | Авторизация | Назначение |
| --- | --- | --- |
| Пользователь | `Authorization: Bearer <session>` или Telegram Mini App init data | Web/Mini App |
| Telegram-бот | внутренний токен сервиса | доставка кодов, уведомлений и напоминаний |
| AI Connector | отдельный MCP/AI токен проекта | только разрешённые разделы проекта |
| Владелец продукта | пользовательская сессия + Telegram ID из allowlist | `/system/*` |

Обычный клиент не получает `telegramId` другого пользователя, приватные заметки администратора, invite code, bot settings или реальные названия проектов в системной статистике. Полные данные доступны только там, где это явно требуется доверенному сервису.

## Стабильные предметные контракты

### Пользователи и проекты

- `User`: `id`, а в собственном/доверенном контексте также `telegramId`; `username`, имя и аватар могут отсутствовать.
- `Project`: `id`, `ownerId`, `title`, `isArchived`, `createdAt`, `members`, `columns`; `aiToneStyle` остаётся необязательной настройкой.
- `ProjectMember`: `id`, `projectId`, `userId`, `user`, `role`.
- `RolePermissions` определяет доступ к задачам, workspace, календарю, напоминаниям, боту, аналитике и экспорту.

Основные маршруты: `/auth/*`, `/users/:id`, `/users/:id/projects`, `/projects`, `/projects/:id`, `/projects/:id/members`, `/projects/:id/responsibility-areas`.

### Workspace, страницы и файлы

- `PageNode`: `id`, `projectId`, `parentId`, `type`, `title`, `icon`, `order`, `createdAt`, `updatedAt`.
- Тип узла: `page | folder | kanban`.
- `Block`: `id`, `pageId`, `type`, `content`, `order`, `createdAt`, `updatedAt`.
- `ProjectFileRecord`: `id`, `projectId`, `uploaderUserId`, имя, MIME-тип, категория, размер и даты.

Основные маршруты: `/projects/:id/space/meta`, `/space/tree`, `/space/nodes`, `/space/pages/:pageId/blocks`, `/space/blocks/:blockId`, `/projects/:id/files`.

Полный legacy-маршрут `/projects/:id/space` не используется обычным frontend. Новый интерфейс должен продолжать ленивую загрузку дерева, узлов и блоков.

### Задачи и Kanban

- `Column`: `id`, `projectId`, `title`, `position`, `isDefault`, `isArchive`, `isHidden`.
- `Task`: `id`, `projectId`, `columnId`, `title`, `priority`, `isRepeating`, `position`, `isArchived`, `createdAt`.
- Крайний правый столбец означает завершение; при изменении порядка столбцов backend пересчитывает `completedAt`.
- Архивная задача не входит в активные задачи, дедлайны календаря и активную статистику пользователя.

Основные маршруты: `/projects/:id/columns`, `/projects/:id/tasks`, `/tasks`, `/tasks/:id`, `/tasks/:id/move`, `/tasks/:id/archive`, `/users/:id/assigned-tasks`, `/users/:id/task-progress`.

### Календари и напоминания

- `Calendar`: `id`, `type`, `name`, `color`, `categories`, `permissions`, `createdAt`, `updatedAt`.
- Тип календаря: `PERSONAL | PROJECT`.
- `CalendarEvent`: `id`, `calendarId`, владелец и автор, название, начало, `allDay`, тип, цвет, visibility, участники, notification и даты.
- `Reminder`: `id`, `projectId`, создатель, получатель, source type, название, schedule type, статус, channels и даты.
- Внешний календарь доступен только на чтение и хранит связь с локальным календарём.

Основные маршруты: `/me/calendars`, `/me/calendar-events`, `/me/task-deadlines`, `/projects/:id/calendar`, `/projects/:id/calendar-events`, `/calendars/:id/categories`, `/projects/:id/reminders`, `/external-calendar-connections`.

### Администрирование и AI Connector

- Системная панель получает агрегаты через `/system/stats` и `/system/security-events` без раскрытия названий чужих проектов.
- AI Connector получает полный контекст через `/projects/:id/ai-context` и изменения через `/projects/:id/ai-context/changes?since=...`.
- Access policy токена ограничивает scope, разделы, workspace nodes, архив и максимальное количество задач/блоков.
- Контекст изменений содержит `projectId`, массивы новых, изменённых и завершённых задач, страниц и activity с `since` и `generatedAt`.

## Контракт пагинации

Пагинированный ответ содержит:

```json
{
  "itemsKey": [],
  "total": 0,
  "offset": 0,
  "limit": 50,
  "hasMore": false
}
```

`itemsKey` зависит от маршрута: например, `tasks`, `events` или `notifications`.

## Контракт навигации

Редизайн обязан сохранить прямое открытие следующих групп URL:

- `/`, `/today`, `/my-tasks`, `/my-calendar`, `/settings`, `/system-admin`;
- `/project/:projectId/workspace` и `/project/:projectId/workspace/page/:pageId`;
- `/project/:projectId/inbox`, `/notifications`, `/reminders`, `/calendar`, `/members`, `/settings`, `/archive`;
- `/board/:projectId` для старых ссылок и переходов из уведомлений.

Возврат из задачи или связанной страницы должен продолжать использовать query-параметры навигационного контекста, а не создавать дубликат сущности.

## Автоматическая проверка

`npm run test:contracts` в `backend-api` запускает API в изолированной временной директории, создаёт тестовые сущности и проверяет обязательные поля реальных ответов. Проверка допускает новые поля, но падает при удалении или смене типа обязательного поля.

Frontend дополнительно проходит TypeScript/Vite production build. Эти две проверки являются обязательным gate перед каждым этапом редизайна.
