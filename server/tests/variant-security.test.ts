/**
 * Conceptual question variant security tests.
 *
 * Verifies:
 *  1. The variant selected for a student is stable across multiple reads.
 *  2. Two students with different IDs may receive different variants.
 *  3. Submitting answers using a variant question NOT shown to the student
 *     is rejected (wrong question ID → graded as incorrect, not accepted).
 *  4. Submitting the correct answer to a hidden variant earns zero points.
 *  5. The grading outcome exactly matches the variant that was shown.
 *  6. selectVariantQuestions is deterministic for identical inputs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/types";
import type { LevelRow, StudentRow } from "@/lib/types";
import { getAssessmentState, selectVariantQuestions, submitAssessment } from "@/lib/services/assessments";
import { registerStudent } from "@/lib/services/students";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { createContestRecord, createLevelRecord, createTrackRecord } from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

let test: TestDb;
let db: Db;
let contestId: string;
let levelId: string;
let levelRow: LevelRow;

// IDs of questions in the variant group "sec-g1"
let variantAId: string;
let variantBId: string;
// ID of a standalone (non-grouped) question
let standaloneId: string;

async function getStudent(id: string): Promise<StudentRow> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0]!;
}

async function correctOptionFor(questionId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from answer_options where question_id = $1 and is_correct = true limit 1",
    [questionId],
  );
  return rows[0]!.id;
}

async function _wrongOptionFor(questionId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from answer_options where question_id = $1 and is_correct = false limit 1",
    [questionId],
  );
  return rows[0]!.id;
}

async function insertVariantQuestion(
  group: string | null,
  orderIndex: number,
  label: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into conceptual_questions
       (level_id, question_text, question_type, phase, order_index, points, correct_text, explanation, variant_group, is_active)
     values ($1, $2, 'SINGLE_CHOICE', 'BEFORE', $3, 5, null, '', $4, true)
     returning id`,
    [levelId, label, orderIndex, group],
  );
  const qId = rows[0]!.id;
  await db.query(
    `insert into answer_options (question_id, option_text, is_correct, order_index)
     values ($1, 'correct', true, 0), ($1, 'wrong', false, 1)`,
    [qId],
  );
  return qId;
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;

  contestId = await createContestRecord(db, "variant-security");
  const trackId = await createTrackRecord(db, contestId, 1);
  levelId = await createLevelRecord(db, trackId, {
    levelNumber: 1,
    isStarting: true,
    assessmentMode: "BEFORE",
  });

  // Two variants in group "sec-g1", one standalone.
  variantAId = await insertVariantQuestion("sec-g1", 0, "Variant A");
  variantBId = await insertVariantQuestion("sec-g1", 1, "Variant B");
  standaloneId = await insertVariantQuestion(null, 2, "Standalone Q");

  const { rows } = await db.query<LevelRow>("select * from levels where id = $1", [levelId]);
  levelRow = rows[0]!;
});

afterAll(() => test.close());

describe("variant determinism", () => {
  it("shows the same variant on every subsequent read for the same student", async () => {
    const { student } = await registerStudent(
      { fullName: "Det Student", rollNumber: "VS001", year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/vs001/", password: "secret123" },
      { db },
    );
    const entity = await getStudent(student.id);

    const reads = await Promise.all(
      Array.from({ length: 5 }, () => getAssessmentState(entity, levelRow, db)),
    );
    const ids = reads.map((s) =>
      s.phases.find((p) => p.phase === "BEFORE")!.questions.map((q) => q.id).sort().join(","),
    );
    // All five reads must produce exactly the same question IDs.
    expect(new Set(ids).size).toBe(1);
  });

  it("includes exactly one variant from the group plus the standalone question", async () => {
    const { student } = await registerStudent(
      { fullName: "Count Student", rollNumber: "VS002", year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/vs002/", password: "secret123" },
      { db },
    );
    const entity = await getStudent(student.id);
    const state = await getAssessmentState(entity, levelRow, db);
    const before = state.phases.find((p) => p.phase === "BEFORE")!;

    const variantQs  = before.questions.filter((q) => q.id === variantAId || q.id === variantBId);
    const standalone = before.questions.filter((q) => q.id === standaloneId);
    expect(variantQs).toHaveLength(1);
    expect(standalone).toHaveLength(1);
    expect(before.questions).toHaveLength(2);
  });

  it("two different students may receive different variants from the same group", async () => {
    // Register enough students to make it statistically certain that both
    // variants are assigned (with 2 variants and 20 students, the probability
    // of getting only one variant is 2 * (0.5)^20 ≈ 0.000002).
    const studentIds: string[] = [];
    for (let i = 3; i <= 22; i++) {
      const roll = `VS0${i.toString().padStart(2, "0")}`;
      const { student } = await registerStudent(
        { fullName: `Diversity ${i}`, rollNumber: roll, year: 1,
          leetcodeProfileUrl: `https://leetcode.com/u/${roll.toLowerCase()}/`, password: "secret123" },
        { db },
      );
      studentIds.push(student.id);
    }

    const assignedVariants = new Set<string>();
    for (const sid of studentIds) {
      const entity = await getStudent(sid);
      const s = await getAssessmentState(entity, levelRow, db);
      const before = s.phases.find((p) => p.phase === "BEFORE")!;
      const varQ = before.questions.find((q) => q.id === variantAId || q.id === variantBId);
      if (varQ) assignedVariants.add(varQ.id);
    }
    // With 20 students both variants should be seen.
    expect(assignedVariants.size).toBe(2);
  });
});

describe("variant manipulation resistance", () => {
  it("grading only scores the variant that was shown (not the hidden one)", async () => {
    const { student } = await registerStudent(
      { fullName: "Grading Student", rollNumber: "VS030", year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/vs030/", password: "secret123" },
      { db },
    );
    const entity = await getStudent(student.id);
    const s = await getAssessmentState(entity, levelRow, db);
    const before = s.phases.find((p) => p.phase === "BEFORE")!;

    // Identify shown vs hidden variant.
    const shownVariant = before.questions.find((q) => q.id === variantAId || q.id === variantBId)!;
    const hiddenVariantId = shownVariant.id === variantAId ? variantBId : variantAId;

    // Answer ALL shown questions correctly.
    const answers = [];
    for (const q of before.questions) {
      answers.push({ questionId: q.id, selectedOptionIds: [await correctOptionFor(q.id)] });
    }
    const result = await submitAssessment(entity, { levelId, phase: "BEFORE", answers }, db);

    // Score should equal points for shown questions only (not the hidden variant).
    expect(result.score).toBe(result.maxScore);
    // maxScore must only include shown questions (2 × 5 pts = 10).
    expect(result.maxScore).toBe(10);
    void hiddenVariantId;
  });

  it("submitting an answer for the hidden variant question ID is rejected or ignored", async () => {
    const { student } = await registerStudent(
      { fullName: "Cheater Student", rollNumber: "VS031", year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/vs031/", password: "secret123" },
      { db },
    );
    const entity = await getStudent(student.id);
    const s = await getAssessmentState(entity, levelRow, db);
    const before = s.phases.find((p) => p.phase === "BEFORE")!;

    const shownVariant = before.questions.find((q) => q.id === variantAId || q.id === variantBId)!;
    const hiddenVariantId = shownVariant.id === variantAId ? variantBId : variantAId;

    // Attempt: answer only the HIDDEN variant question (not the shown one).
    const cheatingAnswers = [
      {
        questionId: hiddenVariantId,
        selectedOptionIds: [await correctOptionFor(hiddenVariantId)],
      },
      // Provide the standalone question correctly too.
      {
        questionId: standaloneId,
        selectedOptionIds: [await correctOptionFor(standaloneId)],
      },
    ];

    // The grading service should either reject this (throw) or score it
    // with 0 for the manipulated variant question. Either outcome is secure.
    let result: { score: number; maxScore: number; passed: boolean } | undefined;
    try {
      result = await submitAssessment(
        entity, { levelId, phase: "BEFORE", answers: cheatingAnswers }, db,
      );
    } catch {
      // Rejected outright → secure outcome.
      result = undefined;
    }

    if (result !== undefined) {
      // If not rejected, the hidden variant's answer must NOT be credited.
      // Only the standalone question (5 pts) should be scored; the
      // manipulated variant answer should not add to the score.
      expect(result.score).toBeLessThanOrEqual(5);
    }
  });

  it("selectVariantQuestions is pure and deterministic for identical inputs", () => {
    const fakeQuestions = [
      { id: "q-a", variant_group: "g1", order_index: 0, question_type: "SINGLE_CHOICE" },
      { id: "q-b", variant_group: "g1", order_index: 1, question_type: "SINGLE_CHOICE" },
      { id: "q-c", variant_group: null,  order_index: 2, question_type: "SINGLE_CHOICE" },
    ] as Parameters<typeof selectVariantQuestions>[0];

    const r1 = selectVariantQuestions(fakeQuestions, "student-123", "level-456", "BEFORE");
    const r2 = selectVariantQuestions(fakeQuestions, "student-123", "level-456", "BEFORE");
    const r3 = selectVariantQuestions(fakeQuestions, "student-123", "level-456", "BEFORE");

    // All three calls must return exactly the same question IDs.
    expect(r1.map((q) => q.id)).toEqual(r2.map((q) => q.id));
    expect(r2.map((q) => q.id)).toEqual(r3.map((q) => q.id));
    // Exactly one variant + one standalone.
    expect(r1).toHaveLength(2);
  });

  it("selectVariantQuestions picks a different variant for a different student", () => {
    const fakeQuestions = [
      { id: "q-a", variant_group: "g1", order_index: 0 },
      { id: "q-b", variant_group: "g1", order_index: 1 },
    ] as Parameters<typeof selectVariantQuestions>[0];

    // Collect which variant each of 100 pseudo-random student IDs would get.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const chosen = selectVariantQuestions(fakeQuestions, `student-${i}`, "level-X", "BEFORE");
      seen.add(chosen[0]!.id);
    }
    // With 100 student IDs both variants must appear.
    expect(seen.size).toBe(2);
  });
});
