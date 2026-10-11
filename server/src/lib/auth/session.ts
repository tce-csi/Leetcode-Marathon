import type { CookieOptions, Request, Response } from "express";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { env } from "@/lib/env";
import {
  ADMIN_COOKIE,
  ADMIN_CSRF_COOKIE,
  STUDENT_COOKIE,
  STUDENT_CSRF_COOKIE,
} from "./cookies";
import {
  type ActiveAdminSession,
  type ActiveStudentSession,
  type SessionMeta,
  type SessionTokens,
  createAdminSessionRecord,
  createStudentSessionRecord,
  getAdminBySessionToken,
  getStudentBySessionToken,
} from "./session-store";
import { hashToken } from "./tokens";

export type { ActiveAdminSession, ActiveStudentSession, SessionMeta, SessionTokens };

function cookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: env.isProduction ? "none" : "lax",
    secure: env.isProduction,
    path: "/",
    expires: expiresAt,
  };
}

function csrfCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: false,
    sameSite: env.isProduction ? "none" : "lax",
    secure: env.isProduction,
    path: "/",
    expires: expiresAt,
  };
}

function clearOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: env.isProduction ? "none" : "lax",
    secure: env.isProduction,
    path: "/",
  };
}

function readToken(req: Request, name: string): string | undefined {
  const value = req.cookies?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

// --------------------------- students -------------------------------------

export async function createStudentSession(
  db: Db,
  studentId: string,
  meta: SessionMeta = {},
): Promise<SessionTokens> {
  return createStudentSessionRecord(db, studentId, meta);
}

export function setStudentSessionCookies(res: Response, tokens: SessionTokens): void {
  res.cookie(STUDENT_COOKIE, tokens.token, cookieOptions(tokens.expiresAt));
  res.cookie(STUDENT_CSRF_COOKIE, tokens.csrfToken, csrfCookieOptions(tokens.expiresAt));
}

export async function getStudentSession(
  req: Request,
  db: Db = getDb(),
): Promise<ActiveStudentSession | null> {
  const token = readToken(req, STUDENT_COOKIE);
  if (!token) return null;
  return getStudentBySessionToken(db, token);
}

export function getStudentCsrfCookie(req: Request): string | undefined {
  return readToken(req, STUDENT_CSRF_COOKIE);
}

export async function destroyStudentSession(
  req: Request,
  res: Response,
  db: Db = getDb(),
): Promise<void> {
  const token = readToken(req, STUDENT_COOKIE);
  if (token) {
    await db.query(
      "update student_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
      [hashToken(token)],
    );
  }
  res.clearCookie(STUDENT_COOKIE, clearOptions());
  res.clearCookie(STUDENT_CSRF_COOKIE, { ...clearOptions(), httpOnly: false });
}

// --------------------------- admins ---------------------------------------

export async function createAdminSession(
  db: Db,
  adminId: string,
  meta: SessionMeta = {},
): Promise<SessionTokens> {
  return createAdminSessionRecord(db, adminId, meta);
}

export function setAdminSessionCookies(res: Response, tokens: SessionTokens): void {
  res.cookie(ADMIN_COOKIE, tokens.token, cookieOptions(tokens.expiresAt));
  res.cookie(ADMIN_CSRF_COOKIE, tokens.csrfToken, csrfCookieOptions(tokens.expiresAt));
}

export async function getAdminSession(
  req: Request,
  db: Db = getDb(),
): Promise<ActiveAdminSession | null> {
  const token = readToken(req, ADMIN_COOKIE);
  if (!token) return null;
  return getAdminBySessionToken(db, token);
}

export function getAdminCsrfCookie(req: Request): string | undefined {
  return readToken(req, ADMIN_CSRF_COOKIE);
}

export async function destroyAdminSession(
  req: Request,
  res: Response,
  db: Db = getDb(),
): Promise<void> {
  const token = readToken(req, ADMIN_COOKIE);
  if (token) {
    await db.query(
      "update admin_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
      [hashToken(token)],
    );
  }
  res.clearCookie(ADMIN_COOKIE, clearOptions());
  res.clearCookie(ADMIN_CSRF_COOKIE, { ...clearOptions(), httpOnly: false });
}
