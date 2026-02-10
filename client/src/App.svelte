<script>
  import { onDestroy, onMount } from "svelte";
  import { io } from "socket.io-client";
  import CreateLobby from "./components/CreateLobby.svelte";
  import LobbyView from "./components/LobbyView.svelte";

  const socket = io("http://localhost:3001");

  let roomCode = "";
  let hostName = "Host";
  let joinName = "Player";
  let status = "disconnected";
  let lastError = "";
  let view = "create";
  let inviteLink = "";
  let isHost = false;
  let socketId = "";
  let hasJoined = false;

  let packs = [];
  let selectedPackIds = [];
  let packsLoading = true;
  let players = [];
  let teams = [];
  let rules = null;
  let baseUrl = "";
  let gameState = "lobby";
  let leftTeams = [];
  let rightTeams = [];

  let teamCount = 2;
  let winTarget = 10;
  let guessMode = "year";
  let timerEnabled = false;
  let timerDuration = 60;

  socket.on("connect", () => {
    socketId = socket.id;
    status = `connected: ${socket.id}`;
    console.log("socket connected", socket.id);
  });

  socket.on("room:created", (payload) => {
    roomCode = payload.roomCode;
    isHost = true;
    view = "lobby";
    inviteLink = `${baseUrl}?room=${roomCode}`;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("room", roomCode);
      window.history.replaceState({}, "", url);
    }
    console.log("room created", payload);
  });

  socket.on("room:players", (payload) => {
    players = payload.players || [];
    hasJoined = players.some((player) => player.id === socketId);
    console.log("players", payload);
  });

  socket.on("room:rules", (payload) => {
    rules = payload.rules || null;
    console.log("rules", payload);
  });

  socket.on("room:teams", (payload) => {
    teams = payload.teams || [];
    console.log("teams", payload);
  });

  socket.on("game:started", (payload) => {
    gameState = "playing";
    console.log("game started", payload);
  });

  socket.on("game:next-turn", (payload) => {
    console.log("next turn", payload);
  });

  socket.on("game:score-updated", (payload) => {
    console.log("score updated", payload);
  });

  socket.on("game:round-ended", (payload) => {
    console.log("round ended", payload);
  });

  socket.on("game:sudden-death", (payload) => {
    console.log("sudden death", payload);
  });

  socket.on("game:win", (payload) => {
    gameState = "finished";
    console.log("win", payload);
  });

  socket.on("game:deck-empty", (payload) => {
    gameState = "finished";
    console.log("deck empty", payload);
  });

  socket.on("error", (payload) => {
    lastError = `${payload.code}: ${payload.message}`;
    console.log("error", payload);
  });

  onMount(async () => {
    baseUrl = window.location.origin;
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      roomCode = roomFromUrl.toUpperCase();
      view = "lobby";
      inviteLink = `${baseUrl}?room=${roomCode}`;
    }
    try {
      const response = await fetch("http://localhost:3001/packs");
      if (!response.ok) {
        throw new Error(`packs fetch failed: ${response.status}`);
      }
      packs = await response.json();
    } catch (error) {
      lastError = error.message || "packs fetch failed";
    } finally {
      packsLoading = false;
    }
  });

  function buildRules() {
    return {
      packs: selectedPackIds,
      winTarget,
      guessMode,
      timerEnabled,
      timerDuration,
      teamCount,
    };
  }

  function createRoom() {
    if (!hostName.trim()) {
      lastError = "host name required";
      return;
    }
    if (selectedPackIds.length === 0) {
      lastError = "select at least one pack";
      return;
    }
    lastError = "";
    socket.emit("room:create", { hostName, rules: buildRules() });
  }

  function joinRoom() {
    if (!roomCode) {
      lastError = "open the invite link first";
      return;
    }
    if (!joinName.trim()) {
      lastError = "player name required";
      return;
    }
    lastError = "";
    socket.emit("room:join", { roomCode, playerName: joinName });
  }

  function updateRules() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    if (selectedPackIds.length === 0) {
      lastError = "select at least one pack";
      return;
    }
    lastError = "";
    socket.emit("rules:update", { roomCode, rules: buildRules() });
  }

  function selectAllPacks() {
    selectedPackIds = packs.map((pack) => pack.id);
  }

  function clearPacks() {
    selectedPackIds = [];
  }

  function startGame() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    socket.emit("game:start", { roomCode });
  }

  function nextTurn() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    socket.emit("game:next-turn", { roomCode });
  }

  function joinTeam(teamId) {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    lastError = "";
    socket.emit("team:join", { roomCode, teamId });
  }

  onDestroy(() => {
    socket.disconnect();
  });

  $: leftTeams = teams.filter((_, index) => index % 2 === 0);
  $: rightTeams = teams.filter((_, index) => index % 2 === 1);
