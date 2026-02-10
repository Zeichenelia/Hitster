const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const rooms = new Map();

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
  socket.on("room:create", ({ hostName } = {}) => {
    let code = createRoomCode();
    while (rooms.has(code)) {
      code = createRoomCode();
    }
    const room = createRoom(code, socket.id, hostName);
    applyTeamCount(room, room.rules.teamCount);
    rooms.set(code, room);
    socket.join(code);
    socket.emit("room:created", { roomCode: code, hostId: socket.id });
  });

  socket.on("room:join", ({ roomCode, playerName } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    room.players.set(socket.id, createPlayer(socket.id, playerName));
    socket.join(roomCode);
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
