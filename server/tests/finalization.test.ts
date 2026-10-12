/**
 * Contest finalization ("Submit Contest for Review") regression suite.
 *
 * Covers the service-layer contract that the frontend relies on:
 *  1. Readiness reporting before every level is complete.
 *  2. Server-side rejection of an incomplete finalize (client flag is advisory).
 *  3. Successful finalize: finalized_at + finalist_status promotion + lock.
 *  4. Idempotency: a second finalize never moves the timestamp.
 *  5. Post-finalize guards on submissions and assessments.
 *  6. SCHEDULED contests cannot be finalized.
 *  7. Strict one-submission policy: changed evidence is rejected (409), identical
 *     reports dedupe.
 *  8. listFinishers(finalizedOnly) surfaces only submitted-for-review students.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "@/lib/db/types";
import type { StudentRow } from "@/lib/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createContestRecord,
  createLevelRecord,
  createStudentRecord,
  createTrackRecord,
  getStudentRow,
} from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";
import { createSubmission } from "@/lib/services/submissions";
import { submitAssessment } from "@/lib/services/assessments";
import { getStudentLevels } from "@/lib/services/progression";
import { evaluateFinalizeReadiness, finalizeContest } from "@/lib/services/finalization";
import { listFinishers } from "@/lib/services/finishers";

let test: TestDb;
let db: Db;
let app: Express;
let contestId: string;
let level1: string;
let level2: string;

let studentAId: string;

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

async function fresh(id: string): Promise<StudentRow> {
  return (await getStudentRow(db, id)) as unknown as StudentRow;
}

function toIso(value: string | Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function newStudent(id: string): Promise<StudentRow> {
  const student = await fresh(id);
  await getStudentLevels(student, db);
  return student;
}

function leavesUrl(_slug: string, suffix: string) {
  return `https://leetcode.com/submissions/detail/${suffix}/`;
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;
  app = createApp();

  contestId = await createContestRecord(db, "finalization-contest");
  const trackId = await createTrackRecord(db, contestId, 1);
  level1 = await createLevelRecord(db, trackId, {
    levelNumber: 1,
    title: "Level One",
    isStarting: true,
    requireVerifiedSubmission: false,
    problemSlug: "two-sum",
  });
  level2 = await createLevelRecord(db, trackId, {
    levelNumber: 2,
    title: "Level Two",
    requireVerifiedSubmission: false,
    problemSlug: "reverse-integer",
  });
});

afterAll(async () => {
  await test.close();
});

describe("contest finalization", () => {
  beforeAll(async () => {
    studentAId = await createStudentRecord(db, contestId, {
      rollNumber: "FIN001",
      year: 1,
      fullName: "Finalizer Alpha",
      leetcodeUsername: "lc-fin001",
    });
    await newStudent(studentAId);
  });

  it("reports not-ready before every level is complete", async () => {
    const readiness = await evaluateFinalizeReadiness(db, await fresh(studentAId));
    expect(readiness.finalized).toBe(false);
    expect(readiness.allLevelsCompleted).toBe(false);
    expect(readiness.canFinalize).toBe(false);
    expect(readiness.totalLevels).toBe(2);
    expect(readiness.levelsCompleted).toBe(0);
    expect(readiness.reasons.length).toBeGreaterThan(0);
  });

  it("rejects finalization while a level is still outstanding", async () => {
    await createSubmission(
      await fresh(studentAId),
      {
        levelId: level1,
        submissionUrl: leavesUrl("two-sum", "11"),
        sourceCode: "print('one')",
        programmingLanguage: "python",
      },
      { db },
    );

    await expect(finalizeContest(await fresh(studentAId), { db })).rejects.toThrow(
      /Complete every level/,
    );
  });

  it("finalizes once every level is complete and promotes the finalist status", async () => {
    await createSubmission(
      await fresh(studentAId),
      {
        levelId: level2,
        submissionUrl: leavesUrl("reverse-integer", "22"),
        sourceCode: "print('two')",
        programmingLanguage: "python",
      },
      { db },
    );

    const done = await fresh(studentAId);
    expect(done.finished_at).not.toBeNull();
    expect(done.finalist_status).toBe("PROVISIONAL");

    const readiness = await evaluateFinalizeReadiness(db, done);
    expect(readiness.canFinalize).toBe(true);
    expect(readiness.allLevelsCompleted).toBe(true);
    expect(readiness.levelsCompleted).toBe(2);
    expect(readiness.totalLevels).toBe(2);

    const result = await finalizeContest(done, { db });
    expect(result.alreadyFinalized).toBe(false);
    expect(toIso(result.student.finalized_at)).toBe(result.finalizedAt);
    expect(result.student.finalist_status).toBe("UNDER_REVIEW");
    expect(result.readiness.finalized).toBe(true);
    expect(result.readiness.canFinalize).toBe(false);
  });

  it("is idempotent and never moves the original timestamp", async () => {
    const before = await fresh(studentAId);
    const again = await finalizeContest(before, { db });
    expect(again.alreadyFinalized).toBe(true);
    expect(toIso(again.finalizedAt)).toBe(toIso(before.finalized_at));
    expect(toIso((await fresh(studentAId)).finalized_at)).toBe(toIso(before.finalized_at));
  });

  it("locks out further coding submissions", async () => {
    await expect(
      createSubmission(
        await fresh(studentAId),
        {
          levelId: level1,
          submissionUrl: leavesUrl("two-sum", "99"),
          sourceCode: "print('late')",
          programmingLanguage: "python",
        },
        { db },
      ),
    ).rejects.toThrow(/submitted for review/);
  });

  it("leaves the stored attempt history untouched after finalizing", async () => {
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from coding_submissions where student_id = $1",
      [studentAId],
    );
    expect(rows[0]!.count).toBe(2);
  });
});

describe("one submission per level", () => {
  let studentId: string;

  beforeAll(async () => {
    studentId = await createStudentRecord(db, contestId, {
      rollNumber: "FIN-MULTI",
      year: 1,
      fullName: "One Submission",
      leetcodeUsername: "lc-fin-multi",
    });
    await newStudent(studentId);
  });

  it("rejects changed evidence while the level already has an active submission", async () => {
    const first = await createSubmission(
      await fresh(studentId),
      {
        levelId: level1,
        submissionUrl: leavesUrl("two-sum", "1"),
        sourceCode: "code-a",
        programmingLanguage: "python",
      },
      { db },
    );
    expect(first.attempt_number).toBe(1);
    expect(first.is_official).toBe(true);

    await expect(
      createSubmission(
        await fresh(studentId),
        {
          levelId: level1,
          submissionUrl: leavesUrl("two-sum", "2"),
          sourceCode: "code-b",
          programmingLanguage: "python",
        },
        { db },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from coding_submissions where student_id = $1 and level_id = $2",
      [studentId, level1],
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("dedupes an identical retry of the active submission", async () => {
    const retry = await createSubmission(
      await fresh(studentId),
      {
        levelId: level1,
        submissionUrl: leavesUrl("two-sum", "1"),
        sourceCode: "code-a",
        programmingLanguage: "python",
      },
      { db },
    );
    expect(retry.attempt_number).toBe(1);

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from coding_submissions where student_id = $1 and level_id = $2",
      [studentId, level1],
    );
    expect(rows[0]!.count).toBe(1);
  });
});

describe("assessment attempts are locked after finalization", () => {
  let assessStudentId: string;
  let assessLevelId: string;
  let assessQuestionId: string;

  beforeAll(async () => {
    const assessContestId = await createContestRecord(db, "finalization-assess-contest");
    const assessTrackId = await createTrackRecord(db, assessContestId, 1);
    assessLevelId = await createLevelRecord(db, assessTrackId, {
      levelNumber: 1,
      isStarting: true,
      assessmentMode: "BEFORE",
      requireAssessmentPass: true,
      requireVerifiedSubmission: false,
      passingScore: 0,
      questions: [
        {
          text: "What is 2 + 2?",
          type: "SINGLE_CHOICE",
          phase: "BEFORE",
          options: [
            { text: "4", correct: true },
            { text: "5" },
          ],
        },
      ],
    });

    assessStudentId = await createStudentRecord(db, assessContestId, {
      rollNumber: "FIN-ASSESS",
      year: 1,
      fullName: "Assessed Student",
      leetcodeUsername: "lc-fin-assess",
    });
    await newStudent(assessStudentId);

    const { rows } = await db.query<{ question_id: string; option_id: string }>(
      `select q.id as question_id, o.id as option_id
         from conceptual_questions q
         join answer_options o on o.question_id = q.id and o.is_correct = true
        where q.level_id = $1 and q.phase = 'BEFORE'`,
      [assessLevelId],
    );

    const passed = await submitAssessment(
      await fresh(assessStudentId),
      {
        levelId: assessLevelId,
        phase: "BEFORE",
        answers: [
          {
            questionId: rows[0]!.question_id,
            selectedOptionIds: [rows[0]!.option_id],
          },
        ],
      },
      db,
    );
    expect(passed.passed).toBe(true);
    expect(passed.completed).toBe(true);

    const finalized = await finalizeContest(await fresh(assessStudentId), { db });
    expect(finalized.alreadyFinalized).toBe(false);

    assessQuestionId = rows[0]!.question_id;
  });

  it("rejects a further assessment attempt", async () => {
    await expect(
      submitAssessment(
        await fresh(assessStudentId),
        {
          levelId: assessLevelId,
          phase: "BEFORE",
          answers: [{ questionId: assessQuestionId, selectedOptionIds: [] }],
        },
        db,
      ),
    ).rejects.toThrow(/submitted for review/);
  });
});

describe("scheduled contests cannot be finalized", () => {
  it("throws a forbidden error before the start time", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into contests (slug, name, timezone, registration_open, start_at)
       values ('finalization-scheduled', 'Scheduled Contest', 'Asia/Kolkata', true,
               now() + interval '1 day')
       returning id`,
    );
    const scheduledContestId = rows[0]!.id;
    const trackId = await createTrackRecord(db, scheduledContestId, 1);
    await createLevelRecord(db, trackId, {
      levelNumber: 1,
      isStarting: true,
      requireVerifiedSubmission: false,
    });

    const studentId = await createStudentRecord(db, scheduledContestId, {
      rollNumber: "FIN-SCHED",
      year: 1,
      fullName: "Scheduled Student",
      leetcodeUsername: "lc-fin-sched",
    });
    await newStudent(studentId);

    await db.query(
      "update student_level_progress set status = 'COMPLETED', completed_at = now() where student_id = $1",
      [studentId],
    );
    await db.query("update students set finished_at = now(), finalist_status = 'PROVISIONAL' where id = $1", [
      studentId,
    ]);

    await expect(finalizeContest(await fresh(studentId), { db })).rejects.toThrow(/not started/);
  });
});

describe("listFinishers finalizedOnly filter", () => {
  let unfinalizedId: string;

  beforeAll(async () => {
    unfinalizedId = await createStudentRecord(db, contestId, {
      rollNumber: "FIN-PENDING",
      year: 1,
      fullName: "Pending Student",
      leetcodeUsername: "lc-fin-pending",
    });
    const student = await newStudent(unfinalizedId);
    await createSubmission(
      student,
      {
        levelId: level1,
        submissionUrl: leavesUrl("two-sum", "31"),
        sourceCode: "pending-1",
        programmingLanguage: "python",
      },
      { db },
    );
    await createSubmission(
      await fresh(unfinalizedId),
      {
        levelId: level2,
        submissionUrl: leavesUrl("reverse-integer", "32"),
        sourceCode: "pending-2",
        programmingLanguage: "python",
      },
      { db },
    );
    expect((await fresh(unfinalizedId)).finished_at).not.toBeNull();
    expect((await fresh(unfinalizedId)).finalized_at).toBeNull();
  });

  it("includes only submitted-for-review finishers", async () => {
    const finishers = await listFinishers(contestId, { year: 1, finalizedOnly: true }, db);
    const finalized = finishers.find((f) => f.studentId === studentAId);
    expect(finalized).toBeDefined();
    expect(finalized!.finalizedAt).not.toBeNull();
    expect(finishers.find((f) => f.studentId === unfinalizedId)).toBeUndefined();
  });

  it("still lists every finisher when the filter is off", async () => {
    const finishers = await listFinishers(contestId, { year: 1 }, db);
    expect(finishers.find((f) => f.studentId === studentAId)).toBeDefined();
    expect(finishers.find((f) => f.studentId === unfinalizedId)).toBeDefined();
  });
});

describe("POST /api/student/contest/finalize", () => {
  let cookies: string[];
  let csrf: string;
  let levelId: string;

  beforeAll(async () => {
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        fullName: "Http Finalizer",
        rollNumber: "HTTP01",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/http_finalizer/",
        password: "password123",
      })
      .expect(200);

    const auth = extractCookies(regRes);
    cookies = auth.cookies;
    csrf = auth.csrf;

    // Start the personal contest timer (gates challenge access).
    await request(app)
      .post("/api/student/contest/start")
      .set("Cookie", cookies)
      .set("x-csrf-token", csrf)
      .expect(200);

    const roadmap = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", cookies)
      .expect(200);
    const levels = roadmap.body.data.levels as Array<{ id: string }>;
    levelId = levels[0]!.id;
    for (const [index, level] of levels.entries()) {
      await request(app)
        .post("/api/student/submissions")
        .set("Cookie", cookies)
        .set("x-csrf-token", csrf)
        .send({
          levelId: level.id,
          submissionUrl: `https://leetcode.com/submissions/detail/${900 + index}/`,
          sourceCode: `http-code-${index}`,
          programmingLanguage: "python",
        })
        .expect(200);
    }
  });

  it("finalizes and then rejects further mutating requests", async () => {
    const finalizeRes = await request(app)
      .post("/api/student/contest/finalize")
      .set("Cookie", cookies)
      .set("x-csrf-token", csrf)
      .expect(200);
    expect(finalizeRes.body.ok).toBe(true);
    expect(finalizeRes.body.data.alreadyFinalized).toBe(false);
    expect(finalizeRes.body.data.student.finalized_at).not.toBeNull();
    expect(finalizeRes.body.data.readiness.canFinalize).toBe(false);

    const again = await request(app)
      .post("/api/student/contest/finalize")
      .set("Cookie", cookies)
      .set("x-csrf-token", csrf)
      .expect(200);
    expect(again.body.data.alreadyFinalized).toBe(true);

    const lockedLevel = await request(app)
      .get(`/api/student/levels/${levelId}`)
      .set("Cookie", cookies)
      .expect(403);
    expect(lockedLevel.body.error.message).toContain("submitted for review");

    const lockedSubmit = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", cookies)
      .set("x-csrf-token", csrf)
      .send({
        levelId,
        submissionUrl: "https://leetcode.com/submissions/detail/999/",
        sourceCode: "late-code",
        programmingLanguage: "python",
      })
      .expect(403);
    expect(lockedSubmit.body.error.message).toContain("locked");
  });
});
