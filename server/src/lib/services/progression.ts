import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { getTrackByYear } from "@/lib/services/contest";
import { detectRapidCompletion } from "@/lib/services/flags";
import { awardPoints, getScoreSummary } from "@/lib/services/scoring";
import type {
  AssessmentMode,
  LevelRow,
  LeetCodeProblemRow,
  ProgressStatus,
  QuestionPhase,
  RoadmapLevel,
  StudentLevelProgressRow,
  StudentRow,
  SubmissionStatus,
} from "@/lib/types";

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

export async function getStudentLevels(
  student: StudentRow,
  db: Db = getDb(),
): Promise<RoadmapLevel[]> {
  const track = await getTrackByYear(student.contest_id, student.year, db);
  if (!track) return [];

  const levelsResult = await db.query<LevelRow & { problem_id: string | null; problem_title: string | null; problem_url: string | null; problem_slug: string | null }>(
    `select l.*, p.id as problem_id, p.title as problem_title, p.url as problem_url, p.problem_slug
       from levels l
       left join leetcode_problems p on p.level_id = l.id
      where l.track_id = $1 and l.is_active = true
      order by l.order_index asc, l.level_number asc`,
    [track.id],
  );
  const levels = levelsResult.rows;
  if (levels.length === 0) return [];
  const levelIds = levels.map((l) => l.id);

  const progressResult = await db.query<StudentLevelProgressRow>(
    `select * from student_level_progress where student_id = $1 and level_id = any($2::uuid[])`,
    [student.id, levelIds],
  );
  const progressByLevel = new Map(progressResult.rows.map((p) => [p.level_id, p]));

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
    const status = (progress?.status ?? "LOCKED") as ProgressStatus;
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

export interface LevelContext {
  level: LevelRow;
  problem: LeetCodeProblemRow | null;
  progress: StudentLevelProgressRow;
}

/**
 * Loads a level for a student, enforcing that it belongs to the student's own
 * year track and that it is not locked. This is the single choke point that
 * prevents cross-track access and locked-level access.
 */
export async function getLevelContext(
  student: StudentRow,
  levelId: string,
  db: Db = getDb(),
): Promise<LevelContext> {
  const levelResult = await db.query<LevelRow>("select * from levels where id = $1", [levelId]);
  const level = levelResult.rows[0];
  if (!level || !level.is_active) throw errors.notFound("Level not found.");

  const track = await getTrackByYear(student.contest_id, student.year, db);
  if (!track || track.id !== level.track_id) {
    throw errors.forbidden("This level is not part of your contest track.");
  }
  if (!track.is_active) {
    throw errors.forbidden("Your year's track is not currently active.");
  }

  const progressResult = await db.query<StudentLevelProgressRow>(
    "select * from student_level_progress where student_id = $1 and level_id = $2",
    [student.id, levelId],
  );
  const progress = progressResult.rows[0];
  if (!progress) throw errors.notFound("No progress record for this level.");
  if (progress.status === "LOCKED") {
    throw errors.locked("Complete the previous level to unlock this challenge.");
  }

  const problemResult = await db.query<LeetCodeProblemRow>(
    "select * from leetcode_problems where level_id = $1",
    [levelId],
  );

  return { level, problem: problemResult.rows[0] ?? null, progress };
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
): Promise<boolean> {
  const progressResult = await db.query<StudentLevelProgressRow>(
    "select * from student_level_progress where student_id = $1 and level_id = $2 for update",
    [student.id, level.id],
  );
  const progress = progressResult.rows[0];
  if (!progress || progress.status === "COMPLETED") return progress?.status === "COMPLETED";

  let submissionSatisfied = true;
  if (level.require_verified_submission) {
    const sub = await db.query<{ id: string }>(
      `select id from coding_submissions
        where student_id = $1 and level_id = $2 and status = 'VERIFIED' limit 1`,
      [student.id, level.id],
    );
    submissionSatisfied = sub.rows.length > 0;
  }

  let assessmentSatisfied = true;
  if (level.require_assessment_pass) {
    const needed = phasesForMode(level.assessment_mode);
    for (const phase of needed) {
      const attempt = await db.query<{ id: string }>(
        `select id from assessment_attempts
          where student_id = $1 and level_id = $2 and phase = $3 and status = 'GRADED' and passed = true
          limit 1`,
        [student.id, level.id, phase],
      );
      if (attempt.rows.length === 0) {
        assessmentSatisfied = false;
        break;
      }
    }
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

  await db.query(
    `update student_level_progress
        set status = 'COMPLETED', completed_at = now(), points_awarded = $2
      where id = $1`,
    [progress.id, level.points],
  );

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

  await unlockNextLevel(db, student.id, level);
  await detectRapidCompletion(student.contest_id, student.id, level.id, db);
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

export interface ProgressSummary {
  totalPoints: number;
  levelsCompleted: number;
  totalLevels: number;
  percent: number;
  pendingSubmissions: number;
  currentLevelId: string | null;
  currentLevelNumber: number | null;
  lastScoreAt: string | null;
}

export async function getProgressSummary(
  db: Db,
  student: StudentRow,
): Promise<ProgressSummary> {
  const track = await getTrackByYear(student.contest_id, student.year, db);
  const score = await getScoreSummary(db, student.id);

  if (!track) {
    return {
      totalPoints: score.totalPoints,
      levelsCompleted: 0,
      totalLevels: 0,
      percent: 0,
      pendingSubmissions: 0,
      currentLevelId: null,
      currentLevelNumber: null,
      lastScoreAt: score.lastScoreAt,
    };
  }

  const totals = await db.query<{ total: number; completed: number }>(
    `select count(l.id)::int as total,
            count(p.id) filter (where p.status = 'COMPLETED')::int as completed
       from levels l
       left join student_level_progress p on p.level_id = l.id and p.student_id = $1
      where l.track_id = $2 and l.is_active = true`,
    [student.id, track.id],
  );

  const pending = await db.query<{ count: number }>(
    `select count(*)::int as count from coding_submissions
      where student_id = $1 and status = 'PENDING_REVIEW'`,
    [student.id],
  );

  const current = await db.query<{ level_id: string; level_number: number }>(
    `select l.id as level_id, l.level_number
       from levels l
       join student_level_progress p on p.level_id = l.id
      where p.student_id = $1 and l.track_id = $2 and l.is_active = true
        and p.status in ('UNLOCKED', 'IN_PROGRESS')
      order by l.order_index asc, l.level_number asc
      limit 1`,
    [student.id, track.id],
  );

  const total = totals.rows[0]?.total ?? 0;
  const completed = totals.rows[0]?.completed ?? 0;
  return {
    totalPoints: score.totalPoints,
    levelsCompleted: completed,
    totalLevels: total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    pendingSubmissions: pending.rows[0]?.count ?? 0,
    currentLevelId: current.rows[0]?.level_id ?? null,
    currentLevelNumber: current.rows[0]?.level_number ?? null,
    lastScoreAt: score.lastScoreAt,
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
  await initializeStudentProgress(db, student);
}
