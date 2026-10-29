const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const db = require("./db");

const PORT = process.env.PORT || 3001;
const ADMIN_PIN = process.env.PLAYLIST_ADMIN_PIN || "1234";
const REPO_ROOT = path.join(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Prevent search engines and crawlers from indexing the site
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

function requireAdminPin(req, res, next) {
  const provided = String(req.headers["x-admin-pin"] ?? req.body?.pin ?? "").trim();
  if (!provided || provided !== ADMIN_PIN) {
    res.status(403).json({ code: "INVALID_PIN", message: "Ungültiger PIN-Code." });
    return;
  }
  next();
}

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});
app.get("/health", (_req, res) => {
  res.json({ status: "ok", dbConnected: db.isDatabaseConnected() });
});

app.get("/packs", (_req, res) => {
  res.json(db.getAllPacks());
});

app.get("/pack-logo/:packId", (req, res) => {
  const pack = db.getPack(req.params.packId);
  if (!pack?.logo) {
    res.status(404).json({ code: "PACK_LOGO_NOT_FOUND" });
    return;
  }
  if (/^https?:\/\//iu.test(pack.logo)) {
    res.redirect(pack.logo);
    return;
  }
  const logoPath = path.join(REPO_ROOT, pack.logo);
  if (!fs.existsSync(logoPath)) {
    res.status(404).json({ code: "PACK_LOGO_NOT_FOUND" });
    return;
  }
  res.sendFile(logoPath);
});

app.get("/api/playlists/status", async (_req, res) => {
  if (!db.isDatabaseConnected()) {
    await db.initDatabase();
  }
  res.json({
    dbConnected: db.isDatabaseConnected(),
    error: db.getLastError(),
  });
});

app.post("/api/playlists/verify-pin", async (req, res) => {
  if (!db.isDatabaseConnected()) {
    await db.initDatabase();
  }
  const provided = String(req.body?.pin ?? req.headers["x-admin-pin"] ?? "").trim();
  res.json({
    valid: Boolean(provided && provided === ADMIN_PIN),
    dbConnected: db.isDatabaseConnected(),
    error: db.getLastError(),
  });
});

app.get("/api/playlists/:packId/songs", (req, res) => {
  if (req.params.packId === "__all__") {
    res.json({
      pack: { id: "__all__", name: "Alle Playlists" },
      songs: db.getAllSongs(),
    });
    return;
  }
  const pack = db.getPack(req.params.packId);
  if (!pack) {
    res.status(404).json({ code: "PACK_NOT_FOUND", message: "Playlist nicht gefunden." });
    return;
  }
  res.json({
    pack,
    songs: db.getSongsForPack(req.params.packId),
  });
});

app.post("/api/playlists", requireAdminPin, async (req, res) => {
  try {
    const pack = await db.createPlaylist({
      name: req.body?.name,
      logo: req.body?.logo,
      csvText: req.body?.csvText,
    });
    const packs = db.getAllPacks();
    io.emit("packs:updated", { packs });
    res.json({ pack, packs });
  } catch (err) {
    res.status(400).json({ code: "CREATE_FAILED", message: err.message });
  }
});

app.delete("/api/playlists/:packId", requireAdminPin, async (req, res) => {
  try {
    await db.deletePlaylist(req.params.packId);
    const packs = db.getAllPacks();
    io.emit("packs:updated", { packs });
    res.json({ packs });
  } catch (err) {
    res.status(400).json({ code: "DELETE_FAILED", message: err.message });
  }
});

app.post("/api/playlists/:packId/songs", requireAdminPin, async (req, res) => {
  try {
    const packId = req.params.packId;
    let songsInput = [];
    if (typeof req.body?.csvText === "string" && req.body.csvText.trim()) {
      songsInput = db.parseCsvSongs(req.body.csvText, packId);
    } else if (Array.isArray(req.body?.songs)) {
      songsInput = req.body.songs;
    } else if (req.body?.song) {
      songsInput = [req.body.song];
    }
    const songs = await db.addSongsToPlaylist(packId, songsInput);
    const packs = db.getAllPacks();
    io.emit("packs:updated", { packs });
    res.json({ songs, packs });
  } catch (err) {
    res.status(400).json({ code: "ADD_SONG_FAILED", message: err.message });
  }
});

app.put("/api/playlists/:packId/songs/:songId", requireAdminPin, async (req, res) => {
  try {
    const songs = await db.updateSong(req.params.packId, req.params.songId, req.body || {});
    res.json({ songs });
  } catch (err) {
    res.status(400).json({ code: "UPDATE_SONG_FAILED", message: err.message });
  }
});

app.delete("/api/playlists/:packId/songs/:songId", requireAdminPin, async (req, res) => {
  try {
    const songs = await db.deleteSong(req.params.packId, req.params.songId);
    const packs = db.getAllPacks();
    io.emit("packs:updated", { packs });
    res.json({ songs, packs });
  } catch (err) {
    res.status(400).json({ code: "DELETE_SONG_FAILED", message: err.message });
  }
});

app.get("/api/song-stats", (req, res) => {
  const rawKey = String(req.query.key || "").trim();
  const fallbackKey = db.getSongStatsKey({
    artist: req.query.artist || "",
    title: req.query.title || "",
  });
  const key = rawKey || fallbackKey;
  if (!key) {
    res.status(400).json({ code: "MISSING_KEY", message: "Song-Key fehlt." });
    return;
  }
  res.json({ key, stats: db.getSongStats(key) });
});

