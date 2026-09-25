# NotoTeam

NotoTeam — приложение для совместной работы с проектами, задачами, канбан-досками, страницами, файлами, календарями, Telegram-ботом и AI Connector.

## Состав проекта

- `frontend` — React/Vite-интерфейс;
- `backend-api` — API, авторизация и хранение данных;
- `backend-bot` — Telegram-бот и уведомления;
- `speech-recognition` — локальное распознавание голосовых;
- `ai-connector-mcp` — MCP-доступ к разрешённым данным проекта;
- `deploy` — серверная конфигурация;
- `docker-compose.yml` — production-контейнеры.

## Документация

- [Развёртывание](./DEPLOYMENT.md)
- [Работа через GitHub, ветки и откат](./docs/GITHUB_WORKFLOW.md)
- [Конфликт портов 80/443](./deploy/PORTS_AND_REVERSE_PROXY.md)
- [Каталог сообщений бота](./BOT_MESSAGES_CATALOG.md)
- [Baseline редизайна](./docs/frontend-redesign-baseline/README.md)

## Локальная разработка

Установить зависимости:

```bash
npm --prefix backend-api ci
npm --prefix frontend ci
npm --prefix backend-bot ci
```

Запустить API и frontend в отдельных терминалах, используя примеры переменных из `.env.example`:

```bash
npm --prefix backend-api start
npm --prefix frontend run dev -- --port 5175
```

## Проверки

```bash
npm --prefix frontend run build
npm --prefix backend-api run smoke
npm --prefix backend-api run test:file-storage
npm --prefix backend-bot run build
npm --prefix ai-connector-mcp run check
npm --prefix ai-connector-mcp run smoke
```

Production-данные, `.env`, ключи и пользовательские файлы не должны добавляться в Git.
