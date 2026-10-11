import { env, isDatabaseConfigured } from "@/lib/env";
import { PostgresDb } from "./postgres";
import type { Db } from "./types";

declare global {
  var __codequestDb: PostgresDb | undefined;
}

/**
 * Returns the shared database instance. Throws with a friendly message if the
 * database has not been configured yet.
 */
export function getDb(): Db {
  if (!isDatabaseConfigured()) {
    throw new Error(
      "Database is not configured. Set DATABASE_URL in your environment " +
        "(see .env.example and README.md).",
    );
  }
  if (!globalThis.__codequestDb) {
    globalThis.__codequestDb = new PostgresDb(env.databaseUrl);
  }
  return globalThis.__codequestDb;
}

export type { Db, QueryResult } from "./types";
