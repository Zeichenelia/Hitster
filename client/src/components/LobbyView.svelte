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
  export let onJoinRoom = () => {};
  export let onJoinTeam = () => {};
  export let onStartGame = () => {};
  export let onNextTurn = () => {};

  let inviteCopied = false;
  let inviteCopiedTimer;

  $: playersByTeam = players.reduce((acc, player) => {
    if (player.teamId) {
      const key = String(player.teamId);
      acc[key] = acc[key] || [];
      acc[key].push(player);
    }
    return acc;
  }, {});

  $: unassignedPlayers = players.filter((player) => !player.teamId);

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

  const getPlayerGlow = (player) => {
    const key = String(player.id || player.name || "");
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (hash + key.charCodeAt(i) * (i + 1)) % 2147483647;
    }
    return playerGlows[Math.abs(hash) % playerGlows.length];
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
            <strong>{team.name}</strong>
            <button class="ghost" on:click={() => onJoinTeam(team.id)}>Join</button>
            {#if (playersByTeam[team.id] || []).length === 0}
              <p class="muted">No players yet.</p>
            {:else}
              <div class="player-list">
                {#each playersByTeam[team.id] as player}
                  <div class="player-card" style={`--player-glow: ${getPlayerGlow(player)}`}>
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
              <div class="player-card" style={`--player-glow: ${getPlayerGlow(player)}`}>
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
          <button class="primary" on:click={onStartGame}>Start game</button>
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
            <strong>{team.name}</strong>
            <button class="ghost" on:click={() => onJoinTeam(team.id)}>Join</button>
            {#if (playersByTeam[team.id] || []).length === 0}
              <p class="muted">No players yet.</p>
            {:else}
              <div class="player-list">
                {#each playersByTeam[team.id] as player}
                  <div class="player-card" style={`--player-glow: ${getPlayerGlow(player)}`}>
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
