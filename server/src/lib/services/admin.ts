import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { AppError, errors } from "@/lib/errors";
import { extractLeetcodeSlug, isLeetcodeProblemUrl, normalizeName, normalizeRollNumber, parseLeetcodeProfileUrl } from "@/lib/normalize";
import { randomIdempotencyKey } from "@/lib/auth/tokens";
import { awardPoints } from "@/lib/services/scoring";
import { computeContestStatus, requireCurrentContest } from "@/lib/services/contest";
import { flagIdentityChanged } from "@/lib/services/flags";
import {
  reconcileTrackProgression,
  resetStudentProgress,
  unlockNextLevel,
} from "@/lib/services/progression";
import type {
  ConceptualQuestionRow,
  ContestRow,
  ContestTrackRow,
  LevelRow,
  LeetCodeProblemRow,
  StudentRow,
  Year,
} from "@/lib/types";
import type {
  LevelCreateInput,
  LevelUpdateInput,
  QuestionCreateInput,
  QuestionUpdateInput,
  StudentAdminActionInput,
} from "@/lib/validation/admin";

export interface AdminStats {
  totalStudents: number;
  firstYear: number;
  secondYear: number;
  activeStudents: number;
  participants: number;
  totalFinishers: number;
  pendingFinalists: number;
  verifiedFinalists: number;
  flaggedParticipants: number;
  totalSubmissions: number;
  verifiedSubmissions: number;
  completedLevels: number;
  totalLevels: number;
  completionRate: number;
}

export async function getDashboardStats(
  contestId: string,
  db: Db = getDb(),
): Promise<AdminStats> {
  const { rows } = await db.query<{
    total_students: number;
    first_year: number;
    second_year: number;
    active_students: number;
    participants: number;
    total_finishers: number;
    pending_finalists: number;
    verified_finalists: number;
    flagged_participants: number;
    total_submissions: number;
    verified_submissions: number;
    completed_levels: number;
    total_levels: number;
  }>(
    `select
       (select count(*) from students where contest_id = $1)::int as total_students,
       (select count(*) from students where contest_id = $1 and year = 1)::int as first_year,
       (select count(*) from students where contest_id = $1 and year = 2)::int as second_year,
       (select count(*) from students where contest_id = $1 and is_active = true)::int as active_students,
       (select count(*) from students s where s.contest_id = $1
          and exists (select 1 from score_events se where se.student_id = s.id))::int as participants,
       (select count(*) from students where contest_id = $1 and finished_at is not null)::int as total_finishers,
       (select count(*) from students where contest_id = $1 and finished_at is not null and finalist_status in ('PROVISIONAL', 'UNDER_REVIEW'))::int as pending_finalists,
       (select count(*) from students where contest_id = $1 and finalist_status = 'VERIFIED')::int as verified_finalists,
       (select count(distinct student_id) from suspicious_flags where contest_id = $1 and resolved_at is null)::int as flagged_participants,
       (select count(*) from coding_submissions cs join students s on s.id = cs.student_id where s.contest_id = $1)::int as total_submissions,
       (select count(*) from coding_submissions cs join students s on s.id = cs.student_id where s.contest_id = $1 and cs.status = 'VERIFIED')::int as verified_submissions,
       (select count(*) from student_level_progress p join students s on s.id = p.student_id where s.contest_id = $1 and p.status = 'COMPLETED')::int as completed_levels,
       (select count(*) from levels l join contest_tracks t on t.id = l.track_id where t.contest_id = $1 and l.is_active = true)::int as total_levels`,
    [contestId],
  );
  const row = rows[0]!;
  const denominator = row.total_students * row.total_levels;
  return {
    totalStudents: row.total_students,
    firstYear: row.first_year,
    secondYear: row.second_year,
    activeStudents: row.active_students,
    participants: row.participants,
    totalFinishers: row.total_finishers,
    pendingFinalists: row.pending_finalists,
    verifiedFinalists: row.verified_finalists,
    flaggedParticipants: row.flagged_participants,
    totalSubmissions: row.total_submissions,
    verifiedSubmissions: row.verified_submissions,
    completedLevels: row.completed_levels,
    totalLevels: row.total_levels,
    completionRate: denominator === 0 ? 0 : Math.round((row.completed_levels / denominator) * 100),
  };
}

