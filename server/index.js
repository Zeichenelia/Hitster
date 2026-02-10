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
      const cardNumber = row["Card#"] || "";
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
        activeTeamId: null,
        turnOrder: [],
        turnIndex: 0,
        isSuddenDeath: false,
    };
}

function createPlayer(id, name) {
    return {
        id,
        name: name || "Player",
        teamId: null,
    };
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
  socket.on("room:create", ({ hostName, rules } = {}) => {
    let code = createRoomCode();
    while (rooms.has(code)) {
      code = createRoomCode();
    }
    const room = createRoom(code, socket.id, hostName);
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
  });

  socket.on("room:join", ({ roomCode, playerName } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    room.players.set(socket.id, createPlayer(socket.id, playerName));
    socket.join(roomCode);
    socket.emit("room:rules", { rules: room.rules });
    socket.emit("room:teams", { teams: Array.from(room.teams.values()) });
    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
  });

  socket.on("team:join", ({ roomCode, teamId } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    if (!room.teams.has(teamId)) return;

    player.teamId = teamId;

    io.to(roomCode).emit("room:players", {
      players: Array.from(room.players.values()),
    });
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

    const deck = loadDeckFromPacks(room.rules.packs);
    if (deck.length === 0) {
      socket.emit("error", { code: "EMPTY_DECK", message: "No cards loaded from packs" });
      return;
    }

    room.deck = shuffleDeck(deck);
    room.discard = [];

    room.state = "playing";
    room.isSuddenDeath = false;
    room.turnOrder = Array.from(room.teams.keys());
    const idx = Math.floor(Math.random() * room.turnOrder.length);
    room.turnIndex = idx;
    room.activeTeamId = room.turnOrder[idx];

    io.to(roomCode).emit("game:started", {
        state: room.state,
        activeTeamId: room.activeTeamId,
        turnOrder: room.turnOrder,
        remainingCards: room.deck.length,
    });
  });

  socket.on("game:next-turn", ({ roomCode } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("error", { code: "NOT_HOST", message: "Only the host can advance the turn" });
      return;
    }

    if (room.state !== "playing") {
      socket.emit("error", { code: "GAME_NOT_STARTED", message: "Game has not started" });
      return;
    }

    if (room.turnOrder.length === 0) {
      room.turnOrder = Array.from(room.teams.keys());
    }
    const nextIndex = (room.turnIndex + 1) % room.turnOrder.length;
    room.turnIndex = nextIndex;
    room.activeTeamId = room.turnOrder[nextIndex];

    if (room.deck.length !== 0) {
        const nextCard = room.deck.pop();
        io.to(roomCode).emit("game:next-turn", {
            activeTeamId: room.activeTeamId,
            card: nextCard,
            remainingCards: room.deck.length,
        });
    } else {
      io.to(roomCode).emit("game:deck-empty", { remainingCards: 0 });
    }
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

    const isRoundEnd = (room.turnIndex + 1) % room.turnOrder.length === 0;
    if (!isRoundEnd) {
      return;
    }

    const winners = Array.from(room.teams.values()).filter(
      (candidate) => candidate.score >= room.rules.winTarget
    );

    if (winners.length === 1) {
      room.state = "finished";
      io.to(roomCode).emit("game:win", { teamId: winners[0].id });
      return;
    }

    if (winners.length > 1) {
      room.isSuddenDeath = true;
      io.to(roomCode).emit("game:sudden-death", {
        teamIds: winners.map((winner) => winner.id),
      });
      return;
    }

    io.to(roomCode).emit("game:round-ended", { isSuddenDeath: room.isSuddenDeath });
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      if (room.players.delete(socket.id)) {
        if (room.players.size === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit("room:players", {
            players: Array.from(room.players.values()),
          });
        }
        break;
      }
    }
  });
});


server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
