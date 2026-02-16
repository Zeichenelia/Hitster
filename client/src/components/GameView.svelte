<script>
  import { onMount } from "svelte";
  export let players = [];
  export let teams = [];
  export let isHost = false;
  export let gameState = "playing";
  export let activeTeamId = "";
  export let currentCard = null;
  export let playerCard = null;
  export let audioUrl = "";
  export let audioState = null;
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
  export let onAudioSync = () => {};
  export let onHostSkipSong = () => {};
  export let onHostSoftReset = () => {};
  export let onReturnToLobby = () => {};

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
  let seekTrackRef;
  let avatarLoadFailed = false;
  let avatarCandidates = [];
  let avatarIndex = 0;
  let playerPollTimer;
  let broadcastPollTimer;
  let showHostMenu = false;

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

  $: displayCard = playerCard || currentCard;
  $: if (displayCard?.id) {
    avatarCandidates = buildAvatarCandidates(displayCard);
    avatarIndex = 0;
    avatarLoadFailed = false;
  }
  $: currentAvatarSrc = avatarCandidates[avatarIndex] || logoSrc;
  $: embedUrl = currentVideoId ? buildEmbedUrl(currentVideoId, origin) : "";
  $: if (currentVideoId && playerReady) {
    syncVolume();
  }

  $: if (audioState && playerReady && currentVideoId && audioState.videoId === currentVideoId) {
    const baseTime = Number.isFinite(Number(audioState.currentTime)) ? Math.max(0, Number(audioState.currentTime)) : 0;
    const elapsed = audioState.isPaused ? 0 : Math.max(0, (Date.now() - Number(audioState.updatedAt || Date.now())) / 1000);
    const targetTime = baseTime + elapsed;
    if (Math.abs(targetTime - playerCurrentTime) > 1.2) {
      sendPlayerCommand("seekTo", [targetTime, true]);
      playerCurrentTime = targetTime;
    }
    if (Boolean(audioState.isPaused) !== isPaused) {
      if (audioState.isPaused) {
        sendPlayerCommand("pauseVideo");
        isPaused = true;
      } else {
        sendPlayerCommand("playVideo");
        isPaused = false;
      }
    }
  }

  const emitAudioSync = (partial = {}) => {
    if (!currentVideoId) {
      return;
    }
    onAudioSync({
      videoId: partial.videoId || currentVideoId,
      currentTime: partial.currentTime ?? playerCurrentTime,
      isPaused: partial.isPaused ?? isPaused,
    });
  };
  const seekRelative = (seconds) => {
    if (!playerReady) {
      return;
    }
    const nextTime = Math.max(0, Math.min(playerDuration || Infinity, playerCurrentTime + seconds));
    sendPlayerCommand("seekTo", [nextTime, true]);
    playerCurrentTime = nextTime;
    emitAudioSync({ currentTime: nextTime, isPaused });
  };

  const togglePlayback = () => {
    if (!playerReady || !currentVideoId) {
      return;
    }
    if (isPaused) {
      sendPlayerCommand("playVideo");
      isPaused = false;
      emitAudioSync({ isPaused: false });
      return;
    }
    sendPlayerCommand("pauseVideo");
    isPaused = true;
    emitAudioSync({ isPaused: true });
  };

  const syncPlaybackProgress = () => {
    if (!playerReady) {
      return;
    }
    sendPlayerCommand("getCurrentTime");
    sendPlayerCommand("getDuration");
    sendPlayerCommand("getPlayerState");
  };

  const seekToRatio = (ratio) => {
    if (!playerReady || !Number.isFinite(playerDuration) || playerDuration <= 0) {
      return;
    }
    const nextTime = Math.max(0, Math.min(playerDuration, ratio * playerDuration));
    sendPlayerCommand("seekTo", [nextTime, true]);
    playerCurrentTime = nextTime;
    emitAudioSync({ currentTime: nextTime, isPaused });
  };

  const handleSeekPointerDown = (event) => {
    if (!seekTrackRef) {
      return;
    }
    const updateFromClientX = (clientX) => {
      const rect = seekTrackRef.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      seekToRatio(Math.max(0, Math.min(1, ratio)));
    };
    updateFromClientX(event.clientX);
    const handleMove = (moveEvent) => updateFromClientX(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const formatTime = (seconds) => {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const mins = Math.floor(safe / 60);
    const secs = String(safe % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };


  const buildAvatarCandidates = (card) => {
    if (!card) {
      return [];
    }
    const fallbackPath = card.packId ? `/pack-logo/${encodeURIComponent(card.packId)}` : "";
    const values = [card.playlistAvatarUrl || "", fallbackPath];
    if (fallbackPath && typeof window !== "undefined") {
      values.push(`${window.location.origin}${fallbackPath}`);
    }
    return values.filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
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
    if (Number.isInteger(info.playerState)) {
      isPaused = info.playerState !== 1;
    }
  };

  const handleDocumentClick = (event) => {
    if (showVolume && volumeDockRef && !volumeDockRef.contains(event.target)) {
      showVolume = false;
    }
    const hostMenuNode = document.querySelector(".host-menu-shell");
    if (showHostMenu && hostMenuNode && !hostMenuNode.contains(event.target)) {
      showHostMenu = false;
    }
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
      playerPollTimer = window.setInterval(syncPlaybackProgress, 500);
      broadcastPollTimer = window.setInterval(() => {
        if (isActiveTeamMember && playerReady && currentVideoId) {
          emitAudioSync();
        }
      }, 2000);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("click", handleDocumentClick);
        window.removeEventListener("message", handlePlayerMessage);
        if (playerPollTimer) {
          window.clearInterval(playerPollTimer);
        }
        if (broadcastPollTimer) {
          window.clearInterval(broadcastPollTimer);
        }
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
      {#if isHost}
        <button class="secondary" on:click={onReturnToLobby}>Zur Lobby</button>
      {/if}
    {/if}
  </div>
</header>

<section class="game-frame">
  {#if isHost}
    <div class="host-menu-shell">
      {#if showHostMenu}
        <div class="host-menu-panel">
          <h3>Host Menü</h3>
          <button type="button" on:click={onHostSkipSong}>Song für alle skippen</button>
          <button type="button" on:click={onHostSoftReset}>Soft Reset (Spiel neu starten)</button>
        </div>
      {/if}
      <button
        class="host-menu-toggle"
        type="button"
        aria-label="Host Menü öffnen"
        aria-expanded={showHostMenu}
        on:click|stopPropagation={() => {
          showHostMenu = !showHostMenu;
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19.14 12.94a7.96 7.96 0 0 0 .06-.94c0-.32-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.45 7.45 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.66 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.05.31-.07.62-.07.94 0 .32.02.63.07.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.02-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
        </svg>
      </button>
    </div>
  {/if}
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
            playerRef?.contentWindow?.postMessage(JSON.stringify({ event: "listening" }), "*");
            syncPlaybackProgress();
          }}
        ></iframe>
      {/key}
    </div>
  {/if}


  {#if displayCard}
    <div class="music-player-card">
      <img
        class="music-player-avatar"
        src={avatarLoadFailed ? logoSrc : currentAvatarSrc}
        alt={displayCard.packName || "Playlist"}
        on:error={() => {
          if (avatarIndex < avatarCandidates.length - 1) {
            avatarIndex += 1;
            return;
          }
          avatarLoadFailed = true;
        }}
      />
      <div class="music-player-body">
        <h2 class="music-player-title">Card #{displayCard.cardNumber || "?"}</h2>
        <p class="music-player-subtitle">{displayCard.packName || "Unknown Playlist"}</p>
        <div class="music-player-controls">
          <button class="music-control-btn" type="button" aria-label="10 Sekunden zurück" on:click={() => seekRelative(-10)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7c3.3 0 6 2.7 6 6a6 6 0 0 1-6 6 6 6 0 0 1-5.7-4H4.2A8 8 0 0 0 12 21a8 8 0 0 0 0-16z"/></svg>
            <span class="music-seek-badge">10</span>
          </button>
          <button class="music-control-btn music-control-btn-main" type="button" aria-label={isPaused ? "Wiedergabe" : "Pause"} on:click={togglePlayback}>
            {#if isPaused}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
            {/if}
          </button>
          <button class="music-control-btn" type="button" aria-label="10 Sekunden vor" on:click={() => seekRelative(10)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 5.7 8h2.1A8 8 0 1 1 12 5z"/></svg>
            <span class="music-seek-badge">10</span>
          </button>
        </div>
      </div>
      <div class="music-progress-track" bind:this={seekTrackRef} role="slider" tabindex="0" aria-label="Song-Position" aria-valuemin="0" aria-valuemax={Math.max(0, Math.floor(playerDuration))} aria-valuenow={Math.max(0, Math.floor(playerCurrentTime))} on:pointerdown={handleSeekPointerDown} on:keydown={(event) => { if (event.key === "ArrowLeft") seekRelative(-10); if (event.key === "ArrowRight") seekRelative(10); }}>
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


<style>
  .host-menu-shell {
    position: fixed;
    left: 18px;
    bottom: 18px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .host-menu-toggle {
    width: 52px;
    height: 52px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.34);
    background: linear-gradient(135deg, rgba(255, 59, 212, 0.48), rgba(94, 59, 255, 0.56));
    color: #fff;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(28, 13, 52, 0.55);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }

  .host-menu-toggle:hover {
    transform: translateY(-1px) scale(1.02);
    box-shadow: 0 10px 28px rgba(44, 22, 80, 0.62);
  }

  .host-menu-toggle svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }

  .host-menu-panel {
    min-width: 250px;
    background: rgba(12, 12, 18, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 14px;
    padding: 12px;
    display: grid;
    gap: 10px;
    box-shadow: 0 16px 28px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
  }

  .host-menu-panel h3 {
    margin: 0;
    font-size: 14px;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.92);
  }

  .host-menu-panel button {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.07);
    color: #fff;
    border-radius: 10px;
    padding: 9px 10px;
    text-align: left;
    cursor: pointer;
    font-weight: 600;
  }

  .host-menu-panel button:hover {
    background: rgba(255, 255, 255, 0.14);
  }
</style>
