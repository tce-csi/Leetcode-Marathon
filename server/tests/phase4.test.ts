/**
 * Phase 4: Single-Admin Authentication & Strict Access Control
 *
 * Verifies:
 *  1. Database-level enforcement: at most one active administrator can exist.
 *  2. Admin login: correct credentials succeed; wrong credentials fail.
 *  3. Disabled admin accounts are blocked even with a valid password.
 *  4. Admin sessions are recognised and can be revoked.
 *  5. Students cannot access any admin route (role boundary enforcement).
 *  6. No public endpoint exists that allows self-promotion to administrator.
 *  7. Unauthenticated callers receive 401 on every protected admin route.
 *  8. CSRF protection is enforced on admin mutation routes.
 *  9. Admin role restrictions (REVIEWER vs SUPER_ADMIN) are enforced.
 * 10. Student session cookies never grant admin-level access.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Db } from "@/lib/db/types";
import { ADMIN_COOKIE, ADMIN_CSRF_COOKIE, STUDENT_COOKIE, STUDENT_CSRF_COOKIE } from "@/lib/auth/cookies";
import { createAdminSessionRecord, createStudentSessionRecord } from "@/lib/auth/session-store";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createAdminRecord,
  createContestRecord,
  createStudentRecord,
  createTrackRecord,
  createLevelRecord,
} from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";

let test: TestDb;
let db: Db;
let contestId: string;
let adminId: string;
let adminToken: string;
let adminCsrfToken: string;
let studentId: string;
let studentToken: string;
let studentCsrfToken: string;

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;

  contestId = await createContestRecord(db, "phase4-contest");
  const trackId = await createTrackRecord(db, contestId, 1);
  await createLevelRecord(db, trackId, { levelNumber: 1, isStarting: true });

  adminId = await createAdminRecord(db, "admin@codequest.local");
  const adminSession = await createAdminSessionRecord(db, adminId);
  adminToken = adminSession.token;
  adminCsrfToken = adminSession.csrfToken;

  studentId = await createStudentRecord(db, contestId);
  const studentSession = await createStudentSessionRecord(db, studentId);
  studentToken = studentSession.token;
  studentCsrfToken = studentSession.csrfToken;
});

afterAll(async () => {
  await test.close();
});

function adminReq(method: "get" | "post" | "put" | "patch" | "delete", path: string) {
  const req = request(createApp());
  return req[method](path)
    .set("Cookie", [`${ADMIN_COOKIE}=${adminToken}`, `${ADMIN_CSRF_COOKIE}=${adminCsrfToken}`])
    .set("x-csrf-token", adminCsrfToken);
}

// ---------------------------------------------------------------------------
// 1. DB-level single active admin enforcement
// ---------------------------------------------------------------------------

describe("single active admin enforcement", () => {
  it("allows creating the first active admin", async () => {
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from admin_users where is_active = true",
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("rejects inserting a second active admin (unique index violation)", async () => {
    await expect(
      db.query(
        "insert into admin_users (email, name, password_hash, role) values ('second@codequest.local', 'Second', 'x', 'SUPER_ADMIN')",
      ),
    ).rejects.toThrow();
  });

  it("allows a second admin row only when is_active = false", async () => {
    await db.query(
      "insert into admin_users (email, name, password_hash, role, is_active) values ('inactive@codequest.local', 'Old', 'x', 'ADMIN', false)",
    );
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from admin_users where is_active = false",
    );
    expect(rows[0]!.count).toBeGreaterThanOrEqual(1);
  });

  it("blocks reactivating the inactive admin when one active admin already exists", async () => {
    await expect(
      db.query(
        "update admin_users set is_active = true where email = 'inactive@codequest.local'",
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Admin login -- correct and wrong credentials
// ---------------------------------------------------------------------------

describe("admin login authentication", () => {
  let hashedPassword: string;

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash("SuperSecret_99", 8);
    await db.query("update admin_users set password_hash = $1 where id = $2", [
      hashedPassword,
      adminId,
    ]);
  });

  it("returns 200 and a session cookie on correct credentials", async () => {
    const res = await request(createApp()).post("/api/auth/admin/login").send({
      email: "admin@codequest.local",
      password: "SuperSecret_99",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.admin.email).toBe("admin@codequest.local");
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieList = Array.isArray(cookies) ? cookies : [cookies ?? ""];
    expect(cookieList.some((c) => c.startsWith(`${ADMIN_COOKIE}=`))).toBe(true);
  });

  it("returns 401 on a wrong password", async () => {
    const res = await request(createApp()).post("/api/auth/admin/login").send({
      email: "admin@codequest.local",
      password: "WrongPassword",
    });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("returns 401 on an unknown email address", async () => {
    const res = await request(createApp()).post("/api/auth/admin/login").send({
      email: "nobody@codequest.local",
      password: "SuperSecret_99",
    });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("returns 422 when the email field is missing", async () => {
    const res = await request(createApp()).post("/api/auth/admin/login").send({
      password: "SuperSecret_99",
    });
    expect(res.status).toBe(422);
  });

  it("does not reveal whether the email exists (no enumeration)", async () => {
    const resUnknown = await request(createApp()).post("/api/auth/admin/login").send({
      email: "nobody@codequest.local",
      password: "WrongPassword",
    });
    const resWrong = await request(createApp()).post("/api/auth/admin/login").send({
      email: "admin@codequest.local",
      password: "WrongPassword",
    });
    expect(resUnknown.status).toBe(401);
    expect(resWrong.status).toBe(401);
    expect(resUnknown.body.error.message).toBe(resWrong.body.error.message);
  });
});

// ---------------------------------------------------------------------------
// 3. Disabled admin account is blocked
// ---------------------------------------------------------------------------

describe("disabled admin account", () => {
  let disabledAdminToken: string;

  beforeAll(async () => {
    const session = await createAdminSessionRecord(db, adminId);
    disabledAdminToken = session.token;
    await db.query("update admin_users set is_active = false where id = $1", [adminId]);
  });

  afterAll(async () => {
    await db.query("update admin_users set is_active = true where id = $1", [adminId]);
  });

  it("rejects session lookups when the admin account is disabled", async () => {
    const res = await request(createApp())
      .get("/api/admin/overview")
      .set("Cookie", [`${ADMIN_COOKIE}=${disabledAdminToken}`]);
    expect(res.status).toBe(401);
  });

  it("rejects the login route when the account is disabled", async () => {
    const hash = await bcrypt.hash("SuperSecret_99", 8);
    await db.query("update admin_users set password_hash = $1 where id = $2", [hash, adminId]);
    const res = await request(createApp()).post("/api/auth/admin/login").send({
      email: "admin@codequest.local",
      password: "SuperSecret_99",
    });
    expect([401, 403]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Admin session management
// ---------------------------------------------------------------------------

describe("admin session management", () => {
  it("GET /api/auth/admin/session returns the admin while the session is live", async () => {
    const res = await request(createApp())
      .get("/api/auth/admin/session")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.admin).not.toBeNull();
    expect(res.body.data.admin.id).toBe(adminId);
  });

  it("GET /api/auth/admin/session returns null when no cookie is present", async () => {
    const res = await request(createApp()).get("/api/auth/admin/session");
    expect(res.status).toBe(200);
    expect(res.body.data.admin).toBeNull();
  });

  it("revokes the session on POST /api/auth/admin/session (logout)", async () => {
    const tmp = await createAdminSessionRecord(db, adminId);
    const res = await request(createApp())
      .post("/api/auth/admin/session")
      .set("Cookie", [`${ADMIN_COOKIE}=${tmp.token}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.signedOut).toBe(true);

    const check = await request(createApp())
      .get("/api/auth/admin/session")
      .set("Cookie", [`${ADMIN_COOKIE}=${tmp.token}`]);
    expect(check.body.data.admin).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Unauthenticated callers receive 401 on every protected admin route
// ---------------------------------------------------------------------------

describe("unauthenticated admin route rejection", () => {
  const protectedRoutes: [string, string][] = [
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/contest"],
    ["GET", "/api/admin/students"],
    ["GET", "/api/admin/submissions"],
    ["GET", "/api/admin/flags"],
    ["GET", "/api/admin/levels"],
    ["GET", "/api/admin/audit"],
  ];

  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} returns 401 without a session`, async () => {
      const res = await request(createApp())[method.toLowerCase() as "get"](path);
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Students cannot access admin routes (role boundary)
// ---------------------------------------------------------------------------

describe("student cannot access admin routes", () => {
  it("GET /api/admin/overview returns 401 when using a student session cookie", async () => {
    const res = await request(createApp())
      .get("/api/admin/overview")
      .set("Cookie", [`${STUDENT_COOKIE}=${studentToken}`]);
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("GET /api/admin/students returns 401 when using a student session cookie", async () => {
    const res = await request(createApp())
      .get("/api/admin/students")
      .set("Cookie", [`${STUDENT_COOKIE}=${studentToken}`]);
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/submissions/review returns 401 when using a student session", async () => {
    const res = await request(createApp())
      .post("/api/admin/submissions/review")
      .set("Cookie", [`${STUDENT_COOKIE}=${studentToken}`, `${STUDENT_CSRF_COOKIE}=${studentCsrfToken}`])
      .set("x-csrf-token", studentCsrfToken)
      .send({ submissionId: "00000000-0000-0000-0000-000000000000", decision: "APPROVED", reason: "" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 7. No self-promotion endpoint exists in the public API
// ---------------------------------------------------------------------------

describe("no self-promotion vector in the public API", () => {
  const promotionAttempts: [string, string, Record<string, unknown>][] = [
    ["POST", "/api/admin/users", { email: "evil@hack.local", password: "evil", role: "SUPER_ADMIN" }],
    ["POST", "/api/auth/admin/register", { email: "evil@hack.local", password: "evil" }],
    ["PUT", "/api/admin/users/promote", { role: "SUPER_ADMIN" }],
  ];

  for (const [method, path, body] of promotionAttempts) {
    it(`${method} ${path} returns 404 (route does not exist)`, async () => {
      const fn = method.toLowerCase() as "post" | "put";
      const res = await request(createApp())[fn](path).send(body);
      expect(res.status).toBe(404);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. CSRF protection on admin mutation routes
// ---------------------------------------------------------------------------

describe("CSRF protection on admin mutations", () => {
  it("rejects PUT /api/admin/contest without x-csrf-token header", async () => {
    const res = await request(createApp())
      .put("/api/admin/contest")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminToken}`, `${ADMIN_CSRF_COOKIE}=${adminCsrfToken}`])
      .send({ name: "Hacked Contest" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects PUT /api/admin/contest with a wrong CSRF token", async () => {
    const res = await request(createApp())
      .put("/api/admin/contest")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminToken}`, `${ADMIN_CSRF_COOKIE}=${adminCsrfToken}`])
      .set("x-csrf-token", "totally-wrong-token")
      .send({ name: "Hacked Contest" });
    expect(res.status).toBe(403);
  });

  it("accepts PUT /api/admin/contest with the correct CSRF token", async () => {
    await db.query(
      "insert into contests (slug, name, timezone, registration_open) values ('phase4-main', 'Phase4 Contest', 'Asia/Kolkata', true) on conflict (slug) do nothing",
    );
    const res = await adminReq("put", "/api/admin/contest").send({});
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 9. Role-based access: REVIEWER cannot perform SUPER_ADMIN/ADMIN operations
// ---------------------------------------------------------------------------

describe("admin role restrictions", () => {
  let reviewerToken: string;
  let reviewerCsrfToken: string;

  beforeAll(async () => {
    await db.query("update admin_users set is_active = false where id = $1", [adminId]);
    const { rows } = await db.query<{ id: string }>(
      "insert into admin_users (email, name, password_hash, role) values ('reviewer@codequest.local', 'Reviewer', 'x', 'REVIEWER') returning id",
    );
    const reviewerId = rows[0]!.id;
    const session = await createAdminSessionRecord(db, reviewerId);
    reviewerToken = session.token;
    reviewerCsrfToken = session.csrfToken;
  });

  afterAll(async () => {
    await db.query("update admin_users set is_active = false where email = 'reviewer@codequest.local'");
    await db.query("update admin_users set is_active = true where id = $1", [adminId]);
  });

  it("allows a REVIEWER to reach the submissions/review guard (permitted role)", async () => {
    const res = await request(createApp())
      .post("/api/admin/submissions/review")
      .set("Cookie", [`${ADMIN_COOKIE}=${reviewerToken}`, `${ADMIN_CSRF_COOKIE}=${reviewerCsrfToken}`])
      .set("x-csrf-token", reviewerCsrfToken)
      .send({
        submissionId: "00000000-0000-0000-0000-000000000000",
        decision: "APPROVED",
        reason: "",
      });
    expect([404, 422]).toContain(res.status);
  });

  it("blocks a REVIEWER from updating contest settings", async () => {
    const res = await request(createApp())
      .put("/api/admin/contest")
      .set("Cookie", [`${ADMIN_COOKIE}=${reviewerToken}`, `${ADMIN_CSRF_COOKIE}=${reviewerCsrfToken}`])
      .set("x-csrf-token", reviewerCsrfToken)
      .send({ name: "Reviewer Hack" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("blocks a REVIEWER from updating a track active state", async () => {
    const res = await request(createApp())
      .patch("/api/admin/tracks/1")
      .set("Cookie", [`${ADMIN_COOKIE}=${reviewerToken}`, `${ADMIN_CSRF_COOKIE}=${reviewerCsrfToken}`])
      .set("x-csrf-token", reviewerCsrfToken)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 10. Cookie name segregation
// ---------------------------------------------------------------------------

describe("cookie name segregation", () => {
  it("passing the admin token in the student cookie slot grants nothing", async () => {
    const res = await request(createApp())
      .get("/api/admin/overview")
      .set("Cookie", [`${STUDENT_COOKIE}=${adminToken}`]);
    expect(res.status).toBe(401);
  });

  it("passing a student token in the admin cookie slot is rejected", async () => {
    const res = await request(createApp())
      .get("/api/admin/overview")
      .set("Cookie", [`${ADMIN_COOKIE}=${studentToken}`]);
    expect(res.status).toBe(401);
  });
});
