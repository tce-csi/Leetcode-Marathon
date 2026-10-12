import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/types";
import type { LevelRow, StudentRow } from "@/lib/types";
import { registerStudent } from "@/lib/services/students";
import { getProgressSummary } from "@/lib/services/progression";
import {
  getAssessmentState,
  submitAssessment,
  getAttemptsForStudent,
  updateAssessmentReviewNote,
} from "@/lib/services/assessments";
import { createSubmission, reviewSubmission } from "@/lib/services/submissions";
import { getStudentProfile } from "@/lib/services/student-profile";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createAdminRecord,
  createLevelRecord,
  createTrackRecord,
} from "./helpers/factories";

/**
 * One-submission quiz policy + Short Text Answer question type.
 *
 * Covers: character bounds, validate-before-insert (invalid answers never consume
 * the single submission), immutable submissions (identical-payload idempotency,
 * changed-payload conflict, DB-level partial unique index), text answers as
 * never-auto-graded evidence, the progression reconciliation (a single submitted
 * — even non-passing — attempt satisfies the level's assessment gate so a student
 * can never be permanently stuck, while quiz points are still only awarded on a
 * pass), BOTH-phase gating, the post-finalize lock, and admin visibility with a
 * non-destructive review note.
 */
let test: TestDb;
let db: Db;
let contestId: string;
let track: string;
let levelText: string;
let levelMcq: string;
let levelMixed: string;
let levelBoth: string;
let adminId: string;

async function studentOf(id: string): Promise<StudentRow> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0]!;
}

async function levelOf(levelId: string): Promise<LevelRow> {
  const { rows } = await db.query<LevelRow>("select * from levels where id = $1", [levelId]);
  return rows[0]!;
}

async function correctOptionId(questionId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from answer_options where question_id = $1 and is_correct = true limit 1",
    [questionId],
  );
  return rows[0]!.id;
}

async function beforeQuestions(student: StudentRow, levelId: string) {
  const level = await levelOf(levelId);
  const state = await getAssessmentState(student, level, db);
  return { state, questions: state.phases.find((p) => p.phase === "BEFORE")!.questions };
}

let rollSequence = 0;
async function freshStudent(year: 1 | 2 = 1): Promise<StudentRow> {
  rollSequence += 1;
  const roll = `QZ${String(rollSequence).padStart(3, "0")}`;
  const { student } = await registerStudent(
    {
      fullName: `Quiz Student ${roll}`,
      rollNumber: roll,
      year,
      leetcodeProfileUrl: `https://leetcode.com/u/qz-${roll}`,
      password: "secret123",
    },
    { db },
  );
  return studentOf(student.id);
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;

  const { rows } = await db.query<{ id: string }>(
    `insert into contests
       (slug, name, timezone, registration_open, is_active, verification_mode, start_at, end_at)
     values ('one-sub-quiz', 'One-Submission Quiz Test', 'Asia/Kolkata', true, true, 'MANUAL',
             now() - interval '1 hour', now() + interval '1 hour')
     returning id`,
  );
  contestId = rows[0]!.id;
  track = await createTrackRecord(db, contestId, 1);
  await db.query("update contest_tracks set is_active = true where id = $1", [track]);

  // Each scenario level is independently `is_starting` so every scenario student
  // (year 1, same track) starts unlocked at their target level.
  levelText = await createLevelRecord(db, track, {
    levelNumber: 1,
    isStarting: true,
    points: 10,
    problemSlug: "two-sum",
    assessmentMode: "BEFORE",
    requireAssessmentPass: true,
    passingScore: 60,
    questions: [
      {
        text: "Explain your approach for Two Sum.",
        type: "SHORT_TEXT",
        phase: "BEFORE",
        points: 4,
        correctText: "optional reference answer",
        minLength: 5,
        maxLength: 20,
      },
    ],
  });

  levelMcq = await createLevelRecord(db, track, {
    levelNumber: 2,
    isStarting: true,
    points: 10,
    problemSlug: "valid-parentheses",
    assessmentMode: "BEFORE",
    requireAssessmentPass: true,
    passingScore: 60,
    questions: [
      {
        text: "Which structure validates parentheses?",
        type: "SINGLE_CHOICE",
        phase: "BEFORE",
        points: 5,
        options: [
          { text: "Stack", correct: true },
          { text: "Hash Map" },
        ],
      },
    ],
  });

  levelMixed = await createLevelRecord(db, track, {
    levelNumber: 3,
    isStarting: true,
    points: 10,
    problemSlug: "roman-to-integer",
    assessmentMode: "BEFORE",
    requireAssessmentPass: true,
    passingScore: 60,
    questions: [
      {
        text: "What is the value of the symbol 'V' in Roman numerals?",
        type: "SINGLE_CHOICE",
        phase: "BEFORE",
        points: 5,
        options: [
          { text: "5", correct: true },
          { text: "1" },
        ],
      },
      {
        text: "Explain the greedy approach for Roman numerals.",
        type: "SHORT_TEXT",
        phase: "BEFORE",
        points: 3,
        minLength: 10,
      },
    ],
  });

  levelBoth = await createLevelRecord(db, track, {
    levelNumber: 4,
    isStarting: true,
    points: 10,
    problemSlug: "add-binary",
    assessmentMode: "BOTH",
    requireAssessmentPass: true,
    passingScore: 60,
    questions: [
      {
        text: "Which base does binary use?",
        type: "SINGLE_CHOICE",
        phase: "BEFORE",
        points: 5,
        options: [
          { text: "2", correct: true },
          { text: "10" },
        ],
      },
      {
        text: "Why can a carry propagate in binary addition?",
        type: "SHORT_TEXT",
        phase: "AFTER",
        points: 3,
        minLength: 5,
      },
    ],
  });

  adminId = await createAdminRecord(db);
});

