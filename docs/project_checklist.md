# Hitster Multiplayer Project Checklist

## MVP (Phase 1)

- [X] Define the core game loop (round start -> play -> score -> next round)
- [X] Lock the MVP feature list (no accounts, no persistence)
- [X] Choose the stack (Svelte + Vite + Node + Socket.IO)
- [X] Prepare data sources (CSV packs + pack list)
- [X] Create project structure (client/server folders)
- [X] Build backend room/session model
- [X] Implement realtime events (join, leave, start, next card, score update)
- [X] Implement CSV loader and pack filtering
- [ ] Build lobby UI (create/join room)
- [ ] Build pack selection UI (checkbox list)
- [ ] Build game UI (card view + player list + controls)
- [ ] Integrate YouTube playback via stored URL
- [ ] Sync state across players
- [ ] Handle basic errors (no packs selected, empty pack, invalid room)
- [ ] Local multiplayer test with 4-6 players

## Out of Scope (Never Needed)

- [ ] Accounts/registration
- [ ] Save/load game state
- [ ] Rankings/statistics
- [ ] Advanced moderation/anti-cheat

## Stabilization (Phase 2)

- [ ] Reconnect handling (drop/rejoin)
- [ ] Host migration or safe host leave rules
- [ ] Prevent duplicate cards across packs
- [ ] Shuffle seed for fairness and replay
- [ ] Basic admin controls (skip, reset round)
- [ ] Mobile layout polish
- [ ] Simple logging for troubleshooting

## Deployment (Phase 3)

- [ ] Local hosting setup (dev + prod build)
- [ ] Free tunnel setup (Cloudflare Tunnel or ngrok)
- [ ] Add environment config (PORT, BASE_URL)
- [ ] Run a remote test session
- [ ] Optional VPS migration plan

## Maintenance (Phase 4)

- [ ] CSV update workflow (replace packs and re-run header check)
- [ ] Document run steps in README
- [ ] Backups of packs and configs
