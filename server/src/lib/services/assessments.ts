import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { getLevelContext, evaluateLevelCompletion } from "@/lib/services/progression";
import { awardPoints } from "@/lib/services/scoring";
import type {
  AssessmentAttemptRow,
  AssessmentMode,
  ConceptualQuestionRow,
  LevelRow,
  QuestionPhase,
  QuestionType,
  StudentRow,
} from "@/lib/types";
import type { AssessmentSubmitInput } from "@/lib/validation/assessment";

export interface QuestionOptionView {
  id: string;
  text: string;
}

export interface AssessmentQuestionView {
  id: string;
  text: string;
  type: QuestionType;
  points: number;
  options: QuestionOptionView[];
}

export interface PhaseState {
  phase: QuestionPhase;
  questions: AssessmentQuestionView[];
  attemptsUsed: number;
  maxAttempts: number;
  remainingAttempts: number;
  passed: boolean;
  latestAttempt: {
    id: string;
    score: number;
    maxScore: number;
    passed: boolean;
    status: string;
    submittedAt: string | null;
  } | null;
}

export interface AssessmentState {
  mode: AssessmentMode;
  requirePass: boolean;
  passingScore: number;
  phases: PhaseState[];
  beforeSubmitted: boolean;
  linkUnlocked: boolean;
}

interface QuestionOptionRow {
  option_id: string | null;
  option_text: string | null;
  is_correct: boolean | null;
  option_order: number | null;
}

type QuestionWithOptions = ConceptualQuestionRow & { options: QuestionOptionRow[] };

async function loadQuestions(
  db: Db,
  levelId: string,
  phase: QuestionPhase,
): Promise<QuestionWithOptions[]> {
  const { rows } = await db.query<ConceptualQuestionRow & QuestionOptionRow>(
    `select q.*, o.id as option_id, o.option_text, o.is_correct, o.order_index as option_order
       from conceptual_questions q
       left join answer_options o on o.question_id = q.id
      where q.level_id = $1 and q.phase = $2 and q.is_active = true
      order by q.order_index asc, o.order_index asc`,
    [levelId, phase],
  );
  const byId = new Map<string, QuestionWithOptions>();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      const { option_id: _o, option_text: _t, is_correct: _c, option_order: _oo, ...question } = row;
      byId.set(row.id, { ...(question as ConceptualQuestionRow), options: [] });
    }
    if (row.option_id !== null) {
      byId.get(row.id)!.options.push({
        option_id: row.option_id,
        option_text: row.option_text,
        is_correct: row.is_correct,
        option_order: row.option_order,
      });
    }
  }
  return [...byId.values()];
}

export function phaseAllowed(mode: AssessmentMode, phase: QuestionPhase): boolean {
  if (mode === "BOTH") return true;
  return mode === phase;
}

