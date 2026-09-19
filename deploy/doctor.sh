#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE="deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: deploy/.env does not exist. Copy deploy/.env.example and fill it in."
  exit 1
fi

APP_DOMAIN=$(awk -F= '$1 == "APP_DOMAIN" { print $2; exit }' "$ENV_FILE" | tr -d '[:space:]')
if [ -z "$APP_DOMAIN" ]; then
  echo "ERROR: APP_DOMAIN is empty in deploy/.env"
  exit 1
fi

echo "1/5 Validate Compose configuration"
docker compose --env-file "$ENV_FILE" config --quiet

echo "2/5 Check container state"
docker compose --env-file "$ENV_FILE" ps

echo "3/5 Check public frontend"
curl --fail --silent --show-error "https://$APP_DOMAIN/healthz"

echo "4/5 Check public API"
curl --fail --silent --show-error "https://$APP_DOMAIN/api/health"

echo "5/5 Check internal speech service"
docker compose --env-file "$ENV_FILE" exec -T speech-recognition \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read().decode())"

echo "OK: NotoTime services are reachable."
