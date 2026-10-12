import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import {
  getLevelContext,
  evaluateLevelCompletion,
  nextRoadmapLevel,
  type RoadmapLevel,
  type TrackLevelSummary,
} from "@/lib/services/progression";
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
  /** Character bounds for SHORT_TEXT questions (null when the server defaults apply). */
  minLength: number | null;
  maxLength: number | null;
}

export interface PhaseState {
  phase: QuestionPhase;
  questions: AssessmentQuestionView[];
  attemptsUsed: number;
  maxAttempts: number;
  remainingAttempts: number;
  passed: boolean;
  /** Whether this phase's single submission is locked in (one-submission policy). */
  submitted: boolean;
  submittedAt: string | null;
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
  const qPhases = await db.query<{ phase: QuestionPhase }>(
    `select distinct phase from conceptual_questions where level_id = $1 and is_active = true`,
    [level.id],
  );
  const activeQuestionPhases = new Set(qPhases.rows.map((r) => r.phase));

  const configuredPhases: QuestionPhase[] =
    level.assessment_mode === "BOTH"
      ? ["BEFORE", "AFTER"]
      : level.assessment_mode === "NONE"
        ? []
        : [level.assessment_mode];

  const phaseSet = new Set<QuestionPhase>([...configuredPhases, ...activeQuestionPhases]);
  const phases: QuestionPhase[] = [];
  if (phaseSet.has("BEFORE")) phases.push("BEFORE");
  if (phaseSet.has("AFTER")) phases.push("AFTER");

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
    const submission = attempts.rows.find((a) => a.is_submission) ?? null;
    const latest = attempts.rows[0] ?? null;
    const hasSubmitted = Boolean(submission);
    if (phase === "BEFORE" && hasSubmitted) beforeSubmitted = true;

    // One-submission policy: `maxAttempts` is always 1. A locked-in submission
    // is permanent (unlike coding submissions there is no unlock/rejection path),
    // so once the single submission exists the phase is exhausted.
    const submitted = hasSubmitted;

