import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Db } from "@/lib/db/types";
import { ADMIN_COOKIE } from "@/lib/auth/cookies";
import { createAdminSessionRecord } from "@/lib/auth/session-store";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { createAdminRecord, createLevelRecord, createStudentRecord, createTrackRecord } from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";

let test: TestDb;
let contestId: string;
let adminCookie: string;

async function insertSubmission(
  studentId: string,
  levelId: string,
  status: string,
  submissionUrl: string,
): Promise<void> {
  await state.db.query(
    `insert into coding_submissions (student_id, level_id, status, submission_url, verdict)
     values ($1, $2, $3, $4, $5)`,
    [studentId, levelId, status, submissionUrl, status === "VERIFIED" ? "OK" : null],
  );
}

beforeAll(async () => {
  test = await createTestDb();
  state.db = test.db;

  const { rows } = await state.db.query<{ id: string }>(
    `insert into contests (slug, name, timezone, registration_open)
     values ('export', 'Export Test', 'Asia/Kolkata', true) returning id`,
  );
  contestId = rows[0]!.id;

  const trackId = await createTrackRecord(state.db, contestId, 1);
  const levelId = await createLevelRecord(state.db, trackId, {
    levelNumber: 1,
    isStarting: true,
    problemSlug: "two-sum",
  });

  const pendingStudent = await createStudentRecord(state.db, contestId, {
    rollNumber: "E001",
    leetcodeUsername: "e001",
  });
  const verifiedStudent = await createStudentRecord(state.db, contestId, {
    rollNumber: "E002",
    leetcodeUsername: "e002",
  });
  await insertSubmission(pendingStudent, levelId, "PENDING_REVIEW", "https://leetcode.com/problems/two-sum/submissions/1/");
  await insertSubmission(verifiedStudent, levelId, "VERIFIED", "https://leetcode.com/problems/two-sum/submissions/2/");

  const adminId = await createAdminRecord(state.db);
  const session = await createAdminSessionRecord(state.db, adminId);
  adminCookie = session.token;
});

afterAll(async () => {
  await test.close();
});

describe("GET /api/admin/submissions/export", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(createApp()).get("/api/admin/submissions/export");
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("streams a BOM-prefixed CSV with every status when no filter is given", async () => {
    const res = await request(createApp())
      .get("/api/admin/submissions/export")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text.startsWith("\uFEFF")).toBe(true);
    expect(res.text).toContain("Roll Number");
    expect(res.text).toContain("E001");
    expect(res.text).toContain("E002");
    expect(res.text).toContain("PENDING_REVIEW");
    expect(res.text).toContain("VERIFIED");
  });

  it("filters the export by status when requested", async () => {
    const res = await request(createApp())
      .get("/api/admin/submissions/export?status=VERIFIED")
      .set("Cookie", [`${ADMIN_COOKIE}=${adminCookie}`]);
    expect(res.status).toBe(200);
    expect(res.text).toContain("E002");
    expect(res.text).not.toContain("E001");
    expect(res.text).not.toContain("PENDING_REVIEW");
  });
});