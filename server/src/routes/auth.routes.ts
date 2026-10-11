import { Router } from "express";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { verifyPassword } from "@/lib/auth/password";
import {
  destroyAdminSession,
  destroyStudentSession,
  getAdminSession,
  getStudentSession,
  setAdminSessionCookies,
  setStudentSessionCookies,
} from "@/lib/auth/session";
import { createAdminSessionRecord } from "@/lib/auth/session-store";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { errors } from "@/lib/errors";
import { asyncHandler, ok } from "@/lib/http";
import { normalizeEmail } from "@/lib/normalize";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/request";
import { authenticateStudent, registerStudent } from "@/lib/services/students";
import { toPublicAdmin } from "@/lib/serializers";
import type { AdminUserRow } from "@/lib/types";
import { adminLoginSchema, registerSchema, studentLoginSchema } from "@/lib/validation/auth";

export const authRoutes = Router();

authRoutes.post(
  "/register",
  asyncHandler(async (req, res) => {
    assertSameOrigin(req);
    const ip = getClientIp(req);
    const limit = await checkRateLimit(`register:${ip}`, { limit: 10, windowSeconds: 300 });
    if (!limit.allowed) throw errors.tooManyRequests("Too many registration attempts. Try again later.");

    const body = registerSchema.parse(req.body);
    const { student, tokens } = await registerStudent(body, {
      ip,
      userAgent: getUserAgent(req),
    });
    setStudentSessionCookies(res, tokens);
    ok(res, { student });
  }),
);

authRoutes.post(
  "/login",
  asyncHandler(async (req, res) => {
    assertSameOrigin(req);
    const ip = getClientIp(req);
    const body = studentLoginSchema.parse(req.body);
    const limit = await checkRateLimit(`login:${ip}:${body.rollNumber.toLowerCase()}`, {
      limit: 12,
      windowSeconds: 300,
    });
    if (!limit.allowed) throw errors.tooManyRequests("Too many login attempts. Try again later.");

    const { student, tokens } = await authenticateStudent(body.rollNumber, body.password, {
      ip,
      userAgent: getUserAgent(req),
    });
    setStudentSessionCookies(res, tokens);
    ok(res, { student });
  }),
);

authRoutes.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await destroyStudentSession(req, res);
    ok(res, { signedOut: true });
  }),
);

authRoutes.get(
  "/session",
  asyncHandler(async (req, res) => {
    const session = await getStudentSession(req);
    ok(res, { student: session?.student ?? null, csrfToken: session?.csrfToken ?? null });
  }),
);

// ------------------------------ admins -------------------------------------

authRoutes.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    assertSameOrigin(req);
    const ip = getClientIp(req);
    const limit = await checkRateLimit(`admin-login:${ip}`, { limit: 10, windowSeconds: 300 });
    if (!limit.allowed) throw errors.tooManyRequests("Too many login attempts. Try again later.");

    const body = adminLoginSchema.parse(req.body);
    const email = normalizeEmail(body.email);
    const db = getDb();
    const { rows } = await db.query<AdminUserRow>(
      "select * from admin_users where lower(email) = $1",
      [email],
    );
    const admin = rows[0];
    const valid = admin ? await verifyPassword(body.password, admin.password_hash) : false;
    if (!admin || !valid) throw errors.unauthorized("Invalid email or password.");
    if (!admin.is_active) throw errors.forbidden("This administrator account is disabled.");

    await db.query("update admin_users set last_login_at = now() where id = $1", [admin.id]);
    const tokens = await createAdminSessionRecord(db, admin.id, {
      ip,
      userAgent: getUserAgent(req),
    });
    setAdminSessionCookies(res, tokens);
    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: admin.id,
        action: "admin.login",
        entityType: "admin_user",
        entityId: admin.id,
        ip,
      },
      db,
    );
    ok(res, { admin: toPublicAdmin(admin) });
  }),
);

authRoutes.get(
  "/admin/session",
  asyncHandler(async (req, res) => {
    const session = await getAdminSession(req);
    ok(res, { admin: session?.admin ?? null, csrfToken: session?.csrfToken ?? null });
  }),
);

authRoutes.post(
  "/admin/session",
  asyncHandler(async (req, res) => {
    await destroyAdminSession(req, res);
    ok(res, { signedOut: true });
  }),
);