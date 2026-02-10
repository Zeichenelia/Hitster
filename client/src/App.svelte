<script>
  import { onDestroy, onMount } from "svelte";
  import { io } from "socket.io-client";

  const socket = io("http://localhost:3001");

  let roomCode = "";
  let playerName = "Player";
  let hostName = "Host";
  let status = "disconnected";
  let lastError = "";

  let packs = [];
  let selectedPackIds = [];
  let packsLoading = true;

  socket.on("connect", () => {
    status = `connected: ${socket.id}`;
    console.log("socket connected", socket.id);
  });

  socket.on("room:created", (payload) => {
    roomCode = payload.roomCode;
    console.log("room created", payload);
  });

  socket.on("room:players", (payload) => {
    console.log("players", payload);
  });

  socket.on("room:rules", (payload) => {
    console.log("rules", payload);
  });

  socket.on("room:teams", (payload) => {
    console.log("teams", payload);
  });

  socket.on("game:started", (payload) => {
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
    console.log("win", payload);
  });

  socket.on("game:deck-empty", (payload) => {
    console.log("deck empty", payload);
  });

  socket.on("error", (payload) => {
    lastError = `${payload.code}: ${payload.message}`;
    console.log("error", payload);
  });

  onMount(async () => {
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

  function createRoom() {
    socket.emit("room:create", { hostName });
  }

  function joinRoom() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    socket.emit("room:join", { roomCode, playerName });
  }

  function setPacks() {
    if (!roomCode) {
      lastError = "room code required";
      return;
    }
    if (selectedPackIds.length === 0) {
      lastError = "select at least one pack";
      return;
    }
    socket.emit("rules:update", { roomCode, rules: { packs: selectedPackIds } });
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

  onDestroy(() => {
    socket.disconnect();
  });
</script>

<main>
  <h1>Hitster Client</h1>
  <p>Status: {status}</p>
  {#if lastError}
    <p>Last error: {lastError}</p>
  {/if}

  <div class="panel">
    <label>
      Host name
      <input bind:value={hostName} />
    </label>
    <button on:click={createRoom}>Create room</button>
  </div>

  <div class="panel">
    <label>
      Room code
      <input bind:value={roomCode} />
    </label>
    <label>
      Player name
      <input bind:value={playerName} />
    </label>
    <button on:click={joinRoom}>Join room</button>
  </div>

  <div class="panel packs">
    <div>
      <strong>Packs</strong>
      {#if packsLoading}
        <p>Loading packs...</p>
      {:else if packs.length === 0}
        <p>No packs available.</p>
      {:else}
        <div class="pack-list">
          {#each packs as pack}
            <label class="pack-item">
              <input type="checkbox" value={pack.id} bind:group={selectedPackIds} />
              <span>{pack.name}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="panel">
    <button on:click={setPacks}>Set packs</button>
    <button on:click={startGame}>Start game</button>
    <button on:click={nextTurn}>Next turn</button>
  </div>
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    padding: 24px;
  }
  .panel {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;
  }
  .packs {
    align-items: flex-start;
  }
  .pack-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 6px 16px;
    margin-top: 8px;
  }
  .pack-item {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  input {
    padding: 6px 8px;
  }
  button {
    padding: 6px 12px;
  }
</style>