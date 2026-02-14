<script>
  import { onMount } from "svelte";
  export let players = [];
  export let teams = [];
  export let isHost = false;
  export let gameState = "playing";
  export let activeTeamId = "";
  export let currentCard = null;
  export let audioUrl = "";
  export let lastPlacedCardId = "";
  export let lastPlacedTeamId = "";
  export let lastRevealedCard = null;
  export let lastRevealCorrect = true;
  export let lastRevealPosition = -1;
  export let lastRevealTeamId = "";
  export let pendingPlacement = null;
  export let socketId = "";
  export let clientId = "";
  export let playerColors = {};
  export let onNextTurn = () => {};
  export let onPlaceCard = () => {};
  export let onRevealCard = () => {};
  export let onJoinTeam = () => {};

  const timelineSlots = 6;
  const logoSrc = "/assets/hitster-logo.png";
  const dragType = "application/x-hitster-card";
  let drawnCardRef;
  let hoveredDrop = null;
  let dragGhost;
  let dragGhostTemplate;
  let playerRef;
  let playerReady = false;
  let volume = 60;
  let lastVolume = 60;
  let isMuted = false;
  let lastVideoId = "";
  let origin = "";
  let showVolume = false;
  let volumeTrackRef;
  let volumeDockRef;
  let playerCurrentTime = 0;
  let playerDuration = 0;
  let isPaused = false;

  const autoScrollX = (node) => {
    let frame;
    const update = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        const needsScroll = node.scrollWidth > node.clientWidth + 1;
        node.classList.toggle("needs-scroll", needsScroll);
      });
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    const mutationObserver = new MutationObserver(update);

    if (resizeObserver) {
      resizeObserver.observe(node);
    }
    mutationObserver.observe(node, { childList: true, subtree: true });
    update();

    return {
      destroy() {
        if (frame) {
          cancelAnimationFrame(frame);
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        mutationObserver.disconnect();
      },
    };
  };

  const handleDragStart = (event) => {
    if (!currentCard || myTeamId !== activeTeamId) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(dragType, currentCard.id);
    event.dataTransfer.effectAllowed = "move";
    if (dragGhostTemplate) {
      dragGhost = dragGhostTemplate.cloneNode(true);
      dragGhost.classList.remove("drag-ghost-template");
      dragGhost.classList.add("drag-ghost");
      dragGhost.style.visibility = "visible";
    } else if (drawnCardRef) {
      dragGhost = drawnCardRef.cloneNode(true);
      dragGhost.classList.add("drag-ghost");
    }
    if (dragGhost) {
      document.body.appendChild(dragGhost);
      const rect = dragGhost.getBoundingClientRect();
      event.dataTransfer.setDragImage(dragGhost, rect.width / 2, rect.height / 2);
    }
  };

  const handleDrop = (event, teamId, position) => {
    event.preventDefault();
    if (!currentCard || myTeamId !== activeTeamId) {
      return;
    }
    if (teamId !== activeTeamId) {
      return;
    }
    hoveredDrop = null;
    onPlaceCard(position);
  };

  const handleDragOver = (event, teamId, position) => {
    if (!currentCard || myTeamId !== activeTeamId || teamId !== activeTeamId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (hoveredDrop && hoveredDrop.teamId === teamId && hoveredDrop.position === position) {
      return;
    }
    hoveredDrop = { teamId, position };
  };

  const handleDragLeave = (event, teamId, position) => {
    if (hoveredDrop && hoveredDrop.teamId === teamId && hoveredDrop.position === position) {
      hoveredDrop = null;
    }
  };

  const getYouTubeId = (url) => {
    if (!url) return "";
    const match = url.match(/(?:youtu\.be\/|v=|\/embed\/)([\w-]{11})/u);
    return match ? match[1] : "";
  };

  const buildEmbedUrl = (id, originValue) => {
    const params = new URLSearchParams({
      autoplay: "1",
      controls: "0",
      rel: "0",
      playsinline: "1",
      enablejsapi: "1",
    });
    if (originValue) {
      params.set("origin", originValue);
    }
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  };

  const sendPlayerCommand = (command, args = []) => {
    if (!playerRef || !playerRef.contentWindow) {
      return;
    }
    playerRef.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: command, args }),
      "https://www.youtube.com"
    );
  };

  const syncVolume = () => {
    if (!playerReady) {
      return;
    }
    sendPlayerCommand("setVolume", [volume]);
    if (volume === 0) {
      sendPlayerCommand("mute");
    } else {
      sendPlayerCommand("unMute");
    }
  };

  const attemptPlay = () => {
    if (!playerReady || !currentVideoId) {
      return;
    }
    sendPlayerCommand("playVideo");
    isPaused = false;
  };

  const updateVolumeFromClientY = (clientY) => {
    if (!volumeTrackRef) {
      return;
    }
    const rect = volumeTrackRef.getBoundingClientRect();
    const clamped = Math.min(rect.bottom, Math.max(rect.top, clientY));
    const ratio = 1 - (clamped - rect.top) / rect.height;
    volume = Math.round(ratio * 100);
    if (volume > 0) {
      lastVolume = volume;
      isMuted = false;
    } else {
      isMuted = true;
    }
    syncVolume();
  };

  const handleVolumePointerDown = (event) => {
    updateVolumeFromClientY(event.clientY);
    const handleMove = (moveEvent) => {
      updateVolumeFromClientY(moveEvent.clientY);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  $: currentVideoId = getYouTubeId(audioUrl);
  $: if (currentVideoId !== lastVideoId) {
    lastVideoId = currentVideoId;
    playerReady = false;
    playerCurrentTime = 0;
    playerDuration = 0;
    isPaused = false;
  }
  $: embedUrl = currentVideoId ? buildEmbedUrl(currentVideoId, origin) : "";
  $: if (currentVideoId && playerReady) {
    syncVolume();
  }


  const seekRelative = (seconds) => {
    if (!playerReady) {
      return;
    }
    const nextTime = Math.max(0, Math.min(playerDuration || Infinity, playerCurrentTime + seconds));
    sendPlayerCommand("seekTo", [nextTime, true]);
    playerCurrentTime = nextTime;
  };

  const togglePlayback = () => {
    if (!playerReady || !currentVideoId) {
      return;
    }
    if (isPaused) {
      sendPlayerCommand("playVideo");
      isPaused = false;
      return;
    }
    sendPlayerCommand("pauseVideo");
    isPaused = true;
  };

  const formatTime = (seconds) => {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const mins = Math.floor(safe / 60);
    const secs = String(safe % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const handlePlayerMessage = (event) => {
    if (event.origin !== "https://www.youtube.com") {
      return;
    }
    if (typeof event.data !== "string") {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (payload?.event !== "infoDelivery") {
      return;
    }
    const info = payload.info || {};
    if (Number.isFinite(info.currentTime)) {
      playerCurrentTime = info.currentTime;
    }
    if (Number.isFinite(info.duration) && info.duration > 0) {
      playerDuration = info.duration;
    }
  };

  const handleDocumentClick = (event) => {
    if (!showVolume || !volumeDockRef) {
      return;
    }
    if (volumeDockRef.contains(event.target)) {
      return;
    }
    showVolume = false;
  };

  onMount(() => {
    if (typeof window !== "undefined") {
      origin = window.location.origin;
      window.addEventListener("click", handleDocumentClick);
      window.addEventListener("message", handlePlayerMessage);
      const handleFirstInteract = () => {
        attemptPlay();
        window.removeEventListener("pointerdown", handleFirstInteract);
      };
      window.addEventListener("pointerdown", handleFirstInteract, { once: true });
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("click", handleDocumentClick);
        window.removeEventListener("message", handlePlayerMessage);
      }
    };
  });

  $: playersByTeam = players.reduce((acc, player) => {
    if (player.teamId) {
      const key = String(player.teamId);
      acc[key] = acc[key] || [];
      acc[key].push(player);
    }
    return acc;
  }, {});

  $: unassignedPlayers = players.filter((player) => !player.teamId);
  $: currentPlayer =
    players.find((player) => player.clientId && player.clientId === clientId) ||
    players.find((player) => player.id === socketId) ||
    null;
  $: myTeamId = currentPlayer?.teamId || "";
  $: isActiveTeamMember = myTeamId && myTeamId === activeTeamId;
</script>

<header class="top top-center logo-header game-header">
  <img class="logo-title logo-small" src="/assets/hitster-logo.png" alt="Hitster" />
  <div class="game-actions">
    {#if isActiveTeamMember}
      <button class="primary" on:click={onNextTurn}>Deal next card</button>
    {/if}
    {#if gameState === "finished"}
      <p class="hint">Game finished</p>
    {/if}
  </div>
</header>

<section class="game-frame">
  <div class="volume-dock" bind:this={volumeDockRef}>
    <button
      class="volume-toggle"
      type="button"
      aria-label="Toggle volume"
      on:click|stopPropagation={() => {
        if (!showVolume) {
          showVolume = true;
          return;
        }
        if (!isMuted) {
          if (volume > 0) {
            lastVolume = volume;
          }
          volume = 0;
          isMuted = true;
        } else {
          volume = lastVolume || 60;
          isMuted = false;
        }
        syncVolume();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {#if isMuted}
          <path d="M3 9v6h4l5 4V5L7 9H3zm10.5 3l3-3 1.5 1.5-3 3 3 3L16.5 18l-3-3-3 3L9 16.5l3-3-3-3L10.5 9l3 3z" />
        {:else}
          <path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2.05-3.18v6.36A3.5 3.5 0 0 0 15.5 12zm2.5 0a6 6 0 0 0-3.5-5.48v10.96A6 6 0 0 0 18 12z" />
        {/if}
      </svg>
    </button>
    {#if showVolume}
      <div class="volume-panel">
        <div
          class="volume-slider"
          bind:this={volumeTrackRef}
          role="slider"
          aria-label="Volume"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={volume}
          tabindex="0"
          on:pointerdown={handleVolumePointerDown}
          on:keydown={(event) => {
            if (event.key === "ArrowUp") {
              volume = Math.min(100, volume + 5);
              lastVolume = volume;
              isMuted = false;
              syncVolume();
            }
            if (event.key === "ArrowDown") {
              volume = Math.max(0, volume - 5);
              if (volume > 0) {
                lastVolume = volume;
                isMuted = false;
              } else {
                isMuted = true;
              }
              syncVolume();
            }
          }}
        >
          <div class="volume-track"></div>
          <div class="volume-fill" style={`height: ${volume}%`}></div>
          <div class="volume-thumb" style={`bottom: ${volume}%`}></div>
        </div>
      </div>
    {/if}
  </div>
  {#if currentVideoId}
    <div class="audio-hidden" aria-hidden="true">
      {#key embedUrl}
        <iframe
          title="YouTube audio"
          src={embedUrl}
          allow="autoplay; encrypted-media"
          allowfullscreen
          tabindex="-1"
          bind:this={playerRef}
          on:load={() => {
            playerReady = true;
            syncVolume();
            attemptPlay();
          }}
        ></iframe>
      {/key}
    </div>
  {/if}


  {#if currentCard}
    <div class="music-player-card">
      <img
        class="music-player-avatar"
        src={currentCard.playlistAvatarUrl || logoSrc}
        alt={currentCard.packName || "Playlist"}
      />
      <h2 class="music-player-title">Card #{currentCard.cardNumber || "?"}</h2>
      <p class="music-player-subtitle">{currentCard.packName || "Unknown Playlist"}</p>
      <div class="music-player-controls">
        <button class="music-control-btn" type="button" aria-label="10 Sekunden zurück" on:click={() => seekRelative(-10)}>
          -10s
        </button>
        <button class="music-control-btn music-control-btn-main" type="button" aria-label={isPaused ? "Wiedergabe" : "Pause"} on:click={togglePlayback}>
          {isPaused ? "Play" : "Pause"}
        </button>
        <button class="music-control-btn" type="button" aria-label="10 Sekunden vor" on:click={() => seekRelative(10)}>
          +10s
        </button>
      </div>
      <div class="music-progress-track">
        <div class="music-progress-fill" style={`width: ${playerDuration > 0 ? (playerCurrentTime / playerDuration) * 100 : 0}%`}></div>
      </div>
      <div class="music-time-row">
        <span>{formatTime(playerCurrentTime)}</span>
        <span>{formatTime(playerDuration)}</span>
      </div>
    </div>
  {/if}
  {#if currentCard}
    <div
      class="drawn-card"
      bind:this={drawnCardRef}
      draggable={isActiveTeamMember}
      role="button"
      tabindex="0"
      aria-label="Drag card to timeline"
      on:dragstart={handleDragStart}
      on:dragend={() => {
        hoveredDrop = null;
        if (dragGhost) {
          dragGhost.remove();
          dragGhost = null;
        }
      }}
    >
      <img class="timeline-logo" src={logoSrc} alt="Hitster" />
    </div>
  {/if}
  <div class="drag-ghost-template" bind:this={dragGhostTemplate} aria-hidden="true">
    <div class="timeline-card back">
      <img class="timeline-logo" src={logoSrc} alt="Hitster" />
    </div>
  </div>

  {#if teams.length === 0}
    <p class="muted">No teams available.</p>
  {:else}
    <div class="team-timelines">
      {#each teams as team}
        <div class="team-timeline" class:active-team={team.id === activeTeamId}>
          <div class="team-header">
            <div>
              <strong>{team.name}</strong>
              <div class="team-players">
                {#each playersByTeam[team.id] || [] as player}
                  <span
                    class="player-pill"
                    style={`--player-glow: ${playerColors[player.id] || "#3df0ff"}`}
                  >
                    {player.name}
                  </span>
                {/each}
              </div>
            </div>
            <div class="team-header-actions">
              {#if !myTeamId}
                <button class="ghost" on:click={() => onJoinTeam(team.id)}>Join</button>
              {/if}
              <span class="score-badge">{team.score ?? 0}</span>
            </div>
          </div>
          <div
            class="timeline-row"
            class:has-lockin={pendingPlacement && team.id === pendingPlacement.teamId && isActiveTeamMember}
            use:autoScrollX
          >
            <div class="timeline-cards">
              {#if (team.timeline || []).length !== 0}
                {#each Array((team.timeline || []).length + 1) as _, position}
                  {@const isHover =
                    hoveredDrop &&
                    hoveredDrop.teamId === team.id &&
                    hoveredDrop.position === position}
                  <div class="timeline-slot drop-slot" class:show-drop={isHover}>
                    <div
                      class="timeline-drop"
                      class:active={isHover}
                      role="button"
                      tabindex="0"
                      aria-label="Drop card here"
                      on:dragover={(event) => handleDragOver(event, team.id, position)}
                      on:dragleave={(event) => handleDragLeave(event, team.id, position)}
                      on:drop={(event) => handleDrop(event, team.id, position)}
                    >
                      <span class="timeline-drop-label">Drop here</span>
                    </div>
                  </div>
                  {#if pendingPlacement && team.id === pendingPlacement.teamId && position === pendingPlacement.position}
                    <div class="timeline-slot card-slot pending-slot">
                      {#if isActiveTeamMember}
                        <button class="primary lock-in-button" on:click={onRevealCard}>Lock in</button>
                      {/if}
                      <div
                        class="timeline-card back pending-drag"
                        draggable={isActiveTeamMember}
                        role="button"
                        tabindex="0"
                        aria-label="Drag placed card to reposition"
                        on:dragstart={handleDragStart}
                        on:dragend={() => {
                          hoveredDrop = null;
                          if (dragGhost) {
                            dragGhost.remove();
                            dragGhost = null;
                          }
                        }}
                      >
                        <img class="timeline-logo" src={logoSrc} alt="Hitster" />
                      </div>
                    </div>
                  {:else if !lastRevealCorrect && lastRevealedCard && team.id === lastRevealTeamId && position === lastRevealPosition}
                    <div class="timeline-slot card-slot">
                      <div class="timeline-card reveal" style="--card-hue: 210deg">
                        <div class="timeline-top">
                          <span class="timeline-artist">{lastRevealedCard.artist || "Unknown"}</span>
                        </div>
                        <div class="timeline-center">
                          <div class="timeline-year">{lastRevealedCard.year ?? "????"}</div>
                        </div>
                        <div class="timeline-title">{lastRevealedCard.title || "Unknown"}</div>
                      </div>
                    </div>
                  {/if}
                  {#if (team.timeline || [])[position]}
                    {@const card = team.timeline[position]}
                    {#key card.id}
                      <div class="timeline-slot card-slot">
                        <div
                          class="timeline-card filled"
                          class:placed={card.id === lastPlacedCardId && team.id === lastPlacedTeamId}
                          style={`--card-hue: ${position * 36}deg`}
                        >
                          <div class="timeline-top">
                            <span class="timeline-artist">{card.artist || "Unknown"}</span>
                          </div>
                          <div class="timeline-center">
                            <div class="timeline-year">{card.year ?? "????"}</div>
                          </div>
                          <div class="timeline-title">{card.title || "Unknown"}</div>
                        </div>
                      </div>
                    {/key}
                  {/if}
                {/each}
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if unassignedPlayers.length > 0}
    <div class="team-timeline">
      <div class="team-header">
        <div>
          <strong>Unassigned</strong>
          <div class="team-players">
            {#each unassignedPlayers as player}
              <span class="player-pill">{player.name}</span>
            {/each}
          </div>
        </div>
        <span class="score-badge">{unassignedPlayers.length}</span>
      </div>
      <div class="timeline-row" use:autoScrollX>
        <div class="timeline-cards">
          {#each Array(timelineSlots) as _}
            <div class="timeline-slot card-slot">
              <div class="timeline-card back">
                <img class="timeline-logo" src={logoSrc} alt="Hitster" />
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>
