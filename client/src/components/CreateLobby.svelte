<script>
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

  let packSearch = "";
  const defaultHostName = "Host";

  const isPackSelected = (packId) => selectedPackIds.includes(packId);

  const togglePack = (packId) => {
    if (isPackSelected(packId)) {
      selectedPackIds = selectedPackIds.filter((id) => id !== packId);
      return;
    }
    selectedPackIds = [...selectedPackIds, packId];
  };

  $: filteredPacks = packs.filter((pack) => {
    const name = (pack.name || "").toLowerCase();
    return name.includes(packSearch.trim().toLowerCase());
  });

  const clearDefaultHostName = () => {
    if (hostName === defaultHostName) {
      hostName = "";
    }
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

<section class="layout single">
  <div class="column">
    <div class="card">
      <h2>Host setup</h2>
      <div class="field">
        <label for="host-name">Host name</label>
        <input
          id="host-name"
          bind:value={hostName}
          placeholder="Your name"
          on:focus={clearDefaultHostName}
        />
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
      <div class="pack-toolbar">
        <p class="hint">Selected: {selectedPackIds.length} of {packs.length}</p>
        <input
          class="pack-search"
          type="search"
          placeholder="Search packs"
          bind:value={packSearch}
        />
      </div>
      {#if packsLoading}
        <p>Loading packs...</p>
      {:else if packs.length === 0}
        <p>No packs available.</p>
      {:else if filteredPacks.length === 0}
        <p>No packs match your search.</p>
      {:else}
        <div class="pack-list">
          {#each filteredPacks as pack}
            <button
              type="button"
              class="pack-button"
              class:selected={isPackSelected(pack.id)}
              on:click={() => togglePack(pack.id)}
            >
              <span class="pack-label">{pack.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="actions full">
      <button class="primary" on:click={onCreateRoom}>Create room</button>
    </div>
  </div>
</section>