/** Stable pseudo-random index derived from a string (FNV-1a). */
function variantIndex(seed: string, count: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

/**
 * Chooses one variant per `variant_group`. The choice is deterministic for a
 * given student/level/phase so the questions shown and the questions graded
 * always match, while different students may receive different variants.
 * Questions without a variant group are always included.
 */
export function selectVariantQuestions(
  questions: QuestionWithOptions[],
  studentId: string,
  levelId: string,
  phase: QuestionPhase,
): QuestionWithOptions[] {
  const singles: QuestionWithOptions[] = [];
  const groups = new Map<string, QuestionWithOptions[]>();
  for (const question of questions) {
    if (question.variant_group) {
      const bucket = groups.get(question.variant_group) ?? [];
      bucket.push(question);
      groups.set(question.variant_group, bucket);
    } else {
      singles.push(question);
    }
  }
  const selected = [...singles];
  for (const [group, bucket] of groups) {
    const ordered = [...bucket].sort(
      (a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id),
    );
    const index = variantIndex(`${studentId}:${levelId}:${phase}:${group}`, ordered.length);
    selected.push(ordered[index]!);
  }
  return selected.sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
}

export async function getAssessmentState(
  student: StudentRow,
  level: LevelRow,
  db: Db = getDb(),
): Promise<AssessmentState> {
  const phases: QuestionPhase[] =
    level.assessment_mode === "BOTH"
      ? ["BEFORE", "AFTER"]
      : level.assessment_mode === "NONE"
        ? []
        : [level.assessment_mode];

  const phaseStates: PhaseState[] = [];
  let beforeSubmitted = false;

  for (const phase of phases) {
    const questions = selectVariantQuestions(
      await loadQuestions(db, level.id, phase),
      student.id,
      level.id,
      phase,
    );
    const attempts = await db.query<AssessmentAttemptRow>(
      `select * from assessment_attempts
        where student_id = $1 and level_id = $2 and phase = $3
        order by attempt_number desc`,
      [student.id, level.id, phase],
    );
    const passed = attempts.rows.some((a) => a.status === "GRADED" && a.passed);
    const latest = attempts.rows[0] ?? null;
    const hasSubmitted = attempts.rows.some(
      (a) => a.status === "SUBMITTED" || a.status === "GRADED",
    );
    if (phase === "BEFORE" && hasSubmitted) beforeSubmitted = true;

    phaseStates.push({
      phase,
      questions: questions.map((q) => ({
        id: q.id,
        text: q.question_text,
        type: q.question_type,
        points: q.points,
        options: q.options.map((o) => ({ id: o.option_id!, text: o.option_text! })),
      })),
      attemptsUsed: attempts.rows.length,
      maxAttempts: level.max_attempts,
      remainingAttempts: Math.max(0, level.max_attempts - attempts.rows.length),
      passed,
      latestAttempt: latest
        ? {
            id: latest.id,
            score: latest.score,
            maxScore: latest.max_score,
            passed: latest.passed,
            status: latest.status,
            submittedAt: latest.submitted_at,
          }
        : null,
    });
  }

  const requiresBefore = phaseAllowed(level.assessment_mode, "BEFORE");
  const linkUnlocked = !requiresBefore || beforeSubmitted;

  return {
    mode: level.assessment_mode,
    requirePass: level.require_assessment_pass,
    passingScore: level.passing_score,
    phases: phaseStates,
    beforeSubmitted,
    linkUnlocked,
  };
}

function normalizeShortAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean | null;
  pointsAwarded: number;
  correctOptionIds: string[];
  correctText: string | null;
  explanation: string;
}

export interface SubmitResult {
  attemptId: string;
  status: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  requiresManualGrading: boolean;
  answers: GradedAnswer[];
}

