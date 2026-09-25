# Работа с NotoTeam через GitHub

## Что хранится в репозитории

В GitHub отправляется исходный код, Docker-конфигурация, документация и тесты.

В GitHub не отправляются:

- `.env` и реальные ключи;
- production-база и каталог `app-data`;
- загруженные пользователями файлы;
- резервные копии;
- локальные модели распознавания речи;
- сборки, логи и `node_modules`.

Эти данные должны храниться на сервере в Docker volume и в системе резервного копирования.

## Ветки

- `main` — только проверенная версия, пригодная для staging/production.
- `feature/<name>` — новая функция.
- `fix/<name>` — исправление ошибки.
- `codex/<name>` — изменения из Codex.
- `claude/<name>` — изменения из Claude Code.

Пример начала работы:

```bash
git switch main
git pull --ff-only
git switch -c feature/project-shell
```

После изменений:

```bash
git add <изменённые файлы>
git commit -m "feat: add project shell"
git push -u origin feature/project-shell
```

Затем создаётся Pull Request в `main`. Объединять его следует только после успешных GitHub Actions и ручной проверки preview/staging.

## Автоматические проверки

Workflow `.github/workflows/ci.yml` проверяет:

- production-сборку frontend;
- smoke-тесты API;
- файловые адаптеры local/S3;
- TypeScript-сборку Telegram-бота;
- AI Connector;
- синтаксис сервиса распознавания речи.

## Удалённая разработка через Codespaces

1. Открыть репозиторий на GitHub.
2. Нажать `Code` → `Codespaces` → `Create codespace on ...`.
3. Дождаться установки зависимостей и запуска сервисов.
4. Открыть автоматически предложенный порт `5175`.

Codespaces выдаёт HTTPS-ссылку. Её можно открыть на компьютере или телефоне под тем же GitHub-аккаунтом. Изменения видны после сохранения благодаря Vite HMR.

Codespaces использует отдельные тестовые данные. Он не подключается к production-базе и не должен содержать реальные токены Telegram.

## Preview и staging

Codespaces удобен для личной разработки, но не заменяет постоянный staging.

Для стабильной ссылки команде рекомендуется отдельный staging-сервер:

- ветка/окружение staging разворачивается отдельно от production;
- используется отдельная база и отдельный Telegram-бот;
- production обновляется только из `main` после проверки;
- production volume с данными не удаляется при обновлении контейнеров.

## Откат

Посмотреть историю:

```bash
git log --oneline --decorate -20
```

Безопасный откат опубликованного изменения выполняется новым обратным коммитом:

```bash
git revert <commit_sha>
git push origin main
```

Для production следует дополнительно сохранять резервную копию Docker volume перед миграциями базы.

Не использовать `git reset --hard` и принудительный push для общей ветки `main`.
