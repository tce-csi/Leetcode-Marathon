import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Db } from "@/lib/db/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { createLevelRecord, createTrackRecord } from "./helpers/factories";
import bcrypt from "bcryptjs";
import type { Express } from "express";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";

let test: TestDb;
let db: Db;
let app: Express;
let contestId: string;
let trackYear1: string;
let trackYear2: string;
let level1: string;
let level2: string;
let _level3: string;

function extractCookies(res: request.Response) {
  const setCookie = res.headers["set-cookie"];
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookies = list.map((c) => c.split(";")[0]);
  const csrf = list
    .find((c) => c.includes("csrf="))
    ?.split(";")[0]
    .split("=")[1];
  return { cookies, csrf: csrf ?? "" };
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;
  app = createApp();

  const { rows } = await db.query<{ id: string }>(
    `insert into contests (slug, name, timezone, registration_open, start_at)
     values ('auto-progress-contest', 'Auto Progress Contest', 'Asia/Kolkata', true, now()) returning id`,
  );
  contestId = rows[0]!.id;
  trackYear1 = await createTrackRecord(db, contestId, 1);
  trackYear2 = await createTrackRecord(db, contestId, 2);

  level1 = await createLevelRecord(db, trackYear1, {
    levelNumber: 1,
    title: "Problem 1",
    points: 100,
    isStarting: true,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });

  level2 = await createLevelRecord(db, trackYear1, {
    levelNumber: 2,
    title: "Problem 2",
    points: 200,
    isStarting: false,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });

  _level3 = await createLevelRecord(db, trackYear1, {
    levelNumber: 3,
    title: "Problem 3",
    points: 300,
    isStarting: false,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });

  const hash = await bcrypt.hash("admin-password", 10);
  await db.query(
    `insert into admin_users (email, name, password_hash, role, is_active)
     values ($1, 'Admin', $2, 'SUPER_ADMIN', true)`,
    ["admin-prog@tce.edu", hash],
  );
});

afterAll(async () => {
  await test.close();
});

