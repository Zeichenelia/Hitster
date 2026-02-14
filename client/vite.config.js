import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const tunnelHost = env.VITE_TUNNEL_HOST?.trim();
  const allowedHosts = ["localhost", "127.0.0.1"];

  if (tunnelHost) {
    allowedHosts.push(tunnelHost);
  }

  return {
    plugins: [svelte()],
    server: {
      host: "0.0.0.0",
      allowedHosts,
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
  };
});