app.get("/api/youtube-meta", async (req, res) => {
  const rawUrl = String(req.query.url || "").trim();
  const videoId = getYouTubeId(rawUrl);
  if (!videoId) {
    res.status(400).json({ code: "INVALID_YOUTUBE_URL", message: "Ungültiger YouTube-Link." });
    return;
  }
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      throw new Error(`YouTube oEmbed returned ${response.status}`);
    }
    const data = await response.json();
    const rawTitle = String(data.title || "").trim();
    const rawAuthor = String(data.author_name || "")
      .replace(/\s*-\s*Topic$/iu, "")
      .replace(/VEVO$/iu, "")
      .trim();

    const yearMatch = rawTitle.match(/\b(19[2-9]\d|20[0-2]\d)\b/u);
    const detectedYear = yearMatch ? Number.parseInt(yearMatch[1], 10) : "";

    const cleanedTitle = rawTitle
      .replace(/\((?:official|offizielles?|music|musik|lyric|lyrics|audio|video|hd|hq|4k|remaster(?:ed)?|live)[^)]*\)/giu, "")
      .replace(/\[(?:official|offizielles?|music|musik|lyric|lyrics|audio|video|hd|hq|4k|remaster(?:ed)?|live)[^\]]*\]/giu, "")
      .replace(/\s+/gu, " ")
      .trim();

    let artist = rawAuthor;
    let title = cleanedTitle;
    const dashParts = cleanedTitle.split(/\s+[-–—]\s+/u);
    if (dashParts.length >= 2) {
      artist = dashParts[0].trim();
      title = dashParts.slice(1).join(" - ").trim();
    }

    res.json({
      videoId,
      url: canonicalUrl,
      artist,
      title,
      year: detectedYear,
      youtubeTitle: rawTitle,
    });
  } catch (err) {
    res.status(400).json({ code: "YOUTUBE_FETCH_FAILED", message: "Konnte Metadaten nicht laden." });
  }
});

// Serve the built Svelte client (client/dist) when it exists, e.g. on Render.
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: send index.html for any other GET request (e.g. invite links).
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/socket.io") || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

const rooms = new Map();

function serializeCardForClient(card) {
  if (!card) {
    return null;
  }
  const pack = db.getPack(card.packId);
  return {
    id: card.id,
    url: card.url || "",
    packId: card.packId || "",
    packName: pack?.name || "",
    cardNumber: card.cardNumber || "",
    playlistAvatarUrl: pack?.logo ? `/pack-logo/${encodeURIComponent(card.packId)}` : "",
    title: card.title || "",
    artist: card.artist || "",
    year: card.year ?? "",
    statsKey: card.statsKey || db.getSongStatsKey(card),
  };
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function loadDeckFromPacks(packIds) {
  return db.loadDeckFromPacks(packIds);
}

function serializeRoomState(room) {
  return {
    version: room.version,
    state: room.state,
    rules: room.rules,
    players: Array.from(room.players.values()),
    teams: Array.from(room.teams.values()),
    activeTeamId: room.activeTeamId,
    currentCard: serializeCardForClient(room.currentCard),
    audioState: room.audioState || null,
    remainingCards: room.deck.length,
    pendingPlacement: room.pendingPlacement || null,
    slotVotes: Object.values(room.slotVotes || {}),
    turnDeadline: room.turnDeadline || null,
    pendingGuess: room.pendingGuess || { artist: "", title: "" },
  };
}

function getYouTubeId(url) {
  if (!url) {
    return "";
  }
  const match = String(url).match(/(?:youtu\.be\/|v=|\/embed\/)([\w-]{11})/u);
  return match ? match[1] : "";
}

function createAudioState(card) {
  const videoId = getYouTubeId(card?.url || "");
  return {
    videoId,
    currentTime: 0,
    isPaused: false,
    updatedAt: Date.now(),
  };
}
function drawValidCard(room) {
  while (room.deck.length > 0) {
    const candidate = room.deck.pop();
    if (getYouTubeId(candidate?.url || "")) {
      return candidate;
    }
    room.discard.push(candidate);
  }
  return null;
}

function broadcastRoomState(roomCode, room) {
  room.version += 1;
  io.to(roomCode).emit("room:state", serializeRoomState(room));
}

const roomTimers = new Map();

function clearRoomTurnTimer(roomCode, room) {
  const existing = roomTimers.get(roomCode);
  if (existing) {
    clearTimeout(existing);
    roomTimers.delete(roomCode);
  }
  if (room) {
    room.turnDeadline = null;
  }
}

function normalizeGuessString(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/ø/giu, "o")
    .replace(/æ/giu, "ae")
    .toLowerCase()
    .replace(/\b(?:feat|ft|featuring)\b\.?.*$/gu, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, " ")
    .replace(/\s+-\s+.*$/gu, " ")
    .replace(/[&+/]/gu, " ")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\b(?:the|die|der|das|and|und|mit)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeKeepBrackets(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/ø/giu, "o")
    .replace(/æ/giu, "ae")
    .toLowerCase()
    .replace(/\b(?:feat|ft|featuring)\b\.?[^)\]]*/gu, " ")
    .replace(/[&+/]/gu, " ")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\b(?:the|die|der|das|and|und|mit)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i += 1) {
    v0[i] = i;
  }
  for (let i = 0; i < a.length; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) {
      v0[j] = v1[j];
    }
  }
  return v0[b.length];
}

function isFuzzyMatch(guessRaw, candidates) {
  const guessForms = [normalizeGuessString(guessRaw), normalizeKeepBrackets(guessRaw)].filter(Boolean);
  if (guessForms.length === 0) {
    return false;
  }
  for (const candidate of candidates) {
    const targetForms = [normalizeGuessString(candidate), normalizeKeepBrackets(candidate)].filter(Boolean);
    for (const g of guessForms) {
      for (const t of targetForms) {
        if (g === t) {
          return true;
        }
        if (
          g.length >= 4 &&
          (t.includes(g) || g.includes(t)) &&
          Math.min(g.length, t.length) / Math.max(g.length, t.length) >= 0.65
        ) {
          return true;
        }
        const dist = levenshteinDistance(g, t);
        const maxLen = Math.max(g.length, t.length);
        const ratio = maxLen > 0 ? 1 - dist / maxLen : 0;
        if (ratio >= 0.72 || (maxLen >= 5 && dist <= 2) || (maxLen >= 3 && dist <= 1)) {
          return true;
        }
      }
    }
  }
  return false;
}

function checkArtistGuess(guessArtist, actualArtist) {
  const raw = String(actualArtist || "").trim();
  if (!raw) return false;
  const parts = raw
    .split(/[,&;/]|\b(?:feat|ft|featuring|and|und|mit|x|vs)\b\.?/iu)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return isFuzzyMatch(guessArtist, [raw, ...parts]);
}

