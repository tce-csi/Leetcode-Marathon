/**
 * Safe database connection verification tool for CodeQuest.
 *
 * Verifies connectivity to the configured Supabase PostgreSQL database
 * without ever exposing passwords or secret credentials in logs.
 *
 * Usage:
 *   npm run db:test
 */
import { config } from "dotenv";
import { Pool } from "pg";
import { PostgresDb } from "../src/lib/db/postgres";

config({ path: ".env" });

function maskConnectionString(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = "********";
    }
    return parsed.toString();
  } catch {
    return urlStr.replace(/:([^:@]+)@/, ":********@");
  }
}

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
  console.log("\n=======================================================");
  console.log("       CodeQuest — Supabase Connection Diagnostic      ");
  console.log("=======================================================\n");

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("✗ DATABASE_URL is not set.");
    console.error("  Configure server/.env with your Supabase database connection string.");
    console.error("  Example: DATABASE_URL=postgresql://postgres:<PASSWORD>@db.lpdxqrmvbenitcgafhpj.supabase.co:5432/postgres\n");
    process.exit(1);
  }

  // Check if placeholder is still present
  if (/<PASSWORD>|YOUR[-_]PASSWORD/i.test(connectionString)) {
    console.error("✗ DATABASE_URL still contains a password placeholder.");
    console.error(`  Current target: ${maskConnectionString(connectionString)}`);
    console.error("  Please open server/.env and replace <PASSWORD> with your real Supabase database password.");
    console.error("  (Remember to URL-encode special characters like @, #, $, ?, % in the password)\n");
    process.exit(1);
  }

  const masked = maskConnectionString(connectionString);
  console.log(`Target database: ${masked}`);

  let parsedHost = "";
  let parsedPort = "5432";
  try {
    const url = new URL(connectionString);
    parsedHost = url.hostname;
    parsedPort = url.port || "5432";
  } catch {
    // Ignore URL parse failure
  }

  if (parsedHost.includes("pooler.supabase.com") || parsedPort === "6543") {
    console.log("Mode: Supabase Connection Pooler (port 6543 — IPv4 compatible, serverless friendly)");
  } else if (parsedHost.includes("supabase.co")) {
    console.log("Mode: Supabase Direct Connection (port 5432 — requires IPv6 network support)");
  } else {
    console.log(`Mode: PostgreSQL (${parsedHost}:${parsedPort})`);
  }

  console.log("\n→ Testing connection...");
  const startTime = Date.now();

  const pool = new Pool({
    connectionString,
    ssl: sslFor(connectionString),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const client = await pool.connect();
    const connectTime = Date.now() - startTime;

    try {
      // 1. Diagnostic query via raw client
      const res = await client.query<{
        version: string;
        current_database: string;
        current_user: string;
        server_time: string;
      }>("SELECT version(), current_database(), current_user, now() AS server_time;");

      const row = res.rows[0];
      const queryTime = Date.now() - startTime - connectTime;

      console.log(`✓ Connected successfully in ${connectTime}ms (query latency: ${queryTime}ms)`);
      console.log(`✓ Database: ${row.current_database}`);
      console.log(`✓ User:     ${row.current_user}`);
      console.log(`✓ Time:     ${row.server_time}`);
      console.log(`✓ Engine:   ${row.version.split(" on ")[0]}`);

      // 2. Test production application PostgresDb module
      console.log("\n→ Verifying production PostgresDb application module...");
      const prodDb = new PostgresDb(connectionString);
      const prodCheck = await prodDb.query<{ check: number }>("SELECT 1 AS check;");
      if (prodCheck.rows[0]?.check === 1) {
        console.log("✓ Production PostgresDb module is fully operational.");
      }
      await prodDb.pool.end();

      // Check migration status if table exists
      const migCheck = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '_migrations'
        );
      `);

      if (migCheck.rows[0].exists) {
        const migs = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM _migrations;");
        console.log(`✓ Schema has ${migs.rows[0].count} applied migration(s).`);
      } else {
        console.log("• Migrations have not been applied yet. Run: npm run db:migrate");
      }

      console.log("\n=======================================================");
      console.log("  Database connection verified and ready for CodeQuest!  ");
      console.log("=======================================================\n");
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error: any) {
    await pool.end().catch(() => {});

    console.error("\n✗ Connection failed!");
    console.error(`  Error: ${error.message || error}`);

    const code = error.code || "";
    const msg = String(error.message || "");

    if (code === "28P01" || msg.includes("password authentication failed")) {
      console.error("\n[Diagnosis: Authentication Failure]");
      console.error("  The database password for user 'postgres' was rejected by Supabase.");
      console.error("  • Check your Supabase database password in server/.env.");
      console.error("  • If your password contains special characters like @, #, $, ?, /, %, :");
      console.error("    ensure they are URL percent-encoded (e.g., encode '@' as '%40', '#' as '%23').");
      console.error("  • You can reset your database password in Supabase Dashboard -> Project Settings -> Database.");
    } else if (
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "ENETUNREACH" ||
      code === "EADDRNOTAVAIL" ||
      msg.includes("ENOTFOUND") ||
      msg.includes("getaddrinfo")
    ) {
      console.error("\n[Diagnosis: Network or IPv6 Incompatibility]");
      console.error(`  Could not resolve or route to ${parsedHost}.`);
      console.error("  Supabase direct connections (db.<project>.supabase.co:5432) resolve to IPv6 addresses.");
      console.error("  If your local network, ISP, or hosting environment does not support IPv6,");
      console.error("  switch to the Supabase Transaction Pooler connection string:");
      console.error("  1. Go to Supabase Dashboard -> Connect (top right).");
      console.error("  2. Select 'Transaction pooler' (port 6543, uses IPv4).");
      console.error("  3. Copy the URI and set it as DATABASE_URL in server/.env.");
    } else if (code === "ETIMEDOUT" || msg.includes("timeout")) {
      console.error("\n[Diagnosis: Connection Timeout]");
      console.error("  Connection attempt timed out after 10 seconds.");
      console.error("  • If on an IPv4-only network, direct Supabase URLs (port 5432) will time out.");
      console.error("    Try the Supabase Transaction Pooler (port 6543) instead.");
      console.error("  • Verify firewall rules allow outbound traffic on port 5432 or 6543.");
    } else if (
      msg.includes("SSL") ||
      msg.includes("TLS") ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    ) {
      console.error("\n[Diagnosis: TLS/SSL Certificate Error]");
      console.error("  TLS handshake failed with Supabase.");
      console.error("  • Add PGSSL_NO_VERIFY=true to server/.env if your environment cannot verify the CA chain.");
    }

    console.log();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
