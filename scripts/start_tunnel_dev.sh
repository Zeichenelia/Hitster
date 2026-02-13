#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"
SERVER_DIR="$ROOT_DIR/server"

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "Starting backend (port 3001)..."
( cd "$SERVER_DIR" && npm run dev ) &

echo "Starting frontend (port 5173)..."
( cd "$CLIENT_DIR" && npm run dev -- --host 0.0.0.0 --port 5173 ) &

echo "Waiting for frontend to boot..."
sleep 4

echo "Starting Cloudflare tunnel to frontend..."
cloudflared tunnel --url http://localhost:5173