export async function submitAssessment(
  student: StudentRow,
  input: AssessmentSubmitInput,
  db: Db = getDb(),
): Promise<SubmitResult> {
  const { level } = await getLevelContext(student, input.levelId, db);
  if (!phaseAllowed(level.assessment_mode, input.phase)) {
    throw errors.badRequest("This assessment phase is not enabled for this level.");
  }

  const questions = selectVariantQuestions(
    await loadQuestions(db, level.id, input.phase),
    student.id,
    level.id,
    input.phase,
  );
  if (questions.length === 0) {
    throw errors.badRequest("There are no questions for this phase.");
  }

  const attemptsUsed = await db.query<{ count: number }>(
    `select count(*)::int as count from assessment_attempts
      where student_id = $1 and level_id = $2 and phase = $3`,
    [student.id, level.id, input.phase],
  );
  const used = attemptsUsed.rows[0]?.count ?? 0;
  if (used >= level.max_attempts) {
    throw errors.conflict("You have used all of your attempts for this assessment.");
  }

  const answerByQuestion = new Map(input.answers.map((a) => [a.questionId, a]));

  return db.transaction(async (tx) => {
    const attempt = await tx.query<AssessmentAttemptRow>(
      `insert into assessment_attempts
         (student_id, level_id, phase, attempt_number, status, max_score)
       values ($1, $2, $3, $4, 'IN_PROGRESS', $5)
       returning *`,
      [student.id, level.id, input.phase, used + 1, 0],
    );
    const attemptId = attempt.rows[0]!.id;

    let score = 0;
    let maxScore = 0;
    let requiresManual = false;
    const graded: GradedAnswer[] = [];

    for (const question of questions) {
      maxScore += question.points;
      const answer = answerByQuestion.get(question.id);
      const correctOptions = question.options.filter((o) => o.is_correct).map((o) => o.option_id!);
      let isCorrect: boolean | null = false;
      let pointsAwarded = 0;

      if (!answer) {
        isCorrect = false;
      } else if (question.question_type === "SHORT_TEXT") {
        if (question.correct_text) {
          isCorrect =
            normalizeShortAnswer(answer.textAnswer ?? "") ===
            normalizeShortAnswer(question.correct_text);
        } else {
          isCorrect = null;
          requiresManual = true;
        }
      } else if (
        question.question_type === "SINGLE_CHOICE" ||
        question.question_type === "TRUE_FALSE"
      ) {
        const selected = answer.selectedOptionIds ?? [];
        isCorrect = selected.length === 1 && correctOptions.length === 1 && selected[0] === correctOptions[0];
      } else {
        const selected = new Set(answer.selectedOptionIds ?? []);
        const correct = new Set(correctOptions);
        isCorrect =
          selected.size === correct.size && [...selected].every((id) => correct.has(id));
      }

      if (isCorrect === true) pointsAwarded = question.points;
      score += pointsAwarded;

      await tx.query(
        `insert into assessment_answers
           (attempt_id, question_id, selected_option_ids, text_answer, is_correct, points_awarded)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          attemptId,
          question.id,
          answer?.selectedOptionIds ?? [],
          answer?.textAnswer ?? null,
          isCorrect,
          pointsAwarded,
        ],
      );

      graded.push({
        questionId: question.id,
        isCorrect,
        pointsAwarded,
        correctOptionIds: correctOptions,
        correctText: question.correct_text,
        explanation: question.explanation,
      });
    }

    const percent = maxScore === 0 ? 100 : Math.round((score / maxScore) * 100);
    const status = requiresManual ? "SUBMITTED" : "GRADED";
    const passed = !requiresManual && percent >= level.passing_score;

    await tx.query(
      `update assessment_attempts
          set status = $2, score = $3, max_score = $4, passed = $5,
              submitted_at = now(), graded_at = $6
        where id = $1`,
      [attemptId, status, score, maxScore, passed, requiresManual ? null : new Date().toISOString()],
    );

    if (passed) {
      await awardPoints(
        {
          studentId: student.id,
          contestId: student.contest_id,
          levelId: level.id,
          source: "ASSESSMENT",
          points: score,
          reason: `${input.phase} assessment passed on level ${level.level_number}`,
          idempotencyKey: `assessment:${student.id}:${level.id}:${input.phase}`,
        },
        tx,
      );
    }

    await evaluateLevelCompletion(tx, student, level);

    return {
      attemptId,
      status,
      score,
      maxScore,
      percent,
      passed,
      requiresManualGrading: requiresManual,
      answers: graded,
    };
  });
}

export interface AttemptDetail {
  attempt: AssessmentAttemptRow;
  answers: {
    questionId: string;
    questionText: string;
    isCorrect: boolean | null;
    pointsAwarded: number;
  }[];
}

export async function getAttemptsForStudent(
  studentId: string,
  levelId: string,
  db: Db = getDb(),
): Promise<AttemptDetail[]> {
  const attempts = await db.query<AssessmentAttemptRow>(
    `select * from assessment_attempts where student_id = $1 and level_id = $2 order by attempt_number desc`,
    [studentId, levelId],
  );
  const details: AttemptDetail[] = [];
  for (const attempt of attempts.rows) {
    const answers = await db.query<{
      question_id: string;
      question_text: string;
      is_correct: boolean | null;
      points_awarded: number;
    }>(
      `select a.question_id, q.question_text, a.is_correct, a.points_awarded
         from assessment_answers a
         join conceptual_questions q on q.id = a.question_id
        where a.attempt_id = $1
        order by q.order_index asc`,
      [attempt.id],
    );
    details.push({
      attempt,
      answers: answers.rows.map((row) => ({
        questionId: row.question_id,
        questionText: row.question_text,
        isCorrect: row.is_correct,
        pointsAwarded: row.points_awarded,
      })),
    });
  }
  return details;
}

/** Administrator grading of manual (short-text) answers. */
export async function gradeManualAnswers(
  adminId: string,
  attemptId: string,
  decisions: { answerId: string; isCorrect: boolean }[],
  db: Db = getDb(),
): Promise<AssessmentAttemptRow> {
  return db.transaction(async (tx) => {
    const attemptResult = await tx.query<AssessmentAttemptRow>(
      "select * from assessment_attempts where id = $1 for update",
      [attemptId],
    );
    const attempt = attemptResult.rows[0];
    if (!attempt) throw errors.notFound("Attempt not found.");

    const answers = await tx.query<{ id: string; question_id: string; is_correct: boolean | null }>(
      "select id, question_id, is_correct from assessment_answers where attempt_id = $1",
      [attemptId],
    );
    const questionPoints = new Map<string, number>();
    const qRows = await tx.query<{ id: string; points: number }>(
      "select id, points from conceptual_questions where level_id = $1",
      [attempt.level_id],
    );
    for (const q of qRows.rows) questionPoints.set(q.id, q.points);

    const decisionByAnswer = new Map(decisions.map((d) => [d.answerId, d.isCorrect]));
    let score = 0;
    let maxScore = 0;
    for (const answer of answers.rows) {
      const points = questionPoints.get(answer.question_id) ?? 0;
      maxScore += points;
      const decision = decisionByAnswer.get(answer.id);
      if (decision === undefined) {
        if (answer.is_correct === true) score += points;
        continue;
      }
      const awarded = decision ? points : 0;
      await tx.query(
        "update assessment_answers set is_correct = $2, points_awarded = $3 where id = $1",
        [answer.id, decision, awarded],
      );
      score += awarded;
    }

    const level = await tx.query<{ passing_score: number; level_number: number }>(
      "select passing_score, level_number from levels where id = $1",
      [attempt.level_id],
    );
    const passingScore = level.rows[0]?.passing_score ?? 0;
    const percent = maxScore === 0 ? 100 : Math.round((score / maxScore) * 100);
    const passed = percent >= passingScore;

    const updated = await tx.query<AssessmentAttemptRow>(
      `update assessment_attempts
          set status = 'GRADED', score = $2, max_score = $3, passed = $4,
              graded_at = now(), graded_by = $5
        where id = $1 returning *`,
      [attemptId, score, maxScore, passed, adminId],
    );

    if (passed) {
      const student = await tx.query<{ id: string; contest_id: string }>(
        "select id, contest_id from students where id = $1",
        [attempt.student_id],
      );
      if (student.rows[0]) {
        await awardPoints(
          {
            studentId: attempt.student_id,
            contestId: student.rows[0].contest_id,
            levelId: attempt.level_id,
            source: "ASSESSMENT",
            points: score,
            reason: `${attempt.phase} assessment graded on level ${level.rows[0]?.level_number ?? ""}`,
            idempotencyKey: `assessment:${attempt.student_id}:${attempt.level_id}:${attempt.phase}`,
          },
          tx,
        );
      }
    }

    const studentResult = await tx.query<StudentRow>(
      "select * from students where id = $1",
      [attempt.student_id],
    );
    const levelResult = await tx.query<LevelRow>("select * from levels where id = $1", [
      attempt.level_id,
    ]);
    if (studentResult.rows[0] && levelResult.rows[0]) {
      await evaluateLevelCompletion(tx, studentResult.rows[0], levelResult.rows[0]);
    }

    return updated.rows[0]!;
  });
}
