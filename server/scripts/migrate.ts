/**
 * Database migration runner.
 *
 * Applies every SQL file in supabase/migrations (sorted by filename) exactly
 * once, tracking applied files in a `_migrations` table. Each migration runs in
 * its own transaction so a failure leaves the database untouched.
 *
 * Usage:
 *   npm run db:migrate            # apply pending migrations
 *   npm run db:migrate -- --reset # drop the public schema first, then migrate
 */
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

config({ path: ".env" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const reset = process.argv.includes("--reset");

function sslFor(connectionString: string) {
  const requiresSsl =
    /sslmode=(require|verify-ca|verify-full|prefer)/i.test(connectionString) ||
    /supabase\.(co|com)/i.test(connectionString) ||
    process.env.PGSSLMODE === "require";
  if (!requiresSsl) return undefined;
  const rejectUnauthorized = process.env.PGSSL_STRICT_VERIFY === "true";
  return { rejectUnauthorized };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("✗ DATABASE_URL is not set. Configure server/.env first.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 2 });
  const client = await pool.connect();

  try {
    if (reset) {
      console.log("→ Resetting schema (DROP SCHEMA public CASCADE)…");
      await client.query("drop schema if exists public cascade");
      await client.query("create schema public");
    }

    await client.query(`
      create table if not exists _migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Set<string>(
      (await client.query<{ filename: string }>("select filename from _migrations")).rows.map(
        (r) => r.filename,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migration files found.");
      return;
    }

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`• ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`→ Applying ${file}…`);
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into _migrations (filename) values ($1)", [file]);
        await client.query("commit");
        count += 1;
        console.log(`✓ ${file}`);
      } catch (error) {
        await client.query("rollback");
        console.error(`✗ Failed applying ${file}`);
        throw error;
      }
    }

    console.log(
      count > 0 ? `\n✓ Applied ${count} migration(s).` : "\n✓ Database already up to date.",
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