describe("CODEQUEST — Automatic Level Progression & Separation of Verification", () => {
  let studentCookie: string[];
  let studentCsrf: string;
  let studentId: string;

  beforeAll(async () => {
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        fullName: "Auto Student",
        rollNumber: "22AUTO01",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/auto_student/",
        password: "password123",
      })
      .expect(200);

    studentId = regRes.body.data.student.id;
    const auth = extractCookies(regRes);
    studentCookie = auth.cookies;
    studentCsrf = auth.csrf;
  });

  it("Level 1 starts UNLOCKED and Level 2 starts LOCKED", async () => {
    const res = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);

    const levels = res.body.data.levels;
    expect(levels[0].id).toBe(level1);
    expect(levels[0].status).toBe("UNLOCKED");
    expect(levels[1].id).toBe(level2);
    expect(levels[1].status).toBe("LOCKED");
  });

  it("Rejects non-LeetCode URLs", async () => {
    const res = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .send({
        levelId: level1,
        submissionUrl: "https://github.com/fake/repo",
        sourceCode: "def two_sum(): pass",
      })
      .expect(400);

    expect(res.body.error.message).toContain("leetcode.com");
  });

  it("Submitting a valid LeetCode attempt advances Level 1 and unlocks Level 2 without admin approval", async () => {
    const subRes = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .send({
        levelId: level1,
        submissionUrl: "https://leetcode.com/problems/two-sum/submissions/123456/",
        sourceCode: "def two_sum(): pass",
        programmingLanguage: "python",
      })
      .expect(200);

    expect(subRes.body.ok).toBe(true);
    // Crucial: submission status is PENDING_REVIEW (no false VERIFIED)
    expect(subRes.body.data.submission.status).toBe("PENDING_REVIEW");

    // Check roadmap: Level 1 is COMPLETED and Level 2 is UNLOCKED immediately
    const roadmapRes = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);

    const levels = roadmapRes.body.data.levels;
    expect(levels[0].status).toBe("COMPLETED");
    expect(levels[1].status).toBe("UNLOCKED");
    expect(levels[2].status).toBe("LOCKED");

    // Verified points must NOT be awarded merely for submitting an attempt URL
    const summaryRes = roadmapRes.body.data.summary;
    expect(summaryRes.totalPoints).toBe(0);
    expect(summaryRes.levelsCompleted).toBe(1);
  });

  it("Duplicate submission reports do not unlock additional levels", async () => {
    await request(app)
      .post("/api/student/submissions")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .send({
        levelId: level1,
        submissionUrl: "https://leetcode.com/problems/two-sum/submissions/123456/",
        sourceCode: "def two_sum(): pass",
        programmingLanguage: "python",
      })
      .expect(200);

    const roadmapRes = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);

    const levels = roadmapRes.body.data.levels;
    // Level 3 must still be locked
    expect(levels[1].status).toBe("UNLOCKED");
    expect(levels[2].status).toBe("LOCKED");
  });

  it("Student can continue immediately to Level 2 and report an attempt", async () => {
    const subRes = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .send({
        levelId: level2,
        submissionUrl: "https://leetcode.com/problems/reverse-integer/submissions/234567/",
        sourceCode: "def reverse(): pass",
        programmingLanguage: "python",
      })
      .expect(200);

    expect(subRes.body.data.submission.status).toBe("PENDING_REVIEW");

    const roadmapRes = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);

    const levels = roadmapRes.body.data.levels;
    expect(levels[1].status).toBe("COMPLETED");
    expect(levels[2].status).toBe("UNLOCKED");
  });

  it("Leaderboard reflects marathon progress while keeping unverified scores at 0", async () => {
    const lbRes = await request(app)
      .get("/api/leaderboard?year=1")
      .expect(200);

    expect(lbRes.body.ok).toBe(true);
    const entry = lbRes.body.data.entries.find(
      (e: { studentId: string }) => e.studentId === studentId,
    );
    expect(entry).toBeDefined();
    // 2 levels completed/advanced in marathon
    expect(entry.levelsCompleted).toBe(2);
    // Verified score is 0 because admin has not approved yet
    expect(entry.totalPoints).toBe(0);
  });

  it("Admin approval awards verified points without resetting or corrupting progression", async () => {
    const adminLoginRes = await request(app)
      .post("/api/auth/admin/login")
      .send({ email: "admin-prog@tce.edu", password: "admin-password" })
      .expect(200);

    const { cookies: adminCookies, csrf: adminCsrf } = extractCookies(adminLoginRes);

    const queueRes = await request(app)
      .get("/api/admin/submissions?status=PENDING_REVIEW")
      .set("Cookie", adminCookies)
      .expect(200);

    const sub1 = queueRes.body.data.submissions.find(
      (s: { student_id: string; level_id: string; id: string }) =>
        s.student_id === studentId && s.level_id === level1,
    );
    expect(sub1).toBeDefined();

    // Approve Level 1 submission
    const reviewRes = await request(app)
      .post("/api/admin/submissions/review")
      .set("Cookie", adminCookies)
      .set("x-csrf-token", adminCsrf)
      .send({
        submissionId: sub1.id,
        decision: "APPROVED",
        reason: "Valid solution verified",
      })
      .expect(200);

    expect(reviewRes.body.data.submission.status).toBe("VERIFIED");

    // Verified points are now awarded (100 pts for level 1)
    const lbRes = await request(app).get("/api/leaderboard?year=1").expect(200);
    const entry = lbRes.body.data.entries.find(
      (e: { studentId: string }) => e.studentId === studentId,
    );
    expect(entry.totalPoints).toBe(100);
    expect(entry.levelsCompleted).toBe(2);
  });

  it("Cross-year track access remains forbidden", async () => {
    // Attempting to access track 2
    const crossRes = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);

    expect(
      crossRes.body.data.levels.every((l: { track_id: string }) => l.track_id !== trackYear2),
    ).toBe(true);
  });
});
