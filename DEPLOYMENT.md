# Развёртывание NotoTime на сервере

Эта инструкция рассчитана на чистый сервер Ubuntu 22.04/24.04 x86_64 и Docker Compose v2.
Весь стек запускается одной конфигурацией:

- `caddy` — публичный HTTPS и автоматические сертификаты;
- `frontend` — собранный React-интерфейс и прокси `/api`;
- `backend-api` — единый API, база и фоновые календарные уведомления;
- `backend-bot` — Telegram-бот в режиме long polling;
- `speech-recognition` — локальный Faster Whisper, без внешнего AI API.

API, бот и распознавание не публикуют порты в интернет. Постоянные данные находятся в
Docker-томе `nototime-app-data` и сохраняются при обновлении контейнеров.

## 1. Требования

Минимум без активного распознавания нескольких голосовых одновременно:

- 2 vCPU;
- 4 ГБ RAM;
- 15 ГБ свободного диска;
- Ubuntu 22.04 или 24.04 x86_64;
- домен с A-записью на IP сервера;
- открытые TCP-порты 80 и 443;
- исходящий HTTPS-доступ к Telegram и внешним календарям.

Рекомендуется 4 vCPU и 8 ГБ RAM. Для слабого сервера используйте модель `base`, для
обычного — `small`. Модель `medium` имеет смысл только на более мощном CPU-сервере.

Telegram Mini App требует публичный HTTPS. IP-адрес или `localhost` вместо домена для
полноценного продакшена не подходят.

## 2. Подготовка DNS и Telegram

1. Создайте A-запись, например `app.example.com -> 203.0.113.10`.
2. Дождитесь обновления DNS: `dig +short app.example.com` должен вернуть IP сервера.
3. Получите токен бота в `@BotFather`.
4. Убедитесь, что этот же бот используется для входа, уведомлений и Mini App.
5. Каждый пользователь должен хотя бы один раз нажать `/start`, иначе Telegram не даст
   боту первым отправить ему уведомление.

## 3. Установка Docker