afterAll(async () => {
  await test.close();
});

describe("character bounds and validation", () => {
  it("exposes configured bounds on short text and lets choice questions keep options", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelText);
    expect(questions[0]!.type).toBe("SHORT_TEXT");
    expect(questions[0]!.minLength).toBe(5);
    expect(questions[0]!.maxLength).toBe(20);

    const other = await freshStudent();
    const { state, questions: mixedQuestions } = await beforeQuestions(other, levelMixed);
    const textQuestion = mixedQuestions.find((q) => q.type === "SHORT_TEXT")!;
    const choiceQuestion = mixedQuestions.find((q) => q.type === "SINGLE_CHOICE")!;
    expect(textQuestion.minLength).toBe(10);
    expect(textQuestion.maxLength).toBeNull(); // server default (4000) applies
    expect(choiceQuestion.options.length).toBe(2);

    const before = state.phases.find((p) => p.phase === "BEFORE")!;
    expect(before.maxAttempts).toBe(1);
    expect(before.attemptsUsed).toBe(0);
    expect(before.remainingAttempts).toBe(1);
    expect(before.submitted).toBe(false);
  });

  it("rejects blank, too-short, and too-long answers without consuming the submission", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelText);
    const qid = questions[0]!.id;

    await expect(
      submitAssessment(
        student,
        { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "   " }] },
        db,
      ),
    ).rejects.toThrowError(/Answer every question/);

    await expect(
      submitAssessment(
        student,
        { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "abc" }] },
        db,
      ),
    ).rejects.toThrowError(/too short/);

    await expect(
      submitAssessment(
        student,
        { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "x".repeat(25) }] },
        db,
      ),
    ).rejects.toThrowError(/too long/);

    const state = (await beforeQuestions(student, levelText)).state.phases.find(
      (p) => p.phase === "BEFORE",
    )!;
    expect(state.attemptsUsed).toBe(0);
    expect(state.remainingAttempts).toBe(1);

    const result = await submitAssessment(
      student,
      { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "hash maps" }] },
      db,
    );
    expect(result.status).toBe("SUBMITTED");
    expect(result.requiresManualGrading).toBe(true);
  });
});

