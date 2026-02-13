#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"
SERVER_DIR="$ROOT_DIR/server"
ENV_FILE="$CLIENT_DIR/.env"
TUNNEL_LOG="$ROOT_DIR/.cloudflared-tunnel.log"

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

upsert_env_var() {
  local key="$1"
  local value="$2"

  if [[ -f "$ENV_FILE" ]] && grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i -E "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# Start backend
( cd "$SERVER_DIR" && npm run dev ) &

# Wait for backend to boot
sleep 2

# Start tunnel in background and extract URL from logs
echo "Starting Cloudflare tunnel to frontend..."
: > "$TUNNEL_LOG"
cloudflared tunnel --url http://localhost:5173 > "$TUNNEL_LOG" 2>&1 &

TUNNEL_URL=""
for _ in {1..30}; do
  TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Could not determine tunnel URL. cloudflared logs:"
  cat "$TUNNEL_LOG"
  exit 1
fi

TUNNEL_HOST="${TUNNEL_URL#https://}"
echo "Tunnel URL: $TUNNEL_URL"

upsert_env_var "VITE_PUBLIC_APP_URL" "$TUNNEL_URL"
upsert_env_var "VITE_TUNNEL_HOST" "$TUNNEL_HOST"

echo ".env updated with:"
echo "  VITE_PUBLIC_APP_URL=$TUNNEL_URL"
echo "  VITE_TUNNEL_HOST=$TUNNEL_HOST"

# Start frontend
echo "Starting frontend..."
( cd "$CLIENT_DIR" && npm run dev -- --host 0.0.0.0 --port 5173 ) &

wait
