import { Pool, type PoolClient } from "pg";
import type { Db, QueryResult } from "./types";

/**
 * Production data layer backed by a node-postgres connection pool.
 *
 * Designed for serverless environments: the pool is created lazily, kept small,
 * and connections are released promptly. The pool is stored on globalThis so
 * that hot reloads during development do not leak connections.
 */

function buildSslConfig(connectionString: string): false | { rejectUnauthorized: boolean } {
  const requiresSsl =
    /sslmode=(require|verify-ca|verify-full|prefer)/i.test(connectionString) ||
    /supabase\.(co|com)/i.test(connectionString) ||
    process.env.PGSSLMODE === "require";
  if (!requiresSsl) return false;
  // Supabase uses TLS encryption. To prevent Node from failing with SELF_SIGNED_CERT_IN_CHAIN,
  // rejectUnauthorized defaults to false unless PGSSL_STRICT_VERIFY=true is set.
  const rejectUnauthorized = process.env.PGSSL_STRICT_VERIFY === "true";
  return { rejectUnauthorized };
}

class PostgresDb implements Db {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: buildSslConfig(connectionString),
    });
    // Prevent an unhandled 'error' event from crashing the process when an
    // idle client is dropped by the pooler.
    this.pool.on("error", (err) => {
      console.error("[db] idle client error", err.message);
    });
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query(text, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = makeClientDb(client);
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function makeClientDb(client: PoolClient): Db {
  const db: Db = {
    async query<T = Record<string, unknown>>(
      text: string,
      params: readonly unknown[] = [],
    ) {
      const result = await client.query(text, params as unknown[]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      // Nested transactions reuse the same client and become savepoints.
      const savepoint = `sp_${Math.random().toString(36).slice(2)}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await fn(db);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      }
    },
  };
  return db;
}

export { PostgresDb };