// ---------------------------------------------------------------------------
// Track (year) management
// ---------------------------------------------------------------------------

/**
 * Enables or disables a year's track. This is the server-controlled feature
 * flag behind "Second Year open / First Year coming soon".
 */
export async function setTrackActive(
  adminId: string,
  year: Year,
  isActive: boolean,
  db: Db = getDb(),
): Promise<ContestTrackRow> {
  return db.transaction(async (tx) => {
    const contest = await requireCurrentContest(tx);
    const { rows } = await tx.query<ContestTrackRow>(
      `update contest_tracks
          set is_active = $3
        where contest_id = $1 and year = $2
        returning *`,
      [contest.id, year, isActive],
    );
    const track = rows[0];
    if (!track) throw errors.notFound("Track not found.");
    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "track.update",
        entityType: "track",
        entityId: track.id,
        metadata: { year, isActive },
      },
      tx,
    );
    return track;
  });
}

// ---------------------------------------------------------------------------
// Level management
// ---------------------------------------------------------------------------

// Level number and order are owned by the backend (see `renumberTrackLevels`)
// and are deliberately not editable through the generic update path, so an
// administrator can never create gaps, duplicates or cross-track moves.
const LEVEL_COLUMNS: Record<string, string> = {
  title: "title",
  description: "description",
  teaser: "teaser",
  difficulty: "difficulty",
  points: "points",
  isActive: "is_active",
  isStarting: "is_starting",
  assessmentMode: "assessment_mode",
  requireAssessmentPass: "require_assessment_pass",
  passingScore: "passing_score",
  maxAttempts: "max_attempts",
  requireVerifiedSubmission: "require_verified_submission",
};

async function upsertProblem(
  db: Db,
  levelId: string,
  problem: NonNullable<LevelCreateInput["problem"]>,
): Promise<LeetCodeProblemRow> {
  if (!isLeetcodeProblemUrl(problem.url)) {
    throw errors.badRequest("Problem URL must be a valid leetcode.com problem link.");
  }
  const slug = problem.problemSlug?.trim() || extractLeetcodeSlug(problem.url) || "";
  const { rows } = await db.query<LeetCodeProblemRow>(
    `insert into leetcode_problems (level_id, title, url, problem_slug, difficulty)
     values ($1, $2, $3, $4, $5)
     on conflict (level_id) do update
       set title = excluded.title, url = excluded.url,
           problem_slug = excluded.problem_slug, difficulty = excluded.difficulty
     returning *`,
    [levelId, problem.title, problem.url, slug, problem.difficulty ?? "EASY"],
  );
  return rows[0]!;
}

/**
 * Reserved floor for archived level numbers. Archived rows keep their history
 * but are parked far above the live 1..N range so the (track_id, level_number)
 * unique constraint stays intact for every row.
 */
const LEVEL_ARCHIVE_BASE = 1_000_000;

/**
 * Serializes level-numbering changes for a track by taking a row lock for the
 * duration of the transaction. Concurrent create/delete requests for the same
 * track therefore cannot allocate the same position.
 */
async function lockTrackForUpdate(tx: Db, trackId: string): Promise<ContestTrackRow> {
  const { rows } = await tx.query<ContestTrackRow>(
    "select * from contest_tracks where id = $1 for update",
    [trackId],
  );
  const track = rows[0];
  if (!track) throw errors.notFound("Track not found.");
  return track;
}

