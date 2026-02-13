#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"
SERVER_DIR="$ROOT_DIR/server"
VITE_CONFIG="$CLIENT_DIR/vite.config.js"
ENV_FILE="$CLIENT_DIR/.env"

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

# Start backend
( cd "$SERVER_DIR" && npm run dev ) &

# Wait for backend to boot
sleep 2

# --- Cloudflare tunnel and config update first ---
echo "Starting Cloudflare tunnel to frontend..."
TUNNEL_URL=$(cloudflared tunnel --url http://localhost:5173 2>&1 | tee /dev/tty | grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' | head -n 1)

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Could not determine tunnel URL."
  exit 1
fi

TUNNEL_HOST=$(echo "$TUNNEL_URL" | sed -E 's@https?://([^/]+)/?@\1@')

awk -v host="$TUNNEL_HOST" '
  BEGIN {in_block=0}
  /allowedHosts:/ {print; print "      [\""host"\"],"; in_block=1; next}
  in_block && /\[/ {next}
  in_block && /\],/ {in_block=0; next}
  !in_block {print}
' "$VITE_CONFIG" > "$VITE_CONFIG.tmp" && mv "$VITE_CONFIG.tmp" "$VITE_CONFIG"

echo "VITE_PUBLIC_APP_URL=$TUNNEL_URL" > "$ENV_FILE"
echo ".env file updated with VITE_PUBLIC_APP_URL=$TUNNEL_URL"

# --- Now start frontend ---
echo "Starting frontend..."
( cd "$CLIENT_DIR" && npm run dev -- --host 0.0.0.0 --port 5173 ) &
