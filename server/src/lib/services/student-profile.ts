import type { LevelRow, PublicStudent, StudentRow } from "@/lib/types";
import { toPublicStudent } from "@/lib/serializers";

import type { CodingSubmissionRow, StudentLevelProgressRow } from "@/lib/types";
import type { Db } from "@/lib/db/types";
import { getDb } from "@/lib/db";

export interface LevelSubmissionHistory {
  level: LevelRow & { problem_title: string | null; problem_url: string | null };
  progress: StudentLevelProgressRow | null;
  submissions: CodingSubmissionRow[];
}

export interface StudentProfile {
  student: PublicStudent;
  levelsCompleted: number;
  totalPoints: number;
  lastActivity: string | null;
  firstSubmissionAt: string | null;
  contestCompletedAt: string | null;
  totalLevels: number;
  history: LevelSubmissionHistory[];
}

/**
 * Returns a comprehensive student contest profile for the admin review UI.
 * Includes all levels (in order), all submissions per level, and key timestamps.
 */
export async function getStudentProfile(
  contestId: string,
  studentId: string,
  db: Db = getDb(),
): Promise<StudentProfile | null> {
  const studentResult = await db.query<StudentRow>(
    "select * from students where id = $1 and contest_id = $2",
    [studentId, contestId],
  );
  const student = studentResult.rows[0];
  if (!student) return null;

  // Get the track for the student's year
  const trackResult = await db.query<{ id: string }>(
    "select id from contest_tracks where contest_id = $1 and year = $2",
    [contestId, student.year],
  );
  const trackId = trackResult.rows[0]?.id;

  // Get all levels in contest order with problem info
  const levelsResult = await db.query<LevelRow & { problem_title: string | null; problem_url: string | null }>(
    `select l.*,
            p.title as problem_title,
            p.url as problem_url
       from levels l
       left join leetcode_problems p on p.level_id = l.id
      where l.track_id = $1 and l.is_active = true
      order by l.order_index asc, l.level_number asc`,
    [trackId ?? ""],
  );

  // Get all progress records for this student
  const progressResult = await db.query<StudentLevelProgressRow>(
    "select * from student_level_progress where student_id = $1",
    [studentId],
  );
  const progressMap = new Map<string, StudentLevelProgressRow>(
    progressResult.rows.map((p) => [p.level_id, p]),
  );

  // Get all submissions for this student, ordered by level and attempt
  const submissionsResult = await db.query<CodingSubmissionRow>(
    `select * from coding_submissions
      where student_id = $1
      order by level_id, attempt_number asc, created_at asc`,
    [studentId],
  );
  const submissionsByLevel = new Map<string, CodingSubmissionRow[]>();
  for (const sub of submissionsResult.rows) {
    const existing = submissionsByLevel.get(sub.level_id) ?? [];
    existing.push(sub);
    submissionsByLevel.set(sub.level_id, existing);
  }

  // Build history
  const history: LevelSubmissionHistory[] = levelsResult.rows.map((level) => ({
    level,
    progress: progressMap.get(level.id) ?? null,
    submissions: submissionsByLevel.get(level.id) ?? [],
  }));

  // Summary stats
  const scoreResult = await db.query<{ total: number }>(
    "select coalesce(sum(points), 0)::int as total from score_events where student_id = $1",
    [studentId],
  );
  const levelsCompleted = progressResult.rows.filter((p) => p.status === "COMPLETED").length;
  const totalPoints = scoreResult.rows[0]?.total ?? 0;

  // Last activity: most recent submission created_at
  const lastActivity = submissionsResult.rows.at(-1)?.created_at ?? null;
  const firstSubmissionAt = submissionsResult.rows.at(0)?.created_at ?? null;

  // Contest completed at: when student completed the last level
  const completedProgresses = progressResult.rows
    .filter((p) => p.status === "COMPLETED" && p.completed_at)
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime());
  const contestCompletedAt =
    levelsCompleted === levelsResult.rows.length && completedProgresses.length > 0
      ? completedProgresses[0]!.completed_at
      : null;

  return {
    student: toPublicStudent(student),
    levelsCompleted,
    totalPoints,
    lastActivity,
    firstSubmissionAt,
    contestCompletedAt,
    totalLevels: levelsResult.rows.length,
    history,
  };
}
