<script>
  import { onMount } from "svelte";

  export let apiBaseUrl = "";
  export let packs = [];
  export let onClose = () => {};
  export let onPacksUpdated = () => {};

  let activeTab = "manage"; // "manage" | "create"
  let selectedPackId = packs[0]?.id || "";
  let songs = [];
  let songsLoading = false;
  let songSearch = "";
  let filterBrokenOnly = false;

  let pin = "";
  let isUnlocked = false;
  let pinChecking = false;
  let dbConnected = false;
  let dbError = "";
  let dbChecking = false;

  let statusMsg = "";
  let errorMsg = "";

  // Add Single Song state
  let newUrl = "";
  let newArtist = "";
  let newTitle = "";
  let newYear = "";
  let metaLoading = false;
  let addingSong = false;

  // Bulk CSV add to existing playlist
  let showBulkImport = false;
  let bulkCsvText = "";
  let bulkFileName = "";

  // Edit Song state
  let editingSongId = null;
  let editArtist = "";
  let editTitle = "";
  let editYear = "";
  let editUrl = "";
  let savingEdit = false;

  // Create New Playlist state
  let newPackName = "";
  let newPackLogo = "";
  let newPackCsvText = "";
  let newPackCsvFileName = "";
  let creatingPack = false;

  const showFeedback = (msg, isError = false) => {
    if (isError) {
      errorMsg = msg;
      statusMsg = "";
    } else {
      statusMsg = msg;
      errorMsg = "";
    }
  };

  $: if (!selectedPackId && packs.length > 0) {
    selectedPackId = packs[0].id;
  }

  $: if (selectedPackId) {
    loadSongs(selectedPackId);
  }

  async function checkServerStatus() {
    dbChecking = true;
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists/status`);
      if (res.ok) {
        const data = await res.json();
        dbConnected = Boolean(data.dbConnected);
        dbError = data.error || "";
        if (dbConnected) {
          dbError = "";
        }
      }
    } catch (err) {
      dbError = err.message || "Server nicht erreichbar";
    } finally {
      dbChecking = false;
    }
  }

  async function verifyPin(pinToVerify = pin, silent = false) {
    const cleaned = String(pinToVerify || "").trim();
    if (!cleaned) {
      if (!silent) showFeedback("Bitte PIN eingeben.", true);
      return false;
    }
    pinChecking = true;
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: cleaned }),
      });
      const data = await res.json();
      dbConnected = Boolean(data.dbConnected);
      if (data.valid) {
        isUnlocked = true;
        pin = cleaned;
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("hitster:adminPin", cleaned);
        }
        if (!silent) showFeedback("Bearbeitungsmodus freigeschaltet!");
        return true;
      } else {
        isUnlocked = false;
        if (!silent) showFeedback("Falscher PIN-Code.", true);
        return false;
      }
    } catch (err) {
      if (!silent) showFeedback("PIN-Prüfung fehlgeschlagen.", true);
      return false;
    } finally {
      pinChecking = false;
    }
  }

  async function loadSongs(packId) {
    if (!packId) return;
    songsLoading = true;
    editingSongId = null;
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists/${encodeURIComponent(packId)}/songs`);
      if (!res.ok) {
        throw new Error("Songs konnten nicht geladen werden.");
      }
      const data = await res.json();
      songs = data.songs || [];
    } catch (err) {
      showFeedback(err.message || "Fehler beim Laden der Songs.", true);
    } finally {
      songsLoading = false;
    }
  }

  async function fetchYouTubeMeta(urlValue) {
    const trimmed = String(urlValue || "").trim();
    if (!trimmed || !/(?:youtu\.be\/|v=|\/embed\/)([\w-]{11})/u.test(trimmed)) {
      return;
    }
    metaLoading = true;
    try {
      const res = await fetch(`${apiBaseUrl}/api/youtube-meta?url=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return;
      const meta = await res.json();
      if (meta.artist && !newArtist.trim()) {
        newArtist = meta.artist;
      }
      if (meta.title && !newTitle.trim()) {
        newTitle = meta.title;
      }
      if (meta.year && !newYear) {
        newYear = String(meta.year);
      }
    } catch (_err) {
      // Optional helper
    } finally {
      metaLoading = false;
    }
  }

  async function handleAddSong() {
    if (!isUnlocked) {
      showFeedback("Bitte zuerst oben mit PIN freischalten.", true);
      return;
    }
    if (!selectedPackId) {
      showFeedback("Bitte zuerst eine Playlist auswählen.", true);
      return;
    }
    const yearNum = Number.parseInt(newYear, 10);
    if (!newArtist.trim() || !newTitle.trim() || !newUrl.trim() || !yearNum) {
      showFeedback("Bitte YouTube-Link, Interpret, Titel und gültiges Erscheinungsjahr ausfüllen.", true);
      return;
    }
    addingSong = true;
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists/${encodeURIComponent(selectedPackId)}/songs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({
          song: {
            artist: newArtist.trim(),
            title: newTitle.trim(),
            year: yearNum,
            url: newUrl.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Song konnte nicht hinzugefügt werden.");
      }
      songs = data.songs || songs;
      if (data.packs) {
        onPacksUpdated(data.packs);
      }
      newUrl = "";
      newArtist = "";
      newTitle = "";
      newYear = "";
      showFeedback("Song erfolgreich zur Playlist hinzugefügt!");
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      addingSong = false;
    }
  }

  async function handleBulkCsvAdd() {
    if (!isUnlocked || !selectedPackId || !bulkCsvText.trim()) {
      return;
    }
    addingSong = true;
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists/${encodeURIComponent(selectedPackId)}/songs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({ csvText: bulkCsvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "CSV-Import fehlgeschlagen.");
      }
      songs = data.songs || songs;
      if (data.packs) {
        onPacksUpdated(data.packs);
      }
      bulkCsvText = "";
      bulkFileName = "";
      showBulkImport = false;
      showFeedback("CSV-Songs erfolgreich importiert!");
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      addingSong = false;
    }
  }

  function startEditSong(song) {
    editingSongId = song.dbId || song.id;
    editArtist = song.artist || "";
    editTitle = song.title || "";
    editYear = String(song.year || "");
    editUrl = song.url || "";
  }

  async function saveEditSong(song) {
    const songKey = song.dbId || song.id;
    savingEdit = true;
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/playlists/${encodeURIComponent(selectedPackId)}/songs/${encodeURIComponent(songKey)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-admin-pin": pin,
          },
          body: JSON.stringify({
            artist: editArtist.trim(),
            title: editTitle.trim(),
            year: Number.parseInt(editYear, 10) || song.year,
            url: editUrl.trim(),
            isBroken: false,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Speichern fehlgeschlagen.");
      }
      songs = data.songs || songs;
      editingSongId = null;
      showFeedback("Song aktualisiert!");
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      savingEdit = false;
    }
  }

  async function handleDeleteSong(song) {
    const songKey = song.dbId || song.id;
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/playlists/${encodeURIComponent(selectedPackId)}/songs/${encodeURIComponent(songKey)}`,
        {
          method: "DELETE",
          headers: { "x-admin-pin": pin },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Löschen fehlgeschlagen.");
      }
      songs = data.songs || songs;
      if (data.packs) {
        onPacksUpdated(data.packs);
      }
      showFeedback("Song entfernt.");
    } catch (err) {
      showFeedback(err.message, true);
    }
  }

  async function handleCreatePlaylist() {
    if (!isUnlocked) {
      showFeedback("Bitte zuerst oben mit PIN freischalten.", true);
      return;
    }
    if (!newPackName.trim()) {
      showFeedback("Bitte einen Namen für die neue Playlist eingeben.", true);
      return;
    }
    creatingPack = true;
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({
          name: newPackName.trim(),
          logo: newPackLogo.trim(),
          csvText: newPackCsvText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Playlist konnte nicht erstellt werden.");
      }
      if (data.packs) {
        onPacksUpdated(data.packs, data.pack?.id);
      }
      if (data.pack?.id) {
        selectedPackId = data.pack.id;
      }
      newPackName = "";
      newPackLogo = "";
      newPackCsvText = "";
      newPackCsvFileName = "";
      activeTab = "manage";
      showFeedback(`Playlist "${data.pack?.name}" erfolgreich erstellt!`);
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      creatingPack = false;
    }
  }

  async function handleDeletePlaylist() {
    if (!isUnlocked || !selectedPackId) return;
    const currentPack = packs.find((p) => p.id === selectedPackId);
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Playlist "${currentPack?.name || selectedPackId}" wirklich komplett löschen?`)
    ) {
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists/${encodeURIComponent(selectedPackId)}`, {
        method: "DELETE",
        headers: { "x-admin-pin": pin },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Playlist konnte nicht gelöscht werden.");
      }
      if (data.packs) {
        onPacksUpdated(data.packs);
        selectedPackId = data.packs[0]?.id || "";
      }
      showFeedback("Playlist gelöscht.");
    } catch (err) {
      showFeedback(err.message, true);
    }
  }

  function handleCsvFileUpload(event, target) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (target === "newPack") {
        newPackCsvText = text;
        newPackCsvFileName = file.name;
      } else {
        bulkCsvText = text;
        bulkFileName = file.name;
      }
    };
    reader.readAsText(file, "utf-8");
  }

  $: filteredSongs = songs.filter((song) => {
    if (filterBrokenOnly && !song.isBroken) {
      return false;
    }
    const q = songSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(song.artist || "").toLowerCase().includes(q) ||
      String(song.title || "").toLowerCase().includes(q) ||
      String(song.year || "").includes(q)
    );
  });

  $: brokenCount = songs.filter((s) => s.isBroken).length;

  onMount(() => {
    checkServerStatus();
    if (typeof window !== "undefined") {
      const savedPin = window.sessionStorage.getItem("hitster:adminPin");
      if (savedPin) {
        verifyPin(savedPin, true);
      }
    }
  });
