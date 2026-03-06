<script>
  import JoinModal from "./JoinModal.svelte";

  export let inviteLink = "";
  export let lastError = "";
  export let players = [];
  export let leftTeams = [];
  export let rightTeams = [];
  export let rules = null;
  export let isHost = false;
  export let hasJoined = false;
  export let joinName = "";
  export let gameState = "lobby";
  export let playerColors = {};
  export let socketId = "";
  export let clientId = "";
  export let onJoinRoom = () => {};
  export let onJoinTeam = () => {};
  export let onRenameTeam = () => {};
  export let onStartGame = () => {};
  export let onNextTurn = () => {};

  let inviteCopied = false;
  let inviteCopiedTimer;
  let editingTeamId = "";
  let draftTeamName = "";

  $: playersByTeam = players.reduce((acc, player) => {
    if (player.teamId) {
      const key = String(player.teamId);
      acc[key] = acc[key] || [];
      acc[key].push(player);
    }
    return acc;
  }, {});

  $: unassignedPlayers = players.filter((player) => !player.teamId);
  $: canStartGame = unassignedPlayers.length === 0;
  $: currentPlayer =
    players.find((player) => player.clientId && player.clientId === clientId) ||
    players.find((player) => player.id === socketId) ||
    null;
  $: myTeamId = currentPlayer?.teamId || "";

  const canRenameTeam = (teamId) => Boolean(myTeamId) && myTeamId === teamId;

  const startRenameTeam = (team) => {
    if (!canRenameTeam(team.id)) {
      return;
    }
    editingTeamId = team.id;
    draftTeamName = team.name || "";
  };

  const cancelRenameTeam = () => {
    editingTeamId = "";
    draftTeamName = "";
  };

  const submitRenameTeam = (teamId) => {
    if (!canRenameTeam(teamId)) {
      return;
    }
    const nextName = String(draftTeamName || "").trim();
    if (!nextName) {
      return;
    }
    onRenameTeam(teamId, nextName);
    cancelRenameTeam();
  };

  const copyInviteLink = async () => {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (error) {
      const fallback = document.createElement("textarea");
      fallback.value = inviteLink;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "absolute";
      fallback.style.left = "-9999px";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      document.body.removeChild(fallback);
    }
    inviteCopied = true;
    clearTimeout(inviteCopiedTimer);
    inviteCopiedTimer = setTimeout(() => {
      inviteCopied = false;
    }, 2000);
  };
</script>

<header class="top top-center logo-header">
  <img class="logo-title" src="/assets/hitster-logo.png" alt="Hitster" />
</header>