    phaseStates.push({
      phase,
      questions: questions.map((q) => ({
        id: q.id,
        text: q.question_text,
        type: q.question_type,
        points: q.points,
        options: q.options.map((o) => ({ id: o.option_id!, text: o.option_text! })),
        minLength: q.min_length,
        maxLength: q.max_length,
      })),
      attemptsUsed: submitted ? 1 : 0,
      maxAttempts: 1,
      remainingAttempts: submitted ? 0 : 1,
      passed,
      submitted,
      submittedAt: submission?.submitted_at ?? null,
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

  const requiresBefore = phases.includes("BEFORE");
  const linkUnlocked = !requiresBefore || beforeSubmitted;

  const effectiveMode: AssessmentMode =
    phases.length === 2 ? "BOTH" : phases.length === 1 ? phases[0]! : level.assessment_mode;

  return {
    mode: effectiveMode,
    requirePass: level.require_assessment_pass,
    passingScore: level.passing_score,
    phases: phaseStates,
    beforeSubmitted,
    linkUnlocked,
  };
}

const SHORT_TEXT_MIN_DEFAULT = 1;
const SHORT_TEXT_MAX_DEFAULT = 4000;

interface IncomingAnswer {
  questionId: string;
  selectedOptionIds?: string[];
  textAnswer?: string;
}

interface StoredAnswerRow {
  question_id: string;
  selected_option_ids: string[] | null;
  text_answer: string | null;
}

/**
 * Validates a full quiz payload BEFORE any attempt row is created, so invalid
 * or incomplete submissions never consume the one allowed submission.
 */
function validateAnswersBeforeSubmit(
  questions: QuestionWithOptions[],
  answerByQuestion: Map<string, IncomingAnswer>,
): void {
  for (const question of questions) {
    const answer = answerByQuestion.get(question.id);
    if (question.question_type === "SHORT_TEXT") {
      const min = question.min_length ?? SHORT_TEXT_MIN_DEFAULT;
      const max = question.max_length ?? SHORT_TEXT_MAX_DEFAULT;
      const text = answer?.textAnswer?.trim() ?? "";
      if (text.length === 0) {
        throw errors.badRequest("Answer every question before submitting.");
      }
      if (text.length < min) {
        throw errors.badRequest(
          `Your answer is too short (minimum ${min} characters).`,
        );
      }
      if (text.length > max) {
        throw errors.badRequest(
          `Your answer is too long (maximum ${max} characters).`,
        );
      }
    } else if (!answer || (answer.selectedOptionIds ?? []).length === 0) {
      throw errors.badRequest("Answer every question before submitting.");
    }
  }
}

/**
 * True when the incoming payload is byte-for-byte (after trimming) identical to
 * the stored submission. Used to make retries of an already-accepted submission
 * idempotent without allowing a changed payload to overwrite the immutable row.
 */
function payloadsMatch(
  stored: StoredAnswerRow[],
  incoming: IncomingAnswer[],
): boolean {
  if (stored.length !== incoming.length) return false;
  const byQuestion = new Map(stored.map((row) => [row.question_id, row]));
  for (const answer of incoming) {
    const row = byQuestion.get(answer.questionId);
    if (!row) return false;
    if ((answer.selectedOptionIds ?? []).length !== (row.selected_option_ids ?? []).length) {
      return false;
    }
    const selected = new Set(row.selected_option_ids ?? []);
    if (!(answer.selectedOptionIds ?? []).every((id) => selected.has(id))) return false;
    if ((answer.textAnswer?.trim() ?? "") !== (row.text_answer?.trim() ?? "")) return false;
  }
  return true;
}

/**
 * Reconstructs the submission result for an already-accepted payload. The
 * submission already fired its points/progression side effects exactly once, so
 * this path only rebuilds the response and re-runs the (idempotent) completion
 * evaluation in case the original response was lost in transit.
 */
async function buildIdempotentResult(
  tx: Db,
  student: StudentRow,
  level: LevelRow,
  questions: QuestionWithOptions[],
  submission: AssessmentAttemptRow,
  trackLevels: TrackLevelSummary[],
  totalLevels: number,
): Promise<SubmitResult> {
  const storedAnswers = await tx.query<{
    question_id: string;
    is_correct: boolean | null;
    points_awarded: number;
  }>(
    "select question_id, is_correct, points_awarded from assessment_answers where attempt_id = $1",
    [submission.id],
  );
  const byQuestion = new Map(storedAnswers.rows.map((r) => [r.question_id, r]));
  let requiresManual = false;
  const answers: GradedAnswer[] = questions.map((question) => {
    const stored = byQuestion.get(question.id);
    const isCorrect = stored?.is_correct ?? null;
    if (isCorrect === null) requiresManual = true;
    return {
      questionId: question.id,
      isCorrect,
      pointsAwarded: stored?.points_awarded ?? 0,
      correctOptionIds: question.options.filter((o) => o.is_correct).map((o) => o.option_id!),
      correctText: question.correct_text,
      explanation: question.explanation,
    };
  });

  const percent =
    submission.max_score === 0 ? 100 : Math.round((submission.score / submission.max_score) * 100);
  const completed = await evaluateLevelCompletion(tx, student, level, {
    trackTotalLevels: totalLevels,
    trackCompletedLevels: trackLevels.filter(
      (t) => t.progress_status === "COMPLETED" && t.id !== level.id,
    ).length,
  });
  const nextLevel = completed ? nextRoadmapLevel(trackLevels, level) : null;

  return {
    attemptId: submission.id,
    status: submission.status,
    score: submission.score,
    maxScore: submission.max_score,
    percent,
    passed: submission.passed,
    requiresManualGrading: requiresManual,
    answers,
    nextLevel,
    completed,
    totalLevels,
  };
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
  nextLevel?: RoadmapLevel | null;
  completed?: boolean;
  totalLevels?: number;
}

export async function submitAssessment(
  student: StudentRow,
  input: AssessmentSubmitInput,
  db: Db = getDb(),
): Promise<SubmitResult> {
  const { level, trackLevels, totalLevels } = await getLevelContext(student, input.levelId, db);
  const qCountResult = await db.query<{ count: number }>(
    `select count(*)::int as count from conceptual_questions where level_id = $1 and phase = $2 and is_active = true`,
    [level.id, input.phase],
  );
  const hasQuestionsForPhase = (qCountResult.rows[0]?.count ?? 0) > 0;
  if (!phaseAllowed(level.assessment_mode, input.phase) && !hasQuestionsForPhase) {
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

  const answerByQuestion = new Map(input.answers.map((a) => [a.questionId, a]));

  // A finalized contest is frozen for review. Checked before payload validation
  // so a frozen student is always told the attempt is locked, regardless of the
  // payload's own validity (and before any attempt row could be created).
  const frozenCheck = await db.query<Pick<StudentRow, "finalized_at">>(
    "select finalized_at from students where id = $1",
    [student.id],
  );
  if (frozenCheck.rows[0]?.finalized_at) {
    throw errors.conflict(
      "This contest has been submitted for review and can no longer be changed.",
    );
  }

  // Validate the full payload before any attempt row exists, so an invalid or
  // incomplete submission never consumes the single allowed attempt.
  validateAnswersBeforeSubmit(questions, answerByQuestion);

  return db.transaction(async (tx) => {
    // A finalized contest is frozen for review — no further assessment attempts.
    const frozen = await tx.query<Pick<StudentRow, "finalized_at">>(
      "select finalized_at from students where id = $1 for update",
      [student.id],
    );
    if (frozen.rows[0]?.finalized_at) {
      throw errors.conflict(
        "This contest has been submitted for review and can no longer be changed.",
      );
    }

    // One-submission slot: at most one is_submission row per (student, level,
    // phase). The row lock on `students` serialises concurrent submissions, and
    // the partial unique index is the final backstop for any path that slips
    // past the check.
    const existing = await tx.query<AssessmentAttemptRow>(
      `select * from assessment_attempts
        where student_id = $1 and level_id = $2 and phase = $3 and is_submission = true
        limit 1`,
      [student.id, level.id, input.phase],
    );
    const submission = existing.rows[0] ?? null;
    if (submission) {
      const stored = await tx.query<StoredAnswerRow>(
        `select question_id, selected_option_ids, text_answer
           from assessment_answers where attempt_id = $1`,
        [submission.id],
      );
      if (payloadsMatch(stored.rows, input.answers)) {
        // Idempotent retry of an already-accepted submission (e.g. a lost
        // network response). Side effects already fired — only the result is
        // rebuilt.
        return buildIdempotentResult(
          tx,
          student,
          level,
          questions,
          submission,
          trackLevels,
          totalLevels,
        );
      }
      throw errors.conflict("This quiz has already been submitted and cannot be changed.");
    }

    const attemptNumberResult = await tx.query<{ max: number }>(
      `select coalesce(max(attempt_number), 0) as max from assessment_attempts
        where student_id = $1 and level_id = $2 and phase = $3`,
      [student.id, level.id, input.phase],
    );
    const attemptNumber = (attemptNumberResult.rows[0]?.max ?? 0) + 1;

    const attempt = await tx.query<AssessmentAttemptRow>(
      `insert into assessment_attempts
         (student_id, level_id, phase, attempt_number, status, max_score)
       values ($1, $2, $3, $4, 'IN_PROGRESS', $5)
       returning *`,
      [student.id, level.id, input.phase, attemptNumber, 0],
    );
    const attemptId = attempt.rows[0]!.id;

    let score = 0;
    let maxScore = 0;
    let requiresManual = false;
    const graded: GradedAnswer[] = [];
    const answerRows: unknown[] = [];

    for (const question of questions) {
      maxScore += question.points;
      const answer = answerByQuestion.get(question.id);
      const correctOptions = question.options.filter((o) => o.is_correct).map((o) => o.option_id!);
      let isCorrect: boolean | null = false;
      let pointsAwarded = 0;

      if (question.question_type === "SHORT_TEXT") {
        // Short text answers are evidence for the organisers. They are never
        // auto-classified as correct/incorrect (no keyword matching, no AI
        // grading), so they always await manual review and award no points here.
        isCorrect = null;
        requiresManual = true;
      } else if (
        question.question_type === "SINGLE_CHOICE" ||
        question.question_type === "TRUE_FALSE"
      ) {
        const selected = answer?.selectedOptionIds ?? [];
        isCorrect = selected.length === 1 && correctOptions.length === 1 && selected[0] === correctOptions[0];
      } else {
        const selected = new Set(answer?.selectedOptionIds ?? []);
        const correct = new Set(correctOptions);
        isCorrect =
          selected.size === correct.size && [...selected].every((id) => correct.has(id));
      }

      if (isCorrect === true) pointsAwarded = question.points;
      score += pointsAwarded;

      answerRows.push(
        attemptId,
        question.id,
        answer?.selectedOptionIds ?? [],
        answer?.textAnswer ?? null,
        isCorrect,
        pointsAwarded,
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

    if (answerRows.length > 0) {
      const rowCount = answerRows.length / 6;
      const placeholders = Array.from(
        { length: rowCount },
        (_, r) => `($${r * 6 + 1}, $${r * 6 + 2}, $${r * 6 + 3}, $${r * 6 + 4}, $${r * 6 + 5}, $${r * 6 + 6})`,
      ).join(", ");
      await tx.query(
        `insert into assessment_answers
           (attempt_id, question_id, selected_option_ids, text_answer, is_correct, points_awarded)
         values ${placeholders}`,
        answerRows,
      );
    }

    const percent = maxScore === 0 ? 100 : Math.round((score / maxScore) * 100);
    const status = requiresManual ? "SUBMITTED" : "GRADED";
    const passed = !requiresManual && percent >= level.passing_score;

    try {
      await tx.query(
        `update assessment_attempts
            set status = $2, score = $3, max_score = $4, passed = $5,
                submitted_at = now(), graded_at = $6, is_submission = true
          where id = $1`,
        [attemptId, status, score, maxScore, passed, requiresManual ? null : new Date().toISOString()],
      );
    } catch (error) {
      // Race guard: a concurrent request claimed the one-submission slot between
      // our check and this UPDATE. When the winner stored the identical payload
      // the request is idempotent; otherwise it is an immutable-submission
      // conflict — never a bare database error.
      if ((error as { code?: string }).code === "23505") {
        const winner = await tx.query<AssessmentAttemptRow>(
          `select * from assessment_attempts
            where student_id = $1 and level_id = $2 and phase = $3 and is_submission = true
            limit 1`,
          [student.id, level.id, input.phase],
        );
        if (winner.rows[0]) {
          const stored = await tx.query<StoredAnswerRow>(
            `select question_id, selected_option_ids, text_answer
               from assessment_answers where attempt_id = $1`,
            [winner.rows[0].id],
          );
          if (payloadsMatch(stored.rows, input.answers)) {
            return buildIdempotentResult(
              tx,
              student,
              level,
              questions,
              winner.rows[0],
              trackLevels,
              totalLevels,
            );
          }
        }
        throw errors.conflict("This quiz has already been submitted and cannot be changed.");
      }
      throw error;
    }

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

    const completed = await evaluateLevelCompletion(tx, student, level, {
      trackTotalLevels: totalLevels,
      trackCompletedLevels: trackLevels.filter(
        (t) => t.progress_status === "COMPLETED" && t.id !== level.id,
      ).length,
    });
    const nextLevel = completed ? nextRoadmapLevel(trackLevels, level) : null;

    return {
      attemptId,
      status,
      score,
      maxScore,
      percent,
      passed,
      requiresManualGrading: requiresManual,
      answers: graded,
      nextLevel,
      completed,
      totalLevels,
    };
  });
}

export interface AttemptAnswerDetail {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  isCorrect: boolean | null;
  pointsAwarded: number;
  selectedOptionIds: string[];
  selectedOptions: { id: string; text: string }[];
  textAnswer: string | null;
}

export interface AttemptDetail {
  attempt: AssessmentAttemptRow;
  answers: AttemptAnswerDetail[];
}

export async function getAttemptsForStudent(
  studentId: string,
  levelId: string,
  db: Db = getDb(),
): Promise<AttemptDetail[]> {
  const { rows } = await db.query<
    AssessmentAttemptRow & {
      answers: {
        question_id: string;
        question_text: string;
        question_type: QuestionType;
        is_correct: boolean | null;
        points_awarded: number;
        selected_option_ids: string[];
        selected_options: { id: string; text: string }[];
        text_answer: string | null;
      }[];
    }
  >(
    `select a.*,
            coalesce(
              json_agg(json_build_object(
                'question_id', q.id,
                'question_text', q.question_text,
                'question_type', q.question_type,
                'is_correct', aa.is_correct,
                'points_awarded', aa.points_awarded,
                'selected_option_ids', coalesce(aa.selected_option_ids, '{}'),
                'text_answer', aa.text_answer,
                'selected_options', coalesce(
                  (select json_agg(json_build_object('id', o.id, 'text', o.option_text))
                     from answer_options o
                    where o.id = any(aa.selected_option_ids)),
                  '[]'::json
                )
              ) order by q.order_index asc) filter (where q.id is not null),
              '[]'::json
            ) as answers
       from assessment_attempts a
       left join assessment_answers aa on aa.attempt_id = a.id
       left join conceptual_questions q on q.id = aa.question_id
      where a.student_id = $1 and a.level_id = $2
      group by a.id
      order by a.attempt_number desc`,
    [studentId, levelId],
  );
  return rows.map((row) => {
    const { answers, ...attempt } = row;
    return {
      attempt,
      answers: answers.map((answer) => ({
        questionId: answer.question_id,
        questionText: answer.question_text,
        questionType: answer.question_type,
        isCorrect: answer.is_correct,
        pointsAwarded: answer.points_awarded,
        selectedOptionIds: answer.selected_option_ids ?? [],
        selectedOptions: answer.selected_options ?? [],
        textAnswer: answer.text_answer,
      })),
    };
  });
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

/**
 * Records an admin review note/status on an assessment attempt WITHOUT touching
 * the student's original answers. The submitted quiz stays immutable.
 */
export async function updateAssessmentReviewNote(
  adminId: string,
  attemptId: string,
  note: string | null,
  db: Db = getDb(),
): Promise<AssessmentAttemptRow> {
  const updated = await db.query<AssessmentAttemptRow>(
    `update assessment_attempts
        set review_note = $2, reviewed_by = $3, reviewed_at = now()
      where id = $1
      returning *`,
    [attemptId, note?.trim() || null, adminId],
  );
  const attempt = updated.rows[0];
  if (!attempt) throw errors.notFound("Assessment attempt not found.");
  return attempt;
}