/**
 * Renumbers the live (non-archived) levels of a track to a contiguous 1..N
 * sequence following the official order (order_index, then level_number), and
 * normalizes order_index to match. Runs in two phases so the immediate
 * (track_id, level_number) unique constraint can never observe a transient
 * collision during the shuffle. Callers must already hold the track lock.
 */
async function renumberTrackLevels(tx: Db, trackId: string): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    `select id from levels
      where track_id = $1 and archived_at is null
      order by order_index asc, level_number asc`,
    [trackId],
  );
  if (rows.length === 0) return 0;

  const maxResult = await tx.query<{ max: number | null }>(
    "select max(level_number) as max from levels where track_id = $1 and archived_at is null",
    [trackId],
  );
  const offset = Number(maxResult.rows[0]?.max ?? 0) + rows.length + 1;

  // Phase 1: move every live number safely above the destination range.
  await tx.query(
    `update levels
        set level_number = level_number + $2
      where track_id = $1 and archived_at is null`,
    [trackId, offset],
  );

  // Phase 2: assign the final contiguous numbers and normalized order.
  for (const [index, row] of rows.entries()) {
    const number = index + 1;
    await tx.query("update levels set level_number = $2, order_index = $2 where id = $1", [
      row.id,
      number,
    ]);
  }
  return rows.length;
}

/**
 * Archives a level that has participant activity, preserving every historic
 * record (submissions, source code, attempts, progress, audit). The row is
 * moved to a reserved high number so the live sequence stays gap-free and the
 * uniqueness constraint is never violated.
 */
async function archiveLevel(tx: Db, adminId: string, level: LevelRow): Promise<void> {
  const { rows } = await tx.query<{ next: number }>(
    `select greatest(coalesce(max(level_number), 0) + 1, $2)::int as next
       from levels
      where track_id = $1 and archived_at is not null`,
    [level.track_id, LEVEL_ARCHIVE_BASE],
  );
  const archivedNumber = rows[0]!.next;
  await tx.query(
    `update levels
        set archived_at = now(), archived_by = $2, is_active = false,
            level_number = $3, order_index = $3
      where id = $1`,
    [level.id, adminId, archivedNumber],
  );
}

async function levelActivityCounts(
  tx: Db,
  levelId: string,
): Promise<{ submissions: number; attempts: number; progress: number; participants: number }> {
  const { rows } = await tx.query<{
    submissions: number;
    attempts: number;
    progress: number;
    participants: number;
  }>(
    `select
        (select count(*)::int from coding_submissions where level_id = $1) as submissions,
        (select count(*)::int from assessment_attempts where level_id = $1) as attempts,
        (select count(*)::int from student_level_progress where level_id = $1) as progress,
        (select count(distinct student_id)::int from student_level_progress where level_id = $1) as participants`,
    [levelId],
  );
  return rows[0]!;
}

export interface LevelChangeImpact {
  contestStarted: boolean;
  contestState: string;
  participants: number;
  submissions: number;
  activeProgress: number;
  requiresConfirmation: boolean;
}

/**
 * Summarizes how a level change would affect a live contest. When the contest
 * has already started and participants exist, an administrator must explicitly
 * confirm the change before it is applied.
 */
async function getLevelChangeImpact(
  tx: Db,
  contestId: string,
  trackId: string,
): Promise<LevelChangeImpact> {
  const { rows: contestRows } = await tx.query<ContestRow>(
    "select * from contests where id = $1",
    [contestId],
  );
  const contest = contestRows[0];
  if (!contest) throw errors.notFound("Contest not found.");
  const status = computeContestStatus(contest);
  const contestStarted = status.contest === "LIVE" || status.contest === "ENDED";

  const { rows } = await tx.query<{
    participants: number;
    submissions: number;
    active_progress: number;
  }>(
    `select
        (select count(*)::int from students where contest_id = $1) as participants,
        (select count(*)::int from coding_submissions cs
           join students s on s.id = cs.student_id
          where s.contest_id = $1) as submissions,
        (select count(*)::int from student_level_progress p
           join levels l on l.id = p.level_id
          where l.track_id = $2 and p.status <> 'LOCKED') as active_progress`,
    [contestId, trackId],
  );
  const stats = rows[0]!;
  return {
    contestStarted,
    contestState: status.contest,
    participants: stats.participants,
    submissions: stats.submissions,
    activeProgress: stats.active_progress,
    requiresConfirmation: contestStarted && stats.participants > 0,
  };
}

