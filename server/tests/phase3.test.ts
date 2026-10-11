import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/types";
import {
  getAssessmentState,
  submitAssessment,
} from "@/lib/services/assessments";
import {
  updateLevel,
  updateStudentIdentity,
  verifyStudentIdentity,
} from "@/lib/services/admin";
import {
  detectDuplicateSubmissionUrl,
  detectOutsideWindow,
  detectRapidCompletion,
  listFlags,
  resolveFlag,
} from "@/lib/services/flags";
import { getStudentLevels } from "@/lib/services/progression";
import {
  createSubmission,
  listSubmissionsForReview,
} from "@/lib/services/submissions";
import { registerStudent } from "@/lib/services/students";
import type { ContestRow, StudentRow } from "@/lib/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createAdminRecord,
  createLevelRecord,
  createTrackRecord,
} from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

let test: TestDb;
let db: Db;
let contestId: string;
let track1: string;
let track2: string;
let level1: string;
let level2: string;
let level3: string;
let level4: string;
let adminId: string;

async function studentEntity(id: string): Promise<StudentRow> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0]!;
}

async function insertQuestion(options: {
  levelId: string;
  text: string;
  variantGroup: string | null;
  correctOptionId?: boolean;
  correctText?: string | null;
}): Promise<string> {
  const inserted = await db.query<{ id: string }>(
    `insert into conceptual_questions
       (level_id, question_text, question_type, phase, order_index, points, correct_text, explanation, variant_group, is_active)
     values ($1,$2,'SINGLE_CHOICE','BEFORE',0,5,$3,'',$4,true)
     returning id`,
    [options.levelId, options.text, options.correctText ?? null, options.variantGroup],
  );
  const questionId = inserted.rows[0]!.id;
  await db.query(
    `insert into answer_options (question_id, option_text, is_correct, order_index)
     values ($1, 'correct', true, 0), ($1, 'wrong', false, 1)`,
    [questionId],
  );
  return questionId;
}

async function correctOptionId(questionId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from answer_options where question_id = $1 and is_correct = true limit 1",
    [questionId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;

  const { rows } = await db.query<{ id: string }>(
    `insert into contests
       (slug, name, timezone, registration_open, is_active, verification_mode, start_at, end_at)
     values ('phase3', 'LeetCode Marathon Test', 'Asia/Kolkata', true, true, 'MANUAL',
             now() - interval '1 hour', now() + interval '1 hour')
     returning id`,
  );
  contestId = rows[0]!.id;

  track1 = await createTrackRecord(db, contestId, 1);
  track2 = await createTrackRecord(db, contestId, 2);
  await db.query("update contest_tracks set is_active = true where id in ($1,$2)", [track1, track2]);

  level1 = await createLevelRecord(db, track1, {
    levelNumber: 1,
    isStarting: true,
    points: 10,
    problemSlug: "two-sum",
    assessmentMode: "BEFORE",
  });
  await db.query("update levels set teaser = $2 where id = $1", [
    level1,
    "Given numbers and a target, can you spot the pair?",
  ]);
  level2 = await createLevelRecord(db, track1, {
    levelNumber: 2,
    points: 20,
    problemSlug: "valid-parentheses",
  });
  await db.query("update levels set teaser = $2 where id = $1", [level2, "Secret future teaser"]);
  level3 = await createLevelRecord(db, track1, {
    levelNumber: 3,
    points: 30,
    problemSlug: "roman-to-integer",
  });
  level4 = await createLevelRecord(db, track1, {
    levelNumber: 4,
    points: 40,
    problemSlug: "add-binary",
  });

  adminId = await createAdminRecord(db);
});

afterAll(async () => {
  await test.close();
});

describe("future-level withholding", () => {
  it("hides titles, teasers, and problem links for locked levels but not unlocked ones", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Hide Me",
        rollNumber: "P3001",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/p3001/",
        password: "secret123",
      },
      { db },
    );
    const levels = await getStudentLevels(await studentEntity(student.id), db);
    const unlocked = levels.find((l) => l.levelNumber === 1)!;
    const locked = levels.find((l) => l.levelNumber === 2)!;

    expect(unlocked.hidden).toBe(false);
    expect(unlocked.title).toBe("Level 1");
    expect(unlocked.teaser).toContain("target");
    expect(unlocked.problem?.slug).toBe("two-sum");

    expect(locked.hidden).toBe(true);
    expect(locked.title).toBe("Level 2");
    expect(locked.teaser).toBe("");
    expect(locked.problem).toBeNull();
  });
});