describe("one immutable submission per phase", () => {
  it("rejects a changed payload once a submission is locked in", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelText);
    const qid = questions[0]!.id;

    const first = await submitAssessment(
      student,
      { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "hash maps" }] },
      db,
    );
    expect(first.passed).toBe(false);

    await expect(
      submitAssessment(
        student,
        { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "binary search" }] },
        db,
      ),
    ).rejects.toThrowError(/already been submitted and cannot be changed/i);

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from assessment_attempts where student_id = $1 and level_id = $2",
      [student.id, levelText],
    );
    expect(rows[0]!.count).toBe(1);

    const attempts = await getAttemptsForStudent(student.id, levelText, db);
    expect(attempts[0]!.attempt.id).toBe(first.attemptId);
    expect(attempts[0]!.attempt.is_submission).toBe(true);
  });

  it("returns the original result when the identical payload is submitted again", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelMixed);
    const mcq = questions.find((q) => q.type === "SINGLE_CHOICE")!;
    const text = questions.find((q) => q.type === "SHORT_TEXT")!;
    const correct = await correctOptionId(mcq.id);

    const first = await submitAssessment(
      student,
      {
        levelId: levelMixed,
        phase: "BEFORE",
        answers: [
          { questionId: mcq.id, selectedOptionIds: [correct] },
          { questionId: text.id, textAnswer: "subtract the biggest numeral first" },
        ],
      },
      db,
    );
    expect(first.requiresManualGrading).toBe(true);

    const retry = await submitAssessment(
      student,
      {
        levelId: levelMixed,
        phase: "BEFORE",
        answers: [
          { questionId: mcq.id, selectedOptionIds: [correct] },
          { questionId: text.id, textAnswer: "  subtract the biggest numeral first  " },
        ],
      },
      db,
    );
    expect(retry.attemptId).toBe(first.attemptId);
    expect(retry.status).toBe(first.status);
    expect(retry.passed).toBe(first.passed);
    expect(retry.score).toBe(first.score);

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from assessment_attempts where student_id = $1 and level_id = $2",
      [student.id, levelMixed],
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("is idempotent for a passed fully-graded submission without double-scoring", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelMcq);
    const qid = questions[0]!.id;
    const correct = await correctOptionId(qid);

    const first = await submitAssessment(
      student,
      { levelId: levelMcq, phase: "BEFORE", answers: [{ questionId: qid, selectedOptionIds: [correct] }] },
      db,
    );
    expect(first.passed).toBe(true);

    const retry = await submitAssessment(
      student,
      { levelId: levelMcq, phase: "BEFORE", answers: [{ questionId: qid, selectedOptionIds: [correct] }] },
      db,
    );
    expect(retry.attemptId).toBe(first.attemptId);
    expect(retry.passed).toBe(true);

    const summary = await getProgressSummary(db, student);
    expect(summary.totalPoints).toBe(5);
  });

  it("blocks a second submission row at the database level while older attempts stay as history", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelMcq);
    const qid = questions[0]!.id;
    const correct = await correctOptionId(qid);

    await submitAssessment(
      student,
      { levelId: levelMcq, phase: "BEFORE", answers: [{ questionId: qid, selectedOptionIds: [correct] }] },
      db,
    );

    // A second is_submission=true row must be rejected by the partial unique index.
    await expect(
      db.query(
        `insert into assessment_attempts
           (student_id, level_id, phase, attempt_number, status, score, max_score, passed, is_submission)
         values ($1, $2, 'BEFORE', 2, 'GRADED', 5, 5, true, true)`,
        [student.id, levelMcq],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    // Older attempts (no submission slot) remain visible as attempt history.
    await db.query(
      `insert into assessment_attempts
         (student_id, level_id, phase, attempt_number, status, score, max_score, passed, graded_at)
       values ($1, $2, 'BEFORE', 3, 'GRADED', 0, 5, false, now())`,
      [student.id, levelMcq],
    );

    const state = (await beforeQuestions(student, levelMcq)).state.phases.find(
      (p) => p.phase === "BEFORE",
    )!;
    expect(state.submitted).toBe(true);
    expect(state.attemptsUsed).toBe(1);
    expect(state.passed).toBe(true);
  });
});

describe("short text answers are evidence, never auto-graded", () => {
  it("stores text answers unclassified with zero points even alongside a correct choice", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelMixed);
    const mcq = questions.find((q) => q.type === "SINGLE_CHOICE")!;
    const text = questions.find((q) => q.type === "SHORT_TEXT")!;
    const correct = await correctOptionId(mcq.id);
    const textAnswer = "always pick the largest numeral that fits";

    const result = await submitAssessment(
      student,
      {
        levelId: levelMixed,
        phase: "BEFORE",
        answers: [
          { questionId: mcq.id, selectedOptionIds: [correct] },
          { questionId: text.id, textAnswer },
        ],
      },
      db,
    );

    expect(result.requiresManualGrading).toBe(true);
    // A submission containing text answers waits for review and never auto-passes.
    expect(result.status).toBe("SUBMITTED");
    expect(result.passed).toBe(false);
    expect(result.score).toBe(5);
    expect(result.maxScore).toBe(8);

    const textGraded = result.answers.find((a) => a.questionId === text.id)!;
    expect(textGraded.isCorrect).toBeNull();
    expect(textGraded.pointsAwarded).toBe(0);

    const { rows } = await db.query<{ is_correct: boolean | null; text_answer: string | null }>(
      "select is_correct, text_answer from assessment_answers where attempt_id = $1 and question_id = $2",
      [result.attemptId, text.id],
    );
    expect(rows[0]!.is_correct).toBeNull();
    expect(rows[0]!.text_answer).toBe(textAnswer);

    const summary = await getProgressSummary(db, student);
    expect(summary.totalPoints).toBe(0);
  });
});

