import type { Db } from "@/lib/db/types";
import { toPublicAdmin, toPublicStudent } from "@/lib/serializers";
import type { AdminUserRow, PublicAdmin, PublicStudent, StudentRow } from "@/lib/types";
import { SESSION_TTL_MS } from "./cookies";
import { generateToken, hashToken } from "./tokens";

/**
 * Database-only session operations. Contains no Next.js imports so that it can
 * be exercised directly from integration tests and the service layer.
 */

export interface SessionTokens {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ActiveStudentSession {
  student: PublicStudent;
  sessionId: string;
  csrfToken: string;
}

export interface ActiveAdminSession {
  admin: PublicAdmin;
  sessionId: string;
  csrfToken: string;
}

interface StudentSessionJoinRow extends StudentRow {
  session_id: string;
  session_csrf: string;
  session_expires_at: string;
  session_revoked_at: string | null;
}

interface AdminSessionJoinRow extends AdminUserRow {
  session_id: string;
  session_csrf: string;
  session_expires_at: string;
  session_revoked_at: string | null;
}

export async function createStudentSessionRecord(
  db: Db,
  studentId: string,
  meta: SessionMeta = {},
): Promise<SessionTokens> {
  const token = generateToken();
  const csrfToken = generateToken(18);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    `insert into student_sessions (student_id, token_hash, csrf_token, ip, user_agent, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      studentId,
      hashToken(token),
      csrfToken,
      meta.ip ?? null,
      meta.userAgent ?? null,
      expiresAt.toISOString(),
    ],
  );
  return { token, csrfToken, expiresAt };
}

export async function createAdminSessionRecord(
  db: Db,
  adminId: string,
  meta: SessionMeta = {},
): Promise<SessionTokens> {
  const token = generateToken();
  const csrfToken = generateToken(18);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    `insert into admin_sessions (admin_id, token_hash, csrf_token, ip, user_agent, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      adminId,
      hashToken(token),
      csrfToken,
      meta.ip ?? null,
      meta.userAgent ?? null,
      expiresAt.toISOString(),
    ],
  );
  return { token, csrfToken, expiresAt };
}

export async function getStudentBySessionToken(
  db: Db,
  token: string,
): Promise<ActiveStudentSession | null> {
  const { rows } = await db.query<StudentSessionJoinRow>(
    `select st.*, s.id as session_id, s.csrf_token as session_csrf,
            s.expires_at as session_expires_at, s.revoked_at as session_revoked_at
       from student_sessions s
       join students st on st.id = s.student_id
      where s.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.session_revoked_at) return null;
  if (new Date(row.session_expires_at).getTime() < Date.now()) return null;
  if (!row.is_active) return null;
  return {
    student: toPublicStudent(row),
    sessionId: row.session_id,
    csrfToken: row.session_csrf,
  };
}

export async function getAdminBySessionToken(
  db: Db,
  token: string,
): Promise<ActiveAdminSession | null> {
  const { rows } = await db.query<AdminSessionJoinRow>(
    `select a.*, s.id as session_id, s.csrf_token as session_csrf,
            s.expires_at as session_expires_at, s.revoked_at as session_revoked_at
       from admin_sessions s
       join admin_users a on a.id = s.admin_id
      where s.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.session_revoked_at) return null;
  if (new Date(row.session_expires_at).getTime() < Date.now()) return null;
  if (!row.is_active) return null;
  return {
    admin: toPublicAdmin(row),
    sessionId: row.session_id,
    csrfToken: row.session_csrf,
  };
}

export async function revokeStudentSessionById(db: Db, sessionId: string): Promise<void> {
  await db.query(
    "update student_sessions set revoked_at = now() where id = $1 and revoked_at is null",
    [sessionId],
  );
}

export async function revokeAdminSessionById(db: Db, sessionId: string): Promise<void> {
  await db.query(
    "update admin_sessions set revoked_at = now() where id = $1 and revoked_at is null",
    [sessionId],
  );
}