describe("conceptual question variants", () => {
  it("shows exactly one variant per group plus ungrouped questions", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Variant One",
        rollNumber: "P3002",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/p3002/",
        password: "secret123",
      },
      { db },
    );
    await insertQuestion({ levelId: level1, text: "Variant A", variantGroup: "g1" });
    await insertQuestion({ levelId: level1, text: "Variant B", variantGroup: "g1" });
    await insertQuestion({ levelId: level1, text: "Standalone", variantGroup: null });

    const entity = await studentEntity(student.id);
    const levelRow = (
      await db.query<{ id: string }>("select * from levels where id = $1", [level1])
    ).rows[0];
    void levelRow;

    const assessment = await getAssessmentState(entity, await loadLevel(), db);
    const before = assessment.phases.find((p) => p.phase === "BEFORE")!;
    const variantCount = before.questions.filter((q) => q.text.startsWith("Variant")).length;
    const standaloneCount = before.questions.filter((q) => q.text === "Standalone").length;
    expect(variantCount).toBe(1);
    expect(standaloneCount).toBe(1);
  });

  it("grades only the variant shown to the student", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Variant Two",
        rollNumber: "P3003",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/p3003/",
        password: "secret123",
      },
      { db },
    );
    const entity = await studentEntity(student.id);
    const level = await loadLevel();
    const before = (await getAssessmentState(entity, level, db)).phases.find(
      (p) => p.phase === "BEFORE",
    )!;

    expect(before.questions.length).toBe(2);
    const answers = [];
    for (const question of before.questions) {
      answers.push({
        questionId: question.id,
        selectedOptionIds: [await correctOptionId(question.id)],
      });
    }

    const result = await submitAssessment(
      entity,
      { levelId: level1, phase: "BEFORE", answers },
      db,
    );
    expect(result.passed).toBe(true);
    // 2 shown questions x 5 points each - the hidden variant is never graded.
    expect(result.maxScore).toBe(10);
    expect(result.score).toBe(10);
  });

  it("selects the same variant deterministically for a given student and level", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Variant Determinism",
        rollNumber: "P3006",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/p3006/",
        password: "secret123",
      },
      { db },
    );
    const entity = await studentEntity(student.id);
    const level = await loadLevel();

    const first = (await getAssessmentState(entity, level, db)).phases.find(
      (p) => p.phase === "BEFORE",
    )!;
    const second = (await getAssessmentState(entity, level, db)).phases.find(
      (p) => p.phase === "BEFORE",
    )!;

    expect(first.questions.map((q) => q.id)).toEqual(second.questions.map((q) => q.id));
    expect(first.questions.filter((q) => q.text.startsWith("Variant"))).toHaveLength(1);
  });
});

async function loadLevel() {
  const { rows } = await db.query<import("@/lib/types").LevelRow>(
    "select * from levels where id = $1",
    [level1],
  );
  return rows[0]!;
}

describe("integrity acknowledgment", () => {
  it("stores the acknowledgment timestamp when the flag is sent", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Integrity Yes",
        rollNumber: "P3004",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/p3004/",
        password: "secret123",
        acceptIntegrity: true,
      },
      { db },
    );
    const entity = await studentEntity(student.id);
    expect(entity.integrity_accepted_at).not.toBeNull();
  });

  it("leaves the acknowledgment empty when the flag is omitted", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Integrity No",
        rollNumber: "P3005",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/p3005/",
        password: "secret123",
      },
      { db },
    );
    const entity = await studentEntity(student.id);
    expect(entity.integrity_accepted_at).toBeNull();
  });
});

