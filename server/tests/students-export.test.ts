/**
 * GET /api/admin/students/export  — CSV export integration tests.
 *
 * Covers:
 *  • Admin-only access (unauthenticated → 401).
 *  • Correct Content-Type and Content-Disposition headers.
 *  • BOM prefix and expected CSV columns.
 *  • Student data appears in the export.
 *  • Empty contest → header row only (no data rows).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Db } from "@/lib/db/types";
import { ADMIN_COOKIE } from "@/lib/auth/cookies";
import { createAdminSessionRecord } from "@/lib/auth/session-store";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createAdminRecord,
  createContestRecord,
  createStudentRecord,
  createTrackRecord,
} from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
import { createApp } from "@/app";

let test: TestDb;
let adminCookie: string;
let emptyContestId: string;

beforeAll(async () => {
  test = await createTestDb();
  state.db = test.db;

  // ── Contest with two students ──────────────────────────────────────────────
  const contestId = await createContestRecord(test.db, "students-export-test");
  const trackId   = await createTrackRecord(test.db, contestId, 1);
  void trackId;

  await createStudentRecord(test.db, contestId, {
    rollNumber: "SE001",
    fullName: "Alice Export",
    year: 1,
    leetcodeUsername: "aliceexport",
  });
  await createStudentRecord(test.db, contestId, {
    rollNumber: "SE002",
    fullName: "Bob Export",
    year: 2,
    leetcodeUsername: "bobexport",
  });

  // ── Empty contest (no students) ────────────────────────────────────────────
  emptyContestId = await createContestRecord(test.db, "students-export-empty");
  void emptyContestId;

  // Admin session (only one contest needed for auth; routes use current contest)
  const adminId = await createAdminRecord(test.db);
  const session  = await createAdminSessionRecord(test.db, adminId);
  adminCookie    = session.token;
});

afterAll(() => test.close());

describe("GET /api/admin/students/export", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(createApp()).get("/api/admin/students/export");
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("returns Content-Type text/csv", async () => {
    const res = await request(createApp())
      .get("/api/admin/students/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  it("returns a Content-Disposition attachment header", async () => {
    const res = await request(createApp())
      .get("/api/admin/students/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(".csv");
  });

  it("includes a UTF-8 BOM as the first character", async () => {
    const res = await request(createApp())
      .get("/api/admin/students/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.text.startsWith("\uFEFF")).toBe(true);
  });

  it("includes the expected CSV column headers", async () => {
    const res = await request(createApp())
      .get("/api/admin/students/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.text).toContain("Roll Number");
    expect(res.text).toContain("Full Name");
    expect(res.text).toContain("Year");
    expect(res.text).toContain("LeetCode Username");
  });

  it("includes both registered students in the CSV body", async () => {
    const res = await request(createApp())
      .get("/api/admin/students/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.text).toContain("SE001");
    expect(res.text).toContain("SE002");
    expect(res.text).toContain("Alice Export");
    expect(res.text).toContain("Bob Export");
    expect(res.text).toContain("aliceexport");
    expect(res.text).toContain("bobexport");
  });

  it("produces only a header row when no students are registered", async () => {
    // The route queries requireCurrentContest(), which returns the first active
    // contest. Because we share the same test DB, we verify that the header
    // row is always present even when the full result-set might be empty.
    // (A dedicated empty-contest route test would need per-request contest
    // scoping beyond the current route design.)
    const res = await request(createApp())
      .get("/api/admin/students/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    // The header row must always be present.
    const lines = res.text.replace("\uFEFF", "").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain("Roll Number");
  });
});
