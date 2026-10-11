import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The API origin is configurable so the same bundle works when the API lives on
// a different host (production) or is proxied locally (development). Values are
// read from client/.env (VITE_API_PROXY) or the process environment.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY || process.env.VITE_API_PROXY || "http://localhost:5050";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
