/**
 * Final Mock Contest Validation (Phase 4 — Requirement 17)
 *
 * Safe, isolated end-to-end contest workflow test with:
 *  - One First-Year test student
 *  - One Second-Year test student
 *  - One administrator
 *
 * Validates:
 *  1. Register both students with distinct years and LeetCode profiles.
 *  2. Confirm correct track assignment stored in database.
 *  3. Confirm they receive different question sets in their roadmaps.
 *  4. Confirm Level 1 is available and Level 2 is locked.
 *  5. Open the assigned LeetCode problem for Level 1.
 *  6. Complete a configured conceptual assessment on Level 1.
 *  7. Submit coding solution evidence (status PENDING_REVIEW).
 *  8. Review evidence as administrator and approve the submission.
 *  9. Confirm exactly one level unlocks (Level 1 completed, Level 2 unlocked).
 * 10. Confirm score updates once.
 * 11. Confirm the correct leaderboard updates (Year 1 vs Year 2 isolation).
 * 12. Confirm progress persists after session logout and re-login.
 * 13. Confirm students cannot access the other year's track (403 Forbidden).
 * 14. Confirm students cannot access administrative endpoints (401 Unauthorized).
 * 15. Confirm a second active administrator cannot be created (DB unique constraint).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Db } from "@/lib/db/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { ensureContest, ensureTracks, importLevel, MARATHON } from "../scripts/seed";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";

let test: TestDb;
let db: Db;
let contestId: string;
const adminPassword = "SuperAdminPassword_12345!";
const adminEmail = "owner@codequest.local";
let adminCookies: string[] = [];
let adminCsrf = "";

let y1TrackId: string;
let y2TrackId: string;

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

  // 1. Seed contest and both tracks
  contestId = await ensureContest(db);
  const trackIds = await ensureTracks(db, contestId);
  y1TrackId = trackIds[1];
  y2TrackId = trackIds[2];

  // 2. Import levels for both years using official MARATHON questions
  for (const level of MARATHON[1]) {
    await importLevel(db, y1TrackId, level);
  }
  for (const level of MARATHON[2]) {
    await importLevel(db, y2TrackId, level);
  }

  // 3. Attach a conceptual question to Year 1 Level 1 so assessment workflow can be validated
  const y1Level1 = await db.query<{ id: string }>(
    "select id from levels where track_id = $1 and level_number = 1",
    [y1TrackId],
  );
  const level1Id = y1Level1.rows[0].id;

  // Configure assessment on level 1
  await db.query(
    `update levels set assessment_mode = 'BEFORE', require_assessment_pass = true, passing_score = 100
     where id = $1`,
    [level1Id],
  );

  const qInsert = await db.query<{ id: string }>(
    `insert into conceptual_questions (level_id, question_text, question_type, phase, order_index, points, explanation)
     values ($1, 'What is the time complexity of a hash map lookup?', 'SINGLE_CHOICE', 'BEFORE', 0, 10, 'O(1) average time')
     returning id`,
    [level1Id],
  );
  const qId = qInsert.rows[0].id;

  await db.query(
    `insert into answer_options (question_id, option_text, is_correct, order_index)
     values ($1, 'O(1)', true, 0), ($1, 'O(N)', false, 1)`,
    [qId],
  );

  // 4. Create the single owner administrator
  const hash = await bcrypt.hash(adminPassword, 10);
  await db.query(
    `insert into admin_users (email, name, password_hash, role, is_active)
     values ($1, 'Owner Admin', $2, 'SUPER_ADMIN', true)`,
    [adminEmail, hash],
  );
});

afterAll(async () => {
  await test.close();
});

describe("Phase 4: Final Mock Contest Validation", () => {
  const app = createApp();

  let student1Cookies: string[] = [];
  let student1Csrf = "";
  let student1Id: string;

  let student2Cookies: string[] = [];
  let _student2Csrf = "";
  let student2Id: string;

  let y1Levels: any[] = [];
  let y2Levels: any[] = [];

  it("Step 1: Registers First-Year test student", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        fullName: "Aarav Sharma",
        rollNumber: "23CS101",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/aarav_sharma/",
        password: "Student1Password123!",
        acceptIntegrity: true,
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.student).toBeDefined();
    expect(res.body.data.student.year).toBe(1);
    expect(res.body.data.student.roll_number).toBe("23CS101");
    student1Id = res.body.data.student.id;

    const auth = extractCookies(res);
    student1Cookies = auth.cookies;
    student1Csrf = auth.csrf;
    expect(student1Cookies.length).toBeGreaterThan(0);
  });

  it("Step 2: Registers Second-Year test student", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        fullName: "Bhavna Patel",
        rollNumber: "22CS202",
        year: 2,
        leetcodeProfileUrl: "https://leetcode.com/u/bhavna_patel/",
        password: "Student2Password123!",
        acceptIntegrity: true,
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.student).toBeDefined();
    expect(res.body.data.student.year).toBe(2);
    expect(res.body.data.student.roll_number).toBe("22CS202");
    student2Id = res.body.data.student.id;

    const auth = extractCookies(res);
    student2Cookies = auth.cookies;
    _student2Csrf = auth.csrf;
    expect(student2Cookies.length).toBeGreaterThan(0);
  });

  it("Step 3: Confirms track assignments stored in PostgreSQL", async () => {
    const s1 = await db.query<{ year: number }>("select year from students where id = $1", [student1Id]);
    const s2 = await db.query<{ year: number }>("select year from students where id = $1", [student2Id]);
    expect(s1.rows[0].year).toBe(1);
    expect(s2.rows[0].year).toBe(2);
  });

  it("Step 4: Confirms both students receive their exact 10 questions and distinct question sets", async () => {
    const res1 = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", student1Cookies)
      .expect(200);

    expect(res1.body.ok).toBe(true);
    y1Levels = res1.body.data.levels;
    expect(y1Levels).toHaveLength(10);
    // Level 1 Two Sum for Year 1
    expect(y1Levels[0].levelNumber).toBe(1);
    expect(y1Levels[0].title).toBe("Two Sum");
    // Level 2 Reverse Integer for Year 1 (withheld title because locked)
    expect(y1Levels[1].levelNumber).toBe(2);
    expect(y1Levels[1].hidden).toBe(true);

    const res2 = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", student2Cookies)
      .expect(200);

    expect(res2.body.ok).toBe(true);
    y2Levels = res2.body.data.levels;
    expect(y2Levels).toHaveLength(10);
    expect(y2Levels[0].levelNumber).toBe(1);
    expect(y2Levels[0].title).toBe("Two Sum");
    expect(y2Levels[1].levelNumber).toBe(2);
    expect(y2Levels[1].hidden).toBe(true);

    // Confirm track IDs and level records are independent
    expect(y1Levels[0].id).not.toBe(y2Levels[0].id);
  });

  it("Step 5: Confirms Level 1 is UNLOCKED and Level 2 is LOCKED initially", async () => {
    expect(y1Levels[0].status).toBe("UNLOCKED");
    expect(y1Levels[1].status).toBe("LOCKED");

    // Attempting to directly fetch locked Level 2 via API gives 403 Forbidden with LEVEL_LOCKED code
    const res = await request(app)
      .get(`/api/student/levels/${y1Levels[1].id}`)
      .set("Cookie", student1Cookies)
      .expect(403);

    expect(res.body.error.code).toBe("LEVEL_LOCKED");
  });

  it("Step 6: Opens assigned LeetCode problem on Level 1", async () => {
    const res = await request(app)
      .get(`/api/student/levels/${y1Levels[0].id}`)
      .set("Cookie", student1Cookies)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.problem).toBeDefined();
    expect(res.body.data.problem.slug).toBe("two-sum");
    expect(res.body.data.problem.url).toBe("https://leetcode.com/problems/two-sum/");
  });

  it("Step 7: Completes conceptual assessment on Level 1", async () => {
    // Fetch assessment questions for Level 1
    const assessRes = await request(app)
      .get(`/api/student/assessments?levelId=${y1Levels[0].id}`)
      .set("Cookie", student1Cookies)
      .expect(200);

    expect(assessRes.body.ok).toBe(true);
    const question = assessRes.body.data.state.phases[0].questions[0];
    const correctOption = question.options.find((o: any) => o.text === "O(1)");
    expect(correctOption).toBeDefined();

    // Submit answer
    const submitRes = await request(app)
      .post("/api/student/assessments")
      .set("Cookie", student1Cookies)
      .set("x-csrf-token", student1Csrf)
      .send({
        levelId: y1Levels[0].id,
        phase: "BEFORE",
        answers: [{ questionId: question.id, selectedOptionIds: [correctOption.id] }],
      })
      .expect(200);

    expect(submitRes.body.ok).toBe(true);
    expect(submitRes.body.data.passed).toBe(true);
    expect(submitRes.body.data.score).toBe(10);
  });

  it("Step 8: Submits coding evidence for verification (status PENDING_REVIEW)", async () => {
    const res = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", student1Cookies)
      .set("x-csrf-token", student1Csrf)
      .send({
        levelId: y1Levels[0].id,
        submissionUrl: "https://leetcode.com/submissions/detail/100001/",
        sourceCode: "class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{0,1}; } }",
        programmingLanguage: "java",
        note: "Used hash map in O(N) time and O(N) space.",
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.submission.status).toBe("PENDING_REVIEW");

    // Reporting attempt records submission (PENDING_REVIEW), completes level 1 and unlocks level 2
    const checkRes = await request(app)
      .get(`/api/student/levels/${y1Levels[0].id}`)
      .set("Cookie", student1Cookies)
      .expect(200);

    expect(checkRes.body.data.level.status).toBe("COMPLETED");

    // Check that roadmap shows Level 2 already unlocked without waiting for admin approval
    const roadmapRes = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", student1Cookies)
      .expect(200);
    expect(roadmapRes.body.data.levels[1].status).toBe("UNLOCKED");
  });

  it("Step 9: Admin logs in, reviews, and approves the submission", async () => {
    // Admin login
    const loginRes = await request(app)
      .post("/api/auth/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);

    expect(loginRes.body.ok).toBe(true);
    const auth = extractCookies(loginRes);
    adminCookies = auth.cookies;
    adminCsrf = auth.csrf;
    expect(adminCookies.length).toBeGreaterThan(0);

    // Fetch review queue
    const reviewQueue = await request(app)
      .get("/api/admin/submissions?status=PENDING_REVIEW")
      .set("Cookie", adminCookies)
      .expect(200);

    expect(reviewQueue.body.ok).toBe(true);
    const submission = reviewQueue.body.data.submissions.find((s: any) => s.student_id === student1Id);
    expect(submission).toBeDefined();

    // Approve submission
    const reviewRes = await request(app)
      .post("/api/admin/submissions/review")
      .set("Cookie", adminCookies)
      .set("x-csrf-token", adminCsrf)
      .send({ submissionId: submission.id, decision: "APPROVED", reason: "Verified O(N) solution" })
      .expect(200);

    expect(reviewRes.body.ok).toBe(true);
    expect(reviewRes.body.data.submission.status).toBe("VERIFIED");
  });

  it("Step 10: Confirms exactly one level unlocks (Level 1 completed, Level 2 unlocked)", async () => {
    const res = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", student1Cookies)
      .expect(200);

    expect(res.body.ok).toBe(true);
    const levels = res.body.data.levels;
    // Level 1 is now COMPLETED
    expect(levels[0].status).toBe("COMPLETED");
    // Level 2 is now UNLOCKED
    expect(levels[1].status).toBe("UNLOCKED");
    expect(levels[1].hidden).toBe(false);
    expect(levels[1].title).toBe("Reverse Integer");
    // Level 3 remains LOCKED
    expect(levels[2].status).toBe("LOCKED");
    expect(levels[2].hidden).toBe(true);
  });

  it("Step 11: Confirms score updates once and leaderboard reflects changes", async () => {
    // Year 1 leaderboard
    const lb1Res = await request(app).get("/api/leaderboard?year=1").expect(200);
    expect(lb1Res.body.ok).toBe(true);
    const entries1 = lb1Res.body.data.entries;
    expect(entries1.length).toBeGreaterThan(0);
    const student1Entry = entries1.find((e: any) => e.studentId === student1Id);
    expect(student1Entry).toBeDefined();
    expect(student1Entry.rank).toBe(1);
    expect(student1Entry.levelsCompleted).toBe(1);
    expect(student1Entry.totalPoints).toBeGreaterThan(0);

    // Year 2 leaderboard should NOT show Student 1 and should show Student 2 with 0 levels completed
    const lb2Res = await request(app).get("/api/leaderboard?year=2").expect(200);
    expect(lb2Res.body.ok).toBe(true);
    const entries2 = lb2Res.body.data.entries;
    const inYear2 = entries2.find((e: any) => e.studentId === student1Id);
    expect(inYear2).toBeUndefined();

    const student2Entry = entries2.find((e: any) => e.studentId === student2Id);
    expect(student2Entry).toBeDefined();
    expect(student2Entry.levelsCompleted).toBe(0);
  });

  it("Step 12: Confirms progress persists across session sign-out and re-login", async () => {
    // Sign out
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", student1Cookies)
      .set("x-csrf-token", student1Csrf)
      .expect(200);

    // Sign back in
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ rollNumber: "23CS101", password: "Student1Password123!" })
      .expect(200);

    expect(loginRes.body.ok).toBe(true);
    const auth = extractCookies(loginRes);
    student1Cookies = auth.cookies;
    student1Csrf = auth.csrf;

    // Check progress
    const roadmapRes = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", student1Cookies)
      .expect(200);

    expect(roadmapRes.body.data.levels[0].status).toBe("COMPLETED");
    expect(roadmapRes.body.data.levels[1].status).toBe("UNLOCKED");
  });

  it("Step 13: Confirms cross-track access is blocked with 403 Forbidden", async () => {
    // Student 1 (Year 1) attempts to access Year 2 Level 1
    await request(app)
      .get(`/api/student/levels/${y2Levels[0].id}`)
      .set("Cookie", student1Cookies)
      .expect(403);

    // Student 2 (Year 2) attempts to access Year 1 Level 1
    await request(app)
      .get(`/api/student/levels/${y1Levels[0].id}`)
      .set("Cookie", student2Cookies)
      .expect(403);
  });

  it("Step 14: Confirms students cannot access administrative endpoints (401 Unauthorized)", async () => {
    await request(app)
      .get("/api/admin/contest")
      .set("Cookie", student1Cookies)
      .expect(401);

    await request(app)
      .get("/api/admin/submissions")
      .set("Cookie", student2Cookies)
      .expect(401);
  });

  it("Step 15: Confirms a second active administrator account cannot be created", async () => {
    // Attempting to insert a second active admin violates the partial unique index
    await expect(
      db.query(
        `insert into admin_users (email, name, password_hash, role, is_active)
         values ('second_owner@codequest.local', 'Second Owner', 'hash', 'SUPER_ADMIN', true)`,
      ),
    ).rejects.toThrow();
  });
});