function assertChangeConfirmed(impact: LevelChangeImpact, force: boolean, what: string): void {
  if (impact.requiresConfirmation && !force) {
    throw new AppError(
      "LEVEL_CHANGE_CONFIRMATION_REQUIRED",
      `This contest is ${impact.contestState.toLowerCase()} with ${impact.participants} registered participant(s). Confirm before you ${what}.`,
      409,
      impact,
    );
  }
}

export interface LevelMutationResult {
  level: LevelRow;
  levels: AdminLevelRow[];
  totalLevels: number;
}

/**
 * Creates a level at the end of its track. The level number and order are
 * assigned by the backend from the track's current live levels; any value the
 * client may have submitted is ignored. Runs inside a transaction that locks
 * the track so simultaneous requests cannot reuse a number.
 */
export async function createLevel(
  adminId: string,
  input: LevelCreateInput,
  db: Db = getDb(),
): Promise<LevelMutationResult> {
  return db.transaction(async (tx) => {
    const track = await lockTrackForUpdate(tx, input.trackId);
    const impact = await getLevelChangeImpact(tx, track.contest_id, track.id);
    assertChangeConfirmed(impact, input.force ?? false, "add a level to an active contest");

    const position = await tx.query<{ next_number: number; next_order: number }>(
      `select coalesce(max(level_number), 0) + 1 as next_number,
              coalesce(max(order_index), 0) + 1 as next_order
         from levels
        where track_id = $1 and archived_at is null`,
      [track.id],
    );
    const nextNumber = Number(position.rows[0]?.next_number ?? 1);
    const nextOrder = Number(position.rows[0]?.next_order ?? 1);

    const inserted = await tx.query<LevelRow>(
      `insert into levels
         (track_id, level_number, title, description, difficulty, points, order_index,
          is_active, is_starting, assessment_mode, require_assessment_pass, passing_score,
          max_attempts, require_verified_submission)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning *`,
      [
        track.id,
        nextNumber,
        input.title,
        input.description ?? "",
        input.difficulty ?? "EASY",
        input.points ?? 10,
        nextOrder,
        input.isActive ?? true,
        input.isStarting ?? false,
        input.assessmentMode ?? "NONE",
        input.requireAssessmentPass ?? false,
        input.passingScore ?? 60,
        input.maxAttempts ?? 3,
        input.requireVerifiedSubmission ?? true,
      ],
    );
    const level = inserted.rows[0]!;
    if (input.problem) await upsertProblem(tx, level.id, input.problem);

    // Seed a progress record for every student in this track so the new level
    // appears seamlessly, then reconcile so eligible students are unlocked.
    await tx.query(
      `insert into student_level_progress (student_id, level_id, status, unlocked_at)
       select s.id, $1,
              case when $3 = true then 'UNLOCKED'::progress_status else 'LOCKED'::progress_status end,
              case when $3 = true then now() else null end
         from students s
         join contest_tracks ct on ct.contest_id = s.contest_id and ct.year = s.year
        where ct.id = $2
       on conflict (student_id, level_id) do nothing`,
      [level.id, track.id, Boolean(input.isStarting)],
    );
    await reconcileTrackProgression(tx, track.id);

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "level.create",
        entityType: "level",
        entityId: level.id,
        metadata: { levelNumber: level.level_number, trackId: track.id },
      },
      tx,
    );

    const levels = await listLevelsDetailed(track.contest_id, tx);
    return {
      level,
      levels,
      totalLevels: levels.filter((l) => l.track_id === track.id).length,
    };
  });
}

