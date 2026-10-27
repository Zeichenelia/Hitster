<script>
  import { onMount } from "svelte";
  export let players = [];
  export let teams = [];
  export let rules = null;
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
  export let slotVotes = [];
  export let turnDeadline = null;
  export let pendingGuess = { artist: "", title: "" };
  export let socketId = "";
  export let clientId = "";
  export let playerColors = {};
  export let onNextTurn = () => {};
  export let onPlaceCard = () => {};
  export let onVoteSlot = () => {};
  export let onUpdateGuess = () => {};
  export let onRevealCard = () => {};
  export let onJoinTeam = () => {};
  export let onRenameTeam = () => {};
  export let onAudioSync = () => {};
  export let onHostSkipSong = () => {};
  export let onHostSoftReset = () => {};
  export let onReturnToLobby = () => {};
  export let onBrokenSong = () => {};
  export let onKickPlayer = () => {};

  const timelineSlots = 6;
  let lastReportedBrokenCardId = "";
  let dismissRotateHint = false;

  const tryLockLandscape = async () => {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      if (screen?.orientation?.lock) {
        await screen.orientation.lock("landscape");
      }
    } catch (_err) {
      // Browser may not allow programmatic orientation lock; user can rotate manually
    }
    dismissRotateHint = true;
  };
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
  let showHostMenu = false;
  let editingTeamId = "";
  let draftTeamName = "";
  let remainingSeconds = 0;
  let turnTimerInterval;
  let draftArtist = "";
  let draftTitle = "";
  let editingBonusField = "";
  let lastGuessCardId = "";

  const updateRemainingTimer = () => {
    if (!turnDeadline || !currentCard || !rules?.timerEnabled) {
      remainingSeconds = 0;
      return;
    }
    remainingSeconds = Math.max(0, Math.ceil((Number(turnDeadline) - Date.now()) / 1000));
  };

  $: if (turnDeadline || currentCard || rules) {
    updateRemainingTimer();
  }

  $: if ((currentCard?.id || "") !== lastGuessCardId) {
    lastGuessCardId = currentCard?.id || "";
    draftArtist = pendingGuess?.artist || "";
    draftTitle = pendingGuess?.title || "";
    editingBonusField = "";
  }

  $: if (pendingGuess) {
    if (editingBonusField !== "artist" && (pendingGuess.artist || "") !== draftArtist) {
      draftArtist = pendingGuess.artist || "";
    }
    if (editingBonusField !== "title" && (pendingGuess.title || "") !== draftTitle) {
      draftTitle = pendingGuess.title || "";
    }
  }

  $: isBonusGuessMode =
    Boolean(rules?.guessMode) &&
    (rules.guessMode === "year+artist" || rules.guessMode === "year+artist+title");
  $: requiresTitleGuess = rules?.guessMode === "year+artist+title";
  $: timerTotalSeconds = Math.max(15, Number(rules?.timerDuration) || 60);
  $: timerProgressPct =
    rules?.timerEnabled && currentCard && turnDeadline
      ? Math.max(0, Math.min(100, (remainingSeconds / timerTotalSeconds) * 100))
      : 0;

  const handleBonusInput = () => {
    if (!isActiveTeamMember || !currentCard) {
      return;
    }
    onUpdateGuess(draftArtist, draftTitle);
  };

  const handleLockIn = () => {
    onRevealCard({ artist: draftArtist, title: draftTitle });
  };

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

  const getInitials = (name) => {
    const cleaned = String(name || "").trim();
    if (!cleaned) {
      return "?";
    }
    const parts = cleaned.split(/\s+/u);
    if (parts.length >= 2) {
      return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
    }
    return cleaned.slice(0, 2).toUpperCase();
  };

  const getVotesForSlot = (allVotes, teamId, position) =>
    (allVotes || []).filter(
      (vote) => vote && vote.teamId === teamId && Number(vote.position) === position
    );

  const handleVoteClick = (teamId, position) => {
    if (!currentCard || myTeamId !== activeTeamId || teamId !== activeTeamId) {
      return;
    }
    onVoteSlot(position);
  };

  const handlePlaceClick = (teamId, position) => {
    if (!currentCard || myTeamId !== activeTeamId || teamId !== activeTeamId) {
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

  const toPerceptualYouTubeVolume = (sliderVal) => {
    const clamped = Math.max(0, Math.min(100, Number(sliderVal) || 0));
    if (clamped <= 0) {
      return 0;
    }
    return Math.max(1, Math.round(Math.pow(clamped / 100, 2.4) * 100));
  };

  const saveVolumePref = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("hitster:volume", String(volume));
    }
  };

  const syncVolume = () => {
    saveVolumePref();
    if (!playerReady) {
      return;
    }
    const effectiveVolume = isMuted ? 0 : toPerceptualYouTubeVolume(volume);
    sendPlayerCommand("setVolume", [effectiveVolume]);
    if (effectiveVolume === 0 || isMuted) {
      sendPlayerCommand("mute");
    } else {
      sendPlayerCommand("unMute");
    }
  };

  const setSliderVolume = (nextVal) => {
    volume = Math.max(0, Math.min(100, Math.round(nextVal)));
    if (volume > 0) {
      lastVolume = volume;
      isMuted = false;
    } else {
      isMuted = true;
    }
    syncVolume();
  };

  const toggleMute = () => {
    if (!isMuted && volume > 0) {
      lastVolume = volume;
      volume = 0;
      isMuted = true;
    } else {
      volume = lastVolume > 0 ? lastVolume : 50;
      isMuted = false;
    }
    syncVolume();
  };

  const handleVolumeWheel = (event) => {
    const step = event.deltaY < 0 ? 3 : -3;
    setSliderVolume((isMuted ? 0 : volume) + step);
  };

  const attemptPlay = () => {
    if (!playerReady || !currentVideoId) {
      return;
    }
    sendPlayerCommand("playVideo");
    isPaused = false;
  };

  const updateVolumeFromClientX = (clientX) => {
    if (!volumeTrackRef) {
      return;
    }
    const rect = volumeTrackRef.getBoundingClientRect();
    const clamped = Math.min(rect.right, Math.max(rect.left, clientX));
    const ratio = (clamped - rect.left) / rect.width;
    setSliderVolume(ratio * 100);
  };

  const handleVolumePointerDown = (event) => {
    updateVolumeFromClientX(event.clientX);
    const handleMove = (moveEvent) => {
      updateVolumeFromClientX(moveEvent.clientX);
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
      interaction: Boolean(partial.interaction),
    });
  };
  const seekRelative = (seconds) => {
    if (!playerReady) {
      return;
    }
    const nextTime = Math.max(0, Math.min(playerDuration || Infinity, playerCurrentTime + seconds));
    sendPlayerCommand("seekTo", [nextTime, true]);
    playerCurrentTime = nextTime;
    emitAudioSync({ currentTime: nextTime, isPaused, interaction: true });
  };

  const togglePlayback = () => {
    if (!playerReady || !currentVideoId) {
      return;
    }
    if (isPaused) {
      sendPlayerCommand("playVideo");
      isPaused = false;
      emitAudioSync({ isPaused: false, interaction: true });
      return;
    }
    sendPlayerCommand("pauseVideo");
    isPaused = true;
    emitAudioSync({ isPaused: true, interaction: true });
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
    emitAudioSync({ currentTime: nextTime, isPaused, interaction: true });
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
    if (payload?.event === "onError") {
      if (currentCard?.id && currentCard.id !== lastReportedBrokenCardId) {
        lastReportedBrokenCardId = currentCard.id;
        onBrokenSong(currentCard.id, payload.info);
      }
      return;
    }
    if (payload?.event !== "infoDelivery") {
      return;
    }
    const info = payload.info || {};
    if (info.videoData && info.videoData.isPlayable === false) {
      if (currentCard?.id && currentCard.id !== lastReportedBrokenCardId) {
        lastReportedBrokenCardId = currentCard.id;
        onBrokenSong(currentCard.id, "UNPLAYABLE");
      }
      return;
    }
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

  $: if (currentCard && !getYouTubeId(currentCard.url) && currentCard.id !== lastReportedBrokenCardId) {
    lastReportedBrokenCardId = currentCard.id;
    onBrokenSong(currentCard.id, "INVALID_URL");
  }

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
      const storedVol = Number.parseInt(window.localStorage.getItem("hitster:volume") || "", 10);
      if (Number.isFinite(storedVol) && storedVol >= 0 && storedVol <= 100) {
        volume = storedVol;
        if (storedVol > 0) {
          lastVolume = storedVol;
          isMuted = false;
        } else {
          isMuted = true;
        }
      }
      window.addEventListener("click", handleDocumentClick);
      window.addEventListener("message", handlePlayerMessage);
      const handleFirstInteract = () => {
        attemptPlay();
        window.removeEventListener("pointerdown", handleFirstInteract);
      };
      window.addEventListener("pointerdown", handleFirstInteract, { once: true });
      playerPollTimer = window.setInterval(syncPlaybackProgress, 500);
      turnTimerInterval = window.setInterval(updateRemainingTimer, 250);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("click", handleDocumentClick);
        window.removeEventListener("message", handlePlayerMessage);
        if (playerPollTimer) {
          window.clearInterval(playerPollTimer);
        }
        if (turnTimerInterval) {
          window.clearInterval(turnTimerInterval);
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
            playerRef?.contentWindow?.postMessage(
              JSON.stringify({ event: "command", func: "addEventListener", args: ["onError"] }),
              "https://www.youtube.com"
            );
            syncPlaybackProgress();
          }}
        ></iframe>
      {/key}
    </div>
  {/if}


  {#if !dismissRotateHint}
    <div class="mobile-rotate-banner">
      <span>📱 Tipp: Dreh dein Handy quer für die beste Timeline-Ansicht</span>
      <div class="mobile-rotate-actions">
        <button class="ghost rotate-action-btn" type="button" on:click={tryLockLandscape}>Querformat</button>
        <button class="ghost rotate-dismiss-btn" type="button" aria-label="Hinweis schließen" on:click={() => (dismissRotateHint = true)}>✕</button>
      </div>
    </div>
  {/if}

  {#if displayCard || currentCard}
    <div class="game-hud">
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
            <div class="music-player-top-row">
              <div>
                <h2 class="music-player-title">Card #{displayCard.cardNumber || "?"}</h2>
                <p class="music-player-subtitle">{displayCard.packName || "Unknown Playlist"}</p>
              </div>
              {#if rules?.timerEnabled && currentCard && turnDeadline}
                <div
                  class="turn-timer-pill"
                  class:timer-warning={remainingSeconds <= 15 && remainingSeconds > 5}
                  class:timer-danger={remainingSeconds <= 5}
                  title="Verbleibende Rundenzeit"
                >
                  <span class="turn-timer-icon">⏱</span>
                  <span class="turn-timer-value">{remainingSeconds}s</span>
                </div>
              {/if}
            </div>
            {#if rules?.timerEnabled && currentCard && turnDeadline}
              <div class="turn-timer-bar" aria-hidden="true">
                <div
                  class="turn-timer-bar-fill"
                  class:timer-warning={remainingSeconds <= 15 && remainingSeconds > 5}
                  class:timer-danger={remainingSeconds <= 5}
                  style={`width: ${timerProgressPct}%`}
                ></div>
              </div>
            {/if}
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
            <span class="music-time-display">{formatTime(playerCurrentTime)} / {formatTime(playerDuration)}</span>
            <div class="music-volume-mixer" on:wheel|preventDefault={handleVolumeWheel}>
              <button
                class="music-volume-btn"
                type="button"
                title={isMuted || volume === 0 ? "Stummschaltung aufheben" : "Stummschalten"}
                aria-label="Toggle mute"
                on:click={toggleMute}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  {#if isMuted || volume === 0}
                    <path d="M3 9v6h4l5 4V5L7 9H3zm10.5 3l3-3 1.5 1.5-3 3 3 3L16.5 18l-3-3-3 3L9 16.5l3-3-3-3L10.5 9l3 3z" />
                  {:else if volume < 45}
                    <path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2.05-3.18v6.36A3.5 3.5 0 0 0 15.5 12z" />
                  {:else}
                    <path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2.05-3.18v6.36A3.5 3.5 0 0 0 15.5 12zm2.5 0a6 6 0 0 0-3.5-5.48v10.96A6 6 0 0 0 18 12z" />
                  {/if}
                </svg>
              </button>
              <div
                class="music-volume-slider"
                bind:this={volumeTrackRef}
                role="slider"
                aria-label="Lautstärke"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={isMuted ? 0 : volume}
                tabindex="0"
                on:pointerdown={handleVolumePointerDown}
                on:keydown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setSliderVolume((isMuted ? 0 : volume) + 2);
                  }
                  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                    event.preventDefault();
                    setSliderVolume((isMuted ? 0 : volume) - 2);
                  }
                }}
              >
                <div class="music-volume-track"></div>
                <div class="music-volume-fill" style={`width: ${isMuted ? 0 : volume}%`}></div>
                <div class="music-volume-thumb" style={`left: ${isMuted ? 0 : volume}%`}></div>
              </div>
              <span class="music-volume-value">{isMuted ? 0 : volume}%</span>
            </div>
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
          aria-label="Drag card to timeline or click + on a slot"
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
          {#if isActiveTeamMember}
            <span class="drawn-card-hint">Ziehen oder + klicken</span>
          {/if}
        </div>
      {/if}
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
              <div class="team-players">
                {#each playersByTeam[team.id] || [] as player}
                  <span
                    class="player-pill"
                    class:offline={player.connected === false}
                    style={`--player-glow: ${playerColors[player.id] || "#3df0ff"}`}
                  >
                    {player.name}
                    {#if player.connected === false}
                      <span class="pill-offline">offline</span>
                    {/if}
                    {#if isHost && player.id !== socketId && player.connected === false}
                      <button
                        class="pill-kick-btn"
                        type="button"
                        title="Offline-Spieler entfernen"
                        aria-label={`Remove ${player.name}`}
                        on:click={() => onKickPlayer(player.id)}
                      >
                        ✕
                      </button>
                    {/if}
                  </span>
                {/each}
              </div>
            </div>
            <div class="team-header-actions">
              {#if team.id === activeTeamId && currentCard && isBonusGuessMode}
                {#if isActiveTeamMember}
                  <div
                    class="bonus-capsule"
                    class:is-focused={Boolean(editingBonusField)}
                    class:is-filled={Boolean(draftArtist.trim()) && (!requiresTitleGuess || Boolean(draftTitle.trim()))}
                  >
                    <div class="bonus-field">
                      <svg class="bonus-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
                      </svg>
                      <input
                        class="bonus-capsule-input"
                        type="text"
                        maxlength="120"
                        placeholder="Interpret..."
                        aria-label="Interpret eingeben"
                        bind:value={draftArtist}
                        on:focus={() => (editingBonusField = "artist")}
                        on:blur={() => {
                          if (editingBonusField === "artist") editingBonusField = "";
                        }}
                        on:input={handleBonusInput}
                        on:keydown={(event) => {
                          if (event.key === "Enter" && pendingPlacement && team.id === pendingPlacement.teamId) {
                            handleLockIn();
                          }
                        }}
                      />
                      {#if draftArtist}
                        <button
                          class="bonus-clear-btn"
                          type="button"
                          aria-label="Interpret löschen"
                          on:click={() => {
                            draftArtist = "";
                            handleBonusInput();
                          }}
                        >
                          ✕
                        </button>
                      {/if}
                    </div>
                    {#if requiresTitleGuess}
                      <span class="bonus-divider" aria-hidden="true"></span>
                      <div class="bonus-field">
                        <svg class="bonus-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
                        </svg>
                        <input
                          class="bonus-capsule-input"
                          type="text"
                          maxlength="120"
                          placeholder="Songtitel..."
                          aria-label="Songtitel eingeben"
                          bind:value={draftTitle}
                          on:focus={() => (editingBonusField = "title")}
                          on:blur={() => {
                            if (editingBonusField === "title") editingBonusField = "";
                          }}
                          on:input={handleBonusInput}
                          on:keydown={(event) => {
                            if (event.key === "Enter" && pendingPlacement && team.id === pendingPlacement.teamId) {
                              handleLockIn();
                            }
                          }}
                        />
                        {#if draftTitle}
                          <button
                            class="bonus-clear-btn"
                            type="button"
                            aria-label="Titel löschen"
                            on:click={() => {
                              draftTitle = "";
                              handleBonusInput();
                            }}
                          >
                            ✕
                          </button>
                        {/if}
                      </div>
                    {/if}
                    <span
                      class="bonus-chip"
                      class:ready={Boolean(draftArtist.trim()) || (requiresTitleGuess && Boolean(draftTitle.trim()))}
                      title={requiresTitleGuess ? "+1 Punkt je richtigem Tipp (Interpret / Titel)" : "+1 Bonuspunkt bei richtigem Interpreten"}
                    >
                      {#if requiresTitleGuess}
                        {#if Boolean(draftArtist.trim()) && Boolean(draftTitle.trim())}
                          ✓ +2
                        {:else if Boolean(draftArtist.trim()) || Boolean(draftTitle.trim())}
                          ✓ +1 / +2
                        {:else}
                          +2 Bonus
                        {/if}
                      {:else if Boolean(draftArtist.trim())}
                        ✓ +1
                      {:else}
                        +1 Bonus
                      {/if}
                    </span>
                  </div>
                {:else}
                  <div class="bonus-spectator-pill" class:has-text={Boolean(draftArtist || draftTitle)}>
                    <svg class="bonus-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
                    </svg>
                    {#if draftArtist || (requiresTitleGuess && draftTitle)}
                      <span class="bonus-spectator-text">
                        <strong>{draftArtist || "?"}</strong>{#if requiresTitleGuess} · <strong>{draftTitle || "?"}</strong>{/if}
                      </span>
                    {:else}
                      <span class="bonus-spectator-muted">Bonustipp offen</span>
                    {/if}
                    <span class="bonus-chip">{requiresTitleGuess ? "+2" : "+1"}</span>
                  </div>
                {/if}
              {/if}
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
                  {@const isPendingHere =
                    Boolean(pendingPlacement) &&
                    team.id === pendingPlacement.teamId &&
                    position === pendingPlacement.position}
                  {@const slotVoteList = getVotesForSlot(slotVotes, team.id, position)}
                  {@const canTapSlot =
                    isActiveTeamMember &&
                    Boolean(currentCard) &&
                    team.id === activeTeamId &&
                    !isPendingHere}
                  {#if !isPendingHere}
                    <div
                      class="timeline-slot drop-slot"
                      class:tap-ready={canTapSlot}
                      class:has-votes={slotVoteList.length > 0}
                      class:show-drop={isHover}
                    >
                      <div
                        class="timeline-drop"
                        class:active={isHover}
                        class:voted={slotVoteList.length > 0}
                        role="button"
                        tabindex={canTapSlot ? 0 : -1}
                        aria-label="Vote for this slot"
                        title="Klicken zum Abstimmen"
                        on:click={() => handleVoteClick(team.id, position)}
                        on:keydown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleVoteClick(team.id, position);
                          }
                        }}
                        on:dragover={(event) => handleDragOver(event, team.id, position)}
                        on:dragleave={(event) => handleDragLeave(event, team.id, position)}
                        on:drop={(event) => handleDrop(event, team.id, position)}
                      >
                        <div class="slot-vote-zone">
                          {#if slotVoteList.length > 0}
                            <div class="slot-votes">
                              {#each slotVoteList as vote}
                                <span
                                  class="slot-vote-badge"
                                  title={vote.playerName}
                                  style={`--voter-glow: ${playerColors[vote.playerId] || "#3df0ff"}`}
                                >
                                  {getInitials(vote.playerName)}
                                </span>
                              {/each}
                            </div>
                          {:else if isHover}
                            <span class="timeline-drop-label">Drop here</span>
                          {:else if canTapSlot}
                            <span class="slot-vote-hint">Vote</span>
                          {/if}
                        </div>
                        {#if canTapSlot && !isHover}
                          <button
                            class="slot-place-btn"
                            type="button"
                            title="Karte hier platzieren"
                            aria-label="Karte hier platzieren"
                            on:click|stopPropagation={() => handlePlaceClick(team.id, position)}
                          >
                            +
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/if}
                  {#if isPendingHere}
                    <div class="timeline-slot card-slot pending-slot">
                      {#if isActiveTeamMember}
                        <button class="primary lock-in-button" on:click={handleLockIn}>Lock in</button>
                      {/if}
                      <div
                        class="timeline-card back pending-drag"
                        draggable={isActiveTeamMember}
                        role="button"
                        tabindex="0"
                        title={isActiveTeamMember ? "Klicken zum Abstimmen oder Karte ziehen" : ""}
                        aria-label="Placed card – drag to move or click to vote for this slot"
                        on:click={() => handleVoteClick(team.id, position)}
                        on:keydown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleVoteClick(team.id, position);
                          }
                        }}
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
                        <div class="pending-vote-bar">
                          {#if slotVoteList.length > 0}
                            <div class="slot-votes pending-card-votes">
                              {#each slotVoteList as vote}
                                <span
                                  class="slot-vote-badge"
                                  title={vote.playerName}
                                  style={`--voter-glow: ${playerColors[vote.playerId] || "#3df0ff"}`}
                                >
                                  {getInitials(vote.playerName)}
                                </span>
                              {/each}
                            </div>
                          {:else if isActiveTeamMember}
                            <span class="pending-vote-hint">Klicken = Vote</span>
                          {/if}
                        </div>
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
              <span class="player-pill" class:offline={player.connected === false}>
                {player.name}
                {#if player.connected === false}
                  <span class="pill-offline">offline</span>
                {/if}
                {#if isHost && player.id !== socketId}
                  <button
                    class="pill-kick-btn"
                    type="button"
                    title="Spieler entfernen"
                    aria-label={`Remove ${player.name}`}
                    on:click={() => onKickPlayer(player.id)}
                  >
                    ✕
                  </button>
                {/if}
              </span>
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
  .team-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .team-name-input {
    width: min(220px, 100%);
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



  .drawn-card-hint {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 214, 240, 0.82);
    text-align: center;
    padding: 0 6px;
  }

  .player-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .player-pill.offline {
    opacity: 0.6;
  }

  .pill-offline {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
  }

  .pill-kick-btn {
    padding: 0;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: rgba(255, 80, 110, 0.22);
    border: 1px solid rgba(255, 110, 140, 0.5);
    color: #ffd6e0;
    font-size: 10px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .pill-kick-btn:hover {
    background: rgba(255, 80, 110, 0.42);
  }

  .slot-vote-zone {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-top: 6px;
    min-height: 0;
  }

  .slot-vote-hint {
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.38);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  :global(.timeline-drop:hover) .slot-vote-hint {
    opacity: 1;
  }

  .slot-place-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    margin-bottom: 6px;
    border-radius: 999px;
    border: 1px solid rgba(255, 122, 230, 0.55);
    background: rgba(255, 59, 212, 0.2);
    color: #ffd9f0;
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
    transition: transform 0.14s ease, background 0.14s ease, border-color 0.14s ease;
  }

  .slot-place-btn:hover {
    transform: scale(1.1);
    background: rgba(255, 59, 212, 0.45);
    border-color: rgba(255, 180, 240, 0.9);
  }

  .slot-votes {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 4px 2px;
    z-index: 2;
  }

  .pending-vote-bar {
    position: absolute;
    bottom: 8px;
    left: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 26px;
  }

  .pending-card-votes {
    flex-direction: row;
    flex-wrap: wrap;
    padding: 0;
  }

  .pending-vote-hint {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.45);
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px dashed rgba(255, 255, 255, 0.2);
  }

  .slot-vote-badge {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--voter-glow, #3df0ff), #0b0b0f 74%);
    border: 1.5px solid color-mix(in srgb, var(--voter-glow, #3df0ff), #ffffff 28%);
    box-shadow: 0 0 10px color-mix(in srgb, var(--voter-glow, #3df0ff), transparent 35%);
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    animation: votePop 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes votePop {
    from {
      transform: scale(0.5);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .music-time-display {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .music-volume-mixer {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .music-volume-btn {
    padding: 0;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 0;
    background: transparent;
    color: #ffd9f0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .music-volume-btn:hover {
    background: rgba(255, 110, 200, 0.18);
  }

  .music-volume-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .music-volume-slider {
    position: relative;
    width: 96px;
    height: 18px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .music-volume-track {
    position: absolute;
    left: 0;
    right: 0;
    height: 5px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
  }

  .music-volume-fill {
    position: absolute;
    left: 0;
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(90deg, #ff6ec8, #ff9ee2);
  }

  .music-volume-thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ffd9f0;
    border: 1.5px solid #ff3bd4;
    box-shadow: 0 2px 8px rgba(255, 59, 212, 0.55);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .music-volume-value {
    font-size: 0.7rem;
    min-width: 28px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: rgba(236, 240, 255, 0.8);
  }

  .mobile-rotate-banner {
    display: none;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(255, 59, 212, 0.14);
    border: 1px solid rgba(255, 122, 230, 0.4);
    color: #ffd9f0;
    font-size: 12px;
  }

  .mobile-rotate-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .rotate-action-btn {
    padding: 5px 10px;
    font-size: 11px;
  }

  .rotate-dismiss-btn {
    padding: 4px 8px;
    font-size: 11px;
  }

  @media (max-width: 680px) and (orientation: portrait) {
    .mobile-rotate-banner {
      display: flex;
    }
  }

  .music-player-top-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .turn-timer-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(61, 240, 255, 0.14);
    border: 1px solid rgba(61, 240, 255, 0.45);
    color: #d6fbff;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    box-shadow: 0 0 12px rgba(61, 240, 255, 0.2);
  }

  .turn-timer-pill.timer-warning {
    background: rgba(255, 179, 71, 0.18);
    border-color: rgba(255, 179, 71, 0.65);
    color: #ffe2b3;
    box-shadow: 0 0 12px rgba(255, 179, 71, 0.3);
  }

  .turn-timer-pill.timer-danger {
    background: rgba(255, 77, 109, 0.25);
    border-color: rgba(255, 100, 130, 0.85);
    color: #ffd6de;
    box-shadow: 0 0 16px rgba(255, 77, 109, 0.5);
    animation: timerPulse 0.65s ease-in-out infinite alternate;
  }

  .turn-timer-bar {
    width: 100%;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
    margin-top: 2px;
  }

  .turn-timer-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #3df0ff, #58ff8a);
    transition: width 0.25s linear;
  }

  .turn-timer-bar-fill.timer-warning {
    background: linear-gradient(90deg, #ffb347, #ffd43d);
  }

  .turn-timer-bar-fill.timer-danger {
    background: linear-gradient(90deg, #ff4d6d, #ff8a3d);
  }

  @keyframes timerPulse {
    from {
      transform: scale(1);
    }
    to {
      transform: scale(1.06);
    }
  }

  .bonus-capsule {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 5px 3px 11px;
    border-radius: 999px;
    background: linear-gradient(135deg, rgba(18, 20, 32, 0.92), rgba(11, 12, 20, 0.96));
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 6px 18px rgba(0, 0, 0, 0.35);
    transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    max-width: 100%;
    flex-wrap: wrap;
  }

  .bonus-capsule.is-focused {
    border-color: rgba(61, 240, 255, 0.72);
    box-shadow: 0 0 0 2px rgba(61, 240, 255, 0.16), 0 8px 22px rgba(0, 0, 0, 0.45);
  }

  .bonus-capsule.is-filled:not(.is-focused) {
    border-color: rgba(88, 255, 138, 0.55);
    box-shadow: 0 0 14px rgba(88, 255, 138, 0.16), 0 6px 18px rgba(0, 0, 0, 0.35);
  }

  .bonus-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .bonus-icon {
    width: 15px;
    height: 15px;
    fill: #3df0ff;
    opacity: 0.88;
    flex-shrink: 0;
  }

  .bonus-capsule.is-filled .bonus-icon {
    fill: #58ff8a;
  }

  .bonus-capsule-input {
    width: 155px;
    padding: 4px 2px !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    color: #f5f7ff !important;
    font-size: 13px !important;
    font-weight: 500;
    line-height: 1.2;
  }

  .bonus-capsule-input::placeholder {
    color: rgba(210, 220, 245, 0.45);
    font-weight: 400;
  }

  .bonus-capsule-input:focus {
    outline: none !important;
    border: 0 !important;
    box-shadow: none !important;
  }

  .bonus-clear-btn {
    padding: 0;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 0;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.72);
    font-size: 10px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .bonus-clear-btn:hover {
    background: rgba(255, 110, 200, 0.28);
    color: #fff;
  }

  .bonus-divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.16);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .bonus-chip {
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(61, 240, 255, 0.12);
    border: 1px solid rgba(61, 240, 255, 0.35);
    color: #bff8ff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  }

  .bonus-chip.ready {
    background: rgba(88, 255, 138, 0.2);
    border-color: rgba(88, 255, 138, 0.6);
    color: #b8ffd0;
  }

  .bonus-spectator-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 6px 4px 11px;
    border-radius: 999px;
    background: rgba(16, 18, 28, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 12px;
    color: rgba(240, 244, 255, 0.88);
  }

  .bonus-spectator-pill.has-text {
    border-color: rgba(61, 240, 255, 0.4);
  }

  .bonus-spectator-text {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bonus-spectator-muted {
    color: rgba(255, 255, 255, 0.45);
    font-size: 11.5px;
  }

  @media (max-width: 640px) {
    .music-volume-slider {
      width: 68px;
    }

    .bonus-capsule {
      padding: 3px 4px 3px 9px;
      gap: 4px;
    }

    .bonus-capsule-input {
      width: 120px;
      font-size: 12px !important;
    }
  }
</style>

