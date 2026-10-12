import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { formatElapsed } from "@/lib/services/progression";
import type {
  FinalistStatus,
  FinisherEntry,
  FinisherStats,
  StudentRow,
  Year,
} from "@/lib/types";
import type { FinalistStatusInput } from "@/lib/validation/submission";

export interface FinisherListOptions {
  year: Year;
  status?: FinalistStatus | "ALL";
  search?: string;
  sortBy?: "finished_at" | "elapsed";
  verifiedOnly?: boolean;
}

export async function listFinishers(
  contestId: string,
  options: FinisherListOptions,
  db: Db = getDb(),
): Promise<FinisherEntry[]> {
  const clauses: string[] = [
    "s.contest_id = $1",
    "s.year = $2",
    "s.finished_at is not null",
  ];
  const values: unknown[] = [contestId, options.year];

  if (options.verifiedOnly) {
    clauses.push("s.finalist_status = 'VERIFIED'");
  } else if (options.status && options.status !== "ALL") {
    values.push(options.status);
    clauses.push(`s.finalist_status = $${values.length}`);
  }

  if (options.search && options.search.trim()) {
    values.push(`%${options.search.trim().toLowerCase()}%`);
    clauses.push(
      `(lower(s.full_name) like $${values.length} or lower(s.normalized_roll_number) like $${values.length})`,
    );
  }

  const orderBy =
    options.sortBy === "elapsed"
      ? "s.elapsed_duration_ms asc, s.finished_at asc, s.created_at asc"
      : "s.finished_at asc, s.elapsed_duration_ms asc, s.created_at asc";

  // Get total levels for this track
  const trackLevelsResult = await db.query<{ count: number }>(
    `select count(l.id)::int as count
       from levels l
       join contest_tracks ct on ct.id = l.track_id
      where ct.contest_id = $1 and ct.year = $2 and l.is_active = true`,
    [contestId, options.year],
  );
  const totalLevelsCount = trackLevelsResult.rows[0]?.count ?? 0;

  const { rows } = await db.query<
    StudentRow & {
      completed_levels: number;
      total_points: number;
    }
  >(
    `select s.*,
            coalesce((
              select count(p.id) filter (where p.status = 'COMPLETED')::int
                from student_level_progress p
               where p.student_id = s.id
            ), 0) as completed_levels,
            coalesce((
              select sum(se.points)::int
                from score_events se
               where se.student_id = s.id
            ), 0) as total_points
       from students s
      where ${clauses.join(" and ")}
      order by ${orderBy}`,
    values,
  );

  return rows.map((row, idx) => ({
    rank: idx + 1,
    studentId: row.id,
    fullName: row.full_name,
    rollNumber: row.roll_number,
    year: row.year,
    leetcodeUsername: row.leetcode_username,
    leetcodeProfileUrl: row.leetcode_profile_url,
    completedLevels: row.completed_levels,
    totalLevels: totalLevelsCount,
    contestStartedAt: row.contest_started_at,
    finishedAt: row.finished_at!,
    elapsedDurationMs: Number(row.elapsed_duration_ms ?? 0),
    elapsedFormatted: formatElapsed(Number(row.elapsed_duration_ms ?? 0)),
    finalistStatus: row.finalist_status,
    finalistVerifiedAt: row.finalist_verified_at,
    finalistVerifiedBy: row.finalist_verified_by,
    finalistReviewNotes: row.finalist_review_notes,
    finalistDisqualificationReason: row.finalist_disqualification_reason,
    totalPoints: row.total_points,
  }));
}

export async function getFinisherStats(
  contestId: string,
  year: Year,
  db: Db = getDb(),
): Promise<FinisherStats> {
  const result = await db.query<{
    total_registered: number;
    currently_participating: number;
    total_finished: number;
    earliest_finish: string | null;
    fastest_elapsed_ms: number | null;
    verified_finalists: number;
  }>(
    `select
       count(*)::int as total_registered,
       count(*) filter (where is_active = true)::int as currently_participating,
       count(*) filter (where finished_at is not null)::int as total_finished,
       min(finished_at) as earliest_finish,
       min(elapsed_duration_ms) filter (where finished_at is not null) as fastest_elapsed_ms,
       count(*) filter (where finalist_status = 'VERIFIED')::int as verified_finalists
     from students
    where contest_id = $1 and year = $2`,
    [contestId, year],
  );

  const row = result.rows[0];
  const fastestMs = row?.fastest_elapsed_ms ? Number(row.fastest_elapsed_ms) : null;

  return {
    totalRegistered: row?.total_registered ?? 0,
    currentlyParticipating: row?.currently_participating ?? 0,
    totalFinished: row?.total_finished ?? 0,
    earliestFinish: row?.earliest_finish ?? null,
    fastestElapsedMs: fastestMs,
    fastestElapsedFormatted: formatElapsed(fastestMs),
    verifiedFinalists: row?.verified_finalists ?? 0,
  };
}

export async function updateFinalistStatus(
  adminId: string,
  studentId: string,
  input: FinalistStatusInput,
  db: Db = getDb(),
): Promise<StudentRow> {
  const now = new Date().toISOString();
  const result = await db.query<StudentRow>(
    `update students
        set finalist_status = $2,
            finalist_verified_at = $3,
            finalist_verified_by = $4,
            finalist_review_notes = $5,
            finalist_disqualification_reason = $6
      where id = $1
      returning *`,
    [
      studentId,
      input.finalistStatus,
      now,
      adminId,
      input.reviewNotes || null,
      input.disqualificationReason || null,
    ],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw errors.notFound("Student not found.");
  }

  await writeAudit(
    {
      actorType: "ADMIN",
      actorId: adminId,
      action: "student.finalist_status",
      entityType: "student",
      entityId: studentId,
      metadata: {
        status: input.finalistStatus,
        reviewNotes: input.reviewNotes,
        disqualificationReason: input.disqualificationReason,
      },
    },
    db,
  );

  return updated;
}
