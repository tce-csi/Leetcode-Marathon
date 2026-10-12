import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/types";
import type { StudentRow } from "@/lib/types";
import { AppError } from "@/lib/errors";
import { registerStudent, authenticateStudent } from "@/lib/services/students";
import {
  getLevelContext,
  getProgressSummary,
  getStudentLevels,
  resetStudentProgress,
} from "@/lib/services/progression";
import { getAssessmentState, submitAssessment } from "@/lib/services/assessments";
import {
  createSubmission,
  listSubmissionsForReview,
  reviewSubmission,
} from "@/lib/services/submissions";
import { getLeaderboard } from "@/lib/services/leaderboard";
import { getActiveContest } from "@/lib/services/contest";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createAdminRecord,
  createLevelRecord,
  createTrackRecord,
} from "./helpers/factories";

let test: TestDb;
let db: Db;
let contestId: string;
let track1: string;
let track2: string;
let level1: string;
let level2: string;
let adminId: string;

async function studentRow(id: string): Promise<StudentRow> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0]!;
}

async function correctOptionId(questionText: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select o.id from answer_options o
       join conceptual_questions q on q.id = o.question_id
      where q.question_text = $1 and o.is_correct = true limit 1`,
    [questionText],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;

  const { rows } = await db.query<{ id: string }>(
    `insert into contests (slug, name, timezone, registration_open, start_at)
     values ('codequest-test', 'CodeQuest Test', 'Asia/Kolkata', true, now()) returning id`,
  );
  contestId = rows[0]!.id;
  track1 = await createTrackRecord(db, contestId, 1);
  track2 = await createTrackRecord(db, contestId, 2);

  level1 = await createLevelRecord(db, track1, {
    levelNumber: 1,
    isStarting: true,
    points: 10,
    assessmentMode: "BEFORE",
    requireAssessmentPass: true,
    requireVerifiedSubmission: true,
    problemSlug: "two-sum",
    questions: [
      {
        text: "Which structure?",
        phase: "BEFORE",
        points: 1,
        options: [
          { text: "Hash Map", correct: true },
          { text: "Stack" },
        ],
      },
    ],
  });
  level2 = await createLevelRecord(db, track1, {
    levelNumber: 2,
    points: 20,
    problemSlug: "valid-parentheses",
  });
  await createLevelRecord(db, track2, {
    levelNumber: 1,
    isStarting: true,
    points: 10,
    problemSlug: "binary-search",
  });

  adminId = await createAdminRecord(db);
});

afterAll(async () => {
  await test.close();
});

describe("registration and authentication", () => {
  it("registers a student and unlocks the starting level", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Alice First",
        rollNumber: " CS/01 ",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/Alice_LC/",
        password: "secret123",
      },
      { db },
    );
    expect(student.year).toBe(1);
    expect(student.roll_number).toBe("CS/01");
    expect(student).not.toHaveProperty("password_hash");

    const levels = await getStudentLevels(await studentRow(student.id), db);
    expect(levels).toHaveLength(2);
    expect(levels[0]!.status).toBe("UNLOCKED");
    expect(levels[1]!.status).toBe("LOCKED");
  });

  it("rejects a duplicate roll number (normalised)", async () => {
    await expect(
      registerStudent(
        {
          fullName: "Alice Clone",
          rollNumber: "cs/01",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/clone/",
          password: "secret123",
        },
        { db },
      ),
    ).rejects.toThrowError(/already registered/i);
  });

  it("authenticates with the correct password and rejects a wrong one", async () => {
    const { student } = await authenticateStudent("CS/01", "secret123", { db });
    expect(student.roll_number).toBe("CS/01");
    await expect(authenticateStudent("CS/01", "wrong", { db })).rejects.toThrowError(
      /invalid/i,
    );
  });
});

describe("track isolation and level locking", () => {
  it("prevents access to locked levels", async () => {
    const { student } = await authenticateStudent("CS/01", "secret123", { db });
    await expect(getLevelContext(await studentRow(student.id), level2, db)).rejects.toThrow(
      AppError,
    );
  });

  it("prevents accessing another year's track", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Bob Second",
        rollNumber: "CS02",
        year: 2,
        leetcodeProfileUrl: "https://leetcode.com/u/bob_lc/",
        password: "secret123",
      },
      { db },
    );
    await expect(
      getLevelContext(await studentRow(student.id), level1, db),
    ).rejects.toThrowError(/track/i);
  });
});

describe("conceptual assessment", () => {
  it("unlocks the problem link after answering but requires a pass for completion", async () => {
    const { student } = await authenticateStudent("CS/01", "secret123", { db });
    const studentEntity = await studentRow(student.id);

    const state = await getAssessmentState(studentEntity, (await getLevelContext(studentEntity, level1, db)).level, db);
    expect(state.linkUnlocked).toBe(false);

    const wrongOption = await db.query<{ id: string }>(
      "select id from answer_options where option_text = 'Stack' limit 1",
    );

    const first = await submitAssessment(
      studentEntity,
      {
        levelId: level1,
        phase: "BEFORE",
        answers: [{ questionId: state.phases[0]!.questions[0]!.id, selectedOptionIds: [wrongOption.rows[0]!.id] }],
      },
      db,
    );
    expect(first.passed).toBe(false);

    const stateAfter = await getAssessmentState(studentEntity, (await getLevelContext(studentEntity, level1, db)).level, db);
    expect(stateAfter.linkUnlocked).toBe(true);

    const correct = await correctOptionId("Which structure?");
    const second = await submitAssessment(
      studentEntity,
      {
        levelId: level1,
        phase: "BEFORE",
        answers: [{ questionId: state.phases[0]!.questions[0]!.id, selectedOptionIds: [correct] }],
      },
      db,
    );
    expect(second.passed).toBe(true);
  });
});

describe("submission review and unlocking", () => {
  it("records a manual submission and unlocks the next level without awarding verified points", async () => {
    const { student } = await authenticateStudent("CS/01", "secret123", { db });
    const studentEntity = await studentRow(student.id);

    const submission = await createSubmission(
      studentEntity,
      {
        levelId: level1,
        submissionUrl: "https://leetcode.com/problems/two-sum/submissions/1/",
        sourceCode: "def solution(): pass",
      },
      { db },
    );
    expect(submission.status).toBe("PENDING_REVIEW");

    const levels = await getStudentLevels(studentEntity, db);
    expect(levels[0]!.status).toBe("COMPLETED");
    expect(levels[1]!.status).toBe("UNLOCKED");

    // Verified level points are NOT yet awarded for pending submission (only the 1pt from conceptual assessment)
    const summary = await getProgressSummary(db, studentEntity);
    expect(summary.totalPoints).toBe(1);
  });

  it("approves a submission, completes the level and unlocks the next", async () => {
    const { student } = await authenticateStudent("CS/01", "secret123", { db });
    const studentEntity = await studentRow(student.id);
    const queue = await listSubmissionsForReview(contestId, {}, db);
    expect(queue.length).toBeGreaterThan(0);

    await reviewSubmission(adminId, queue[0]!.id, "APPROVED", "Looks good", { db });

    const levels = await getStudentLevels(studentEntity, db);
    expect(levels[0]!.status).toBe("COMPLETED");
    expect(levels[1]!.status).toBe("UNLOCKED");

    // Duplicate scoring must not occur.
    const summaryBefore = await getProgressSummary(db, studentEntity);
    await reviewSubmission(adminId, queue[0]!.id, "APPROVED", "again", { db }).catch(() => undefined);
    const summaryAfter = await getProgressSummary(db, studentEntity);
    expect(summaryAfter.totalPoints).toBe(summaryBefore.totalPoints);
    expect(summaryBefore.totalPoints).toBeGreaterThan(0);
  });

  it("allows resubmission after a rejection", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Carol First",
        rollNumber: "CS03",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/carol_lc/",
        password: "secret123",
      },
      { db },
    );
    const studentEntity = await studentRow(student.id);
    const first = await createSubmission(
      studentEntity,
      {
        levelId: level1,
        submissionUrl: "https://leetcode.com/problems/two-sum/submissions/101/",
        sourceCode: "def solution(): pass",
        note: "attempt 1",
      },
      { db },
    );
    await reviewSubmission(adminId, first.id, "REJECTED", "Not eligible", { db });

    const second = await createSubmission(
      studentEntity,
      {
        levelId: level1,
        submissionUrl: "https://leetcode.com/problems/two-sum/submissions/102/",
        sourceCode: "def solution(): pass",
        note: "attempt 2",
      },
      { db },
    );
    expect(second.status).toBe("PENDING_REVIEW");
    expect(second.id).not.toBe(first.id);
  });
});

describe("leaderboard and progress", () => {
  it("ranks students by verified points", async () => {
    const contest = await getActiveContest(db);
    const board = await getLeaderboard(contest!, 1, {}, db);
    expect(board.length).toBeGreaterThan(0);
    expect(board[0]!.totalPoints).toBeGreaterThanOrEqual(board[board.length - 1]!.totalPoints);
    expect(board[0]!.displayId).toMatch(/\*{3}/);
  });

  it("resets progress back to the starting state", async () => {
    const { student } = await authenticateStudent("CS/01", "secret123", { db });
    const studentEntity = await studentRow(student.id);
    await resetStudentProgress(db, studentEntity);
    const summary = await getProgressSummary(db, studentEntity);
    expect(summary.totalPoints).toBe(0);
    expect(summary.levelsCompleted).toBe(0);
    const levels = await getStudentLevels(studentEntity, db);
    expect(levels[0]!.status).toBe("UNLOCKED");
  });
});