describe("progression reconciliation (a single submission never strands a student)", () => {
  it("completes a short-text level via the coding submission without a quiz pass", async () => {
    const student = await freshStudent();
    const { questions, state: before } = await beforeQuestions(student, levelText);
    const qid = questions[0]!.id;

    const result = await submitAssessment(
      student,
      { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "hash maps" }] },
      db,
    );
    expect(result.passed).toBe(false);

    const after = (await beforeQuestions(student, levelText)).state;
    expect(after.linkUnlocked).toBe(true);
    expect(before.requirePass).toBe(true);

    let progress = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [student.id, levelText],
    );
    expect(progress.rows[0]!.status).not.toBe("COMPLETED");

    const submission = await createSubmission(
      student,
      {
        levelId: levelText,
        submissionUrl: "https://leetcode.com/submissions/detail/9100/",
        sourceCode: "def solution(): pass",
      },
      { db },
    );
    progress = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [student.id, levelText],
    );
    expect(progress.rows[0]!.status).toBe("COMPLETED");

    let summary = await getProgressSummary(db, student);
    expect(summary.totalPoints).toBe(0); // text quiz earned nothing

    await reviewSubmission(adminId, submission.id, "APPROVED", "Looks good", { db });
    summary = await getProgressSummary(db, student);
    expect(summary.totalPoints).toBe(10); // only the coding level points
  });

  it("awards quiz points only when a submission actually passes", async () => {
    const passer = await freshStudent();
    const passerQs = (await beforeQuestions(passer, levelMcq)).questions;
    const correct = await correctOptionId(passerQs[0]!.id);
    const wrongOption = await db.query<{ id: string }>(
      "select id from answer_options where question_id = $1 and is_correct = false limit 1",
      [passerQs[0]!.id],
    );

    const passResult = await submitAssessment(
      passer,
      {
        levelId: levelMcq,
        phase: "BEFORE",
        answers: [{ questionId: passerQs[0]!.id, selectedOptionIds: [correct] }],
      },
      db,
    );
    expect(passResult.passed).toBe(true);

    let summary = await getProgressSummary(db, passer);
    expect(summary.totalPoints).toBe(5);

    const passSubmission = await createSubmission(
      passer,
      {
        levelId: levelMcq,
        submissionUrl: "https://leetcode.com/submissions/detail/9101/",
        sourceCode: "def solution(): pass",
      },
      { db },
    );
    await reviewSubmission(adminId, passSubmission.id, "APPROVED", "ok", { db });
    summary = await getProgressSummary(db, passer);
    expect(summary.totalPoints).toBe(15); // 5 quiz + 10 level

    const failer = await freshStudent();
    const failerQs = (await beforeQuestions(failer, levelMcq)).questions;
    const failResult = await submitAssessment(
      failer,
      {
        levelId: levelMcq,
        phase: "BEFORE",
        answers: [
          { questionId: failerQs[0]!.id, selectedOptionIds: [wrongOption.rows[0]!.id] },
        ],
      },
      db,
    );
    expect(failResult.passed).toBe(false);

    const failSubmission = await createSubmission(
      failer,
      {
        levelId: levelMcq,
        submissionUrl: "https://leetcode.com/submissions/detail/9102/",
        sourceCode: "def solution(): pass",
      },
      { db },
    );
    await reviewSubmission(adminId, failSubmission.id, "APPROVED", "ok", { db });

    const failSummary = await getProgressSummary(db, failer);
    expect(failSummary.totalPoints).toBe(10); // level points only, 0 from the failed quiz
    const failProgress = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [failer.id, levelMcq],
    );
    expect(failProgress.rows[0]!.status).toBe("COMPLETED");
  });
});

