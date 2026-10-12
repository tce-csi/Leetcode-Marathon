import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { getTrackByYear } from "@/lib/services/contest";
import { detectRapidCompletion } from "@/lib/services/flags";
import { awardPoints } from "@/lib/services/scoring";
import type {
  AssessmentMode,
  CodingSubmissionRow,
  ContestRow,
  Difficulty,
  LevelRow,
  LeetCodeProblemRow,
  ProgressStatus,
  QuestionPhase,
  RoadmapLevel,
  StudentLevelProgressRow,
  StudentRow,
  SubmissionStatus,
} from "@/lib/types";
export type { RoadmapLevel };

export function phasesForMode(mode: AssessmentMode): QuestionPhase[] {
  switch (mode) {
    case "BEFORE":
      return ["BEFORE"];
    case "AFTER":
      return ["AFTER"];
    case "BOTH":
      return ["BEFORE", "AFTER"];
    default:
      return [];
  }
}

/** Creates a progress row for every active level in the student's track. */
export async function initializeStudentProgress(db: Db, student: StudentRow): Promise<void> {
  const track = await getTrackByYear(student.contest_id, student.year, db);
  if (!track) return;
  const { rows: levels } = await db.query<{ id: string; is_starting: boolean }>(
    `select id, is_starting from levels
      where track_id = $1 and is_active = true
      order by order_index asc, level_number asc`,
    [track.id],
  );
  if (levels.length === 0) return;

  const startingIds = levels.filter((l) => l.is_starting).map((l) => l.id);
  const unlocked = startingIds.length > 0 ? new Set(startingIds) : new Set([levels[0]!.id]);

  for (const level of levels) {
    const isUnlocked = unlocked.has(level.id);
    await db.query(
      `insert into student_level_progress (student_id, level_id, status, unlocked_at)
       values ($1, $2, $3, $4)
       on conflict (student_id, level_id) do nothing`,
      [student.id, level.id, isUnlocked ? "UNLOCKED" : "LOCKED", isUnlocked ? new Date().toISOString() : null],
    );
  }
}

/**
 * Reconciles student progress records across all active levels in their track.
 * Ensures that if prerequisite levels are completed, newly published or
 * extended levels are automatically unlocked for eligible students.
 */
export async function reconcileStudentProgression(
  db: Db,
  student: StudentRow,
): Promise<void> {
  const track = await getTrackByYear(student.contest_id, student.year, db);
  if (!track) return;

  const { rows: levels } = await db.query<LevelRow>(
    `select id, order_index, level_number, is_starting from levels
      where track_id = $1 and is_active = true
      order by order_index asc, level_number asc`,
    [track.id],
  );
  if (levels.length === 0) return;

  const { rows: progressRows } = await db.query<StudentLevelProgressRow>(
    `select level_id, status from student_level_progress where student_id = $1`,
    [student.id],
  );
  const statusByLevel = new Map(progressRows.map((p) => [p.level_id, p.status]));

  let prevCompleted = true; // First active level is unlocked by default
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i]!;
    const curStatus = statusByLevel.get(lvl.id);

    if (lvl.is_starting || i === 0 || prevCompleted) {
      if (!curStatus) {
        await db.query(
          `insert into student_level_progress (student_id, level_id, status, unlocked_at)
           values ($1, $2, 'UNLOCKED', now())
           on conflict (student_id, level_id) do nothing`,
          [student.id, lvl.id],
        );
        statusByLevel.set(lvl.id, "UNLOCKED");
      } else if (curStatus === "LOCKED") {
        await db.query(
          `update student_level_progress
              set status = 'UNLOCKED', unlocked_at = coalesce(unlocked_at, now())
            where student_id = $1 and level_id = $2`,
          [student.id, lvl.id],
        );
        statusByLevel.set(lvl.id, "UNLOCKED");
      }
    } else {
      if (!curStatus) {
        await db.query(
          `insert into student_level_progress (student_id, level_id, status)
           values ($1, $2, 'LOCKED')
           on conflict (student_id, level_id) do nothing`,
          [student.id, lvl.id],
        );
        statusByLevel.set(lvl.id, "LOCKED");
      }
    }

    const effectiveStatus = statusByLevel.get(lvl.id);
    prevCompleted = effectiveStatus === "COMPLETED";
  }
}

/** Reconciles progression for all active students in a track. */
export async function reconcileTrackProgression(db: Db, trackId: string): Promise<void> {
  const { rows: students } = await db.query<StudentRow>(
    `select s.* from students s
       join contest_tracks ct on ct.contest_id = s.contest_id and ct.year = s.year
      where ct.id = $1 and s.is_active = true`,
    [trackId],
  );
  for (const student of students) {
    await reconcileStudentProgression(db, student);
  }
}

