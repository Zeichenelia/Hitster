<script>
  export let status = "";
  export let lastError = "";
  export let hostName = "";
  export let teamCount = 2;
  export let winTarget = 10;
  export let guessMode = "year";
  export let timerEnabled = false;
  export let timerDuration = 60;
  export let packs = [];
  export let packsLoading = false;
  export let selectedPackIds = [];
  export let onCreateRoom = () => {};
  export let onSelectAllPacks = () => {};
  export let onClearPacks = () => {};
</script>

<header class="top">
  <div>
    <span class="tag">Hitster Create Lobby</span>
    <h1>Set your rules, then create the room.</h1>
    <p class="subtitle">Packs, teams, and timer are locked in at creation.</p>
  </div>
  <div class="status-card">
    <span class="label">Status</span>
    <strong>{status}</strong>
  </div>
</header>

{#if lastError}
  <div class="alert">
    <strong>Last error</strong>
    <span>{lastError}</span>
  </div>
{/if}

<section class="layout single">
  <div class="column">
    <div class="card">
      <h2>Host setup</h2>
      <div class="field">
        <label for="host-name">Host name</label>
        <input id="host-name" bind:value={hostName} placeholder="Your name" />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="team-count">Teams</label>
          <input id="team-count" type="number" min="2" max="6" bind:value={teamCount} />
        </div>
        <div class="field">
          <label for="win-target">Win target</label>
          <input id="win-target" type="number" min="1" max="50" bind:value={winTarget} />
        </div>
      </div>
      <div class="field">
        <label for="guess-mode">Guess mode</label>
        <select id="guess-mode" bind:value={guessMode}>
          <option value="year">Year only</option>
          <option value="year+artist">Year + Artist</option>
          <option value="year+artist+title">Year + Artist + Title</option>
        </select>
      </div>
      <div class="field">
        <label class="checkbox">
          <input type="checkbox" bind:checked={timerEnabled} />
          Enable timer
        </label>
        {#if timerEnabled}
          <label for="timer-duration">Timer seconds</label>
          <input id="timer-duration" type="number" min="10" max="180" bind:value={timerDuration} />
        {/if}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Packs</h2>
        <div class="pack-actions">
          <button class="ghost" on:click={onSelectAllPacks}>Select all</button>
          <button class="ghost" on:click={onClearPacks}>Clear</button>
        </div>
      </div>
      <p class="hint">Selected: {selectedPackIds.length} of {packs.length}</p>
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

    <div class="actions">
      <button class="primary" on:click={onCreateRoom}>Create room</button>
    </div>
  </div>
</section>