describe("phase gating and frozen contests", () => {
  it("completes a BOTH level only once every phase is submitted", async () => {
    const student = await freshStudent();
    const { state } = await beforeQuestions(student, levelBoth);
    const beforePhase = state.phases.find((p) => p.phase === "BEFORE")!;
    const afterPhase = state.phases.find((p) => p.phase === "AFTER")!;
    expect(beforePhase.questions.length).toBe(1);
    expect(afterPhase.questions.length).toBe(1);

    const correct = await correctOptionId(beforePhase.questions[0]!.id);
    await submitAssessment(
      student,
      {
        levelId: levelBoth,
        phase: "BEFORE",
        answers: [
          { questionId: beforePhase.questions[0]!.id, selectedOptionIds: [correct] },
        ],
      },
      db,
    );

    const submission = await createSubmission(
      student,
      {
        levelId: levelBoth,
        submissionUrl: "https://leetcode.com/submissions/detail/9103/",
        sourceCode: "def solution(): pass",
      },
      { db },
    );

    let progress = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [student.id, levelBoth],
    );
    expect(progress.rows[0]!.status).not.toBe("COMPLETED");

    await submitAssessment(
      student,
      {
        levelId: levelBoth,
        phase: "AFTER",
        answers: [
          { questionId: afterPhase.questions[0]!.id, textAnswer: "a carry keeps the sum correct" },
        ],
      },
      db,
    );

    progress = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [student.id, levelBoth],
    );
    expect(progress.rows[0]!.status).toBe("COMPLETED");
    void submission;
  });

  it("blocks new quiz submissions once the student is finalized", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelText);
    const qid = questions[0]!.id;

    await db.query("update students set finalized_at = now() where id = $1", [student.id]);

    await expect(
      submitAssessment(
        student,
        { levelId: levelText, phase: "BEFORE", answers: [{ questionId: qid, textAnswer: "hash maps" }] },
        db,
      ),
    ).rejects.toThrowError(/can no longer be changed/i);
  });
});

describe("admin visibility and review notes", () => {
  it("exposes the locked submission with answers and records a review note without altering them", async () => {
    const student = await freshStudent();
    const { questions } = await beforeQuestions(student, levelMixed);
    const mcq = questions.find((q) => q.type === "SINGLE_CHOICE")!;
    const text = questions.find((q) => q.type === "SHORT_TEXT")!;
    const correct = await correctOptionId(mcq.id);
    const textAnswer = "always pick the largest numeral that fits";

    const result = await submitAssessment(
      student,
      {
        levelId: levelMixed,
        phase: "BEFORE",
        answers: [
          { questionId: mcq.id, selectedOptionIds: [correct] },
          { questionId: text.id, textAnswer },
        ],
      },
      db,
    );

    const profile = await getStudentProfile(contestId, student.id, db);
    expect(profile).not.toBeNull();
    const history = profile!.history.find((h) => h.level.id === levelMixed)!;
    expect(history.assessments.length).toBe(1);
    const submission = history.assessments[0]!;
    expect(submission.attempt.is_submission).toBe(true);
    expect(submission.attempt.status).toBe("SUBMITTED");
    expect(submission.attempt.review_note).toBeNull();

    const textAnswerRendered = submission.answers.find((a) => a.questionId === text.id)!;
    expect(textAnswerRendered.textAnswer).toBe(textAnswer);
    expect(textAnswerRendered.isCorrect).toBeNull();

    const mcqAnswerRendered = submission.answers.find((a) => a.questionId === mcq.id)!;
    expect(mcqAnswerRendered.selectedOptions.map((o) => o.text)).toEqual(["5"]);
    expect(mcqAnswerRendered.isCorrect).toBe(true);

    const updated = await updateAssessmentReviewNote(adminId, result.attemptId, "  Solid write-up  ", db);
    expect(updated.review_note).toBe("Solid write-up");
    expect(updated.reviewed_by).toBe(adminId);
    expect(updated.reviewed_at).not.toBeNull();

    // The student's original answers are untouched by the review note.
    const attempts = await getAttemptsForStudent(student.id, levelMixed, db);
    expect(attempts[0]!.answers.find((a) => a.questionId === text.id)!.textAnswer).toBe(textAnswer);
    expect(attempts[0]!.answers.find((a) => a.questionId === text.id)!.isCorrect).toBeNull();
  });
});