#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/.devcontainer/runtime"
mkdir -p "$RUNTIME_DIR/data"

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  FRONTEND_ORIGIN="https://${CODESPACE_NAME}-5175.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  FRONTEND_ORIGIN="http://127.0.0.1:5175"
fi

if ! curl --silent --fail http://127.0.0.1:8787/health >/dev/null 2>&1; then
  (
    cd "$ROOT/backend-api"
    env \
      NODE_ENV=development \
      PORT=8787 \
      APP_DATA_DIR="$RUNTIME_DIR/data" \
      WORKSPACE_STORAGE=json \
      CORS_ORIGIN="$FRONTEND_ORIGIN" \
      BOT_TOKEN=codespaces-development-token \
      INTERNAL_API_TOKEN=codespaces-internal-token \
      EXTERNAL_CALENDAR_CREDENTIALS_SECRET=codespaces-calendar-secret \
      SYSTEM_STATS_PSEUDONYM_SECRET=codespaces-stats-secret \
      LOCAL_DEV_LOGIN=1 \
      LOCAL_DEV_SYSTEM_OWNER=1 \
      nohup npm start >"$RUNTIME_DIR/backend-api.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/backend-api.pid"
  )
fi

if ! curl --silent --fail http://127.0.0.1:5175 >/dev/null 2>&1; then
  (
    cd "$ROOT/frontend"
    env VITE_WORKSPACE_API_URL=/api \
      nohup npm run dev -- --host 0.0.0.0 --port 5175 >"$RUNTIME_DIR/frontend.log" 2>&1 &
    echo $! >"$RUNTIME_DIR/frontend.pid"
  )
fi

echo "NotoTeam development services are starting."
echo "Frontend: $FRONTEND_ORIGIN"
echo "Logs: $RUNTIME_DIR"
