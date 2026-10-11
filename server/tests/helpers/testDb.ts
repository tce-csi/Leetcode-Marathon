import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@/lib/db/types";

/**
 * Creates a real (in-process, WASM) PostgreSQL database for integration tests
 * and applies every migration file in order. Each call returns an isolated
 * database instance.
 */
export interface TestDb {
  db: Db;
  pglite: PGlite;
  close: () => Promise<void>;
}

function wrap(pglite: PGlite): Db {
  const db: Db = {
    async query<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
      const result = await pglite.query<T>(text, params as unknown[]);
      return {
        rows: (result.rows ?? []) as T[],
        rowCount: result.affectedRows ?? result.rows?.length ?? 0,
      };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      await pglite.query("begin");
      try {
        const value = await fn(db);
        await pglite.query("commit");
        return value;
      } catch (error) {
        try {
          await pglite.query("rollback");
        } catch {
          // ignore
        }
        throw error;
      }
    },
  };
  return db;
}

export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite();
  const migrationsDir = join(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await pglite.exec(sql);
  }
  return {
    db: wrap(pglite),
    pglite,
    close: async () => {
      await pglite.close();
    },
  };
}