Используйте официальный репозиторий Docker. Актуальная исходная инструкция:
[Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

cat <<EOF | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Можно выполнять дальнейшие команды через `sudo docker`. Либо добавить отдельного
администратора в группу `docker`, понимая, что эта группа фактически даёт root-доступ:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

## 4. Перенос проекта

Передайте на сервер всю корневую папку проекта, включая:

```text
backend-api/
backend-bot/
frontend/
speech-recognition/
deploy/
ai-connector-mcp/
docker-compose.yml
DEPLOYMENT.md
```

Каталоги `node_modules`, `dist`, локальные `.env`, логи и `app-data` передавать не нужно.
Пример рабочего каталога на сервере:

```bash
sudo mkdir -p /opt/nototime
sudo chown -R "$USER":"$USER" /opt/nototime
cd /opt/nototime
```

## 5. Настройка окружения

```bash
cd /opt/nototime
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Сгенерируйте три разных секрета:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Откройте `deploy/.env` и обязательно заполните:

```dotenv
APP_DOMAIN=app.example.com
BOT_TOKEN=123456789:real_bot_token
APP_OWNER_TELEGRAM_IDS=123456789
INTERNAL_API_TOKEN=первый_секрет
EXTERNAL_CALENDAR_CREDENTIALS_SECRET=второй_секрет
SYSTEM_STATS_PSEUDONYM_SECRET=третий_секрет
```

Важно:

- `APP_DOMAIN` указывается без `https://` и без завершающего `/`;
- `APP_OWNER_TELEGRAM_IDS` — числовые Telegram ID через запятую;
- `INTERNAL_API_TOKEN` одинаков для API и бота, Compose передаёт его автоматически;
- не отправляйте `deploy/.env` третьим лицам и не добавляйте его в Git;
- `LOCAL_DEV_LOGIN` в production принудительно выключен.

## 6. Первый запуск

Сначала проверьте итоговую конфигурацию, затем соберите и запустите сервисы:

```bash
cd /opt/nototime
docker compose --env-file deploy/.env config --quiet
docker compose --env-file deploy/.env build --pull
docker compose --env-file deploy/.env up -d
docker compose --env-file deploy/.env ps
```

Первая сборка `speech-recognition` скачивает модель Faster Whisper внутрь образа. Это
может занять 5–30 минут в зависимости от сервера и сети. В дальнейшем модель не
скачивается при обычном перезапуске.

Посмотреть процесс запуска:

```bash
docker compose --env-file deploy/.env logs -f --tail=200 \
  backend-api backend-bot speech-recognition frontend caddy
```

Все сервисы должны перейти в состояние `healthy`. Caddy сам запросит TLS-сертификат,
если DNS уже указывает на сервер и порты 80/443 доступны извне.

## 7. Автоматическая проверка

```bash
chmod +x deploy/doctor.sh
./deploy/doctor.sh
```

Скрипт проверит Compose, публичный frontend, API и внутренний speech-сервис. Ручные
проверки:

```bash
curl -fsS https://app.example.com/healthz
curl -fsS https://app.example.com/api/health
docker compose --env-file deploy/.env exec -T speech-recognition \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"
```

После этого:

1. Откройте `https://app.example.com` в браузере.
2. Напишите боту `/start`.
3. Запросите код входа и войдите в приложение.
4. Создайте тестовый проект, папку, страницу и задачу именно через Mini App.
5. Перезагрузите страницу и убедитесь, что объекты сохранились.
6. Выполните `docker compose --env-file deploy/.env restart backend-api`, затем снова
   проверьте данные — они должны сохраниться в томе.

## 8. Проверка распознавания голосовых

Ничего дополнительно устанавливать на хост не требуется: Python, Faster Whisper,
FFmpeg и модель находятся внутри контейнера `speech-recognition`.

1. В Telegram выполните `/switch` и выберите проект и канбан-доску.
2. Отправьте: «Создай задачу подготовить отчёт до двадцатого сентября в шесть вечера».
3. Бот должен показать распознанный текст и запустить обычный сценарий создания задачи.
4. Проверьте задачу в Mini App.

Поддерживаются голосовые команды для задачи, Inbox-заметки, напоминания и немедленного
уведомления. Аудиофайл хранится только во временном каталоге и удаляется после обработки;
в приложении остаются текст и созданная сущность.

Для защиты сервера включены:

- максимум 120 секунд на одно голосовое;
- максимум 20 МБ;
- не более 5 голосовых за 10 минут от одного пользователя;
- ограничение параллельного распознавания;
- таймаут распознавания;
- один worker модели, чтобы она не загружалась в RAM несколько раз.

Если RAM мало, измените в `deploy/.env`:

```dotenv
SPEECH_MODEL=base
SPEECH_MEMORY_LIMIT=2g
SPEECH_CPU_THREADS=2
```

После смены модели требуется пересборка:

```bash
docker compose --env-file deploy/.env build --no-cache speech-recognition
docker compose --env-file deploy/.env up -d speech-recognition backend-bot
```

## 9. Почему создание объектов работает после деплоя

В этой конфигурации устранены основные причины ранее описанного сбоя:

- frontend собирается с относительным API-адресом `/api`, а не с `127.0.0.1`;
- Nginx проксирует `/api` во внутренний контейнер `backend-api:8787`;
- браузер работает только с одним HTTPS-доменом, поэтому CORS согласован;
- API пишет в постоянный том `/data`, заранее доступный пользователю `node`;
- API и бот получают один `INTERNAL_API_TOKEN`;
- лимит Nginx и JSON-body учитывает base64-накладные расходы 25-МБ файлов;
- бот запускается только после healthy-состояния API и распознавания;
- наружу не опубликованы внутренние порты 8787, 3000 и 8000.

## 10. Диагностика

Статусы и последние ошибки:

```bash
docker compose --env-file deploy/.env ps
docker compose --env-file deploy/.env logs --tail=200 backend-api
docker compose --env-file deploy/.env logs --tail=200 backend-bot
docker compose --env-file deploy/.env logs --tail=200 speech-recognition
docker compose --env-file deploy/.env logs --tail=200 caddy
```

Типовые случаи:

- `502 Bad Gateway`: API или frontend ещё не healthy; смотрите их логи.
- Caddy не получает сертификат: неверный DNS, закрыты 80/443 или домен уже проксируется
  другим сервером.
- Mini App читает, но не создаёт: проверьте, что frontend собран с `/api`, а запросы не
  уходят на `localhost`; запустите `doctor.sh`.
- Бот не отвечает: проверьте `BOT_TOKEN`, исходящий интернет и что нет второго экземпляра
  этого же polling-бота.
- Голосовое не распознаётся: проверьте health speech-сервиса, RAM и его логи.
- Контейнер speech получает `OOMKilled`: выберите модель `base` или увеличьте RAM/лимит.
- Уведомления не приходят: пользователь должен нажать `/start`; проверьте общий bot token
  и логи API/бота.

Не запускайте одновременно второй `backend-bot` с тем же токеном и не масштабируйте
`backend-api` без отдельной координации фоновых workers: это может вызвать конфликт
polling или повторную обработку уведомлений.

## 11. Резервная копия

Никогда не используйте `docker compose down -v`: ключ `-v` удалит том с данными.

Создание архива данных:

```bash
mkdir -p deploy/backups
docker run --rm \
  -v nototime-app-data:/data:ro \
  -v "$PWD/deploy/backups:/backup" \
  alpine sh -c 'tar czf /backup/nototime-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
ls -lh deploy/backups
```

Копируйте архивы на отдельный сервер или объектное хранилище. Проверяйте восстановление
на тестовом окружении до того, как полагаться на резервные копии в production.

## 12. Обновление

```bash
cd /opt/nototime
# Здесь получите новую версию файлов через Git или безопасное копирование.
docker compose --env-file deploy/.env config --quiet
docker compose --env-file deploy/.env build --pull
docker compose --env-file deploy/.env up -d
./deploy/doctor.sh
```

Команда `up -d` заменяет контейнеры, но не удаляет `nototime-app-data`.

## 13. Переход на S3-совместимое хранилище

До подключения облака файлы работают в локальном томе. Для S3 заполните `S3_*` в
`deploy/.env`, оставив `FILE_STORAGE=local`, пересоздайте API и сначала выполните миграцию:

```bash
docker compose --env-file deploy/.env up -d --force-recreate backend-api
docker compose --env-file deploy/.env exec backend-api npm run migrate:files-to-s3
```

После проверки объектов в bucket установите `FILE_STORAGE=s3` и пересоздайте API:

```bash
docker compose --env-file deploy/.env up -d --force-recreate backend-api
```

Не используйте `--delete-local` при первой миграции. Сначала сделайте резервную копию и
проверьте скачивание файлов через приложение.

## 14. AI Connector

HTTP-часть AI Connector работает внутри `backend-api`. Каталог `ai-connector-mcp` не
нужно запускать на сервере как постоянный web-контейнер: это stdio MCP-клиент, который
запускается на компьютере, где работает Claude/Codex, и подключается к публичному API
NotoTime по выданному MCP-токену. Инструкция клиента находится внутри этого каталога.