{#if lastError}
  <div class="alert">
    <strong>Last error</strong>
    <span>{lastError}</span>
  </div>
{/if}

<section class="lobby-frame">
  <aside class="teams-side">
    {#if leftTeams.length === 0}
      <p class="muted">No teams yet.</p>
    {:else}
      <div class="teams-list">
        {#each leftTeams as team}
          <div class="team-row stacked">
            <div class="team-name-row">
              {#if editingTeamId === team.id}
                <input
                  class="team-name-input"
                  type="text"
                  maxlength="40"
                  bind:value={draftTeamName}
                  on:keydown={(event) => {
                    if (event.key === "Enter") {
                      submitRenameTeam(team.id);
                    }
                    if (event.key === "Escape") {
                      cancelRenameTeam();
                    }
                  }}
                />
                <button class="ghost team-edit-action" on:click={() => submitRenameTeam(team.id)}>Save</button>
                <button class="ghost team-edit-action" on:click={cancelRenameTeam}>Cancel</button>
              {:else}
                <strong>{team.name}</strong>
                {#if canRenameTeam(team.id)}
                  <button
                    class="team-edit-button"
                    type="button"
                    aria-label="Teamnamen bearbeiten"
                    on:click={() => startRenameTeam(team)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                    </svg>
                  </button>
                {/if}
              {/if}
            </div>
            <button class="ghost" on:click={() => onJoinTeam(team.id)}>Join</button>
            {#if (playersByTeam[team.id] || []).length === 0}
              <p class="muted">No players yet.</p>
            {:else}
              <div class="player-list">
                {#each playersByTeam[team.id] as player}
                  <div
                    class="player-card"
                    style={`--player-glow: ${playerColors[player.id] || "#3df0ff"}`}
                  >
                    {player.name}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </aside>

  <div class="layout lobby-center">
    <div class="column">
      <div class="card">
        <h2>Invite</h2>
        {#if inviteLink}
          <div class="room-code">
            <span>Invite link</span>
            <strong class="mono">{inviteLink}</strong>
            <button class="ghost" on:click={copyInviteLink}>
              {inviteCopied ? "Copied!" : "Copy invite"}
            </button>
          </div>
        {:else}
          <p class="muted">Invite link not ready.</p>
        {/if}
      </div>

      <div class="card">
        <h2>Players</h2>
        {#if unassignedPlayers.length === 0}
          <p class="muted">No players yet.</p>
        {:else}
          <div class="player-list">
            {#each unassignedPlayers as player}
              <div
                class="player-card"
                style={`--player-glow: ${playerColors[player.id] || "#3df0ff"}`}
              >
                {player.name}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="column">
      <div class="card">
        <h2>Room rules</h2>
        {#if rules}
          <p class="hint">Teams: {rules.teamCount}</p>
          <p class="hint">Win target: {rules.winTarget}</p>
          <p class="hint">Guess mode: {rules.guessMode}</p>
          <p class="hint">Timer: {rules.timerEnabled ? `${rules.timerDuration}s` : "off"}</p>
        {:else}
          <p class="muted">Rules not loaded yet.</p>
        {/if}
      </div>

      <div class="card">
        <h2>Host controls</h2>
        <p class="hint">Temporary controls for testing the flow.</p>
        <div class="stack">
          <button class="primary" on:click={onStartGame} disabled={!canStartGame}>Start game</button>
          {#if !canStartGame}
            <p class="muted">All players must join a team before game start.</p>
          {/if}
          {#if gameState === "playing"}
            <button class="ghost" on:click={onNextTurn}>Next turn</button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <aside class="teams-side">
    {#if rightTeams.length === 0}
      <p class="muted">No teams yet.</p>
    {:else}
      <div class="teams-list">
        {#each rightTeams as team}
          <div class="team-row stacked">
            <div class="team-name-row">
              {#if editingTeamId === team.id}
                <input
                  class="team-name-input"
                  type="text"
                  maxlength="40"
                  bind:value={draftTeamName}
                  on:keydown={(event) => {
                    if (event.key === "Enter") {
                      submitRenameTeam(team.id);
                    }
                    if (event.key === "Escape") {
                      cancelRenameTeam();
                    }
                  }}
                />
                <button class="ghost team-edit-action" on:click={() => submitRenameTeam(team.id)}>Save</button>
                <button class="ghost team-edit-action" on:click={cancelRenameTeam}>Cancel</button>
              {:else}
                <strong>{team.name}</strong>
                {#if canRenameTeam(team.id)}
                  <button
                    class="team-edit-button"
                    type="button"
                    aria-label="Teamnamen bearbeiten"
                    on:click={() => startRenameTeam(team)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                    </svg>
                  </button>
                {/if}
              {/if}
            </div>
            <button class="ghost" on:click={() => onJoinTeam(team.id)}>Join</button>
            {#if (playersByTeam[team.id] || []).length === 0}
              <p class="muted">No players yet.</p>
            {:else}
              <div class="player-list">
                {#each playersByTeam[team.id] as player}
                  <div
                    class="player-card"
                    style={`--player-glow: ${playerColors[player.id] || "#3df0ff"}`}
                  >
                    {player.name}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </aside>
</section>

{#if !isHost && !hasJoined}
  <JoinModal bind:joinName onJoin={onJoinRoom} />
{/if}

<style>
  .team-name-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .team-edit-button {
    padding: 4px;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .team-edit-button svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .team-edit-action {
    padding: 6px 10px;
  }

  .team-name-input {
    width: min(180px, 100%);
    text-align: center;
  }
</style>
