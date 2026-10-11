/**
 * Provision the single platform administrator for CodeQuest.
 *
 * Runs strictly as a local interactive CLI command (never through an HTTP endpoint).
 * Connects directly to Supabase PostgreSQL, verifies that no administrator account
 * already exists, prompts for the admin's email, generates a 32-character
 * cryptographically secure password, hashes it, and stores the record.
 *
 * Usage:
 *   npm run admin:create
 */
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Pool } from "pg";
import { generateSecurePassword, hashPassword } from "../src/lib/auth/password";
import { normalizeEmail } from "../src/lib/normalize";

config({ path: ".env" });

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
    // 1. Check whether an administrator already exists
    const existing = await client.query<{ id: string; email: string }>(
      "select id, email from admin_users where is_active = true limit 1",
    );

    if (existing.rows.length > 0) {
      console.log("\n✗ An active administrator already exists in the system.");
      console.log(`  Configured Admin Email: ${existing.rows[0].email}`);
      console.log("  To change the password, use: npm run admin:reset-password\n");
      process.exit(1);
    }

    // 2. Interactive prompt for email
    const rl = createInterface({ input, output });
    let adminEmail = "";

    try {
      const answer = await rl.question("\nEnter Project Owner Admin Email: ");
      adminEmail = normalizeEmail(answer.trim());
    } finally {
      rl.close();
    }

    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      console.error("✗ A valid email address is required.");
      process.exit(1);
    }

    // 3. Generate a strong random password (32 chars)
    const rawPassword = generateSecurePassword(32);
    const passwordHash = await hashPassword(rawPassword);

    // 4. Insert the single administrator atomically
    await client.query("begin");
    await client.query(
      `insert into admin_users (email, name, password_hash, role, is_active)
       values ($1, 'Project Owner', $2, 'SUPER_ADMIN', true)`,
      [adminEmail, passwordHash],
    );
    await client.query("commit");

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    console.log("\nCSI TCE — Administrator Setup\n");
    console.log("Administrator created successfully.\n");
    console.log("Admin Login URL:");
    console.log(`${frontendUrl.replace(/\/$/, "")}/admin/login\n`);
    console.log("Admin Email:");
    console.log(`${adminEmail}\n`);
    console.log("Generated Admin Password:");
    console.log(`${rawPassword}\n`);
    console.log("IMPORTANT:");
    console.log("Save this password in a secure password manager.");
    console.log("It will not be displayed again.\n");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("✗ Failed to provision administrator:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
