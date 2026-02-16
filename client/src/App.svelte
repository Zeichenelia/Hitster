<script>
  import { onDestroy, onMount } from "svelte";
  import { io } from "socket.io-client";
  import CreateLobby from "./components/CreateLobby.svelte";
  import LobbyView from "./components/LobbyView.svelte";
  import GameView from "./components/GameView.svelte";
  import WinnerScreen from "./components/WinnerScreen.svelte";
  import JoinModal from "./components/JoinModal.svelte";

  const defaultApiBaseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3001";
  const apiBaseUrl = import.meta.env.VITE_API_URL || defaultApiBaseUrl;
  // Always use the current window location for the invite link base
  const getPublicAppBaseUrl = () => (typeof window !== "undefined" ? window.location.origin : defaultApiBaseUrl);
  const socket = io(apiBaseUrl, { transports: ["websocket", "polling"] });

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
  let activeTeamId = "";
  let currentCard = null;
  let playerCard = null;
  let remainingCards = 0;
  let lastRevealedCard = null;
  let lastRevealCorrect = true;
  let lastRevealPosition = -1;
  let lastRevealTeamId = "";
  let lastPlacedCardId = "";
  let lastPlacedTeamId = "";
  let autoPlacedCardId = "";
  let pendingPlacement = null;
  let audioUrl = "";
  let audioState = null;
  let leftTeams = [];
  let rightTeams = [];
  let winnerTeamId = "";
  let showWinner = false;
  let winnerTimer;
  let storedTeamId = "";
  let clientId = "";
  let localPrefsReady = false;
  let pendingSync = false;
  let stateVersion = -1;

  let teamCount = 2;
  let winTarget = 10;
  let guessMode = "year";
  let timerEnabled = false;
  let timerDuration = 60;

  const playerGlows = [
    "#3df0ff",
    "#ff4dcb",
    "#58ff8a",
    "#ffb347",
    "#a96bff",
    "#ff6b6b",
    "#3dffb6",
    "#ffd43d",
    "#6bd4ff",
    "#ff8a3d",
  ];

  const getPlayerKey = (player) => String(player.id || player.name || "");

  const getHashedGlow = (player) => {
    const key = getPlayerKey(player);
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (hash + key.charCodeAt(i) * (i + 1)) % 2147483647;
    }
    return playerGlows[Math.abs(hash) % playerGlows.length];
  };


  const normalizeCard = (card) => {
    if (!card) {
      return null;
    }
    const fallbackAvatarPath = card.packId ? `/pack-logo/${encodeURIComponent(card.packId)}` : "";
    return {
      ...card,
      playlistAvatarUrl: card.playlistAvatarUrl || fallbackAvatarPath,
    };
  };

  const getPlayerByClientId = (currentPlayers = players) =>
    currentPlayers.find((player) => player.clientId && player.clientId === clientId) || null;

  const emitRoomSync = () => {
    if (!roomCode) {
      return;
    }
    const shouldSendName = Boolean(storedTeamId || hasJoined);
    const payload = {
      roomCode,
      clientId,
    };
    if (shouldSendName && joinName) {
      payload.playerName = joinName;
    }
    socket.emit("room:sync", payload);
  };

  const tryAutoJoinTeam = (currentPlayers = players) => {
    if (!roomCode || !storedTeamId || !clientId) {
      return;
    }
    if (!teams.some((team) => team.id === storedTeamId)) {
      return;
    }
    const currentPlayer = currentPlayers.find((player) => player.id === socketId);
    if (currentPlayer?.teamId) {
      return;
    }
    socket.emit("team:join", {
      roomCode,
      teamId: storedTeamId,
      playerName: joinName || "Player",
      clientId,
    });
  };

  socket.on("connect", () => {
    socketId = socket.id;
    status = `connected: ${socket.id}`;
    if (roomCode && localPrefsReady) {
      emitRoomSync();
    } else if (roomCode) {
      pendingSync = true;
    }
  });

  socket.on("room:created", (payload) => {
    roomCode = payload.roomCode;
    isHost = true;
    view = "lobby";
    inviteLink = `${getPublicAppBaseUrl()}?room=${roomCode}`;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("room", roomCode);
      window.history.replaceState({}, "", url);
    }
  });

  socket.on("room:players", (payload) => {
    players = payload.players || [];
    hasJoined = players.some((player) => player.id === socketId);
    const currentPlayer = getPlayerByClientId(players) || players.find((player) => player.id === socketId);
    if (currentPlayer?.name && currentPlayer.name !== joinName) {
      joinName = currentPlayer.name;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("hitster:playerName", joinName);
      }
    }
    if (currentPlayer?.teamId) {
      storedTeamId = currentPlayer.teamId;
    } else {
      tryAutoJoinTeam(players);
    }
  });

  socket.on("room:rules", (payload) => {
    rules = payload.rules || null;
  });

  socket.on("room:teams", (payload) => {
    teams = payload.teams || [];
    tryAutoJoinTeam();
  });

  socket.on("room:state", (payload) => {
    const nextVersion = Number.isInteger(payload.version) ? payload.version : 0;
    if (nextVersion < stateVersion) {
      return;
    }
    stateVersion = nextVersion;
    rules = payload.rules || rules;
    players = payload.players || players;
    teams = payload.teams || teams;
    gameState = payload.state || gameState;
    view = "lobby";
    activeTeamId = payload.activeTeamId || "";
    currentCard = normalizeCard(payload.currentCard);
    if (payload.currentCard) {
      playerCard = normalizeCard(payload.currentCard);
    }
    if (payload.currentCard?.url) {
      audioUrl = payload.currentCard.url;
    } else if (payload.state && payload.state !== "playing") {
      audioUrl = "";
      audioState = null;
    }
    remainingCards = payload.remainingCards ?? remainingCards;
    pendingPlacement = payload.pendingPlacement || null;
    if (payload.audioState) {
      audioState = payload.audioState;
    }
    const statePlayers = payload.players || players;
    const currentPlayer = getPlayerByClientId(statePlayers) || statePlayers.find((player) => player.id === socketId);
    if (currentPlayer?.name && currentPlayer.name !== joinName) {
      joinName = currentPlayer.name;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("hitster:playerName", joinName);
      }
    }
    if (currentPlayer?.teamId) {
      storedTeamId = currentPlayer.teamId;
    } else {
      tryAutoJoinTeam(statePlayers);
    }
  });

  socket.on("game:started", (payload) => {
    gameState = "playing";
    activeTeamId = payload.activeTeamId || "";
    currentCard = null;
    playerCard = null;
    audioUrl = "";
    audioState = null;
    remainingCards = payload.remainingCards ?? 0;
    lastRevealedCard = null;
    lastRevealCorrect = true;
    lastRevealPosition = -1;
    lastRevealTeamId = "";
    lastPlacedCardId = "";
    lastPlacedTeamId = "";
    autoPlacedCardId = "";
    winnerTeamId = "";
    showWinner = false;
    if (winnerTimer) {
      clearTimeout(winnerTimer);
      winnerTimer = null;
    }
    teams = teams.map((team) => ({
      ...team,
      score: 0,
      timeline: [],
    }));
  });

  socket.on("game:next-turn", (payload) => {
    activeTeamId = payload.activeTeamId || "";
    currentCard = normalizeCard(payload.card);
    playerCard = normalizeCard(payload.card);
    audioUrl = payload.card?.url || "";
    remainingCards = payload.remainingCards ?? remainingCards;
    pendingPlacement = null;
    audioState = payload.audioState || null;
  });

  socket.on("game:host-song-skipped", (payload) => {
    activeTeamId = payload.activeTeamId || activeTeamId;
    currentCard = normalizeCard(payload.card);
    playerCard = normalizeCard(payload.card);
    audioUrl = payload.card?.url || "";
    remainingCards = payload.remainingCards ?? remainingCards;
    pendingPlacement = null;
    audioState = payload.audioState || null;
  });

  socket.on("game:card-placed", (payload) => {
    pendingPlacement = {
      teamId: payload.teamId || "",
      position: payload.position ?? -1,
    };
  });

  socket.on("game:card-revealed", (payload) => {
    activeTeamId = payload.activeTeamId || activeTeamId;
    remainingCards = payload.remainingCards ?? remainingCards;
    currentCard = null;
    playerCard = normalizeCard(payload.card);
    if (!audioUrl && payload.card?.url) {
      audioUrl = payload.card.url;
    }
    lastRevealCorrect = Boolean(payload.correct);
    lastRevealedCard = payload.correct ? null : payload.card || null;
    lastRevealPosition = payload.correct ? -1 : payload.position ?? -1;
    lastRevealTeamId = payload.correct ? "" : payload.teamId || "";
    lastPlacedCardId = payload.correct ? payload.card?.id || "" : "";
    lastPlacedTeamId = payload.correct ? payload.teamId || "" : "";
    autoPlacedCardId = "";
    pendingPlacement = null;
    if (payload.audioState) {
      audioState = payload.audioState;
    }
  });

  socket.on("audio:state", (payload) => {
    audioState = payload || null;
  });

  socket.on("game:score-updated", (payload) => {
  });

  socket.on("game:round-ended", (payload) => {
  });

  socket.on("game:sudden-death", (payload) => {
  });

  socket.on("game:win", (payload) => {
    gameState = "finished";
    winnerTeamId = payload.teamId || "";
    if (winnerTimer) {
      clearTimeout(winnerTimer);
    }
    winnerTimer = setTimeout(() => {
      showWinner = true;
      winnerTimer = null;
    }, 2500);
  });

  socket.on("game:deck-empty", (payload) => {
    gameState = "finished";
    remainingCards = payload.remainingCards ?? 0;
    winnerTeamId = "";
    showWinner = false;
    if (winnerTimer) {
      clearTimeout(winnerTimer);
      winnerTimer = null;
    }
  });

  socket.on("error", (payload) => {
    lastError = `${payload.code}: ${payload.message}`;
  });

  onMount(async () => {
    baseUrl = window.location.origin;
    const storedClientId = window.localStorage.getItem("hitster:clientId");
    if (storedClientId) {
      clientId = storedClientId;
    } else if (typeof window !== "undefined") {
      clientId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `client-${Date.now()}`;
      window.localStorage.setItem("hitster:clientId", clientId);
    }
    const storedJoinName = window.localStorage.getItem("hitster:playerName");
    if (storedJoinName) {
      joinName = storedJoinName;
    }
    const storedTeam = window.localStorage.getItem("hitster:teamId");
    if (storedTeam) {
      storedTeamId = storedTeam;
    }
    localPrefsReady = true;
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      roomCode = roomFromUrl.toUpperCase();
      view = "lobby";
      inviteLink = `${getPublicAppBaseUrl()}?room=${roomCode}`;
      if (socket.connected) {
        emitRoomSync();
      }
    }
    if (pendingSync && socket.connected && roomCode) {
      emitRoomSync();
      pendingSync = false;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/packs`);
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
    socket.emit("room:create", { hostName, rules: buildRules(), clientId });
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
    if (typeof window !== "undefined") {
      window.localStorage.setItem("hitster:playerName", joinName);
    }
    socket.emit("room:join", { roomCode, playerName: joinName, clientId });
    emitRoomSync();
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

  function returnToLobby() {
    showWinner = false;
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    if (!isHost) {
      lastError = "only host can return to lobby";
      return;
    }
    socket.emit("game:return-to-lobby", { roomCode });
  }

  function handlePlayAgain() {
    showWinner = false;
    if (isHost) {
      startGame();
    }
  }

  function nextTurn() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    socket.emit("game:next-turn", { roomCode });
  }

  function hostSkipSong() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    if (!isHost) {
      lastError = "only host can use host menu";
      return;
    }
    socket.emit("game:host-skip-song", { roomCode });
  }

  function hostSoftReset() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    if (!isHost) {
      lastError = "only host can use host menu";
      return;
    }
    socket.emit("game:host-soft-reset", { roomCode });
  }

  function placeCard(position) {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    if (!activeTeamId || !currentCard) {
      lastError = "no active card";
      return;
    }
    socket.emit("game:place-card", {
      roomCode,
      teamId: activeTeamId,
      position,
    });
  }

  function syncAudioState(partial = {}) {
    if (!roomCode) {
      return;
    }
    socket.emit("audio:sync", {
      roomCode,
      videoId: partial.videoId || audioState?.videoId || "",
      currentTime: partial.currentTime ?? audioState?.currentTime ?? 0,
      isPaused: partial.isPaused ?? audioState?.isPaused ?? false,
    });
  }

  function revealCard() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    socket.emit("game:reveal-card", { roomCode });
  }

  $: if (currentCard && activeTeamId) {
    const activeTeam = teams.find((team) => team.id === activeTeamId);
    if (activeTeam && (activeTeam.timeline || []).length === 0 && autoPlacedCardId !== currentCard.id) {
      autoPlacedCardId = currentCard.id;
      placeCard(0);
    }
  }

  function joinTeam(teamId) {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    lastError = "";
    if (typeof window !== "undefined" && joinName) {
      window.localStorage.setItem("hitster:playerName", joinName);
    }
    socket.emit("team:join", {
      roomCode,
      teamId,
      playerName: joinName || "Player",
      clientId,
    });
    storedTeamId = teamId;
  }

  $: if (typeof window !== "undefined") {
    if (storedTeamId) {
      window.localStorage.setItem("hitster:teamId", storedTeamId);
    } else {
      window.localStorage.removeItem("hitster:teamId");
    }
  }

  onDestroy(() => {
    if (winnerTimer) {
      clearTimeout(winnerTimer);
      winnerTimer = null;
    }
    socket.disconnect();
  });

  $: leftTeams = teams.filter((_, index) => index % 2 === 0);
  $: rightTeams = teams.filter((_, index) => index % 2 === 1);
  $: isLobbyScreen = view === "create" || gameState === "lobby";
  $: winnerTeamName = teams.find((team) => team.id === winnerTeamId)?.name || "Team";
  $: winnerPlayers = players.filter((player) => player.teamId === winnerTeamId);
  $: playerColors = (() => {
    const sortedPlayers = [...players].sort((a, b) =>
      getPlayerKey(a).localeCompare(getPlayerKey(b))
    );
    const colorMap = {};
    if (sortedPlayers.length <= playerGlows.length) {
      sortedPlayers.forEach((player, index) => {
        colorMap[player.id] = playerGlows[index];
      });
      return colorMap;
    }
    sortedPlayers.forEach((player, index) => {
      if (index < playerGlows.length) {
        colorMap[player.id] = playerGlows[index];
      } else {
        colorMap[player.id] = getHashedGlow(player);
      }
    });
    return colorMap;
  })();
</script>

<main
  class="page"
  class:game-page={gameState === "playing" || gameState === "finished"}
  class:lobby-compact={isLobbyScreen}
>
  {#if view === "create"}
    <CreateLobby
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
  {:else if gameState === "playing" || gameState === "finished"}
    <GameView
      {players}
      {teams}
      {rules}
      {isHost}
      {gameState}
      {activeTeamId}
      {currentCard}
      {playerCard}
      {audioUrl}
      {audioState}
      {lastPlacedCardId}
      {lastPlacedTeamId}
      {lastRevealedCard}
      {lastRevealCorrect}
      {lastRevealPosition}
      {lastRevealTeamId}
      {pendingPlacement}
      {socketId}
      {clientId}
      {playerColors}
      onNextTurn={nextTurn}
      onPlaceCard={placeCard}
      onRevealCard={revealCard}
      onJoinTeam={joinTeam}
      onAudioSync={syncAudioState}
      onHostSkipSong={hostSkipSong}
      onHostSoftReset={hostSoftReset}
      onReturnToLobby={returnToLobby}
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
      {playerColors}
      bind:joinName
      {gameState}
      onJoinRoom={joinRoom}
      onJoinTeam={joinTeam}
      onStartGame={startGame}
      onNextTurn={nextTurn}
    />
  {/if}
</main>

{#if (gameState === "playing" || gameState === "finished") && !hasJoined}
  <JoinModal bind:joinName onJoin={joinRoom} />
{/if}

{#if showWinner}
  <WinnerScreen
    winnerName={winnerTeamName}
    {winnerPlayers}
    {playerColors}
    {isHost}
    on:playAgain={handlePlayAgain}
    on:returnToLobby={returnToLobby}
  />
{/if}

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
    --drawn-card-width: clamp(120px, 12vw, 160px);
    --drawn-card-height: 160px;
  }

  :global(html) {
    min-height: 100%;
    background: radial-gradient(circle at top, #1a1026 0%, #0b0b0f 45%, #060607 100%);
    background-repeat: no-repeat;
    background-attachment: fixed;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(circle at top, #1a1026 0%, #0b0b0f 45%, #060607 100%);
    background-repeat: no-repeat;
    background-attachment: fixed;
    color: var(--text);
  }

  :global(.page) {
    font-family: "Sora", sans-serif;
    padding: clamp(6px, 1.2vw, 16px) clamp(14px, 2.4vw, 22px) clamp(18px, 3vw, 40px);
    max-width: 1100px;
    margin: 0 auto;
  }

  :global(.page.game-page) {
    max-width: 100%;
  }

  :global(.page.lobby-compact) {
    padding: clamp(4px, 0.9vw, 12px) clamp(10px, 1.8vw, 18px) clamp(12px, 2.2vw, 26px);
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
    width: min(320px, 88vw);
    height: auto;
    display: block;
    filter: drop-shadow(0 0 8px rgba(255, 120, 214, 0.35))
      drop-shadow(0 0 18px rgba(255, 82, 200, 0.3));
  }

  :global(.page.lobby-compact .logo-title) {
    width: min(240px, 72vw);
  }

  :global(.logo-title.logo-small) {
    width: min(180px, 40vw);
  }

  :global(.game-header) {
    display: grid;
    gap: 8px;
  }

  :global(.game-actions) {
    display: flex;
    justify-content: center;
    gap: 10px;
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

  :global(.page.lobby-compact .layout) {
    gap: 12px;
  }

  :global(.layout.single) {
    grid-template-columns: minmax(0, 1fr);
  }

  :global(.column) {
    display: grid;
    gap: clamp(10px, 2vw, 16px);
  }

  :global(.page.lobby-compact .column) {
    gap: 10px;
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

  :global(.page.lobby-compact .card) {
    padding: clamp(10px, 1.6vw, 14px);
    gap: 8px;
  }

  :global(.lobby-frame) {
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(0, 1.6fr) minmax(200px, 1fr);
    gap: clamp(10px, 1.8vw, 18px);
    align-items: start;
  }

  :global(.page.lobby-compact .lobby-frame) {
    gap: 12px;
  }

  :global(.game-frame) {
    display: grid;
    gap: clamp(16px, 2vw, 24px);
  }


  :global(.music-player-card) {
    position: fixed;
    top: clamp(28px, 4vh, 52px);
    left: clamp(120px, 14vw, 300px);
    z-index: 7;
    width: min(440px, 48vw);
    min-height: 120px;
    background: linear-gradient(160deg, rgba(20, 20, 32, 0.94), rgba(10, 10, 18, 0.96));
    color: #f4f6ff;
    border-radius: 14px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 110, 200, 0.12);
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    grid-template-areas:
      "avatar body"
      "progress progress"
      "time time";
    column-gap: 10px;
    row-gap: 6px;
    align-items: center;
  }

  :global(.music-player-avatar) {
    grid-area: avatar;
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 0 1px rgba(255, 110, 200, 0.16);
  }

  :global(.music-player-body) {
    grid-area: body;
    display: grid;
    gap: 6px;
    align-content: center;
    justify-items: center;
    text-align: center;
  }

  :global(.music-player-title) {
    margin: 0;
    text-align: center;
    font-size: 0.95rem;
    font-weight: 700;
  }

  :global(.music-player-subtitle) {
    margin: 0;
    text-align: center;
    font-size: 0.78rem;
    color: rgba(236, 240, 255, 0.72);
  }

  :global(.music-player-controls) {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }

  :global(.music-control-btn) {
    position: relative;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.14);
    color: #f3f6ff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 0;
  }

  :global(.music-control-btn svg) {
    width: 16px;
    height: 16px;
    fill: currentColor;
    display: block;
  }

  :global(.music-seek-badge) {
    position: absolute;
    bottom: 3px;
    font-size: 0.5rem;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
  }

  :global(.music-control-btn-main) {
    width: 42px;
    height: 42px;
    background: rgba(255, 110, 200, 0.24);
  }

  :global(.music-control-btn-main svg) {
    width: 20px;
    height: 20px;
  }

  :global(.music-progress-track) {
    grid-area: progress;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    overflow: hidden;
    cursor: pointer;
  }

  :global(.music-progress-track:focus-visible) {
    outline: 2px solid rgba(20, 184, 166, 0.45);
    outline-offset: 3px;
  }

  :global(.music-progress-fill) {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #33d9c7, #7ce8d9);
  }

  :global(.music-time-row) {
    grid-area: time;
    display: flex;
    justify-content: space-between;
    font-size: 0.74rem;
    color: rgba(236, 240, 255, 0.72);
  }

  :global(.music-control-btn:hover) {
    background: rgba(255, 110, 200, 0.24);
  }


  @media (max-width: 900px) {
    :global(.music-player-card) {
      top: 12px;
      left: 12px;
      width: min(320px, calc(100vw - 16px));
      grid-template-columns: 76px minmax(0, 1fr);
      min-height: 104px;
      padding: 8px;
      column-gap: 8px;
      row-gap: 5px;
    }

    :global(.music-player-avatar) {
      width: 76px;
      height: 76px;
    }
  }

  :global(.audio-panel) {
    background: rgba(16, 16, 24, 0.8);
    border-radius: 18px;
    padding: clamp(10px, 2vw, 16px);
    border: 1px solid var(--border);
    display: grid;
    gap: 10px;
    width: min(640px, 100%);
  }

  :global(.audio-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  :global(.youtube-frame) {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    background: #0b0b0f;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  :global(.youtube-frame iframe) {
    width: 100%;
    height: 100%;
    border: 0;
  }

  :global(.audio-hidden) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  :global(.audio-hidden iframe) {
    width: 1px;
    height: 1px;
    border: 0;
  }

  :global(.audio-controls) {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(520px, 100%);
  }

  :global(.audio-controls input[type="range"]) {
    flex: 1;
    accent-color: #ff6ec8;
  }

  :global(.volume-dock) {
    position: fixed;
    right: clamp(12px, 2vw, 24px);
    bottom: clamp(12px, 2vw, 24px);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  :global(.volume-toggle) {
    width: 34px;
    height: 34px;
    border-radius: 0;
    background: transparent;
    border: 0;
    display: grid;
    place-items: center;
    color: #ffd9f0;
    cursor: pointer;
    box-shadow: none;
    line-height: 0;
    padding: 0;
  }

  :global(.volume-toggle:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 2px rgba(255, 110, 200, 0.45);
  }

  :global(.volume-toggle svg) {
    width: 26px;
    height: 26px;
    fill: currentColor;
    display: block;
    transform: translateX(0);
  }

  :global(.volume-panel) {
    position: absolute;
    left: 50%;
    bottom: 54px;
    width: 44px;
    height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateX(-50%);
  }

  :global(.ui-label) {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }

  :global(.volume-slider) {
    position: relative;
    width: 12px;
    height: 150px;
    display: grid;
    place-items: center;
    cursor: pointer;
    touch-action: none;
  }

  :global(.volume-track) {
    position: absolute;
    width: 6px;
    height: 100%;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 999px;
  }

  :global(.volume-fill) {
    position: absolute;
    width: 6px;
    bottom: 0;
    background: #ff6ec8;
    border-radius: 999px;
  }

  :global(.volume-thumb) {
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ff6ec8;
    box-shadow: 0 6px 16px rgba(255, 110, 200, 0.4);
    transform: translateY(50%);
  }

  :global(.volume-slider:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 2px rgba(255, 110, 200, 0.45);
    border-radius: 12px;
  }

  :global(.ui-slider::-moz-range-thumb) {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ff6ec8;
    border: 0;
    box-shadow: 0 6px 16px rgba(255, 110, 200, 0.4);
  }

  :global(.drawn-card) {
    position: fixed;
    right: clamp(12px, 2vw, 24px);
    top: clamp(28px, 4vh, 120px);
    z-index: 8;
    width: var(--drawn-card-width);
    height: var(--drawn-card-height);
    border-radius: 16px;
    background: radial-gradient(circle at top, rgba(30, 30, 38, 0.95), rgba(10, 10, 14, 0.98));
    border: 1px solid rgba(255, 255, 255, 0.12);
    display: grid;
    place-items: center;
    cursor: grab;
  }

  :global(.drag-ghost) {
    position: fixed;
    top: -9999px;
    left: -9999px;
    width: var(--drawn-card-width);
    height: var(--drawn-card-height);
    background: transparent;
    border: 0;
    display: block;
    pointer-events: none;
    z-index: -1;
  }

  :global(.drag-ghost-template) {
    position: fixed;
    top: -9999px;
    left: -9999px;
    width: var(--drawn-card-width);
    height: var(--drawn-card-height);
    visibility: hidden;
    pointer-events: none;
  }

  :global(.drag-ghost-template .timeline-card) {
    width: var(--drawn-card-width);
    height: var(--drawn-card-height);
  }

  :global(.drag-ghost .timeline-card) {
    width: 100%;
    height: 100%;
  }

  :global(.drawn-card:active) {
    cursor: grabbing;
  }

  :global(.drawn-card .timeline-logo) {
    width: 78px;
    opacity: 0.9;
  }

  :global(.lock-in) {
    position: fixed;
    right: clamp(12px, 2vw, 24px);
    top: 380px;
    z-index: 5;
  }

  :global(.team-timelines) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
  }

  :global(.team-timeline) {
    background: rgba(16, 16, 24, 0.7);
    border-radius: 20px;
    padding: clamp(12px, 2vw, 18px);
    border: 1px solid var(--border);
    display: grid;
    gap: 12px;
    width: 100%;
  }

  :global(.team-timeline.active-team) {
    border-color: rgba(80, 255, 150, 0.85);
    box-shadow: 0 0 0 2px rgba(80, 255, 150, 0.2), 0 0 18px rgba(80, 255, 150, 0.25);
  }

  :global(.team-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  :global(.team-header-actions) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(.team-players) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  :global(.player-pill) {
    padding: 4px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--player-glow, #3df0ff), #0b0b0f 82%);
    border: 1px solid color-mix(in srgb, var(--player-glow, #3df0ff), #ffffff 18%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--player-glow, #3df0ff), #000000 55%),
      0 0 14px color-mix(in srgb, var(--player-glow, #3df0ff), transparent 35%);
    font-size: 12px;
    color: #f5f5f8;
  }

  :global(.timeline-row) {
    overflow-x: hidden;
    overflow-y: visible;
    padding-bottom: 6px;
  }

  :global(.timeline-row.has-lockin) {
    padding-top: 44px;
  }

  :global(.timeline-row.needs-scroll) {
    overflow-x: auto;
    overflow-y: visible;
  }

  :global(.timeline-cards) {
    --timeline-card-width: clamp(120px, 12vw, 160px);
    --drop-hit-width: 10px;
    --springy-ease: cubic-bezier(0.34, 1.56, 0.64, 1);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 0;
    align-items: stretch;
    justify-content: center;
    min-width: 100%;
  }

  :global(.timeline-slot) {
    display: grid;
    perspective: 900px;
    width: var(--timeline-card-width);
    transition: width 0.4s var(--springy-ease), margin-right 0.4s var(--springy-ease);
  }

  :global(.timeline-slot.card-slot) {
    margin-right: 12px;
  }

  :global(.timeline-slot.pending-slot) {
    position: relative;
  }

  :global(.lock-in-button) {
    position: absolute;
    top: -34px;
    left: 50%;
    transform: translateX(-50%) !important;
    z-index: 3;
    white-space: nowrap;
  }

  :global(.lock-in-button:hover) {
    transform: translate(-50%, -1px) !important;
  }

  :global(.timeline-slot.drop-slot) {
    position: relative;
    width: var(--drop-hit-width);
    margin-right: 0;
    transition: width 0.4s var(--springy-ease), margin-right 0.4s var(--springy-ease);
  }

  :global(.timeline-slot.drop-slot.show-drop) {
    width: var(--timeline-card-width);
    margin-right: 12px;
  }

  :global(.timeline-drop) {
    border: 1px dashed rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    min-height: 48px;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.35);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0;
    transform: scale(0.96);
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, opacity 0.24s ease,
      transform 1s var(--springy-ease);
  }

  :global(.timeline-slot.drop-slot.show-drop .timeline-drop) {
    opacity: 1;
    transform: scale(1);
  }

  :global(.timeline-drop.active) {
    border-color: rgba(255, 110, 200, 0.6);
    color: rgba(255, 214, 240, 0.85);
    background: rgba(255, 110, 200, 0.08);
  }

  :global(.timeline-drop-label) {
    pointer-events: none;
  }

  :global(.timeline-card) {
    border-radius: 16px;
    padding: 10px 12px;
    min-height: 160px;
    background: linear-gradient(180deg, hsl(var(--card-hue, 270deg) 55% 72%), hsl(var(--card-hue, 270deg) 48% 62%));
    border: 2px solid rgba(0, 0, 0, 0.08);
    color: #1a0f1e;
    display: grid;
    gap: 8px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  :global(.timeline-card.filled) {
    color: #261019;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.18);
    transform-style: preserve-3d;
  }

  :global(.timeline-card.placed) {
    animation: cardFlip 0.7s ease;
  }

  :global(.timeline-card.reveal) {
    box-shadow: inset 0 0 0 2px rgba(255, 110, 200, 0.4);
    animation: revealPulse 1.6s ease-in-out infinite;
    transform-style: preserve-3d;
  }

  :global(.timeline-card.reveal) {
    animation: cardFlip 0.7s ease, revealPulse 1.6s ease-in-out infinite;
  }

  @keyframes revealPulse {
    0%, 100% {
      box-shadow: inset 0 0 0 2px rgba(255, 110, 200, 0.35), 0 0 12px rgba(255, 110, 200, 0.2);
    }
    50% {
      box-shadow: inset 0 0 0 2px rgba(255, 110, 200, 0.6), 0 0 16px rgba(255, 110, 200, 0.35);
    }
  }

  @keyframes cardFlip {
    0% {
      transform: rotateY(90deg) scale(0.98);
      opacity: 0.4;
    }
    60% {
      transform: rotateY(-8deg) scale(1);
      opacity: 1;
    }
    100% {
      transform: rotateY(0deg) scale(1);
      opacity: 1;
    }
  }

  :global(.timeline-card.back) {
    background: radial-gradient(circle at top, rgba(30, 30, 38, 0.95), rgba(10, 10, 14, 0.98));
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.6);
    min-height: 160px;
    place-items: center;
  }

  :global(.timeline-card.pending-drag) {
    cursor: grab;
  }

  :global(.timeline-card.pending-drag:active) {
    cursor: grabbing;
  }

  :global(.timeline-top) {
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 12px;
    color: rgba(20, 12, 22, 0.8);
  }

  :global(.timeline-artist) {
    font-size: 12px;
  }

  :global(.timeline-center) {
    display: grid;
    gap: 6px;
    place-items: center;
  }

  :global(.timeline-logo) {
    width: 42px;
    height: auto;
    opacity: 0.7;
  }

  :global(.timeline-card.back .timeline-logo) {
    width: 120px;
    opacity: 0.85;
  }

  :global(.timeline-year) {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  :global(.timeline-title) {
    font-size: 12px;
    font-style: italic;
  }


  :global(.score-badge) {
    background: rgba(255, 110, 200, 0.15);
    color: #ffd9f0;
    border: 1px solid rgba(255, 110, 200, 0.35);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
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

  :global(.page.lobby-compact .teams-list) {
    max-height: min(52vh, 520px);
    overflow: auto;
    padding-right: 6px;
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

  :global(.pack-toolbar) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  :global(.pack-search) {
    min-width: 200px;
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
    --pack-button-height: 64px;
    display: grid;
    grid-template-columns: repeat(2, 220px);
    grid-auto-rows: var(--pack-button-height);
    gap: 8px 16px;
    justify-content: center;
    padding-top: 4px;
  }

  :global(.page.lobby-compact .pack-list) {
    --pack-button-height: 54px;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    max-height: min(40vh, 360px);
    overflow: auto;
    padding-right: 6px;
    padding-top: 4px;
  }


  :global(.pack-button) {
    border: 1px solid rgba(255, 90, 130, 0.35);
    border-radius: 14px;
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(26, 16, 26, 0.9), rgba(18, 12, 18, 0.92));
    color: #ffe1ea;
    text-align: center;
    cursor: pointer;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 0 1px rgba(20, 12, 20, 0.6), 0 10px 20px rgba(8, 6, 10, 0.35);
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease,
      background 0.15s ease, color 0.15s ease;
  }

  :global(.page.lobby-compact .pack-button) {
    width: 100%;
    height: 54px;
    padding: 10px 12px;
  }

  :global(.pack-label) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.2;
  }

  :global(.pack-button:hover) {
    transform: translateY(-1px);
  }

  :global(.pack-button.selected) {
    border-color: rgba(70, 255, 160, 0.8);
    background: linear-gradient(180deg, rgba(12, 40, 26, 0.95), rgba(10, 26, 20, 0.95));
    color: #e6fff3;
    box-shadow: inset 0 0 0 1px rgba(32, 120, 72, 0.45), 0 0 18px rgba(60, 240, 150, 0.35);
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

  :global(.actions.full) {
    width: 100%;
  }

  :global(.actions.full button) {
    width: 100%;
    justify-content: center;
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
    :global(.timeline-cards) {
      --timeline-card-width: clamp(110px, 14vw, 140px);
      --drop-hit-width: 8px;
    }
  }
</style>
