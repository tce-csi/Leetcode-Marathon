import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { computeContestStatus, getContestById, getTrackByYear } from "@/lib/services/contest";
import { checkAndRecordContestFinish } from "@/lib/services/progression";
import type { StudentRow } from "@/lib/types";

/**
 * Contest finalization ("Submit Contest for Review").
 *
 * Completing the last level already records `finished_at` automatically for the
 * finisher leaderboard. Finalization is a separate, deliberate, one-way action:
 * the student freezes their attempt and asks the organisers to review it. Every
 * requirement is re-validated on the server — the client's readiness flags are
 * advisory only. Once `finalized_at` is set the account is locked out of further
 * submissions and assessments (enforced in those services) and the student
 * enters the admin review queue.
 */

export interface FinalizeReadiness {
  /** True once the student explicitly submitted the contest for review. */
  finalized: boolean;
  /** True when every active level in the student's track is COMPLETED. */
  allLevelsCompleted: boolean;
  /** True when the automatic completion timestamp has been recorded. */
  finished: boolean;
  levelsCompleted: number;
  totalLevels: number;
  /** Convenience flag: the contest may be submitted for review right now. */
  canFinalize: boolean;
  /** Human-readable reasons blocking finalization (empty when canFinalize). */
  reasons: string[];
}

export interface FinalizeResult {
  finalizedAt: string;
  alreadyFinalized: boolean;
  student: StudentRow;
  readiness: FinalizeReadiness;
}

export interface FinalizeContext {
  db?: Db;
  ip?: string | null;
}

interface CompletionCounts {
  total: number;
  completed: number;
}

async function getCompletionCounts(db: Db, student: StudentRow): Promise<CompletionCounts> {
  const { rows } = await db.query<CompletionCounts>(
    `select
        (select count(l.id)::int from levels l
           join contest_tracks ct on ct.id = l.track_id
          where ct.contest_id = $2 and ct.year = $3 and l.is_active = true) as total,
        (select count(l.id)::int from levels l
           join contest_tracks ct on ct.id = l.track_id
           join student_level_progress p on p.level_id = l.id and p.student_id = $1
          where ct.contest_id = $2 and ct.year = $3 and l.is_active = true
            and p.status = 'COMPLETED') as completed`,
    [student.id, student.contest_id, student.year],
  );
  return {
    total: rows[0]?.total ?? 0,
    completed: rows[0]?.completed ?? 0,
  };
}

/**
 * Derives the finalization readiness for a student. A level only ever reaches
 * COMPLETED once its submission and assessment requirements are satisfied, so
 * "all levels completed" already implies every configured requirement has been
 * met — no separate requirement audit is needed.
 */
export async function evaluateFinalizeReadiness(
  db: Db,
  student: StudentRow,
): Promise<FinalizeReadiness> {
  const { total, completed } = await getCompletionCounts(db, student);
  const finalized = Boolean(student.finalized_at);
  const allLevelsCompleted = total > 0 && completed >= total;
  const reasons: string[] = [];
  if (finalized) reasons.push("This contest has already been submitted for review.");
  else if (total === 0) reasons.push("Your track has no active levels yet.");
  else if (!allLevelsCompleted) {
    reasons.push("Complete every level before submitting the contest for review.");
  }
  return {
    finalized,
    allLevelsCompleted,
    finished: Boolean(student.finished_at),
    levelsCompleted: completed,
    totalLevels: total,
    canFinalize: !finalized && allLevelsCompleted,
    reasons,
  };
}

export async function finalizeContest(
  student: StudentRow,
  ctx: FinalizeContext = {},
): Promise<FinalizeResult> {
  const db = ctx.db ?? getDb();

  return db.transaction(async (tx) => {
    // Serialize concurrent finalize clicks on the same student.
    const locked = await tx.query<StudentRow>(
      "select * from students where id = $1 for update",
      [student.id],
    );
    const row = locked.rows[0];
    if (!row) throw errors.notFound("Student not found.");

    const contest = await getContestById(row.contest_id, tx);
    if (!contest) throw errors.notFound("Contest not found.");
    if (computeContestStatus(contest).contest === "SCHEDULED") {
      throw errors.forbidden("The contest has not started yet.");
    }

    // Idempotent: a second finalize is a no-op and never moves the timestamp.
    if (row.finalized_at) {
      const readiness = await evaluateFinalizeReadiness(tx, row);
      return {
        finalizedAt: row.finalized_at,
        alreadyFinalized: true,
        student: row,
        readiness,
      };
    }

    // Server-side re-validation. The client's `allCompleted` flag is ignored.
    const track = await getTrackByYear(row.contest_id, row.year, tx);
    if (!track) throw errors.conflict("Your contest track is not configured.");

    const counts = await getCompletionCounts(tx, row);
    if (counts.total === 0 || counts.completed < counts.total) {
      throw errors.conflict("Complete every level before submitting the contest for review.");
    }

    // The completion timestamp is normally set the moment the final level is
    // completed; recorded defensively here for legacy rows so the finisher
    // leaderboard and elapsed time remain correct.
    await checkAndRecordContestFinish(tx, row, track.id);

    const now = new Date().toISOString();
    const updated = await tx.query<StudentRow>(
      `update students
          set finalized_at = $2,
              finalist_status = case
                when finalist_status = 'PROVISIONAL' then 'UNDER_REVIEW'
                else finalist_status
              end,
              -- Freeze the official personal-timer elapsed duration. Students who
              -- started before the timer feature (started_at null) keep whatever
              -- duration was already recorded.
              elapsed_duration_ms = case
                when started_at is not null
                  then (extract(epoch from (now() - started_at)) * 1000)::bigint
                else elapsed_duration_ms
              end
        where id = $1
        returning *`,
      [row.id, now],
    );
    const saved = updated.rows[0]!;

    await writeAudit(
      {
        actorType: "STUDENT",
        actorId: row.id,
        action: "contest.finalized",
        entityType: "student",
        entityId: row.id,
        metadata: {
          finalizedAt: now,
          finalistStatus: saved.finalist_status,
          levelsCompleted: counts.completed,
          totalLevels: counts.total,
        },
        ip: ctx.ip,
      },
      tx,
    );

    const readiness = await evaluateFinalizeReadiness(tx, saved);
    return {
      finalizedAt: now,
      alreadyFinalized: false,
      student: saved,
      readiness,
    };
  });
}