export async function getStudentLevels(
  student: StudentRow,
  db: Db = getDb(),
): Promise<RoadmapLevel[]> {
  const levelsResult = await db.query<
    LevelRow & {
      problem_id: string | null;
      problem_title: string | null;
      problem_url: string | null;
      problem_slug: string | null;
      progress_status: ProgressStatus | null;
      progress_unlocked_at: string | null;
      progress_completed_at: string | null;
    }
  >(
    `select l.*, p.id as problem_id, p.title as problem_title, p.url as problem_url, p.problem_slug,
            pr.status as progress_status,
            pr.unlocked_at as progress_unlocked_at,
            pr.completed_at as progress_completed_at
       from levels l
       join contest_tracks ct on ct.id = l.track_id and ct.contest_id = $2 and ct.year = $3
       left join leetcode_problems p on p.level_id = l.id
       left join student_level_progress pr on pr.level_id = l.id and pr.student_id = $1
      where l.is_active = true
      order by l.order_index asc, l.level_number asc`,
    [student.id, student.contest_id, student.year],
  );
  const levels = levelsResult.rows;
  if (levels.length === 0) return [];
  const levelIds = levels.map((l) => l.id);

  const progressByLevel = new Map<string, StudentLevelProgressRow>();
  const statusByLevel = new Map<string, ProgressStatus>();
  for (const lvl of levels) {
    if (lvl.progress_status) {
      statusByLevel.set(lvl.id, lvl.progress_status);
      progressByLevel.set(lvl.id, {
        id: "",
        student_id: student.id,
        level_id: lvl.id,
        status: lvl.progress_status,
        points_awarded: 0,
        unlocked_at: lvl.progress_unlocked_at,
        completed_at: lvl.progress_completed_at,
        challenge_opened_at: null,
        created_at: "",
        updated_at: "",
      });
    }
  }

  const toInsert: Array<{ levelId: string; status: ProgressStatus }> = [];
  const toUnlock: string[] = [];
  let prevCompleted = true; // First active level is unlocked by default
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i]!;
    const curStatus = statusByLevel.get(lvl.id);
    if (lvl.is_starting || i === 0 || prevCompleted) {
      if (!curStatus) {
        toInsert.push({ levelId: lvl.id, status: "UNLOCKED" });
        statusByLevel.set(lvl.id, "UNLOCKED");
      } else if (curStatus === "LOCKED") {
        toUnlock.push(lvl.id);
        statusByLevel.set(lvl.id, "UNLOCKED");
      }
    } else if (!curStatus) {
      toInsert.push({ levelId: lvl.id, status: "LOCKED" });
      statusByLevel.set(lvl.id, "LOCKED");
    }
    prevCompleted = statusByLevel.get(lvl.id) === "COMPLETED";
  }

  if (toInsert.length > 0) {
    const placeholders = toInsert.map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3}::progress_status, case when $${idx * 3 + 3}::progress_status = 'UNLOCKED' then now() else null end)`).join(", ");
    await db.query(
      `insert into student_level_progress (student_id, level_id, status, unlocked_at) values ${placeholders}
       on conflict (student_id, level_id) do nothing`,
      toInsert.flatMap((r) => [student.id, r.levelId, r.status]),
    );
    const nowIso = new Date().toISOString();
    for (const r of toInsert) {
      progressByLevel.set(r.levelId, {
        id: "",
        student_id: student.id,
        level_id: r.levelId,
        status: r.status,
        points_awarded: 0,
        unlocked_at: r.status === "UNLOCKED" ? nowIso : null,
        completed_at: null,
        challenge_opened_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }
  }
  if (toUnlock.length > 0) {
    await db.query(
      `update student_level_progress
          set status = 'UNLOCKED', unlocked_at = coalesce(unlocked_at, now())
        where student_id = $1 and level_id = any($2::uuid[]) and status = 'LOCKED'`,
      [student.id, toUnlock],
    );
    for (const id of toUnlock) {
      const existing = progressByLevel.get(id);
      progressByLevel.set(id, { ...existing!, status: "UNLOCKED", unlocked_at: existing?.unlocked_at ?? null });
    }
  }

  const submissions = await db.query<{ level_id: string; status: SubmissionStatus }>(
    `select distinct on (level_id) level_id, status
       from coding_submissions
      where student_id = $1 and level_id = any($2::uuid[]) and status <> 'REJECTED'
      order by level_id, created_at desc`,
    [student.id, levelIds],
  );
  const submissionByLevel = new Map(submissions.rows.map((s) => [s.level_id, s.status]));

  const attempts = await db.query<{ level_id: string; phase: QuestionPhase; passed: boolean }>(
    `select level_id, phase, bool_or(passed) as passed
       from assessment_attempts
      where student_id = $1 and level_id = any($2::uuid[]) and status = 'GRADED'
      group by level_id, phase`,
    [student.id, levelIds],
  );
  const passedByLevelPhase = new Map<string, boolean>();
  for (const a of attempts.rows) {
    passedByLevelPhase.set(`${a.level_id}:${a.phase}`, a.passed);
  }

  return levels.map((level) => {
    const progress = progressByLevel.get(level.id);
    const status = (statusByLevel.get(level.id) ?? progress?.status ?? "LOCKED") as ProgressStatus;
    // Future challenges are withheld until unlocked: no title, teaser or
    // LeetCode link (title/URL/slug) is exposed for locked levels.
    const hidden = status === "LOCKED";
    return {
      id: level.id,
      levelNumber: level.level_number,
      title: hidden ? `Level ${level.level_number}` : level.title,
      description: hidden ? "" : level.description,
      teaser: hidden ? "" : level.teaser,
      hidden,
      difficulty: level.difficulty,
      points: level.points,
      status,
      assessmentMode: level.assessment_mode,
      requireAssessmentPass: level.require_assessment_pass,
      requireVerifiedSubmission: level.require_verified_submission,
      passingScore: level.passing_score,
      maxAttempts: level.max_attempts,
      problem:
        !hidden && level.problem_id
          ? {
              title: level.problem_title ?? level.title,
              url: level.problem_url ?? "",
              slug: level.problem_slug ?? "",
            }
          : null,
      submissionStatus: submissionByLevel.get(level.id) ?? null,
      beforeAssessmentPassed: passedByLevelPhase.get(`${level.id}:BEFORE`) ?? false,
      afterAssessmentPassed: passedByLevelPhase.get(`${level.id}:AFTER`) ?? false,
      completedAt: progress?.completed_at ?? null,
      unlockedAt: progress?.unlocked_at ?? null,
    };
  });
}

export interface TrackLevelSummary {
  id: string;
  level_number: number;
  order_index: number;
  title: string;
  description: string;
  teaser: string;
  difficulty: Difficulty;
  points: number;
  assessment_mode: AssessmentMode;
  require_assessment_pass: boolean;
  require_verified_submission: boolean;
  passing_score: number;
  max_attempts: number;
  problem_title: string | null;
  problem_url: string | null;
  problem_slug: string | null;
  progress_status: ProgressStatus | null;
}

export interface LevelContext {
  level: LevelRow;
  problem: LeetCodeProblemRow | null;
  progress: StudentLevelProgressRow;
  contest: ContestRow;
  trackLevels: TrackLevelSummary[];
  totalLevels: number;
  /** Most recent submission of any status for this level (null when none exist). */
  latestSubmission: CodingSubmissionRow | null;
  /** Most recent non-rejected submission for this level (null when none exist). */
  activeSubmission: CodingSubmissionRow | null;
}

/**
 * Builds the "next unlocked level" view purely from the already-fetched track
 * level summaries, avoiding a dedicated round trip to the database.
 */
export function nextRoadmapLevel(
  trackLevels: TrackLevelSummary[],
  level: LevelRow,
): RoadmapLevel | null {
  const next = trackLevels.find(
    (t) =>
      t.order_index > level.order_index ||
      (t.order_index === level.order_index && t.level_number > level.level_number),
  );
  if (!next) return null;
  return {
    id: next.id,
    levelNumber: next.level_number,
    title: next.title,
    description: next.description,
    teaser: next.teaser,
    hidden: false,
    difficulty: next.difficulty,
    points: next.points,
    status: "UNLOCKED",
    assessmentMode: next.assessment_mode,
    requireAssessmentPass: next.require_assessment_pass,
    requireVerifiedSubmission: next.require_verified_submission,
    passingScore: next.passing_score,
    maxAttempts: next.max_attempts,
    problem: next.problem_slug
      ? {
          title: next.problem_title ?? next.title,
          url: next.problem_url ?? "",
          slug: next.problem_slug,
        }
      : null,
    submissionStatus: null,
    beforeAssessmentPassed: false,
    afterAssessmentPassed: false,
    completedAt: null,
    unlockedAt: new Date().toISOString(),
  };
}

/**
 * Loads a level for a student, enforcing that it belongs to the student's own
 * year track and that it is not locked. This is the single choke point that
 * prevents cross-track access and locked-level access.
 *
 * Everything the submission/level-open flows need — the level, its problem, the
 * student's progress row, the contest configuration and the full ordered list
 * of active levels in the track — is returned by a single SQL statement so the
 * hot paths spend one network round trip instead of four.
 */
export async function getLevelContext(
  student: StudentRow,
  levelId: string,
  db: Db = getDb(),
): Promise<LevelContext> {
  const levelResult = await db.query<
    LevelRow & {
      problem_id: string | null;
      problem_title: string | null;
      problem_url: string | null;
      problem_slug: string | null;
      student_track_id: string;
      student_track_active: boolean;
      contest: ContestRow;
      progress: StudentLevelProgressRow | null;
      track_levels: TrackLevelSummary[] | null;
      latest_submission: CodingSubmissionRow | null;
      active_submission: CodingSubmissionRow | null;
    }
  >(
    `select l.*,
            p.id as problem_id, p.title as problem_title, p.url as problem_url, p.problem_slug,
            st.id as student_track_id, st.is_active as student_track_active,
            to_json(c) as contest,
            (
              select to_json(pr) from student_level_progress pr
               where pr.student_id = $4 and pr.level_id = l.id
            ) as progress,
            (
              select to_json(s) from coding_submissions s
               where s.student_id = $4 and s.level_id = l.id
               order by s.created_at desc limit 1
            ) as latest_submission,
            (
              select to_json(s) from coding_submissions s
               where s.student_id = $4 and s.level_id = l.id and s.status <> 'REJECTED'
               order by s.created_at desc limit 1
            ) as active_submission,
            (
              select json_agg(t order by t.order_index asc, t.level_number asc)
                from (
                   select l2.id, l2.level_number, l2.order_index, l2.title, l2.description,
                          l2.teaser, l2.difficulty, l2.points, l2.assessment_mode,
                          l2.require_assessment_pass, l2.require_verified_submission,
                          l2.passing_score, l2.max_attempts,
                          p2.title as problem_title, p2.url as problem_url, p2.problem_slug,
                          pr2.status as progress_status
                     from levels l2
                     left join leetcode_problems p2 on p2.level_id = l2.id
                     left join student_level_progress pr2
                       on pr2.level_id = l2.id and pr2.student_id = $4
                    where l2.track_id = l.track_id and l2.is_active = true
                ) t
            ) as track_levels
       from levels l
       join contest_tracks st on st.contest_id = $2 and st.year = $3
       join contests c on c.id = st.contest_id
       left join leetcode_problems p on p.level_id = l.id
      where l.id = $1`,
    [levelId, student.contest_id, student.year, student.id],
  );
  const row = levelResult.rows[0];
  if (!row || !row.is_active) throw errors.notFound("Level not found.");
  if (row.student_track_id !== row.track_id) {
    throw errors.forbidden("This level is not part of your contest track.");
  }
  if (!row.student_track_active) {
    throw errors.forbidden("Your year's track is not currently active.");
  }
  const level: LevelRow = row;
  const problem: LeetCodeProblemRow | null = row.problem_id
    ? {
        id: row.problem_id,
        level_id: level.id,
        title: row.problem_title ?? level.title,
        url: row.problem_url ?? "",
        problem_slug: row.problem_slug ?? "",
        difficulty: level.difficulty,
        created_at: "",
        updated_at: "",
      }
    : null;

  const trackLevels = row.track_levels ?? [];
  let progress = row.progress;

  // If progress is missing or locked, check if the student is eligible to unlock
  // this level. The previous level is derived from the already-fetched
  // `trackLevels` list, so no extra round trip is needed to find it.
  if (!progress || progress.status === "LOCKED") {
    const prevLevel = trackLevels
      .filter(
        (t) =>
          t.order_index < level.order_index ||
          (t.order_index === level.order_index && t.level_number < level.level_number),
      )
      .at(-1);
    let isEligible = level.is_starting || !prevLevel;
    if (!isEligible && prevLevel) {
      const prevProgress = await db.query<{ status: string }>(
        `select status from student_level_progress where student_id = $1 and level_id = $2`,
        [student.id, prevLevel.id],
      );
      if (prevProgress.rows[0]?.status === "COMPLETED") {
        isEligible = true;
      }
    }

    if (isEligible) {
      const upserted = await db.query<StudentLevelProgressRow>(
        `insert into student_level_progress (student_id, level_id, status, unlocked_at)
         values ($1, $2, 'UNLOCKED', now())
         on conflict (student_id, level_id)
         do update set status = case when student_level_progress.status = 'LOCKED' then 'UNLOCKED' else student_level_progress.status end,
                       unlocked_at = coalesce(student_level_progress.unlocked_at, now())
         returning *`,
        [student.id, levelId],
      );
      progress = upserted.rows[0];
    } else if (!progress) {
      const inserted = await db.query<StudentLevelProgressRow>(
        `insert into student_level_progress (student_id, level_id, status)
         values ($1, $2, 'LOCKED')
         on conflict (student_id, level_id) do nothing
         returning *`,
        [student.id, levelId],
      );
      progress = inserted.rows[0];
    }
  }

  if (!progress) throw errors.notFound("No progress record for this level.");
  if (progress.status === "LOCKED") {
    throw errors.locked("Complete the previous level to unlock this challenge.");
  }

  return {
    level,
    problem,
    progress,
    contest: row.contest,
    trackLevels,
    totalLevels: trackLevels.length,
    latestSubmission: row.latest_submission,
    activeSubmission: row.active_submission,
  };
}

/** Counts active (published) levels in a track – used for finished/total figures. */
export async function countActiveLevels(db: Db, trackId: string): Promise<number> {
  const result = await db.query<{ count: number }>(
    `select count(*)::int as count from levels where track_id = $1 and is_active = true`,
    [trackId],
  );
  return result.rows[0]?.count ?? 0;
}

export interface CompletionHints {
  /** A non-rejected submission for this level already exists (caller just created one). */
  submissionSatisfied?: boolean;
  /** A verified submission exists for this level (caller already knows its status). */
  verifiedSubmissionSatisfied?: boolean;
  /** Total active levels in the student's track (from the already-fetched track context). */
  trackTotalLevels?: number;
  /** COMPLETED levels in the track before this level completed (from the track context). */
  trackCompletedLevels?: number;
}

/**
 * Recomputes whether a level is complete and, if so, awards points exactly once
 * and unlocks the next level. Safe to call after any activity (assessment
 * submission, verification, admin approval).
 */
export async function evaluateLevelCompletion(
  db: Db,
  student: StudentRow,
  level: LevelRow,
  hints?: CompletionHints,
): Promise<boolean> {
  const progressResult = await db.query<StudentLevelProgressRow>(
    "select * from student_level_progress where student_id = $1 and level_id = $2 for update",
    [student.id, level.id],
  );
  const progress = progressResult.rows[0];
  if (!progress) return false;

  let submissionSatisfied = true;
  if (level.require_verified_submission && !(hints?.submissionSatisfied ?? false)) {
    // Progression is satisfied by any non-rejected submission (PENDING_REVIEW or
    // VERIFIED). Admin review is an auditing step and must not block advancement.
    const sub = await db.query<{ id: string }>(
      `select id from coding_submissions
        where student_id = $1 and level_id = $2 and status <> 'REJECTED' limit 1`,
      [student.id, level.id],
    );
    submissionSatisfied = sub.rows.length > 0;
  }

  let assessmentSatisfied = true;
  if (level.require_assessment_pass) {
    // One-submission policy: completing the quiz requirement means a submission
    // exists for every required phase (status SUBMITTED or GRADED). Passing is
    // no longer required to advance — quiz points are still awarded separately
    // when a submission passes, so a single (even non-passing) submission never
    // leaves the student permanently stuck on a level. If no questions are
    // configured for the level, the level's configured assessment mode decides
    // which phases must be submitted.
    const phaseRows = await db.query<{ phase: QuestionPhase; submitted: boolean }>(
      `select q.phase, bool_or(a.status in ('SUBMITTED', 'GRADED')) as submitted
         from conceptual_questions q
         left join assessment_attempts a
           on a.student_id = $2 and a.level_id = $1 and a.phase = q.phase
        where q.level_id = $1 and q.is_active = true
        group by q.phase`,
      [level.id, student.id],
    );
    const submittedByPhase = new Map<string, boolean>();
    for (const r of phaseRows.rows) submittedByPhase.set(r.phase, r.submitted === true);
    const needed =
      phaseRows.rows.length > 0
        ? phaseRows.rows.map((r) => r.phase)
        : phasesForMode(level.assessment_mode);
    assessmentSatisfied = needed.every((phase) => submittedByPhase.get(phase) === true);
  }

  if (!submissionSatisfied || !assessmentSatisfied) {
    if (progress.status === "UNLOCKED") {
      await db.query(
        "update student_level_progress set status = 'IN_PROGRESS' where id = $1",
        [progress.id],
      );
    }
    return false;
  }

  // Progression is satisfied! If not yet marked completed, advance and unlock next level.
  if (progress.status !== "COMPLETED") {
    await db.query(
      `update student_level_progress
          set status = 'COMPLETED', completed_at = now()
        where id = $1`,
      [progress.id],
    );
    await unlockNextLevel(db, student.id, level);
    await detectRapidCompletion(student.contest_id, student.id, level.id, db);

    // Check if the student has completed all required active levels for their track.
    // When the caller already supplied the track totals, no extra COUNT query is needed.
    const finishHints =
      hints?.trackTotalLevels !== undefined && hints?.trackCompletedLevels !== undefined
        ? { total: hints.trackTotalLevels, completed: hints.trackCompletedLevels + 1 }
        : undefined;
    await checkAndRecordContestFinish(db, student, level.track_id, finishHints);
  }

  // Verified points: Only award submission score if independently verified or if
  // verification is not required for this level. Self-reported attempts do not award
  // verified points until approved/verified.
  const verifiedSub = hints?.verifiedSubmissionSatisfied !== undefined
    ? { rows: hints.verifiedSubmissionSatisfied ? [{ id: "known" }] : [] }
    : await db.query<{ id: string }>(
        `select id from coding_submissions
          where student_id = $1 and level_id = $2 and status = 'VERIFIED' limit 1`,
        [student.id, level.id],
      );

  const shouldAwardPoints = !level.require_verified_submission || verifiedSub.rows.length > 0;
  if (shouldAwardPoints) {
    await awardPoints(
      {
        studentId: student.id,
        contestId: student.contest_id,
        levelId: level.id,
        source: "SUBMISSION",
        points: level.points,
        reason: `Completed level ${level.level_number}: ${level.title}`,
        idempotencyKey: `level:${student.id}:${level.id}`,
      },
      db,
    );
    await db.query(
      `update student_level_progress set points_awarded = $2 where id = $1`,
      [progress.id, level.points],
    );
  }

  return true;
}

export async function unlockNextLevel(
  db: Db,
  studentId: string,
  level: LevelRow,
): Promise<void> {
  await db.query(
    `update student_level_progress p
        set status = 'UNLOCKED', unlocked_at = coalesce(p.unlocked_at, now())
      where p.student_id = $1
        and p.status = 'LOCKED'
        and p.level_id = (
          select l.id from levels l
           where l.track_id = $2 and l.is_active = true
             and (l.order_index, l.level_number) > ($3, $4)
           order by l.order_index asc, l.level_number asc
           limit 1
        )`,
    [studentId, level.track_id, level.order_index, level.level_number],
  );
}

export async function getNextLevel(
  db: Db,
  studentId: string,
  level: LevelRow,
): Promise<RoadmapLevel | null> {
  const nextLevelQuery = await db.query<
    LevelRow & {
      problem_id: string | null;
      problem_title: string | null;
      problem_url: string | null;
      problem_slug: string | null;
    }
  >(
    `select l.*, p.id as problem_id, p.title as problem_title, p.url as problem_url, p.problem_slug
       from levels l
       left join leetcode_problems p on p.level_id = l.id
      where l.track_id = $1 and l.is_active = true
        and (l.order_index, l.level_number) > ($2, $3)
      order by l.order_index asc, l.level_number asc
      limit 1`,
    [level.track_id, level.order_index, level.level_number],
  );
  const next = nextLevelQuery.rows[0];
  if (!next) return null;

  return {
    id: next.id,
    levelNumber: next.level_number,
    title: next.title,
    description: next.description,
    teaser: next.teaser,
    hidden: false,
    difficulty: next.difficulty,
    points: next.points,
    status: "UNLOCKED",
    assessmentMode: next.assessment_mode,
    requireAssessmentPass: next.require_assessment_pass,
    requireVerifiedSubmission: next.require_verified_submission,
    passingScore: next.passing_score,
    maxAttempts: next.max_attempts,
    problem: next.problem_slug
      ? {
          title: next.problem_title ?? next.title,
          url: next.problem_url ?? "",
          slug: next.problem_slug,
        }
      : null,
    submissionStatus: null,
    beforeAssessmentPassed: false,
    afterAssessmentPassed: false,
    completedAt: null,
    unlockedAt: new Date().toISOString(),
  };
}

export function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":");
}

export interface StartContestResult {
  startedAt: string;
  alreadyStarted: boolean;
  student: StudentRow;
}

/**
 * Starts the student's personal contest timer exactly once. Idempotent: the
 * first call stamps `started_at` with the database clock; later calls return the
 * original timestamp untouched. The timestamp anchors the live dashboard timer
 * and the official elapsed duration used for finisher rankings.
 */
export async function startPersonalContest(
  db: Db,
  student: StudentRow,
): Promise<StartContestResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.query<Pick<StudentRow, "id" | "started_at">>(
      "select id, started_at from students where id = $1 for update",
      [student.id],
    );
    const row = locked.rows[0];
    if (!row) throw errors.notFound("Student not found.");
    if (row.started_at) {
      const current = await tx.query<StudentRow>("select * from students where id = $1", [
        row.id,
      ]);
      return {
        startedAt: row.started_at,
        alreadyStarted: true,
        student: current.rows[0]!,
      };
    }

    const updated = await tx.query<StudentRow>(
      `update students set started_at = now() where id = $1 returning *`,
      [row.id],
    );
    const saved = updated.rows[0]!;

    await writeAudit(
      {
        actorType: "STUDENT",
        actorId: saved.id,
        action: "contest.started",
        entityType: "student",
        entityId: saved.id,
        metadata: { startedAt: saved.started_at },
      },
      tx,
    );

    return { startedAt: saved.started_at!, alreadyStarted: false, student: saved };
  });
}

/**
 * Checks if the student has completed all required, published active levels
 * in their assigned track. When completed, atomically records finished_at,
 * contest_started_at, and elapsed_duration_ms exactly once.
 */
export async function checkAndRecordContestFinish(
  db: Db,
  student: StudentRow,
  trackId: string,
  precomputed?: { total: number; completed: number },
): Promise<{ finished: boolean; finishedAt: string | null }> {
  let total: number;
  let completed: number;
  if (precomputed) {
    total = precomputed.total;
    completed = precomputed.completed;
  } else {
    const stats = await db.query<{ total: number; completed: number }>(
      `select
          (select count(l.id)::int from levels l where l.track_id = $2 and l.is_active = true) as total,
          (select count(p.id)::int from levels l
             join student_level_progress p on p.level_id = l.id and p.student_id = $1
            where l.track_id = $2 and l.is_active = true and p.status = 'COMPLETED') as completed`,
      [student.id, trackId],
    );
    total = stats.rows[0]?.total ?? 0;
    completed = stats.rows[0]?.completed ?? 0;
  }

  if (total > 0 && completed >= total) {
    const existing = await db.query<{ finished_at: string | null; started_at: string | null }>(
      `select finished_at, started_at from students where id = $1`,
      [student.id],
    );
    if (existing.rows[0]?.finished_at) {
      return { finished: true, finishedAt: existing.rows[0].finished_at };
    }

    const now = new Date();
    const knownStartedAt = existing.rows[0]?.started_at
      ? new Date(existing.rows[0].started_at)
      : null;

    let effectiveStartAt: Date | null = knownStartedAt;

    if (!effectiveStartAt) {
      const contestResult = await db.query<{ start_at: string | null }>(
        `select start_at from contests where id = $1`,
        [student.contest_id],
      );
      const contestStartAt = contestResult.rows[0]?.start_at ? new Date(contestResult.rows[0].start_at) : null;
      effectiveStartAt = contestStartAt && contestStartAt <= now ? contestStartAt : null;
    }
    if (!effectiveStartAt) {
      const earliestUnlock = await db.query<{ earliest: string | null }>(
        `select min(unlocked_at) as earliest from student_level_progress where student_id = $1`,
        [student.id],
      );
      effectiveStartAt = earliestUnlock.rows[0]?.earliest
        ? new Date(earliestUnlock.rows[0].earliest)
        : new Date(student.created_at);
    }

    const elapsedMs = Math.max(0, now.getTime() - effectiveStartAt.getTime());

    const updated = await db.query<StudentRow>(
      `update students
          set finished_at = $2,
              contest_started_at = $3,
              elapsed_duration_ms = $4
        where id = $1 and finished_at is null
        returning *`,
      [student.id, now.toISOString(), effectiveStartAt.toISOString(), elapsedMs],
    );

    if (updated.rows.length > 0) {
      await writeAudit(
        {
          actorType: "SYSTEM",
          actorId: null,
          action: "contest.finished",
          entityType: "student",
          entityId: student.id,
          metadata: {
            finishedAt: now.toISOString(),
            effectiveStartAt: effectiveStartAt.toISOString(),
            elapsedMs,
            totalLevels: total,
          },
        },
        db,
      );
      return { finished: true, finishedAt: now.toISOString() };
    }
  }

  return { finished: false, finishedAt: null };
}

export interface ProgressSummary {
  totalPoints: number;
  levelsCompleted: number;
  totalLevels: number;
  percent: number;
  pendingSubmissions: number;
  currentLevelId: string | null;
  currentLevelNumber: number | null;
  lastScoreAt: string | null;
  finishedAt: string | null;
  /** Set once the student explicitly submits the contest for review. */
  finalizedAt: string | null;
  /** Personal contest start (server-authoritative, one-time stamp). */
  startedAt: string | null;
  contestStartedAt: string | null;
  elapsedDurationMs: number | null;
  elapsedFormatted: string | null;
}

export async function getProgressSummary(
  db: Db,
  student: StudentRow,
): Promise<ProgressSummary> {
  const { rows } = await db.query<{
    total: number;
    completed: number;
    pending: number;
    current_level_id: string | null;
    current_level_number: number | null;
    total_points: number;
    last_score_at: string | null;
    finished_at: string | null;
    finalized_at: string | null;
    contest_started_at: string | null;
    elapsed_duration_ms: number | null;
    started_at: string | null;
  }>(
    `select
        (select count(*) from levels l where l.track_id = ct.id and l.is_active = true)::int as total,
        (select count(*) from levels l
           join student_level_progress p on p.level_id = l.id and p.student_id = s.id
          where l.track_id = ct.id and l.is_active = true and p.status = 'COMPLETED')::int as completed,
        (select count(*) from coding_submissions cs
          where cs.student_id = s.id and cs.status = 'PENDING_REVIEW')::int as pending,
        (select l.id from levels l
           join student_level_progress p on p.level_id = l.id
          where p.student_id = s.id and l.track_id = ct.id and l.is_active = true
            and p.status in ('UNLOCKED', 'IN_PROGRESS')
          order by l.order_index asc, l.level_number asc limit 1) as current_level_id,
        (select l.level_number from levels l
           join student_level_progress p on p.level_id = l.id
          where p.student_id = s.id and l.track_id = ct.id and l.is_active = true
            and p.status in ('UNLOCKED', 'IN_PROGRESS')
          order by l.order_index asc, l.level_number asc limit 1) as current_level_number,
        (select coalesce(sum(se.points), 0)::int from score_events se where se.student_id = s.id) as total_points,
        (select max(se.created_at) from score_events se where se.student_id = s.id) as last_score_at,
        s.finished_at, s.finalized_at, s.contest_started_at, s.elapsed_duration_ms,
        s.started_at
       from students s
       left join contest_tracks ct on ct.contest_id = s.contest_id and ct.year = s.year
      where s.id = $1`,
    [student.id],
  );

  const row = rows[0];
  const total = row?.total ?? 0;
  const completed = row?.completed ?? 0;
  return {
    totalPoints: row?.total_points ?? 0,
    levelsCompleted: completed,
    totalLevels: total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    pendingSubmissions: row?.pending ?? 0,
    currentLevelId: row?.current_level_id ?? null,
    currentLevelNumber: row?.current_level_number ?? null,
    lastScoreAt: row?.last_score_at ?? null,
    finishedAt: row?.finished_at ?? null,
    finalizedAt: row?.finalized_at ?? null,
    startedAt: row?.started_at ?? null,
    contestStartedAt: row?.contest_started_at ?? null,
    elapsedDurationMs: row?.elapsed_duration_ms ?? null,
    elapsedFormatted: formatElapsed(row?.elapsed_duration_ms),
  };
}

/** Deletes all progress, submissions, answers and score events for a student. */
export async function resetStudentProgress(
  db: Db,
  student: StudentRow,
): Promise<void> {
  await db.query("delete from assessment_attempts where student_id = $1", [student.id]);
  await db.query("delete from coding_submissions where student_id = $1", [student.id]);
  await db.query("delete from score_events where student_id = $1", [student.id]);
  await db.query("delete from student_level_progress where student_id = $1", [student.id]);
  await db.query(
    `update students
        set finished_at = null,
            finalized_at = null,
            contest_started_at = null,
            elapsed_duration_ms = null,
            started_at = null,
            finalist_status = 'PROVISIONAL',
            finalist_verified_at = null,
            finalist_verified_by = null,
            finalist_review_notes = null,
            finalist_disqualification_reason = null
      where id = $1`,
    [student.id],
  );
  await initializeStudentProgress(db, student);
}
