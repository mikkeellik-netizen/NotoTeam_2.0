# 🚀 Инструкция по деплою — Telegram Kanban

Следуй шагам по порядку. Каждый шаг — copy-paste команды.

---

## ШАГ 1 — Создать Telegram-бота

1. Открой Telegram, найди **@BotFather**
2. Напиши `/newbot`
3. Придумай имя бота (например: `Kanban Helper`)
4. Придумай username (например: `my_kanban_bot`) — должен заканчиваться на `bot`
5. BotFather выдаст токен вида: `1234567890:ABCDEFabcdef_your_token`
6. **Сохрани токен** — он понадобится на шаге 5

---

## ШАГ 2 — Купить VPS

**Рекомендуемые провайдеры:**

| Провайдер | Цена | Ссылка |
|-----------|------|--------|
| Hetzner   | ~4€/мес | cloud.hetzner.com |
| TimeWeb   | ~300₽/мес | timeweb.cloud |
| Reg.ru    | ~300₽/мес | reg.ru/vps |

**Минимальные требования:**
- Ubuntu 22.04 LTS
- 2 GB RAM
- 20 GB диск
- 1 CPU

**При создании сервера:**
- Выбери OS: **Ubuntu 22.04**
- Выбери регион ближайший к тебе
- Добавь SSH-ключ (или запомни root пароль)

---

## ШАГ 3 — Купить домен и направить на сервер

1. Купи домен на [reg.ru](https://reg.ru) или [nic.ru](https://nic.ru)
   - Например: `mykanban.ru` (~150₽/год)

2. В настройках DNS домена создай запись:
   ```
   Тип: A
   Имя: @
   Значение: IP_АДРЕС_ТВОЕГО_VPS
   TTL: 3600
   ```

3. Также создай запись для www:
   ```
   Тип: A
   Имя: www
   Значение: IP_АДРЕС_ТВОЕГО_VPS
   TTL: 3600
   ```

4. Подожди 5–30 минут пока DNS обновится

---

## ШАГ 4 — Подключиться к серверу

Открой терминал (на Mac/Linux) или PowerShell (Windows):

```bash
ssh root@IP_АДРЕС_СЕРВЕРА
```

Введи пароль если потребует.

---

## ШАГ 5 — Установить всё необходимое

Вставь все команды по очереди:

### Обновить систему
```bash
apt update && apt upgrade -y
```

### Установить Docker
```bash
curl -fsSL https://get.docker.com | sh
```

### Установить Docker Compose
```bash
apt install docker-compose-plugin -y
```

### Установить Nginx
```bash
apt install nginx -y
```

### Установить Certbot (SSL)
```bash
apt install certbot python3-certbot-nginx -y
```

### Установить Git
```bash
apt install git -y
```

---

## ШАГ 6 — Загрузить код на сервер

### Вариант А — через GitHub (рекомендуется)

На своём компьютере создай репозиторий GitHub и загрузи туда папку `project/`.

Затем на сервере:
```bash
cd /opt
git clone https://github.com/ТВО_ИМЯ/kanban.git
cd kanban
```

### Вариант Б — загрузить файлы напрямую

С компьютера (в отдельном терминале):
```bash
scp -r ./project root@IP_АДРЕС_СЕРВЕРА:/opt/kanban
```

Затем на сервере:
```bash
cd /opt/kanban
```

---

## ШАГ 7 — Создать файл .env

На сервере в папке `/opt/kanban`:

```bash
cp .env.example .env
nano .env
```

Заполни все значения:

```env
POSTGRES_USER=kanban_user
POSTGRES_PASSWORD=придумай_сложный_пароль_123
POSTGRES_DB=kanban_db
DATABASE_URL=postgresql://kanban_user:придумай_сложный_пароль_123@postgres:5432/kanban_db

REDIS_PASSWORD=другой_сложный_пароль_456
REDIS_URL=redis://:другой_сложный_пароль_456@redis:6379

BOT_TOKEN=токен_от_botfather_из_шага_1
WEBAPP_URL=https://твой_домен.ru

JWT_SECRET=очень_длинная_случайная_строка_минимум_32_символа_abc123

NODE_ENV=production
PORT=3000
```

Сохрани: `Ctrl+O`, Enter, `Ctrl+X`

---

## ШАГ 8 — Настроить Nginx

```bash
nano /etc/nginx/sites-available/kanban
```

Вставь содержимое файла `nginx.conf` из проекта.
**Замени `YOUR_DOMAIN.COM` на свой домен.**

Активируй конфиг:
```bash
ln -s /etc/nginx/sites-available/kanban /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## ШАГ 9 — Получить SSL-сертификат

```bash
certbot --nginx -d твой_домен.ru -d www.твой_домен.ru
```

- Введи email
- Согласись с условиями (Y)
- Выбери перенаправление на HTTPS (2)

Проверь что всё работает:
```bash
certbot renew --dry-run
```

---

## ШАГ 10 — Запустить приложение

```bash
cd /opt/kanban
docker compose up -d --build
```

Подожди 2–3 минуты пока соберётся.

Проверь что всё запущено:
```bash
docker compose ps
```

Должны быть 4 контейнера со статусом `Up`:
- `kanban_postgres`
- `kanban_redis`
- `kanban_backend`
- `kanban_frontend`

---

## ШАГ 11 — Настроить бота в Telegram

1. Открой @BotFather
2. Напиши `/setmenubutton`
3. Выбери своего бота
4. Отправь URL: `https://твой_домен.ru`
5. Отправь текст кнопки: `Открыть доску`

Также включи Mini App:
1. `/newapp` в BotFather
2. Выбери бота
3. Укажи URL: `https://твой_домен.ru`

---

## ШАГ 12 — Проверка

Открой бота в Telegram и напиши `/start`.

Если всё работает — ты увидишь приветственное сообщение с кнопкой «Открыть доску».

---

## Полезные команды

```bash
# Посмотреть логи бэкенда
docker compose logs backend -f

# Посмотреть логи бота
docker compose logs backend -f | grep Bot

# Перезапустить после изменений
docker compose restart backend

# Полный перезапуск
docker compose down && docker compose up -d

# Обновить код и перезапустить
bash deploy.sh
```

---

## Частые проблемы

### Бот не отвечает
```bash
docker compose logs backend -f
```
Проверь что `BOT_TOKEN` в `.env` правильный.

### Сайт не открывается
```bash
nginx -t
systemctl status nginx
```

### База данных не запускается
```bash
docker compose logs postgres
```
Проверь пароли в `.env`.

### SSL не работает
Убедись что домен направлен на IP сервера (шаг 3) и подождал 30 минут.

---

## Автоматическое обновление SSL

Certbot сам обновляет сертификаты. Проверить:
```bash
systemctl status certbot.timer
```

---

## Готово! 🎉

Твой Telegram Kanban работает по адресу: `https://твой_домен.ru`
