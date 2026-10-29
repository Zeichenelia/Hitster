import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

const lanIp = getLanIp();
console.log("====================================================");
console.log(" Starting Hitster Local Dev Environment");
console.log(" - PC URL:     http://localhost:5173");
if (lanIp) {
  console.log(` - Mobile/LAN: http://${lanIp}:5173`);
}
console.log(" - Backend:    http://localhost:3001");
console.log("====================================================\n");

const children = [];

function startProcess(label, colorCode, cwd, args) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  const prefix = `\x1b[${colorCode}m[${label}]\x1b[0m `;

  child.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) process.stdout.write(`${prefix}${line}\n`);
    }
  });

  child.stderr.on("data", (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) process.stderr.write(`${prefix}${line}\n`);
    }
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix}Exited with code ${code}`);
    }
  });

  children.push(child);
  return child;
}

startProcess("server", "36", path.join(rootDir, "server"), ["index.js"]);
startProcess("client", "35", path.join(rootDir, "client"), [
  path.join(rootDir, "client", "node_modules", "vite", "bin", "vite.js"),
  "--host",
  "0.0.0.0",
  "--port",
  "5173",
]);

function shutdown() {
  for (const child of children) {
    try {
      if (isWin && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
