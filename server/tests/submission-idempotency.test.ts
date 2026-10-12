import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/types";
import { createSubmission } from "@/lib/services/submissions";
import { getProgressSummary, getStudentLevels } from "@/lib/services/progression";
import type { StudentRow } from "@/lib/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createContestRecord,
  createLevelRecord,
  createStudentRecord,
  createTrackRecord,
} from "./helpers/factories";

/**
 * Concurrency-safety regression guards.
 *
 * PGlite exposes a single connection, so genuine transaction interleaving
 * cannot be exercised here. What *can* be pinned is the property that keeps the
 * system correct when the same student fires several submissions at once (double
 * clicks, retries, flaky networks): the operation is idempotent, points are
 * awarded exactly once, and the next level is unlocked exactly once.
 */

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

let test: TestDb;
let db: Db;
let level1: string;
let level2: string;
let student: StudentRow;
let retryStudent: StudentRow;

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;

  const contestId = await createContestRecord(db, "idempotency-contest");
  const track = await createTrackRecord(db, contestId, 1);
  await db.query("update contest_tracks set is_active = true where id = $1", [track]);

  // No verified-submission requirement so completion awards points immediately.
  level1 = await createLevelRecord(db, track, {
    levelNumber: 1,
    title: "Two Sum",
    points: 10,
    isStarting: true,
    requireVerifiedSubmission: false,
    problemSlug: "two-sum",
  });
  level2 = await createLevelRecord(db, track, {
    levelNumber: 2,
    title: "Reverse",
    points: 20,
    requireVerifiedSubmission: true,
  });

  const studentId = await createStudentRecord(db, contestId, {
    rollNumber: "IDEM01",
    year: 1,
    leetcodeUsername: "idem_student",
  });
  const retryStudentId = await createStudentRecord(db, contestId, {
    rollNumber: "IDEM02",
    year: 1,
    leetcodeUsername: "idem_retry",
  });

  student = (
    await db.query<StudentRow>("select * from students where id = $1", [studentId])
  ).rows[0]!;
  retryStudent = (
    await db.query<StudentRow>("select * from students where id = $1", [retryStudentId])
  ).rows[0]!;

  // Mirror the real flow: opening the roadmap creates a progress row for every
  // active level (level 1 unlocked, the rest locked) before any submission.
  await getStudentLevels(student, db);
  await getStudentLevels(retryStudent, db);
});

afterAll(async () => {
  await test.close();
});

describe("submission idempotency under rapid retries", () => {
  it("records one attempt, awards points once, and unlocks the next level once", async () => {
    const payload = {
      levelId: level1,
      submissionUrl: "https://leetcode.com/submissions/detail/1/",
      sourceCode: "def two_sum(nums, target): pass",
      programmingLanguage: "python",
    };

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await createSubmission(student, payload, { db }));
    }

    const subs = await db.query<{ attempt_number: number }>(
      "select attempt_number from coding_submissions where student_id = $1 and level_id = $2",
      [student.id, level1],
    );
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]!.attempt_number).toBe(1);

    for (const result of results) {
      expect(result.completed).toBe(true);
      expect(result.nextLevel?.levelNumber).toBe(2);
      expect(result.totalLevels).toBe(2);
    }

    const points = await db.query<{ count: number }>(
      `select count(*)::int as count from score_events
        where student_id = $1 and level_id = $2`,
      [student.id, level1],
    );
    expect(points.rows[0]!.count).toBe(1);

    const next = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [student.id, level2],
    );
    expect(next.rows[0]!.status).toBe("UNLOCKED");

    const summary = await getProgressSummary(db, student);
    expect(summary.levelsCompleted).toBe(1);
    expect(summary.totalLevels).toBe(2);
  });

  it("accepts a fresh attempt once the previous submission is rejected", async () => {
    const first = await createSubmission(
      retryStudent,
      {
        levelId: level1,
        submissionUrl: "https://leetcode.com/submissions/detail/10/",
        sourceCode: "def two_sum_a(nums, target): pass",
        programmingLanguage: "python",
      },
      { db },
    );
    expect(first.attempt_number).toBe(1);

    await db.query(
      "update coding_submissions set status = 'REJECTED' where student_id = $1 and level_id = $2",
      [retryStudent.id, level1],
    );

    const result = await createSubmission(
      retryStudent,
      {
        levelId: level1,
        submissionUrl: "https://leetcode.com/submissions/detail/11/",
        sourceCode: "def two_sum_b(nums, target): pass",
        programmingLanguage: "python",
      },
      { db },
    );

    const subs = await db.query<{ attempt_number: number; status: string }>(
      "select attempt_number, status from coding_submissions where student_id = $1 and level_id = $2 order by attempt_number",
      [retryStudent.id, level1],
    );
    expect(subs.rows).toHaveLength(2);
    expect(subs.rows[1]!.attempt_number).toBe(2);
    expect(result.attempt_number).toBe(2);
  });
});