</script>

<main class="page">
  {#if view === "create"}
    <CreateLobby
      {status}
      {lastError}
      bind:hostName
      bind:teamCount
      bind:winTarget
      bind:guessMode
      bind:timerEnabled
      bind:timerDuration
      {packs}
      {packsLoading}
      bind:selectedPackIds
      onCreateRoom={createRoom}
      onSelectAllPacks={selectAllPacks}
      onClearPacks={clearPacks}
    />
  {:else}
    <LobbyView
      {inviteLink}
      {lastError}
      {players}
      {leftTeams}
      {rightTeams}
      {rules}
      {isHost}
      {hasJoined}
      bind:joinName
      {gameState}
      onJoinRoom={joinRoom}
      onJoinTeam={joinTeam}
      onStartGame={startGame}
      onNextTurn={nextTurn}
    />
  {/if}
</main>

<style>
  @import url("https://fonts.googleapis.com/css2?family=Monoton&family=Neonderthaw&family=Sora:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap");

  :global(:root) {
    --bg: #0b0b0f;
    --surface: #13131a;
    --surface-2: #1b1b26;
    --text: #f5f5f8;
    --muted: #a7a8b4;
    --border: #2a2a38;
    --accent: #ff3bd4;
    --accent-2: #ff7ae6;
    --shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  }

  :global(body) {
    margin: 0;
    background: radial-gradient(circle at top, #1a1026 0%, #0b0b0f 45%, #060607 100%);
    color: var(--text);
  }

  :global(.page) {
    font-family: "Sora", sans-serif;
    padding: clamp(6px, 1.2vw, 16px) clamp(14px, 2.4vw, 22px) clamp(18px, 3vw, 40px);
    max-width: 1100px;
    margin: 0 auto;
  }

  :global(.top) {
    display: flex;
    justify-content: space-between;
    gap: clamp(12px, 2vw, 20px);
    align-items: center;
    margin-bottom: clamp(6px, 1.4vw, 12px);
  }

  :global(.top-center) {
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }

  :global(.neon-title) {
    margin: 6px 0 6px;
    font-family: "Monoton", "Sora", sans-serif;
    font-size: clamp(64px, 9vw, 110px);
    font-weight: 400;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #ff77da;
    text-shadow: 0 0 2px rgba(255, 255, 255, 0.9),
      0 0 6px rgba(255, 140, 230, 0.55),
      0 0 14px rgba(255, 89, 208, 0.45),
      0 0 26px rgba(255, 59, 212, 0.35);
  }

  :global(.neon-title::before) {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    color: transparent;
    -webkit-text-stroke: 2px rgba(255, 210, 246, 0.9);
    text-shadow: 0 0 6px rgba(255, 200, 243, 0.55),
      0 0 14px rgba(255, 109, 217, 0.45);
    pointer-events: none;
  }

  :global(.neon-title) {
    position: relative;
    display: inline-block;
  }

  :global(.logo-title) {
    width: min(380px, 92vw);
    height: auto;
    display: block;
    filter: drop-shadow(0 0 8px rgba(255, 120, 214, 0.35))
      drop-shadow(0 0 18px rgba(255, 82, 200, 0.3));
  }

  :global(.logo-header) {
    width: 100%;
    margin-top: 0;
  }

  :global(.tag) {
    text-transform: uppercase;
    letter-spacing: 0.28em;
    font-size: 11px;
    color: var(--muted);
    font-family: "Space Mono", monospace;
  }

  :global(h1) {
    margin: 8px 0 6px;
    font-size: 34px;
    font-weight: 700;
  }

  :global(h2) {
    margin: 0;
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  :global(.subtitle) {
    margin: 0;
    color: var(--muted);
  }

  :global(.status-card) {
    background: var(--surface);
    border-radius: 18px;
    padding: 16px 18px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    display: grid;
    gap: 6px;
    min-width: 220px;
  }

  :global(.status-card .label) {
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--muted);
  }

  :global(.mono) {
    font-family: "Space Mono", monospace;
  }

  :global(.alert) {
    background: #2a1227;
    border: 1px solid #ff73e0;
    color: #ffd2f4;
    padding: 12px 16px;
    border-radius: 12px;
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 18px;
  }

  :global(.layout) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
  }

  :global(.layout.single) {
    grid-template-columns: minmax(0, 1fr);
  }

  :global(.column) {
    display: grid;
    gap: clamp(10px, 2vw, 16px);
  }

  :global(.card) {
    background: var(--surface);
    border-radius: 20px;
    padding: clamp(12px, 2vw, 16px);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    display: grid;
    gap: clamp(8px, 1.6vw, 12px);
  }

  :global(.lobby-frame) {
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(0, 1.6fr) minmax(200px, 1fr);
    gap: clamp(10px, 1.8vw, 18px);
    align-items: start;
  }

  :global(.lobby-center) {
    min-width: 0;
  }

  :global(.teams-side) {
    display: grid;
    gap: 12px;
    align-content: start;
    justify-items: center;
    text-align: center;
  }

  :global(.teams-list) {
    display: grid;
    gap: 10px;
    width: 100%;
  }

  :global(.card-head) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  :global(.pack-actions) {
    display: flex;
    gap: 8px;
  }

  :global(.field) {
    display: grid;
    gap: 6px;
  }

  :global(.field-row) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  :global(.checkbox) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(.pack-list) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px 16px;
  }

  :global(.pack-item) {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  :global(.actions) {
    display: flex;
    gap: 12px;
  }

  :global(.room-code) {
    background: #1c1326;
    border-radius: 12px;
    padding: 12px;
    display: grid;
    gap: 6px;
    font-family: "Space Mono", monospace;
    word-break: break-word;
    border: 1px dashed #ff73e0;
  }

  :global(.room-code strong) {
    font-size: 18px;
  }

  :global(.list ul) {
    padding-left: 16px;
    margin: 8px 0 0;
  }

  :global(.hint) {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }

  :global(.muted) {
    color: var(--muted);
    margin: 0;
  }

  :global(input),
  :global(select) {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    font-size: 15px;
    background: #12121a;
    color: var(--text);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  :global(input:focus),
  :global(select:focus) {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.18);
  }

  :global(input::placeholder) {
    color: #9b9ea4;
  }

  :global(input[type="checkbox"]) {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 6px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  :global(button) {
    padding: 10px 18px;
    border-radius: 999px;
    border: none;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  :global(button.primary) {
    background: linear-gradient(180deg, var(--accent-2) 0%, var(--accent) 100%);
    color: #1a0818;
    box-shadow: 0 10px 22px rgba(255, 59, 212, 0.4);
  }

  :global(button.primary:hover) {
    transform: translateY(-1px);
  }

  :global(button.ghost) {
    background: #191925;
    color: var(--text);
    border: 1px solid #2f2f41;
  }

  :global(button.ghost:hover) {
    transform: translateY(-1px);
  }

  :global(button:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }

  :global(.stack) {
    display: grid;
    gap: 10px;
  }

  :global(.teams-grid) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  :global(.teams-sides) {
    margin-top: 24px;
    padding: 20px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  :global(.teams-title) {
    margin: 0 0 12px;
  }

  :global(.teams-columns) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
  }

  :global(.team-side) {
    display: grid;
    gap: 10px;
  }

  :global(.team-row) {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #141420;
  }

  :global(.team-row.stacked) {
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }

  :global(.player-list) {
    display: grid;
    gap: 8px;
    width: 100%;
  }

  :global(.player-card) {
    border: 1px solid color-mix(in srgb, var(--player-glow, #3df0ff), #ffffff 18%);
    border-radius: 12px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--player-glow, #3df0ff), #0b0b0f 82%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--player-glow, #3df0ff), #000000 55%),
      0 0 18px color-mix(in srgb, var(--player-glow, #3df0ff), transparent 30%);
    text-align: center;
  }


  :global(.team-col) {
    display: grid;
    gap: 10px;
  }

  :global(.team-card) {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #141420;
  }

  :global(.modal-backdrop) {
    position: fixed;
    inset: 0;
    background: rgba(18, 18, 18, 0.45);
    display: grid;
    place-items: center;
    padding: 20px;
  }

  :global(.modal) {
    background: #141420;
    border-radius: 18px;
    padding: 20px;
    max-width: 420px;
    width: 100%;
    border: 1px solid #2f2f41;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
    display: grid;
    gap: 12px;
  }

  @media (max-width: 900px) {
    :global(.top) {
      flex-direction: column;
      align-items: flex-start;
    }
    :global(.field-row) {
      grid-template-columns: 1fr;
    }
    :global(.actions) {
      flex-direction: column;
    }
    :global(.teams-grid) {
      grid-template-columns: 1fr;
    }
    :global(.teams-columns) {
      grid-template-columns: 1fr;
    }
    :global(.lobby-frame) {
      grid-template-columns: 1fr;
    }
    :global(.lobby-center) {
      grid-column: auto;
    }
  }

  @media (max-width: 1200px) {
    :global(.lobby-frame) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    :global(.lobby-center) {
      grid-column: 1 / -1;
    }
  }
</style>
