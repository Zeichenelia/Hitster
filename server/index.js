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
    rooms.set(code, {
      hostId: socket.id,
      players: new Map([[socket.id, { id: socket.id, name: hostName || "Host" }]]),
    });
    socket.join(code);
    socket.emit("room:created", { roomCode: code, hostId: socket.id });
  });

  socket.on("room:join", ({ roomCode, playerName } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "Room not found" });
      return;
    }
    room.players.set(socket.id, { id: socket.id, name: playerName || "Player" });
    socket.join(roomCode);
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
