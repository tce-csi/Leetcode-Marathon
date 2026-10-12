import { Pool, type PoolClient } from "pg";
import { countDbQuery } from "@/lib/perf";
import type { Db, QueryResult } from "./types";

/**
 * Production data layer backed by a node-postgres connection pool.
 *
 * Designed for serverless environments (Netlify functions): the pool is created
 * lazily, kept very small, and connections are released promptly. When the
 * function scales out, every instance opens its own tiny pool, so a large
 * per-instance maximum would multiply across instances and exhaust the
 * database's connection limit. The default is therefore deliberately small and
 * can be raised with DB_POOL_MAX when running behind a transaction pooler.
 * The pool is stored on globalThis so hot reloads during development do not
 * leak connections.
 */

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

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
    // Small per-instance pool: a serverless function instance handles only a
    // handful of concurrent requests, and Supabase's pooler multiplexes the
    // rest. Default 3 keeps total connections bounded when many instances spin
    // up to serve the 100 concurrent participants.
    const maxPool = readPositiveInt("DB_POOL_MAX", 3);
    const statementTimeout = readPositiveInt("DB_STATEMENT_TIMEOUT_MS", 15_000);
    this.pool = new Pool({
      connectionString,
      max: maxPool,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      // Recycle pooled connections periodically so the pooler never hands back a
      // connection the database has already closed.
      maxUses: 7_500,
      allowExitOnIdle: true,
      keepAlive: true,
      application_name: "codequest-api",
      // Hard server-side caps so a runaway query can never pin a connection for
      // the whole contest.
      statement_timeout: statementTimeout,
      query_timeout: statementTimeout + 5_000,
      idle_in_transaction_session_timeout: 15_000,
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
    countDbQuery();
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
      countDbQuery();
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
