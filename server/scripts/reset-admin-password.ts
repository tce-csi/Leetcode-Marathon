/**
 * Reset password for the platform administrator.
 *
 * Runs only as a trusted local CLI operation. Requires database access.
 * Locates the existing active administrator, generates a new cryptographically
 * secure 32-character password, hashes it, stores the new hash, and invalidates
 * all existing administrator sessions.
 *
 * Usage:
 *   npm run admin:reset-password
 */
import { config } from "dotenv";
import { Pool } from "pg";
import { generateSecurePassword, hashPassword } from "../src/lib/auth/password";

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
    // 1. Locate the single active administrator
    const existing = await client.query<{ id: string; email: string }>(
      "select id, email from admin_users where is_active = true limit 1",
    );

    if (existing.rows.length === 0) {
      console.log("\n✗ No active administrator account was found.");
      console.log("  To create one, run: npm run admin:create\n");
      process.exit(1);
    }

    const admin = existing.rows[0];

    // 2. Generate a new strong password
    const newPassword = generateSecurePassword(32);
    const newHash = await hashPassword(newPassword);

    await client.query("begin");

    // 3. Update the password hash
    await client.query(
      "update admin_users set password_hash = $1, updated_at = now() where id = $2",
      [newHash, admin.id],
    );

    // 4. Invalidate all active admin sessions for this administrator
    await client.query(
      "update admin_sessions set revoked_at = now() where admin_id = $1 and revoked_at is null",
      [admin.id],
    );

    await client.query("commit");

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    console.log("\nCSI TCE — Administrator Password Reset\n");
    console.log("Administrator password reset successfully.\n");
    console.log("Admin Login URL:");
    console.log(`${frontendUrl.replace(/\/$/, "")}/admin/login\n`);
    console.log("Admin Email:");
    console.log(`${admin.email}\n`);
    console.log("Generated Admin Password:");
    console.log(`${newPassword}\n`);
    console.log("IMPORTANT:");
    console.log("All existing administrator sessions have been invalidated.");
    console.log("Save this new password in a secure password manager.");
    console.log("It will not be displayed again.\n");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("✗ Failed to reset administrator password:", error);
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
