import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: "forks",
    env: {
      BCRYPT_ROUNDS: "4",
      JWT_SECRET: "test-secret-value-at-least-16-chars",
      NODE_ENV: "test",
      FRONTEND_URL: "http://localhost:5173",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});