# NotoTime: конфликт портов 80 и 443

## Короткий ответ

Контейнеры `frontend` и `caddy` не конфликтуют друг с другом из-за порта 80.

В `docker-compose.yml` используются два разных механизма:

```yaml
frontend:
  expose:
    - "80"
```

`expose` делает порт 80 доступным только другим контейнерам внутри Docker-сети. Порт 80 сервера при этом не занимается.

```yaml
caddy:
  ports:
    - "80:80"
    - "443:443"
    - "443:443/udp"
```

`ports` публикует порты контейнера Caddy на сервере. Поэтому только Caddy пытается занять серверные порты 80 и 443.

Caddy обращается к frontend по внутреннему адресу:

```caddyfile
reverse_proxy frontend:80
```

Ошибка:

```text
failed to bind host port 0.0.0.0:80/tcp: address already in use
```

означает, что порт 80 сервера уже занят другим процессом или контейнером.

## Что делать прямо сейчас

### 1. Найти, кто занял порт 80

Выполнить на сервере:

```bash
sudo ss -ltnp | grep ':80 '
docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep '0.0.0.0:80'
```

Дополнительно проверить распространённые reverse proxy:

```bash
sudo systemctl status nginx --no-pager
sudo systemctl status apache2 --no-pager
sudo systemctl status caddy --no-pager
```

Проверить порт 443:

```bash
sudo ss -ltnp | grep ':443 '
docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep '0.0.0.0:443'
```

### 2. Выбрать один из двух сценариев

#### Сценарий A: на сервере нет других сайтов

Рекомендуется использовать Caddy из комплекта NotoTime как единственный reverse proxy.

Если порты занимает ненужный Nginx:

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
```

Если порты занимает ненужный Apache:

```bash
sudo systemctl stop apache2
sudo systemctl disable apache2
```

Если порт занимает старый Docker-контейнер, сначала определить его по выводу `docker ps`, затем остановить именно этот контейнер:

```bash
docker stop <container_name>
```

После освобождения портов запустить NotoTime из корня проекта:

```bash
docker compose down --remove-orphans
docker compose up -d --build
```

#### Сценарий B: Nginx/Caddy уже обслуживает другие сайты

Не нужно останавливать действующий reverse proxy. На одном сервере портами 80 и 443 должен управлять один внешний reverse proxy.

В этом случае DevOps-инженеру следует:

1. Оставить существующий Nginx или Caddy владельцем портов 80 и 443.
2. Не публиковать Caddy из NotoTime на этих же портах.
3. Опубликовать вход NotoTime только на локальном альтернативном порту, например `127.0.0.1:8080`.
4. Настроить существующий reverse proxy на домен NotoTime и проксировать запросы на `127.0.0.1:8080`.
5. TLS-сертификат выпускать на уровне существующего reverse proxy.

Пример временной привязки Caddy NotoTime только к localhost:

```yaml
caddy:
  ports:
    - "127.0.0.1:8080:80"
```

Это изменение следует оформить отдельным production override-файлом, а не вручную редактировать основной `docker-compose.yml` на сервере.

Пример `docker-compose.proxy.yml`:

```yaml
services:
  caddy:
    ports: !override
      - "127.0.0.1:8080:80"
```

Запуск:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

Перед использованием `!override` нужно убедиться, что на сервере установлена актуальная версия Docker Compose. Если версия не поддерживает этот тег, DevOps-инженеру следует создать обычный production compose-файл с итоговой конфигурацией портов.

## Проверка перед повторным запуском

Порты 80 и 443 должны быть свободны, если используется сценарий A:

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

Если команда ничего не вывела, порты свободны.

Проверить итоговую конфигурацию Compose:

```bash
docker compose config
```

Запустить контейнеры:

```bash
docker compose up -d --build
```

Проверить состояние:

```bash
docker compose ps
docker compose logs --tail=100 caddy
docker compose logs --tail=100 frontend
docker compose logs --tail=100 backend-api
```

Все основные контейнеры должны иметь состояние `running` или `healthy`.

## Проверка после запуска

```bash
curl -I http://<домен>
curl -I https://<домен>
```

Затем проверить в браузере:

1. Открывается главная страница.
2. Работает вход.
3. Создаются проекты, папки, страницы и задачи.
4. Загружаются файлы.
5. Telegram-бот видит backend.
6. Голосовое сообщение распознаётся.

## Что не нужно менять

Не нужно менять или удалять:

```yaml
frontend:
  expose:
    - "80"
```

Этот порт используется только внутри Docker-сети и необходим Caddy для обращения к frontend.

Также не следует публиковать frontend напрямую через `ports: "80:80"`, поскольку внешний трафик должен проходить через reverse proxy. Caddy отвечает за HTTPS, маршрутизацию и защитные HTTP-заголовки.

## Рекомендуемое решение

- Для отдельного чистого сервера: освободить 80/443 и оставить текущий Caddy NotoTime.
- Для сервера с другими сайтами: использовать уже работающий reverse proxy и подключить NotoTime через локальный upstream.
- Не запускать одновременно два reverse proxy, каждый из которых пытается занять `0.0.0.0:80` и `0.0.0.0:443`.