describe("suspicious activity flags", () => {
  it("flags a duplicate submission link shared across students", async () => {
    const a = (
      await registerStudent(
        {
          fullName: "Dup A",
          rollNumber: "P3010",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3010/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const b = (
      await registerStudent(
        {
          fullName: "Dup B",
          rollNumber: "P3011",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3011/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const url = "https://leetcode.com/problems/two-sum/submissions/999/";

    const subA = await createSubmission(await studentEntity(a.id), { levelId: level1, submissionUrl: url }, { db });
    await createSubmission(await studentEntity(b.id), { levelId: level1, submissionUrl: url }, { db });

    const flags = await listFlags(contestId, { openOnly: true }, db);
    const dup = flags.find((f) => f.kind === "DUPLICATE_SUBMISSION_URL");
    expect(dup).toBeTruthy();
    expect(dup!.severity).toBe("HIGH");

    const resolved = await resolveFlag(adminId, dup!.id, db);
    expect(resolved.resolved_at).not.toBeNull();
    void subA;
  });

  it("flags evidence reported outside the contest window", async () => {
    const student = (
      await registerStudent(
        {
          fullName: "Late",
          rollNumber: "P3012",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3012/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const submission = await createSubmission(
      await studentEntity(student.id),
      { levelId: level1, submissionUrl: "https://leetcode.com/problems/two-sum/submissions/777/" },
      { db },
    );
    const { rows } = await db.query<ContestRow>("select * from contests where id = $1", [contestId]);
    const contest = { ...rows[0]!, end_at: new Date(Date.now() - 60_000).toISOString() };
    await detectOutsideWindow(contest, student.id, level1, submission.id, db);
    const flags = await listFlags(contestId, { openOnly: true }, db);
    expect(flags.some((f) => f.kind === "SUBMISSION_OUTSIDE_WINDOW")).toBe(true);
  });

  it("flags several completions within a short interval", async () => {
    const student = (
      await registerStudent(
        {
          fullName: "Speedy",
          rollNumber: "P3013",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3013/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    for (const levelId of [level2, level3, level4]) {
      await db.query(
        `insert into student_level_progress (student_id, level_id, status, completed_at)
         values ($1, $2, 'COMPLETED', now())
         on conflict (student_id, level_id)
         do update set status = 'COMPLETED', completed_at = now()`,
        [student.id, levelId],
      );
    }
    await detectRapidCompletion(contestId, student.id, level1, db);
    const flags = await listFlags(contestId, { openOnly: true }, db);
    expect(flags.some((f) => f.kind === "RAPID_LEVEL_COMPLETION")).toBe(true);
  });

  it("does not create duplicate open flags for the same signal", async () => {
    const other = (
      await registerStudent(
        {
          fullName: "Repeat Anchor",
          rollNumber: "P3014",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3014/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const target = (
      await registerStudent(
        {
          fullName: "Repeat Target",
          rollNumber: "P3015",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3015/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const url = "https://leetcode.com/problems/two-sum/submissions/222/";
    await createSubmission(await studentEntity(other.id), { levelId: level1, submissionUrl: url }, { db });
    const targetSubmission = await createSubmission(
      await studentEntity(target.id),
      { levelId: level1, submissionUrl: "https://leetcode.com/problems/two-sum/submissions/333/" },
      { db },
    );

    await detectDuplicateSubmissionUrl(contestId, target.id, targetSubmission.id, url, level1, db);
    await detectDuplicateSubmissionUrl(contestId, target.id, targetSubmission.id, url, level1, db);

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from suspicious_flags
        where student_id = $1 and kind = 'DUPLICATE_SUBMISSION_URL'`,
      [target.id],
    );
    expect(rows[0]!.count).toBe(1);
  });
});

describe("admin identity management", () => {
  it("corrects identity, clears verification, and records a flag and audit entry", async () => {
    const student = (
      await registerStudent(
        {
          fullName: "Identity Person",
          rollNumber: "P3020",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3020/",
          password: "secret123",
        },
        { db },
      )
    ).student;

    await db.query("update students set identity_verified_at = now() where id = $1", [student.id]);

    const updated = await updateStudentIdentity(
      adminId,
      {
        studentId: student.id,
        year: 2,
        leetcodeProfileUrl: "https://leetcode.com/u/p3020new/",
      },
      db,
    );
    expect(updated.year).toBe(2);
    expect(updated.identity_verified_at).toBeNull();

    const flags = await listFlags(contestId, { openOnly: true }, db);
    expect(flags.some((f) => f.kind === "IDENTITY_CHANGED")).toBe(true);

    const audit = await db.query<{ count: number }>(
      "select count(*)::int as count from audit_logs where action = 'student.identity.update'",
    );
    expect(audit.rows[0]!.count).toBeGreaterThanOrEqual(1);
  });

  it("marks a linked identity as verified", async () => {
    const student = (
      await registerStudent(
        {
          fullName: "Verify Person",
          rollNumber: "P3021",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3021/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const verified = await verifyStudentIdentity(adminId, student.id, db);
    expect(verified.identity_verified_at).not.toBeNull();
    expect(verified.identity_verified_by).toBe(adminId);
  });

  it("rejects a LeetCode identity already used by another student", async () => {
    const existing = (
      await registerStudent(
        {
          fullName: "Original",
          rollNumber: "P3022",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3022/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    const other = (
      await registerStudent(
        {
          fullName: "Other",
          rollNumber: "P3023",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/p3023/",
          password: "secret123",
        },
        { db },
      )
    ).student;
    void existing;
    await expect(
      updateStudentIdentity(
        adminId,
        { studentId: other.id, leetcodeProfileUrl: "https://leetcode.com/u/p3022/" },
        db,
      ),
    ).rejects.toThrowError(/already linked/i);
  });
});

describe("admin content and export", () => {
  it("persists an edited challenge teaser", async () => {
    const updated = await updateLevel(adminId, { id: level2, teaser: "A brand new teaser" }, db);
    expect(updated.teaser).toBe("A brand new teaser");
  });

  it("lists submissions across every status when no status filter is given", async () => {
    const all = await listSubmissionsForReview(contestId, {}, db);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const rejectedOnly = await listSubmissionsForReview(contestId, { status: "REJECTED" }, db);
    expect(rejectedOnly.every((row) => row.status === "REJECTED")).toBe(true);
  });
});