</script>

<div class="modal-backdrop playlist-modal-backdrop" role="presentation" on:click|self={onClose}>
  <div class="playlist-modal" role="dialog" aria-modal="true" aria-label="Playlists und Songs verwalten">
    <div class="pm-header">
      <div class="pm-title-group">
        <h2>🎵 Playlists & Songs</h2>
        <span class="pm-db-badge" class:connected={dbConnected}>
          {dbConnected ? "🟢 MariaDB verbunden" : "💾 Lokaler Speicher"}
        </span>
        {#if !dbConnected}
          <button
            class="ghost pm-tiny-btn"
            type="button"
            disabled={dbChecking}
            title="Datenbank-Verbindung erneut testen"
            on:click={checkServerStatus}
          >
            {dbChecking ? "Prüft..." : "Neu verbinden ↻"}
          </button>
        {/if}
      </div>
      <button class="ghost pm-close-btn" type="button" aria-label="Schließen" on:click={onClose}>✕</button>
    </div>

    <div class="pm-pin-bar" class:unlocked={isUnlocked}>
      {#if isUnlocked}
        <div class="pm-pin-status">
          <span class="pm-unlock-badge">🔓 Bearbeitungsmodus aktiv</span>
          <span class="pm-pin-hint">Du kannst Songs hinzufügen, bearbeiten und neue Playlists erstellen.</span>
        </div>
        <button
          class="ghost pm-small-btn"
          type="button"
          on:click={() => {
            isUnlocked = false;
            pin = "";
            if (typeof window !== "undefined") window.sessionStorage.removeItem("hitster:adminPin");
          }}
        >
          Sperren
        </button>
      {:else}
        <div class="pm-pin-status">
          <span class="pm-lock-badge">🔒 Schreibgeschützt</span>
          <span class="pm-pin-hint">PIN eingeben, um Songs oder Playlists hinzuzufügen:</span>
        </div>
        <div class="pm-pin-form">
          <input
            class="pm-pin-input"
            type="password"
            placeholder="PIN-Code..."
            bind:value={pin}
            on:keydown={(e) => {
              if (e.key === "Enter") verifyPin();
            }}
          />
          <button class="primary pm-small-btn" type="button" disabled={pinChecking} on:click={() => verifyPin()}>
            Freischalten
          </button>
        </div>
      {/if}
    </div>

    {#if !dbConnected && dbError}
      <div class="pm-alert warning">
        <span>⚠️ Hinweis: {dbError}</span>
        <button class="ghost pm-tiny-btn" type="button" on:click={checkServerStatus}>Erneut versuchen ↻</button>
      </div>
    {/if}
    {#if errorMsg}
      <div class="pm-alert error">{errorMsg}</div>
    {/if}
    {#if statusMsg}
      <div class="pm-alert success">{statusMsg}</div>
    {/if}

    <div class="pm-tabs">
      <button
        type="button"
        class="pm-tab"
        class:active={activeTab === "manage"}
        on:click={() => (activeTab = "manage")}
      >
        Songs in Playlist ({songs.length})
      </button>
      <button
        type="button"
        class="pm-tab"
        class:active={activeTab === "create"}
        on:click={() => (activeTab = "create")}
      >
        + Neue Playlist erstellen
      </button>
    </div>

    {#if activeTab === "manage"}
      <div class="pm-toolbar">
        <div class="pm-pack-select-row">
          <label for="pm-pack-select">Playlist:</label>
          <select id="pm-pack-select" bind:value={selectedPackId}>
            {#each packs as pack}
              <option value={pack.id}>
                {pack.name} ({pack.songCount ?? "?"} Songs)
              </option>
            {/each}
          </select>
          {#if isUnlocked && selectedPackId}
            <button
              class="ghost pm-danger-btn"
              type="button"
              title="Ganze Playlist löschen"
              on:click={handleDeletePlaylist}
            >
              Playlist löschen
            </button>
          {/if}
        </div>
      </div>

      {#if isUnlocked}
        <div class="pm-add-card">
          <div class="pm-add-header">
            <strong>+ Song zu dieser Playlist hinzufügen</strong>
            <button
              class="ghost pm-small-btn"
              type="button"
              on:click={() => (showBulkImport = !showBulkImport)}
            >
              {showBulkImport ? "Einzelner Song" : "📄 CSV importieren"}
            </button>
          </div>

          {#if !showBulkImport}
            <div class="pm-add-grid">
              <div class="pm-url-row">
                <input
                  type="url"
                  placeholder="YouTube-Link einfügen (füllt Interpret & Titel automatisch aus)..."
                  bind:value={newUrl}
                  on:input={() => fetchYouTubeMeta(newUrl)}
                  on:paste={(e) => {
                    setTimeout(() => fetchYouTubeMeta(newUrl), 50);
                  }}
                />
                {#if metaLoading}
                  <span class="pm-meta-spinner">Lädt Info...</span>
                {/if}
              </div>
              <div class="pm-song-fields">
                <input type="text" placeholder="Interpret *" bind:value={newArtist} />
                <input type="text" placeholder="Songtitel *" bind:value={newTitle} />
                <input
                  class="pm-year-input"
                  type="number"
                  min="1900"
                  max="2030"
                  placeholder="Jahr *"
                  bind:value={newYear}
                  on:keydown={(e) => {
                    if (e.key === "Enter") handleAddSong();
                  }}
                />
                <button class="primary pm-add-btn" type="button" disabled={addingSong} on:click={handleAddSong}>
                  {addingSong ? "Speichert..." : "+ Hinzufügen"}
                </button>
              </div>
            </div>
          {:else}
            <div class="pm-bulk-box">
              <p class="pm-hint">
                Lade eine CSV-Datei mit den Spalten <code>Title,Artist,Year,URL</code> (oder Hitster-CSV-Format) hoch:
              </p>
              <div class="pm-file-row">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  on:change={(e) => handleCsvFileUpload(e, "bulk")}
                />
                {#if bulkFileName}
                  <span class="pm-file-badge">{bulkFileName}</span>
                {/if}
                <button
                  class="primary pm-small-btn"
                  type="button"
                  disabled={!bulkCsvText.trim() || addingSong}
                  on:click={handleBulkCsvAdd}
                >
                  CSV importieren
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <div class="pm-filter-row">
        <input
          class="pm-search-input"
          type="search"
          placeholder="Songs durchsuchen (Interpret, Titel, Jahr)..."
          bind:value={songSearch}
        />
        {#if brokenCount > 0}
          <label class="checkbox pm-broken-toggle">
            <input type="checkbox" bind:checked={filterBrokenOnly} />
            <span>⚠️ Defekte ({brokenCount})</span>
          </label>
        {/if}
      </div>

      <div class="pm-song-list">
        {#if songsLoading}
          <p class="muted">Lade Songs...</p>
        {:else if filteredSongs.length === 0}
          <p class="muted">Keine Songs gefunden.</p>
        {:else}
          {#each filteredSongs as song (song.dbId || song.id)}
            {@const isEditing = editingSongId === (song.dbId || song.id)}
            <div class="pm-song-row" class:broken={song.isBroken}>
              {#if isEditing}
                <div class="pm-song-edit-grid">
                  <input type="text" placeholder="Interpret" bind:value={editArtist} />
                  <input type="text" placeholder="Titel" bind:value={editTitle} />
                  <input class="pm-year-input" type="number" placeholder="Jahr" bind:value={editYear} />
                  <input type="url" placeholder="YouTube-URL" bind:value={editUrl} />
                  <div class="pm-edit-actions">
                    <button
                      class="primary pm-small-btn"
                      type="button"
                      disabled={savingEdit}
                      on:click={() => saveEditSong(song)}
                    >
                      Speichern
                    </button>
                    <button class="ghost pm-small-btn" type="button" on:click={() => (editingSongId = null)}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              {:else}
                <div class="pm-song-info">
                  <span class="pm-year-badge">{song.year || "????"}</span>
                  <div class="pm-song-text">
                    <strong>{song.artist || "Unbekannt"}</strong>
                    <span>– {song.title || "Unbekannt"}</span>
                    {#if song.isBroken}
                      <span class="pm-broken-tag">⚠️ Video nicht verfügbar</span>
                    {/if}
                  </div>
                </div>
                <div class="pm-song-actions">
                  {#if song.url}
                    <a
                      class="pm-link-btn"
                      href={song.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Auf YouTube öffnen"
                    >
                      ▶
                    </a>
                  {/if}
                  {#if isUnlocked}
                    <button
                      class="ghost pm-icon-btn"
                      type="button"
                      title="Bearbeiten"
                      on:click={() => startEditSong(song)}
                    >
                      ✎
                    </button>
                    <button
                      class="ghost pm-icon-btn danger"
                      type="button"
                      title="Song löschen"
                      on:click={() => handleDeleteSong(song)}
                    >
                      🗑
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="pm-create-panel">
        {#if !isUnlocked}
          <p class="muted">Bitte gib oben zuerst den PIN-Code ein, um eine neue Playlist anzulegen.</p>
        {:else}
          <div class="field">
            <label for="new-pack-name">Name der neuen Playlist *</label>
            <input
              id="new-pack-name"
              type="text"
              placeholder="z.B. 2000er Party Hits"
              bind:value={newPackName}
            />
          </div>
          <div class="field">
            <label for="new-pack-logo">Cover-Bild URL (optional)</label>
            <input
              id="new-pack-logo"
              type="url"
              placeholder="https://..."
              bind:value={newPackLogo}
            />
          </div>
          <div class="field">
            <label for="new-pack-csv">Songs direkt per CSV-Datei importieren (optional)</label>
            <p class="pm-hint">
              Du kannst entweder eine CSV-Datei (Spalten: <code>Title,Artist,Year,URL</code>) hochladen oder die Playlist leer erstellen und danach einzelne YouTube-Links einfügen.
            </p>
            <input
              id="new-pack-csv"
              type="file"
              accept=".csv,text/csv"
              on:change={(e) => handleCsvFileUpload(e, "newPack")}
            />
            {#if newPackCsvFileName}
              <span class="pm-file-badge">Geladen: {newPackCsvFileName}</span>
            {/if}
          </div>
          <div class="pm-create-actions">
            <button
              class="primary"
              type="button"
              disabled={creatingPack || !newPackName.trim()}
              on:click={handleCreatePlaylist}
            >
              {creatingPack ? "Erstelle Playlist..." : "Playlist erstellen"}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .playlist-modal-backdrop {
    z-index: 120;
    backdrop-filter: blur(5px);
  }

  .playlist-modal {
    background: #141422;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 22px;
    padding: clamp(14px, 2.5vw, 22px);
    width: min(860px, 96vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
    overflow: hidden;
  }

  .pm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .pm-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pm-title-group h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  .pm-db-badge {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.8);
  }

  .pm-db-badge.connected {
    background: rgba(88, 255, 138, 0.14);
    border-color: rgba(88, 255, 138, 0.45);
    color: #b8ffd0;
  }

  .pm-close-btn {
    padding: 6px 12px;
  }

  .pm-pin-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 12px;
    border-radius: 14px;
    background: rgba(255, 179, 71, 0.08);
    border: 1px solid rgba(255, 179, 71, 0.3);
  }

  .pm-pin-bar.unlocked {
    background: rgba(88, 255, 138, 0.08);
    border-color: rgba(88, 255, 138, 0.35);
  }

  .pm-pin-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12.5px;
  }

  .pm-lock-badge {
    font-weight: 700;
    color: #ffd99b;
  }

  .pm-unlock-badge {
    font-weight: 700;
    color: #9effc2;
  }

  .pm-pin-hint {
    color: rgba(255, 255, 255, 0.72);
  }

  .pm-pin-form {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pm-pin-input {
    width: 130px;
    padding: 6px 10px !important;
    font-size: 13px !important;
  }

  .pm-small-btn {
    padding: 6px 12px !important;
    font-size: 12px !important;
  }

  .pm-tiny-btn {
    padding: 3px 8px !important;
    font-size: 11px !important;
    border-radius: 999px !important;
  }

  .pm-alert.warning {
    background: rgba(255, 179, 71, 0.16);
    border: 1px solid rgba(255, 179, 71, 0.45);
    color: #ffe0b2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pm-alert {
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 12.5px;
    font-weight: 600;
  }

  .pm-alert.error {
    background: rgba(255, 77, 109, 0.18);
    border: 1px solid rgba(255, 77, 109, 0.5);
    color: #ffd0d9;
  }

  .pm-alert.success {
    background: rgba(88, 255, 138, 0.16);
    border: 1px solid rgba(88, 255, 138, 0.45);
    color: #c2ffd6;
  }

  .pm-tabs {
    display: flex;
    gap: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 8px;
  }

  .pm-tab {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 7px 14px;
    font-size: 13px;
  }

  .pm-tab.active {
    background: rgba(255, 59, 212, 0.22);
    border-color: rgba(255, 122, 230, 0.65);
    color: #fff;
  }

  .pm-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pm-pack-select-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    flex-wrap: wrap;
  }

  .pm-pack-select-row select {
    flex: 1;
    min-width: 200px;
  }

  .pm-danger-btn {
    border-color: rgba(255, 90, 120, 0.45) !important;
    color: #ffb8c6 !important;
    padding: 7px 12px !important;
    font-size: 12px !important;
  }

  .pm-add-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(61, 240, 255, 0.28);
    border-radius: 14px;
    padding: 10px 12px;
    display: grid;
    gap: 8px;
  }

  .pm-add-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    color: #d6fbff;
  }

  .pm-add-grid {
    display: grid;
    gap: 8px;
  }

  .pm-url-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pm-url-row input {
    flex: 1;
    padding: 7px 10px !important;
    font-size: 13px !important;
  }

  .pm-meta-spinner {
    font-size: 11px;
    color: #3df0ff;
    white-space: nowrap;
  }

  .pm-song-fields {
    display: grid;
    grid-template-columns: 1fr 1fr 90px auto;
    gap: 8px;
  }

  .pm-song-fields input {
    padding: 7px 10px !important;
    font-size: 13px !important;
    min-width: 0;
  }

  .pm-add-btn {
    padding: 7px 14px !important;
    font-size: 13px !important;
    white-space: nowrap;
  }

  .pm-filter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pm-search-input {
    flex: 1;
    padding: 7px 11px !important;
    font-size: 13px !important;
  }

  .pm-broken-toggle {
    font-size: 12px;
    color: #ffb8c6;
  }

  .pm-song-list {
    flex: 1;
    min-height: 180px;
    max-height: 38vh;
    overflow-y: auto;
    display: grid;
    gap: 6px;
    padding-right: 4px;
    align-content: start;
  }

  .pm-song-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 13px;
  }

  .pm-song-row.broken {
    border-color: rgba(255, 90, 120, 0.5);
    background: rgba(255, 70, 100, 0.08);
  }

  .pm-song-info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .pm-year-badge {
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 110, 200, 0.16);
    border: 1px solid rgba(255, 110, 200, 0.35);
    color: #ffd9f0;
    font-weight: 700;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .pm-song-text {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .pm-broken-tag {
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(255, 80, 110, 0.25);
    color: #ffc2ce;
  }

  .pm-song-actions {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .pm-link-btn,
  .pm-icon-btn {
    width: 28px;
    height: 28px;
    padding: 0 !important;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    text-decoration: none;
    color: #d6fbff;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }

  .pm-icon-btn.danger:hover {
    background: rgba(255, 80, 110, 0.3);
    border-color: rgba(255, 110, 140, 0.6);
  }

  .pm-song-edit-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 80px 1.2fr auto;
    gap: 6px;
    width: 100%;
    align-items: center;
  }

  .pm-song-edit-grid input {
    padding: 5px 8px !important;
    font-size: 12px !important;
    min-width: 0;
  }

  .pm-edit-actions {
    display: flex;
    gap: 4px;
  }

  .pm-create-panel {
    display: grid;
    gap: 12px;
    padding: 6px 0;
  }

  .pm-hint {
    margin: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.68);
  }

  .pm-file-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pm-file-badge {
    font-size: 11.5px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(61, 240, 255, 0.15);
    color: #bff8ff;
  }

  @media (max-width: 720px) {
    .pm-song-fields,
    .pm-song-edit-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
