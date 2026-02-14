const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { parse } = require("csv-parse/sync");

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/packs", (_req, res) => {
  res.json(Array.from(packIndex.values()));
});

app.get("/pack-logo/:packId", (req, res) => {
  const pack = packIndex.get(req.params.packId);
  if (!pack?.logo) {
    res.status(404).json({ code: "PACK_LOGO_NOT_FOUND" });
    return;
  }
  res.sendFile(path.join(REPO_ROOT, pack.logo));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const rooms = new Map();

const REPO_ROOT = path.join(__dirname, "..");
const PACK_LIST_PATH = path.join(REPO_ROOT, "data", "playlists", "hitster_de_packs.json");

function loadPackIndex() {
  const raw = fs.readFileSync(PACK_LIST_PATH, "utf-8");
  const packs = JSON.parse(raw);
  return new Map(packs.map((pack) => [pack.id, pack]));
}

const packIndex = loadPackIndex();

function serializeCardForClient(card) {
  if (!card) {
    return null;
  }
  const pack = packIndex.get(card.packId);
  return {
    id: card.id,
    url: card.url || "",
    packId: card.packId || "",
    packName: pack?.name || "",
    cardNumber: card.cardNumber || "",
    playlistAvatarUrl: card.packId ? `/pack-logo/${encodeURIComponent(card.packId)}` : "",
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
  const cards = [];
  for (const packId of packIds) {
    const pack = packIndex.get(packId);
    if (!pack) {
      continue;
    }
    const csvPath = path.join(REPO_ROOT, pack.file);
    const raw = fs.readFileSync(csvPath, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });
    for (const row of records) {
      const parsedYear = Number.parseInt(row["Year"], 10);
      const year = Number.isNaN(parsedYear) ? row["Year"] : parsedYear;
      const cardNumber = row["Card#"] || row["﻿Card#"] || "";
      cards.push({
        id: `${packId}-${cardNumber || cards.length + 1}`,
        packId,
        cardNumber,
        title: row["Title"] || "",
        artist: row["Artist"] || "",
        year,
        url: row["URL"] || "",
        youtubeTitle: row["Youtube-Title"] || "",
        isrc: row["ISRC"] || "",
      });
    }
  }
  return cards;
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
    remainingCards: room.deck.length,
    pendingPlacement: room.pendingPlacement || null,
  };
}

function broadcastRoomState(roomCode, room) {
  room.version += 1;
  io.to(roomCode).emit("room:state", serializeRoomState(room));
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
        pendingPlacement: null,
        pendingDiscard: null,
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

  socket.on("game:start", ({ roomCode } = {}) => {
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
    room.pendingDiscard = null;

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
    }

    if (room.deck.length !== 0) {
      const nextCard = room.deck.pop();
      room.currentCard = nextCard;
      io.to(roomCode).emit("game:next-turn", {
        activeTeamId: room.activeTeamId,
        card: serializeCardForClient(nextCard),
        remainingCards: room.deck.length,
      });
      broadcastRoomState(roomCode, room);
    } else {
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
      room.roundResults.set(team.id, true);
      room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
      room.activeTeamId = room.turnOrder[room.turnIndex];

      io.to(roomCode).emit("game:card-revealed", {
        teamId: team.id,
        card: revealedCard,
        correct: true,
        position: 0,
        activeTeamId: room.activeTeamId,
        remainingCards: room.deck.length,
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

  socket.on("game:reveal-card", ({ roomCode } = {}) => {
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

    const team = room.teams.get(room.activeTeamId);
    if (!team) {
      socket.emit("error", { code: "TEAM_NOT_FOUND", message: "Team not found" });
      return;
    }

    const normalizeYear = (value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const timeline = team.timeline || [];
    const index = room.pendingPlacement.position;
    const cardYear = normalizeYear(room.currentCard.year);
    const prevYear = index > 0 ? normalizeYear(timeline[index - 1].year) : -Infinity;
    const nextYear = index < timeline.length ? normalizeYear(timeline[index].year) : Infinity;
    const correct = timeline.length === 0 ? true : (cardYear >= prevYear && cardYear <= nextYear);

    if (correct) {
      team.score += 1;
      team.timeline = [...timeline.slice(0, index), room.currentCard, ...timeline.slice(index)];
    } else {
      room.pendingDiscard = room.currentCard;
    }
    room.roundResults.set(team.id, correct);

    const revealedCard = room.currentCard;
    room.currentCard = null;
    room.pendingPlacement = null;
    room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
    room.activeTeamId = room.turnOrder[room.turnIndex];

    io.to(roomCode).emit("game:card-revealed", {
      teamId: team.id,
      card: revealedCard,
      correct,
      position: index,
      activeTeamId: room.activeTeamId,
      remainingCards: room.deck.length,
    });
    io.to(roomCode).emit("room:teams", { teams: Array.from(room.teams.values()) });
    advanceRound(room, roomCode);
    broadcastRoomState(roomCode, room);
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


server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