function checkTitleGuess(guessTitle, actualTitle) {
  const raw = String(actualTitle || "").trim();
  if (!raw) return false;
  const parts = raw
    .split(/\s+-\s+|\(|\)|\[|\]/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return isFuzzyMatch(guessTitle, [raw, ...parts]);
}

function evaluateBonusGuess(rules, card, guess) {
  const mode = rules?.guessMode || "year";
  if (mode === "year" || !card) {
    return { bonusPoints: 0, artistCorrect: null, titleCorrect: null };
  }
  const artistGuess = String(guess?.artist || "").trim();
  const titleGuess = String(guess?.title || "").trim();
  const artistCorrect = checkArtistGuess(artistGuess, card.artist);
  if (mode === "year+artist") {
    return {
      bonusPoints: artistCorrect ? 1 : 0,
      artistCorrect,
      titleCorrect: null,
      hadGuess: Boolean(artistGuess),
    };
  }
  if (mode === "year+artist+title") {
    const titleCorrect = checkTitleGuess(titleGuess, card.title);
    return {
      bonusPoints: (artistCorrect ? 1 : 0) + (titleCorrect ? 1 : 0),
      artistCorrect,
      titleCorrect,
      hadGuess: Boolean(artistGuess || titleGuess),
    };
  }
  return { bonusPoints: 0, artistCorrect: null, titleCorrect: null, hadGuess: false };
}

function executeCardReveal(room, roomCode, { forceMiss = false, timedOut = false, guessOverride = null } = {}) {
  clearRoomTurnTimer(roomCode, room);
  if (!room || room.state !== "playing" || !room.currentCard) {
    return;
  }
  const team = room.teams.get(room.activeTeamId);
  if (!team) {
    return;
  }

  const normalizeYear = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const timeline = team.timeline || [];
  const hasPlacement = Boolean(room.pendingPlacement && room.pendingPlacement.teamId === room.activeTeamId);
  const index = hasPlacement
    ? Math.max(0, Math.min(Number(room.pendingPlacement.position) || 0, timeline.length))
    : 0;

  let correct = false;
  if (!forceMiss && hasPlacement) {
    const cardYear = normalizeYear(room.currentCard.year);
    const prevYear = index > 0 ? normalizeYear(timeline[index - 1].year) : -Infinity;
    const nextYear = index < timeline.length ? normalizeYear(timeline[index].year) : Infinity;
    correct = timeline.length === 0 ? true : cardYear >= prevYear && cardYear <= nextYear;
  }

  const effectiveGuess = guessOverride || room.pendingGuess || { artist: "", title: "" };
  const bonusResult = evaluateBonusGuess(room.rules, room.currentCard, effectiveGuess);

  // Song statistics: only real decisions count (the auto-placed first card is skipped).
  if (timeline.length > 0) {
    let yearError = null;
    let direction = null;
    if (!correct && hasPlacement && !forceMiss) {
      const cardYear = normalizeYear(room.currentCard.year);
      const prevYear = index > 0 ? normalizeYear(timeline[index - 1].year) : null;
      const nextYear = index < timeline.length ? normalizeYear(timeline[index].year) : null;
      if (nextYear !== null && cardYear > nextYear) {
        // Placed before songs that are older -> song was estimated too old
        yearError = cardYear - nextYear;
        direction = "too_old";
      } else if (prevYear !== null && cardYear < prevYear) {
        // Placed after songs that are newer -> song was estimated too new
        yearError = prevYear - cardYear;
        direction = "too_new";
      }
    }
    const mode = room.rules?.guessMode || "year";
    const elapsedMs = room.turnStartedAt ? Date.now() - room.turnStartedAt : null;
    db.recordSongPlay(room.currentCard, {
      correct,
      timedOut,
      yearError,
      direction,
      artistAttempt: mode === "year+artist" || mode === "year+artist+title",
      artistCorrect: Boolean(bonusResult.artistCorrect),
      titleAttempt: mode === "year+artist+title",
      titleCorrect: Boolean(bonusResult.titleCorrect),
      decisionMs: !timedOut && elapsedMs !== null && elapsedMs <= 10 * 60 * 1000 ? elapsedMs : null,
    });
  }

  if (correct) {
    team.score += 1;
    team.timeline = [...timeline.slice(0, index), room.currentCard, ...timeline.slice(index)];
  } else {
    room.pendingDiscard = room.currentCard;
  }

  if (bonusResult.bonusPoints > 0) {
    team.score += bonusResult.bonusPoints;
  }

  room.roundResults.set(team.id, correct);

  const revealedCard = room.currentCard;
  room.currentCard = null;
  room.audioState = room.audioState?.videoId ? room.audioState : createAudioState(revealedCard);
  room.pendingPlacement = null;
  room.pendingGuess = { artist: "", title: "" };
  room.slotVotes = {};
  room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
  room.activeTeamId = room.turnOrder[room.turnIndex];

  io.to(roomCode).emit("game:card-revealed", {
    teamId: team.id,
    card: serializeCardForClient(revealedCard),
    correct,
    position: index,
    activeTeamId: room.activeTeamId,
    remainingCards: room.deck.length,
    audioState: room.audioState,
    timedOut,
    hadPlacement: hasPlacement,
    bonusPoints: bonusResult.bonusPoints,
    artistCorrect: bonusResult.artistCorrect,
    titleCorrect: bonusResult.titleCorrect,
    hadGuess: bonusResult.hadGuess,
  });
  io.to(roomCode).emit("room:teams", { teams: Array.from(room.teams.values()) });
  advanceRound(room, roomCode);
  broadcastRoomState(roomCode, room);
}

function startRoomTurnTimer(roomCode, room) {
  clearRoomTurnTimer(roomCode, room);
  if (!room || room.state !== "playing" || !room.currentCard || !room.rules?.timerEnabled) {
    return;
  }
  const activeTeam = room.teams.get(room.activeTeamId);
  if (!activeTeam || (activeTeam.timeline || []).length === 0) {
    return;
  }
  const durationSec = Math.max(5, Math.min(300, Number(room.rules.timerDuration) || 60));
  room.turnDeadline = Date.now() + durationSec * 1000;
  const timerId = setTimeout(() => {
    roomTimers.delete(roomCode);
    const currentRoom = rooms.get(roomCode);
    if (!currentRoom || currentRoom.state !== "playing" || !currentRoom.currentCard) {
      return;
    }
    const hasPlacement = Boolean(
      currentRoom.pendingPlacement && currentRoom.pendingPlacement.teamId === currentRoom.activeTeamId
    );
    executeCardReveal(currentRoom, roomCode, {
      forceMiss: !hasPlacement,
      timedOut: true,
    });
  }, durationSec * 1000);
  roomTimers.set(roomCode, timerId);
}

function sortTeamIds(teamIds) {
  return [...teamIds].sort((a, b) => {
    const aNum = Number.parseInt(String(a).split("-")[1], 10);
    const bNum = Number.parseInt(String(b).split("-")[1], 10);
    return (Number.isNaN(aNum) ? 0 : aNum) - (Number.isNaN(bNum) ? 0 : bNum);
  });
}

function resolveRoundOutcome(room, roomCode) {
  const roundResults = room.roundResults || new Map();

  if (room.isSuddenDeath) {
    const activeTeams = room.suddenDeathTeams.length ? room.suddenDeathTeams : room.turnOrder;
    const correctTeams = activeTeams.filter((teamId) => roundResults.get(teamId));
    const survivors = correctTeams.length ? correctTeams : activeTeams;

    if (survivors.length === 1) {
      room.state = "finished";
      io.to(roomCode).emit("game:win", { teamId: survivors[0] });
      return true;
    }

    room.suddenDeathTeams = survivors;
    room.turnOrder = sortTeamIds(survivors);
    room.turnIndex = 0;
    room.activeTeamId = room.turnOrder[0];
    room.roundTurnsRemaining = room.turnOrder.length;
    io.to(roomCode).emit("game:sudden-death", { teamIds: survivors });
    room.roundResults = new Map();
    return false;
  }

  const winners = Array.from(room.teams.values()).filter(
    (candidate) => candidate.score >= room.rules.winTarget
  );

  if (winners.length === 1) {
    room.state = "finished";
    io.to(roomCode).emit("game:win", { teamId: winners[0].id });
    return true;
  }

  if (winners.length > 1) {
    room.isSuddenDeath = true;
    room.suddenDeathTeams = winners.map((winner) => winner.id);
    room.turnOrder = sortTeamIds(room.suddenDeathTeams);
    room.turnIndex = 0;
    room.activeTeamId = room.turnOrder[0];
    room.roundTurnsRemaining = room.turnOrder.length;
    io.to(roomCode).emit("game:sudden-death", { teamIds: room.suddenDeathTeams });
    room.roundResults = new Map();
    return false;
  }

  room.roundResults = new Map();
  room.roundTurnsRemaining = room.turnOrder.length;
  return false;
}

function advanceRound(room, roomCode) {
  if (!room.roundTurnsRemaining || room.roundTurnsRemaining <= 0) {
    room.roundTurnsRemaining = room.turnOrder.length;
  }
  room.roundTurnsRemaining = Math.max(0, room.roundTurnsRemaining - 1);
  if (room.roundTurnsRemaining > 0) {
    return false;
  }
  return resolveRoundOutcome(room, roomCode);
}

function createRoom(code, hostId, hostName) {
    return {
        code,
        hostId,
        state: "lobby",
        players: new Map([[hostId, { id: hostId, name: hostName || "Host", teamId: null }]]),
        teams: new Map(),
        rules: {
          packs: [],
          winTarget: 10,
          guessMode: "year",
          timerEnabled: false,
          timerDuration: 60,
          teamCount: 2,
        },
        deck: [],
        discard: [],
        currentCard: null,
        audioState: null,
        audioSyncAuthorityId: null,
        audioSyncAuthorityUpdatedAt: 0,
        pendingPlacement: null,
        pendingDiscard: null,
        slotVotes: {},
        turnDeadline: null,
        pendingGuess: { artist: "", title: "" },
        activeTeamId: null,
        turnOrder: [],
        turnIndex: 0,
        roundStartIndex: 0,
        roundTurnsRemaining: 0,
        roundResults: new Map(),
        suddenDeathTeams: [],
        isSuddenDeath: false,
        version: 0,
    };
}

function createPlayer(id, name, clientId) {
    return {
        id,
        name: name || "Player",
        teamId: null,
        clientId: clientId || "",
        connected: true,
    };
}

function findPlayerByClientId(room, clientId) {
  if (!clientId) {
    return null;
  }
  for (const [socketId, player] of room.players.entries()) {
    if (player.clientId === clientId) {
      return { socketId, player };
    }
  }
  return null;
}

function createTeam(id, name) {
    return {
        id,
        name: name || "Team",
        timeline: [],
        score: 0,
    };
}

function normalizeTeamName(name) {
  if (typeof name !== "string") {
    return "";
  }
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

function applyTeamCount(room, teamCount) {
  room.teams = new Map();
  for (let i = 1; i <= teamCount; i += 1) {
    const teamId = `team-${i}`;
    room.teams.set(teamId, createTeam(teamId, `Team ${i}`));
  }
  for (const player of room.players.values()) {
    player.teamId = null;
  }
}

function assignPlayersToRandomTeams(room) {
  const players = Array.from(room.players.values());
  const teamIds = sortTeamIds(Array.from(room.teams.keys()));

  if (teamIds.length === 0) {
    for (const player of players) {
      player.teamId = null;
    }
    return;
  }

  for (let i = players.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  const baseTeamSize = Math.floor(players.length / teamIds.length);
  const teamsWithExtraPlayer = players.length % teamIds.length;

  let playerIndex = 0;
  for (let teamIndex = 0; teamIndex < teamIds.length; teamIndex += 1) {
    const teamId = teamIds[teamIndex];
    const teamSize = baseTeamSize + (teamIndex < teamsWithExtraPlayer ? 1 : 0);
    for (let count = 0; count < teamSize; count += 1) {
      players[playerIndex].teamId = teamId;
      playerIndex += 1;
    }
  }
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ hostName, rules, clientId } = {}) => {
    let code = createRoomCode();
    while (rooms.has(code)) {
      code = createRoomCode();
    }
    const room = createRoom(code, socket.id, hostName);
    room.players.set(socket.id, createPlayer(socket.id, hostName, clientId));
    if (rules) {
      room.rules = { ...room.rules, ...rules };
    }
    if (Number.isInteger(room.rules.teamCount) && room.rules.teamCount > 0) {
      applyTeamCount(room, room.rules.teamCount);
    }
    rooms.set(code, room);
    socket.join(code);
    socket.emit("room:created", { roomCode: code, hostId: socket.id });
    io.to(code).emit("room:rules", { rules: room.rules });
    io.to(code).emit("room:teams", { teams: Array.from(room.teams.values()) });
    io.to(code).emit("room:players", { players: Array.from(room.players.values()) });
    broadcastRoomState(code, room);
  });

  socket.on("room:join", ({ roomCode, playerName, clientId } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    const existing = findPlayerByClientId(room, clientId);
    if (existing) {
      room.players.delete(existing.socketId);
      existing.player.id = socket.id;
      existing.player.name = playerName || existing.player.name;
      existing.player.connected = true;
      room.players.set(socket.id, existing.player);
    } else {
      room.players.set(socket.id, createPlayer(socket.id, playerName, clientId));
    }
    socket.join(roomCode);
    socket.emit("room:rules", { rules: room.rules });
    socket.emit("room:teams", { teams: Array.from(room.teams.values()) });
    socket.emit("room:state", serializeRoomState(room));
    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("room:sync", ({ roomCode, clientId, playerName } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    let updated = false;
    const existing = findPlayerByClientId(room, clientId);
    if (existing) {
      if (existing.socketId !== socket.id) {
        room.players.delete(existing.socketId);
        existing.player.id = socket.id;
        room.players.set(socket.id, existing.player);
        updated = true;
      }
      existing.player.name = playerName || existing.player.name;
      existing.player.connected = true;
    } else if (playerName) {
      room.players.set(socket.id, createPlayer(socket.id, playerName, clientId));
      updated = true;
    }
    socket.join(roomCode);
    socket.emit("room:state", serializeRoomState(room));
    if (updated) {
      io.to(roomCode).emit("room:players", {
        players: Array.from(room.players.values()),
      });
      broadcastRoomState(roomCode, room);
    }
  });

  socket.on("audio:sync", ({ roomCode, videoId, currentTime, isPaused, interaction } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    const requestingPlayer = room.players.get(socket.id);
    if (!requestingPlayer) {
      socket.emit("error", { code: "PLAYER_NOT_FOUND", message: "Player not found" });
      return;
    }

    if (room.state !== "playing") {
      return;
    }

    const normalizedVideoId = typeof videoId === "string" ? videoId : "";
    if (!normalizedVideoId) {
      return;
    }

    const prevState = room.audioState || createAudioState(room.currentCard);
    if (!prevState.videoId) {
      return;
    }
    if (prevState.videoId && prevState.videoId !== normalizedVideoId) {
      return;
    }

    const normalizedTime = Number.isFinite(Number(currentTime))
      ? Math.max(0, Number(currentTime))
      : prevState.currentTime || 0;
    const normalizedPaused = typeof isPaused === "boolean" ? isPaused : Boolean(prevState.isPaused);
    const isInteraction = Boolean(interaction);

    const now = Date.now();
    const authorityTimeoutMs = 4500;
    const hasAuthority = room.audioSyncAuthorityId === socket.id;
    const authorityExpired = now - (room.audioSyncAuthorityUpdatedAt || 0) > authorityTimeoutMs;
    const isMajorCorrection = Math.abs(normalizedTime - (prevState.currentTime || 0)) >= 1.5;
    const pauseStateChanged = normalizedPaused !== Boolean(prevState.isPaused);
    const canTakeAuthority = !room.audioSyncAuthorityId || hasAuthority || authorityExpired || isMajorCorrection || pauseStateChanged;

    if (!canTakeAuthority) {
      return;
    }

    const shouldBroadcast = isInteraction || pauseStateChanged || isMajorCorrection;

    if (!hasAuthority) {
      if (!shouldBroadcast) {
        return;
      }
      room.audioSyncAuthorityId = socket.id;
    }
    room.audioSyncAuthorityUpdatedAt = now;

    const nextAudioState = {
      videoId: normalizedVideoId,
      currentTime: normalizedTime,
      isPaused: normalizedPaused,
      updatedAt: now,
    };

    room.audioState = nextAudioState;

    if (shouldBroadcast) {
      io.to(roomCode).emit("audio:state", nextAudioState);
    }
  });

  socket.on("team:join", ({ roomCode, teamId, playerName, clientId } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    socket.join(roomCode);

    let player = room.players.get(socket.id);
    if (!player) {
      const existing = findPlayerByClientId(room, clientId);
      if (existing) {
        room.players.delete(existing.socketId);
        existing.player.id = socket.id;
        existing.player.connected = true;
        player = existing.player;
      } else {
        player = createPlayer(socket.id, playerName || "Player", clientId);
      }
      room.players.set(socket.id, player);
    }
    player.name = playerName || player.name;

    if (!room.teams.has(teamId)) return;

    player.teamId = teamId;

    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("team:rename", ({ roomCode, teamId, name, clientId } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    socket.join(roomCode);

    let requestingPlayer = room.players.get(socket.id);
    if (!requestingPlayer && clientId) {
      const existing = findPlayerByClientId(room, clientId);
      if (existing) {
        room.players.delete(existing.socketId);
        existing.player.id = socket.id;
        existing.player.connected = true;
        room.players.set(socket.id, existing.player);
        requestingPlayer = existing.player;
      }
    }

    if (!requestingPlayer) {
      socket.emit("error", { code: "PLAYER_NOT_FOUND", message: "Player not found" });
      return;
    }

    const team = room.teams.get(teamId);
    if (!team) {
      socket.emit("error", { code: "TEAM_NOT_FOUND", message: "Team not found" });
      return;
    }

    if (requestingPlayer.teamId !== teamId) {
      socket.emit("error", { code: "NOT_TEAM_MEMBER", message: "Only team members can rename this team" });
      return;
    }

    const normalizedName = normalizeTeamName(name);
    if (!normalizedName) {
      socket.emit("error", { code: "INVALID_TEAM_NAME", message: "Team name is required" });
      return;
    }

    team.name = normalizedName;
    io.to(roomCode).emit("room:teams", { teams: Array.from(room.teams.values()) });
    broadcastRoomState(roomCode, room);
  });
  socket.on("team:randomize", ({ roomCode } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can randomize teams" });
      return;
    }

    if (room.state !== "lobby" && room.state !== "finished") {
      socket.emit("error", { code: "GAME_IN_PROGRESS", message: "Random teams are only available in lobby or after game end" });
      return;
    }

    assignPlayersToRandomTeams(room);
    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("rules:update", ({ roomCode, rules } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    const nextRules = { ...room.rules, ...rules };
    room.rules = nextRules;
    if (Number.isInteger(nextRules.teamCount) && nextRules.teamCount > 0) {
      applyTeamCount(room, nextRules.teamCount);
    }
    io.to(roomCode).emit("room:rules", { rules: room.rules });
    io.to(roomCode).emit("room:teams", {
      teams: Array.from(room.teams.values()),
    });
    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("room:leave", ({ roomCode } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      return;
    }
    room.players.delete(socket.id);
    socket.leave(roomCode);
    if (room.players.size === 0) {
      rooms.delete(roomCode);
      return;
    }
    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
  });

  socket.on("player:kick", ({ roomCode, playerId } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can kick players" });
      return;
    }
    if (!playerId || playerId === room.hostId) {
      socket.emit("error", { code: "INVALID_PLAYER", message: "Cannot kick the host" });
      return;
    }
    if (!room.players.has(playerId)) {
      return;
    }
    room.players.delete(playerId);
    io.to(playerId).emit("player:kicked", { roomCode });
    const targetSocket = io.sockets.sockets.get(playerId);
    if (targetSocket) {
      targetSocket.leave(roomCode);
    }
    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:start", ({ roomCode, randomizeTeams } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can start the game" });
      return;
    }

    const teams = Array.from(room.teams.values());
    if (teams.length < 2) {
      socket.emit("error", { code: "NOT_ENOUGH_TEAMS", message: "At least two teams are required to start the game" });
      return;
    }

    if (!Array.isArray(room.rules.packs) || room.rules.packs.length === 0) {
      socket.emit("error", { code: "NO_PACKS", message: "Select at least one pack" });
      return;
    }

    if (Boolean(randomizeTeams)) {
      assignPlayersToRandomTeams(room);
      io.to(roomCode).emit("room:players", {
        players: Array.from(room.players.values()),
      });
    }

    const unassignedPlayers = Array.from(room.players.values()).filter((player) => !player.teamId);
    if (unassignedPlayers.length > 0) {
      socket.emit("error", {
        code: "UNASSIGNED_PLAYERS",
        message: "All players must join a team before starting the game",
      });
      return;
    }

    const deck = loadDeckFromPacks(room.rules.packs);
    if (deck.length === 0) {
      socket.emit("error", { code: "EMPTY_DECK", message: "No cards loaded from packs" });
      return;
    }

    room.deck = shuffleDeck(deck);
    room.discard = [];
    room.currentCard = null;
    room.audioState = null;
    room.audioSyncAuthorityId = null;
    room.audioSyncAuthorityUpdatedAt = 0;
    room.pendingDiscard = null;
    room.slotVotes = {};
    room.pendingGuess = { artist: "", title: "" };
    clearRoomTurnTimer(roomCode, room);

    for (const team of room.teams.values()) {
      team.score = 0;
      team.timeline = [];
    }

    room.state = "playing";
    room.isSuddenDeath = false;
    room.suddenDeathTeams = [];
    room.roundResults = new Map();
    room.turnOrder = sortTeamIds(Array.from(room.teams.keys()));
    room.turnIndex = 0;
    room.roundStartIndex = 0;
    room.roundTurnsRemaining = room.turnOrder.length;
    room.activeTeamId = room.turnOrder[0];

    io.to(roomCode).emit("game:started", {
        state: room.state,
        activeTeamId: room.activeTeamId,
        turnOrder: room.turnOrder,
        remainingCards: room.deck.length,
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:host-soft-reset", ({ roomCode, randomizeTeams } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can reset the game" });
      return;
    }

    if (!Array.isArray(room.rules.packs) || room.rules.packs.length === 0) {
      socket.emit("error", { code: "NO_PACKS", message: "Select at least one pack" });
      return;
    }

    if (Boolean(randomizeTeams)) {
      assignPlayersToRandomTeams(room);
      io.to(roomCode).emit("room:players", {
        players: Array.from(room.players.values()),
      });
    }

    const deck = loadDeckFromPacks(room.rules.packs);
    if (deck.length === 0) {
      socket.emit("error", { code: "EMPTY_DECK", message: "No cards loaded from packs" });
      return;
    }

    room.deck = shuffleDeck(deck);
    room.discard = [];
    room.currentCard = null;
    room.pendingPlacement = null;
    room.pendingDiscard = null;
    room.slotVotes = {};
    room.pendingGuess = { artist: "", title: "" };
    clearRoomTurnTimer(roomCode, room);
    room.audioState = null;
    room.audioSyncAuthorityId = null;
    room.audioSyncAuthorityUpdatedAt = 0;

    for (const team of room.teams.values()) {
      team.score = 0;
      team.timeline = [];
    }

    room.state = "playing";
    room.isSuddenDeath = false;
    room.suddenDeathTeams = [];
    room.roundResults = new Map();
    room.turnOrder = sortTeamIds(Array.from(room.teams.keys()));
    room.turnIndex = 0;
    room.roundStartIndex = 0;
    room.roundTurnsRemaining = room.turnOrder.length;
    room.activeTeamId = room.turnOrder[0] || null;

    io.to(roomCode).emit("room:teams", { teams: Array.from(room.teams.values()) });
    io.to(roomCode).emit("game:started", {
      state: room.state,
      activeTeamId: room.activeTeamId,
      turnOrder: room.turnOrder,
      remainingCards: room.deck.length,
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:return-to-lobby", ({ roomCode } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can return to lobby" });
      return;
    }

    room.state = "lobby";
    room.currentCard = null;
    room.pendingPlacement = null;
    room.pendingDiscard = null;
    room.slotVotes = {};
    room.pendingGuess = { artist: "", title: "" };
    clearRoomTurnTimer(roomCode, room);
    room.audioState = null;
    room.audioSyncAuthorityId = null;
    room.audioSyncAuthorityUpdatedAt = 0;
    room.activeTeamId = "";
    room.isSuddenDeath = false;
    room.suddenDeathTeams = [];
    room.roundResults = new Map();

    for (const team of room.teams.values()) {
      team.score = 0;
      team.timeline = [];
    }

    io.to(roomCode).emit("room:teams", { teams: Array.from(room.teams.values()) });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:host-skip-song", ({ roomCode } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can skip songs" });
      return;
    }

    if (room.state !== "playing") {
      socket.emit("error", { code: "GAME_NOT_STARTED", message: "Game has not started" });
      return;
    }

    if (!room.currentCard) {
      socket.emit("error", { code: "NO_CARD", message: "No card to skip" });
      return;
    }

    room.pendingPlacement = null;
    room.slotVotes = {};
    room.discard.push(room.currentCard);

    if (room.deck.length === 0) {
      room.currentCard = null;
      room.audioState = null;
      room.audioSyncAuthorityId = null;
      room.audioSyncAuthorityUpdatedAt = 0;
      io.to(roomCode).emit("game:deck-empty", { remainingCards: 0 });
      broadcastRoomState(roomCode, room);
      return;
    }

    const nextCard = drawValidCard(room);
    if (!nextCard) {
      room.currentCard = null;
      room.audioState = null;
      room.audioSyncAuthorityId = null;
      room.audioSyncAuthorityUpdatedAt = 0;
      io.to(roomCode).emit("game:deck-empty", { remainingCards: 0 });
      broadcastRoomState(roomCode, room);
      return;
    }
    room.currentCard = nextCard;
    room.turnStartedAt = Date.now();
    room.pendingGuess = { artist: "", title: "" };
    room.audioState = createAudioState(nextCard);
    room.audioSyncAuthorityId = null;
    room.audioSyncAuthorityUpdatedAt = 0;
    startRoomTurnTimer(roomCode, room);

    io.to(roomCode).emit("game:host-song-skipped", {
      activeTeamId: room.activeTeamId,
      card: serializeCardForClient(nextCard),
      remainingCards: room.deck.length,
      audioState: room.audioState,
      turnDeadline: room.turnDeadline,
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:report-broken-song", ({ roomCode, cardId } = {}) => {
    const room = rooms.get(roomCode);
    if (!room || room.state !== "playing" || !room.currentCard) {
      return;
    }
    if (!room.players.has(socket.id)) {
      return;
    }
    if (cardId && room.currentCard.id !== cardId) {
      return;
    }

    db.markSongBroken(room.currentCard);
    room.discard.push(room.currentCard);
    room.pendingPlacement = null;
    room.slotVotes = {};

    const nextCard = drawValidCard(room);
    if (!nextCard) {
      room.currentCard = null;
      room.audioState = null;
      room.audioSyncAuthorityId = null;
      room.audioSyncAuthorityUpdatedAt = 0;
      io.to(roomCode).emit("game:deck-empty", { remainingCards: 0 });
      broadcastRoomState(roomCode, room);
      return;
    }

    room.currentCard = nextCard;
    room.turnStartedAt = Date.now();
    room.pendingGuess = { artist: "", title: "" };
    room.audioState = createAudioState(nextCard);
    room.audioSyncAuthorityId = null;
    room.audioSyncAuthorityUpdatedAt = 0;
    startRoomTurnTimer(roomCode, room);

    io.to(roomCode).emit("game:host-song-skipped", {
      activeTeamId: room.activeTeamId,
      card: serializeCardForClient(nextCard),
      remainingCards: room.deck.length,
      audioState: room.audioState,
      turnDeadline: room.turnDeadline,
      autoSkipped: true,
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:next-turn", ({ roomCode } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    const requestingPlayer = room.players.get(socket.id);
    if (socket.id !== room.hostId && requestingPlayer?.teamId !== room.activeTeamId) {
      socket.emit("error", { code: "NOT_ACTIVE_TEAM", message: "Not your turn" });
      return;
    }

    if (room.state !== "playing") {
      socket.emit("error", { code: "GAME_NOT_STARTED", message: "Game has not started" });
      return;
    }

    if (room.currentCard) {
      socket.emit("error", { code: "CARD_PENDING", message: "Resolve current card first" });
      return;
    }

    if (room.pendingPlacement) {
      socket.emit("error", { code: "PLACEMENT_PENDING", message: "Confirm placement first" });
      return;
    }

    if (room.turnOrder.length === 0) {
      room.turnOrder = sortTeamIds(Array.from(room.teams.keys()));
    }

    if (room.pendingDiscard) {
      room.discard.push(room.pendingDiscard);
      room.pendingDiscard = null;
    room.slotVotes = {};
    room.pendingGuess = { artist: "", title: "" };
    clearRoomTurnTimer(roomCode, room);
    }

    room.slotVotes = {};
    room.pendingGuess = { artist: "", title: "" };
    const nextCard = drawValidCard(room);
    if (nextCard) {
      room.currentCard = nextCard;
      room.turnStartedAt = Date.now();
      room.audioState = createAudioState(nextCard);
      room.audioSyncAuthorityId = null;
      room.audioSyncAuthorityUpdatedAt = 0;
      startRoomTurnTimer(roomCode, room);
      io.to(roomCode).emit("game:next-turn", {
        activeTeamId: room.activeTeamId,
        card: serializeCardForClient(nextCard),
        remainingCards: room.deck.length,
        audioState: room.audioState,
        turnDeadline: room.turnDeadline,
      });
      broadcastRoomState(roomCode, room);
    } else {
      clearRoomTurnTimer(roomCode, room);
      io.to(roomCode).emit("game:deck-empty", { remainingCards: 0 });
      broadcastRoomState(roomCode, room);
    }
  });

  socket.on("game:place-card", ({ roomCode, teamId, position } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    if (room.state !== "playing") {
      socket.emit("error", { code: "GAME_NOT_STARTED", message: "Game has not started" });
      return;
    }
    const requestingPlayer = room.players.get(socket.id);
    if (!requestingPlayer || requestingPlayer.teamId !== room.activeTeamId) {
      socket.emit("error", { code: "NOT_ACTIVE_TEAM", message: "Not your turn" });
      return;
    }
    if (!room.currentCard) {
      socket.emit("error", { code: "NO_CARD", message: "No card to place" });
      return;
    }
    if (teamId !== room.activeTeamId) {
      socket.emit("error", { code: "NOT_ACTIVE_TEAM", message: "Not your turn" });
      return;
    }
    const team = room.teams.get(teamId);
    if (!team) {
      socket.emit("error", { code: "TEAM_NOT_FOUND", message: "Team not found" });
      return;
    }

    const timeline = team.timeline || [];
    const index = timeline.length === 0 ? 0 : Math.max(0, Math.min(Number(position) || 0, timeline.length));

    if (timeline.length === 0) {
      team.score += 1;
      team.timeline = [room.currentCard];
      const revealedCard = room.currentCard;
      room.currentCard = null;
      room.audioState = room.audioState?.videoId ? room.audioState : createAudioState(revealedCard);
      room.roundResults.set(team.id, true);
      room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
      room.activeTeamId = room.turnOrder[room.turnIndex];

      io.to(roomCode).emit("game:card-revealed", {
        teamId: team.id,
        card: serializeCardForClient(revealedCard),
        correct: true,
        position: 0,
        activeTeamId: room.activeTeamId,
        remainingCards: room.deck.length,
        audioState: room.audioState,
      });
      io.to(roomCode).emit("room:teams", { teams: Array.from(room.teams.values()) });
      advanceRound(room, roomCode);
      broadcastRoomState(roomCode, room);
      return;
    }

    room.pendingPlacement = { teamId, position: index };

    io.to(roomCode).emit("game:card-placed", {
      teamId,
      position: index,
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:vote-slot", ({ roomCode, teamId, position } = {}) => {
    const room = rooms.get(roomCode);
    if (!room || room.state !== "playing" || !room.currentCard) {
      return;
    }
    const requestingPlayer = room.players.get(socket.id);
    if (!requestingPlayer || requestingPlayer.teamId !== room.activeTeamId) {
      return;
    }
    if (teamId !== room.activeTeamId) {
      return;
    }
    const team = room.teams.get(teamId);
    if (!team) {
      return;
    }
    const timeline = team.timeline || [];
    if (timeline.length === 0) {
      return;
    }
    const index = Math.max(0, Math.min(Number(position) || 0, timeline.length));
    if (!room.slotVotes) {
      room.slotVotes = {};
    }
    const voteKey = requestingPlayer.clientId || socket.id;
    const existingVote = room.slotVotes[voteKey];
    if (existingVote && existingVote.position === index && existingVote.teamId === teamId) {
      delete room.slotVotes[voteKey];
    } else {
      room.slotVotes[voteKey] = {
        playerId: socket.id,
        clientId: requestingPlayer.clientId || "",
        playerName: requestingPlayer.name || "Player",
        teamId,
        position: index,
      };
    }
    io.to(roomCode).emit("game:slot-votes", {
      slotVotes: Object.values(room.slotVotes),
    });
    broadcastRoomState(roomCode, room);
  });

  socket.on("game:update-guess", ({ roomCode, artist, title } = {}) => {
    const room = rooms.get(roomCode);
    if (!room || room.state !== "playing" || !room.currentCard) {
      return;
    }
    const requestingPlayer = room.players.get(socket.id);
    if (!requestingPlayer || requestingPlayer.teamId !== room.activeTeamId) {
      return;
    }
    room.pendingGuess = {
      artist: typeof artist === "string" ? artist.slice(0, 120) : room.pendingGuess?.artist || "",
      title: typeof title === "string" ? title.slice(0, 120) : room.pendingGuess?.title || "",
    };
    io.to(roomCode).emit("game:guess-updated", {
      pendingGuess: room.pendingGuess,
    });
  });

  socket.on("game:reveal-card", ({ roomCode, artistGuess, titleGuess } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    if (room.state !== "playing") {
      socket.emit("error", { code: "GAME_NOT_STARTED", message: "Game has not started" });
      return;
    }
    const requestingPlayer = room.players.get(socket.id);
    if (!requestingPlayer || requestingPlayer.teamId !== room.activeTeamId) {
      socket.emit("error", { code: "NOT_ACTIVE_TEAM", message: "Not your turn" });
      return;
    }
    if (!room.currentCard || !room.pendingPlacement) {
      socket.emit("error", { code: "NO_PLACEMENT", message: "No card placement to reveal" });
      return;
    }
    if (room.pendingPlacement.teamId !== room.activeTeamId) {
      socket.emit("error", { code: "NOT_ACTIVE_TEAM", message: "Not your turn" });
      return;
    }

    const guessOverride =
      typeof artistGuess === "string" || typeof titleGuess === "string"
        ? {
            artist: typeof artistGuess === "string" ? artistGuess : room.pendingGuess?.artist || "",
            title: typeof titleGuess === "string" ? titleGuess : room.pendingGuess?.title || "",
          }
        : null;

    executeCardReveal(room, roomCode, { guessOverride });
  });

  socket.on("game:score-update", ({ roomCode, teamId, card, correct } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    if (room.state !== "playing") {
      socket.emit("error", { code: "GAME_NOT_STARTED", message: "Game has not started" });
      return;
    }
    const team = room.teams.get(teamId);
    if (!team) {
      socket.emit("error", { code: "TEAM_NOT_FOUND", message: "Team not found" });
      return;
    }

    if (correct) {
      team.score += 1;
      if (card) {
        team.timeline.push(card);
      }
    } else if (card) {
      room.discard.push(card);
    }

    io.to(roomCode).emit("game:score-updated", {
      teamId: team.id,
      score: team.score,
      timelineLength: team.timeline.length,
      remainingCards: room.deck.length,
      audioState: room.audioState,
    });
    io.to(roomCode).emit("room:teams", {
      teams: Array.from(room.teams.values()),
    });

    if (advanceRound(room, roomCode)) {
      return;
    }

    io.to(roomCode).emit("game:round-ended", { isSuddenDeath: room.isSuddenDeath });
    broadcastRoomState(roomCode, room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      const player = room.players.get(socket.id);
      if (!player) {
        continue;
      }
      if (player.clientId) {
        player.connected = false;
        io.to(code).emit("room:players", {
          players: Array.from(room.players.values()),
        });
        broadcastRoomState(code, room);
        break;
      }
      if (room.players.delete(socket.id)) {
        if (room.players.size === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit("room:players", {
            players: Array.from(room.players.values()),
          });
          broadcastRoomState(code, room);
        }
        break;
      }
    }
  });
});


db.initDatabase().finally(() => {
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
});

