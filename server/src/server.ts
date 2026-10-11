import "dotenv/config";
import { createApp } from "@/app";
import { env } from "@/lib/env";

const app = createApp();
const port = env.port;

const server = app.listen(port, () => {
  console.log(
    `[codequest] API listening on http://localhost:${port} (${env.nodeEnv})`,
  );
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[codequest] DATABASE_URL is not set. Requests that touch the database will fail " +
        "with a clear error until server/.env is configured.",
    );
  }
});

function shutdown(signal: string) {
  console.log(`[codequest] received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));