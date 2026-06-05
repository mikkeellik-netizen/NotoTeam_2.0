#!/bin/bash
set -e

echo "🚀 Деплой Kanban..."

# Обновляем код
git pull origin main

# Перезапускаем контейнеры
docker compose down
docker compose build --no-cache
docker compose up -d

echo "✅ Деплой завершён!"
echo "🔗 Сайт: https://$(grep WEBAPP_URL .env | cut -d= -f2)"