export async function updateLevel(
  adminId: string,
  input: LevelUpdateInput,
  db: Db = getDb(),
): Promise<LevelRow> {
  return db.transaction(async (tx) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(LEVEL_COLUMNS)) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length > 0) {
      values.push(input.id);
      await tx.query(`update levels set ${sets.join(", ")} where id = $${values.length}`, values);
    }
    const level = await tx.query<LevelRow>("select * from levels where id = $1", [input.id]);
    if (!level.rows[0]) throw errors.notFound("Level not found.");
    if (input.problem) await upsertProblem(tx, input.id, input.problem);
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "level.update", entityType: "level", entityId: input.id },
      tx,
    );
    return level.rows[0];
  });
}

export interface LevelDeleteResult {
  deleted: true;
  archived: boolean;
  levels: AdminLevelRow[];
  totalLevels: number;
  impact: LevelChangeImpact;
}

/**
 * Removes a level from its track and renumbers the remaining levels so the
 * sequence stays contiguous. A level with participant activity is archived
 * (soft-deleted) rather than hard-deleted so historic submissions, source code,
 * progress and audit records survive. Hard deletion is used only when the level
 * has no related records at all.
 */
export async function deleteLevel(
  adminId: string,
  levelId: string,
  options: { force?: boolean } = {},
  db: Db = getDb(),
): Promise<LevelDeleteResult> {
  return db.transaction(async (tx) => {
    const levelRes = await tx.query<LevelRow>("select * from levels where id = $1", [levelId]);
    const level = levelRes.rows[0];
    if (!level || level.archived_at) throw errors.notFound("Level not found.");

    // Lock the track first (same order as createLevel) to serialize numbering.
    const track = await lockTrackForUpdate(tx, level.track_id);
    const impact = await getLevelChangeImpact(tx, track.contest_id, track.id);
    assertChangeConfirmed(impact, options.force ?? false, "delete a level from an active contest");

    const activity = await levelActivityCounts(tx, levelId);
    const hasActivity =
      activity.submissions > 0 || activity.attempts > 0 || activity.progress > 0;

    if (hasActivity) {
      await archiveLevel(tx, adminId, level);
    } else {
      const deleted = await tx.query("delete from levels where id = $1", [levelId]);
      if (deleted.rowCount === 0) throw errors.notFound("Level not found.");
    }

    await renumberTrackLevels(tx, track.id);

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: hasActivity ? "level.archive" : "level.delete",
        entityType: "level",
        entityId: levelId,
        metadata: { trackId: track.id, archived: hasActivity, title: level.title, activity },
      },
      tx,
    );

    const levels = await listLevelsDetailed(track.contest_id, tx);
    return {
      deleted: true,
      archived: hasActivity,
      levels,
      totalLevels: levels.filter((l) => l.track_id === track.id).length,
      impact,
    };
  });
}

export async function reorderLevels(
  adminId: string,
  trackId: string,
  order: { id: string; orderIndex: number }[],
  db: Db = getDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTrackForUpdate(tx, trackId);
    for (const item of order) {
      await tx.query(
        "update levels set order_index = $2 where id = $1 and track_id = $3 and archived_at is null",
        [item.id, item.orderIndex, trackId],
      );
    }
    // Keep the publicly visible level numbers aligned with the new order.
    await renumberTrackLevels(tx, trackId);
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "level.reorder", entityType: "track", entityId: trackId },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Question management
// ---------------------------------------------------------------------------

