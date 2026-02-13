import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "excellent-rough-vcr-cent.trycloudflare.com"
    ],
    proxy: {
      "/packs": {
        target: "http://localhost:3001",
      },
      "/health": {
        target: "http://localhost:3001",
      },
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
    },
  },
})