export async function createQuestion(
  adminId: string,
  input: QuestionCreateInput,
  db: Db = getDb(),
): Promise<ConceptualQuestionRow> {
  return db.transaction(async (tx) => {
    const inserted = await tx.query<ConceptualQuestionRow>(
      `insert into conceptual_questions
         (level_id, question_text, question_type, phase, order_index, points, correct_text, explanation, is_active, variant_group, min_length, max_length)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        input.levelId,
        input.questionText,
        input.questionType,
        input.phase,
        input.orderIndex ?? 0,
        input.points ?? 1,
        input.correctText || null,
        input.explanation ?? "",
        input.isActive ?? true,
        input.variantGroup || null,
        input.minLength ?? null,
        input.maxLength ?? null,
      ],
    );
    const question = inserted.rows[0]!;
    await replaceOptions(tx, question.id, input.options ?? []);
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "question.create", entityType: "question", entityId: question.id },
      tx,
    );
    return question;
  });
}

export async function updateQuestion(
  adminId: string,
  input: QuestionUpdateInput,
  db: Db = getDb(),
): Promise<ConceptualQuestionRow> {
  return db.transaction(async (tx) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      questionText: "question_text",
      questionType: "question_type",
      phase: "phase",
      orderIndex: "order_index",
      points: "points",
      correctText: "correct_text",
      explanation: "explanation",
      isActive: "is_active",
      variantGroup: "variant_group",
      minLength: "min_length",
      maxLength: "max_length",
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value === "" && (column === "correct_text" || column === "variant_group") ? null : value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length > 0) {
      values.push(input.id);
      await tx.query(`update conceptual_questions set ${sets.join(", ")} where id = $${values.length}`, values);
    }
    if (input.options) {
      await replaceOptions(tx, input.id, input.options);
    }
    const question = await tx.query<ConceptualQuestionRow>(
      "select * from conceptual_questions where id = $1",
      [input.id],
    );
    if (!question.rows[0]) throw errors.notFound("Question not found.");
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "question.update", entityType: "question", entityId: input.id },
      tx,
    );
    return question.rows[0];
  });
}

async function replaceOptions(
  db: Db,
  questionId: string,
  options: { optionText: string; isCorrect?: boolean }[],
): Promise<void> {
  await db.query("delete from answer_options where question_id = $1", [questionId]);
  for (const [index, option] of options.entries()) {
    await db.query(
      `insert into answer_options (question_id, option_text, is_correct, order_index)
       values ($1, $2, $3, $4)`,
      [questionId, option.optionText, option.isCorrect ?? false, index],
    );
  }
}

export async function deleteQuestion(adminId: string, questionId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.query("delete from conceptual_questions where id = $1", [questionId]);
    if (result.rowCount === 0) throw errors.notFound("Question not found.");
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "question.delete", entityType: "question", entityId: questionId },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Student administration
// ---------------------------------------------------------------------------

export async function applyStudentAdminAction(
  adminId: string,
  input: StudentAdminActionInput,
  db: Db = getDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const studentResult = await tx.query<StudentRow>("select * from students where id = $1", [
      input.studentId,
    ]);
    const student = studentResult.rows[0];
    if (!student) throw errors.notFound("Student not found.");

    switch (input.action) {
      case "setActive":
        await tx.query("update students set is_active = $2 where id = $1", [student.id, input.value]);
        break;
      case "resetProgress":
        await resetStudentProgress(tx, student);
        break;
      case "adjustPoints":
        await awardPoints(
          {
            studentId: student.id,
            contestId: student.contest_id,
            source: "ADMIN_ADJUSTMENT",
            points: input.points,
            reason: input.reason,
            idempotencyKey: `admin-adjustment:${randomIdempotencyKey()}`,
          },
          tx,
        );
        break;
      case "grantLevel": {
        const levelResult = await tx.query<LevelRow>(
          "select * from levels where id = $1",
          [input.levelId],
        );
        const level = levelResult.rows[0];
        if (!level) throw errors.notFound("Level not found.");
        await tx.query(
          `insert into student_level_progress (student_id, level_id, status, unlocked_at, completed_at, points_awarded)
           values ($1, $2, 'COMPLETED', now(), now(), $3)
           on conflict (student_id, level_id) do update
             set status = 'COMPLETED', completed_at = now(), points_awarded = $3`,
          [student.id, level.id, level.points],
        );
        await awardPoints(
          {
            studentId: student.id,
            contestId: student.contest_id,
            levelId: level.id,
            source: "ADMIN_ADJUSTMENT",
            points: level.points,
            reason: `Admin granted level ${level.level_number}`,
            idempotencyKey: `level:${student.id}:${level.id}`,
          },
          tx,
        );
        await unlockNextLevel(tx, student.id, level);
        break;
      }
    }

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: `student.${input.action}`,
        entityType: "student",
        entityId: student.id,
        metadata: input,
      },
      tx,
    );
  });
}

export interface StudentIdentityUpdateInput {
  studentId: string;
  fullName?: string;
  rollNumber?: string;
  year?: Year;
  leetcodeProfileUrl?: string;
}

/**
 * Corrects a participant's identity details. Year changes are deliberately
 * administrator-only and are recorded as a review flag plus an audit entry,
 * since participants may not switch year tracks themselves.
 */
export async function updateStudentIdentity(
  adminId: string,
  input: StudentIdentityUpdateInput,
  db: Db = getDb(),
): Promise<StudentRow> {
  return db.transaction(async (tx) => {
    const result = await tx.query<StudentRow>("select * from students where id = $1 for update", [
      input.studentId,
    ]);
    const student = result.rows[0];
    if (!student) throw errors.notFound("Student not found.");

    const sets: string[] = [];
    const values: unknown[] = [];
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (input.fullName !== undefined) {
      const fullName = normalizeName(input.fullName);
      if (fullName) {
        values.push(fullName);
        sets.push(`full_name = $${values.length}`);
        changes.fullName = { from: student.full_name, to: fullName };
      }
    }
    if (input.rollNumber !== undefined) {
      const rollNumber = input.rollNumber.trim();
      const normalized = normalizeRollNumber(rollNumber);
      if (normalized) {
        const clash = await tx.query<{ id: string }>(
          "select id from students where contest_id = $1 and normalized_roll_number = $2 and id <> $3",
          [student.contest_id, normalized, student.id],
        );
        if (clash.rows.length > 0) throw errors.conflict("That roll number is already registered.");
        values.push(rollNumber);
        sets.push(`roll_number = $${values.length}`);
        values.push(normalized);
        sets.push(`normalized_roll_number = $${values.length}`);
        changes.rollNumber = { from: student.roll_number, to: rollNumber };
      }
    }
    if (input.leetcodeProfileUrl !== undefined) {
      const profile = parseLeetcodeProfileUrl(input.leetcodeProfileUrl);
      if (!profile) throw errors.badRequest("Enter a valid LeetCode profile URL.");
      const clash = await tx.query<{ id: string }>(
        "select id from students where contest_id = $1 and leetcode_username_normalized = $2 and id <> $3",
        [student.contest_id, profile.normalizedUsername, student.id],
      );
      if (clash.rows.length > 0) {
        throw errors.conflict("That LeetCode profile is already linked to another participant.");
      }
      values.push(profile.profileUrl);
      sets.push(`leetcode_profile_url = $${values.length}`);
      values.push(profile.username);
      sets.push(`leetcode_username = $${values.length}`);
      values.push(profile.normalizedUsername);
      sets.push(`leetcode_username_normalized = $${values.length}`);
      // The identity is unverified until re-confirmed.
      sets.push("identity_verified_at = null");
      sets.push("identity_verified_by = null");
      changes.leetcodeUsername = { from: student.leetcode_username, to: profile.username };
    }
    if (input.year !== undefined) {
      const track = await tx.query<{ id: string }>(
        "select id from contest_tracks where contest_id = $1 and year = $2",
        [student.contest_id, input.year],
      );
      if (!track.rows[0]) throw errors.badRequest("That year track is not configured.");
      values.push(input.year);
      sets.push(`year = $${values.length}`);
      changes.year = { from: student.year, to: input.year };
    }

    if (sets.length === 0) return student;

    values.push(student.id);
    const updated = await tx.query<StudentRow>(
      `update students set ${sets.join(", ")} where id = $${values.length} returning *`,
      values,
    );

    if (changes.year || changes.leetcodeUsername) {
      await flagIdentityChanged(
        student.contest_id,
        student.id,
        { changes, correctedBy: adminId },
        tx,
      );
    }

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "student.identity.update",
        entityType: "student",
        entityId: student.id,
        metadata: { changes },
      },
      tx,
    );

    return updated.rows[0]!;
  });
}

/** Marks a participant's linked LeetCode identity as manually verified. */
export async function verifyStudentIdentity(
  adminId: string,
  studentId: string,
  db: Db = getDb(),
): Promise<StudentRow> {
  return db.transaction(async (tx) => {
    const result = await tx.query<StudentRow>(
      `update students
          set identity_verified_at = now(), identity_verified_by = $2
        where id = $1
        returning *`,
      [studentId, adminId],
    );
    const student = result.rows[0];
    if (!student) throw errors.notFound("Student not found.");
    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "student.identity.verify",
        entityType: "student",
        entityId: studentId,
      },
      tx,
    );
    return student;
  });
}

export interface AuditLogEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function listAuditLogs(limit = 50, db: Db = getDb()): Promise<AuditLogEntry[]> {
  const { rows } = await db.query<AuditLogEntry>(
    "select * from audit_logs order by created_at desc limit $1",
    [limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Content queries for the admin dashboard
// ---------------------------------------------------------------------------

export interface AdminLevelRow extends LevelRow {
  year: number;
  problem_title: string | null;
  problem_url: string | null;
  problem_slug: string | null;
  question_count: number;
}

export async function listLevelsDetailed(
  contestId: string,
  db: Db = getDb(),
): Promise<AdminLevelRow[]> {
  const { rows } = await db.query<AdminLevelRow>(
    `select l.*, t.year, p.title as problem_title, p.url as problem_url, p.problem_slug,
            (select count(*) from conceptual_questions q where q.level_id = l.id)::int as question_count
       from levels l
       join contest_tracks t on t.id = l.track_id
       left join leetcode_problems p on p.level_id = l.id
      where t.contest_id = $1 and l.archived_at is null
      order by t.year asc, l.order_index asc, l.level_number asc`,
    [contestId],
  );
  return rows;
}

export interface AdminQuestion {
  id: string;
  level_id: string;
  question_text: string;
  question_type: string;
  phase: string;
  order_index: number;
  points: number;
  correct_text: string | null;
  explanation: string;
  variant_group: string | null;
  is_active: boolean;
  options: { id: string; option_text: string; is_correct: boolean; order_index: number }[];
}

export async function getQuestionsForLevel(
  levelId: string,
  db: Db = getDb(),
): Promise<AdminQuestion[]> {
  const { rows } = await db.query<ConceptualQuestionRow & { option_id: string | null; option_text: string | null; is_correct: boolean | null; option_order: number | null }>(
    `select q.*, o.id as option_id, o.option_text, o.is_correct, o.order_index as option_order
       from conceptual_questions q
       left join answer_options o on o.question_id = q.id
      where q.level_id = $1
      order by q.phase asc, q.order_index asc, o.order_index asc`,
    [levelId],
  );
  const map = new Map<string, AdminQuestion>();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        level_id: row.level_id,
        question_text: row.question_text,
        question_type: row.question_type,
        phase: row.phase,
        order_index: row.order_index,
        points: row.points,
        correct_text: row.correct_text,
        explanation: row.explanation,
        variant_group: row.variant_group,
        is_active: row.is_active,
        options: [],
      });
    }
    if (row.option_id) {
      map.get(row.id)!.options.push({
        id: row.option_id,
        option_text: row.option_text ?? "",
        is_correct: row.is_correct ?? false,
        order_index: row.option_order ?? 0,
      });
    }
  }
  return [...map.values()];
}
