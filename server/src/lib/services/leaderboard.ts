import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import type { ContestRow, LeaderboardEntry, Year } from "@/lib/types";

export function maskIdentifier(rollNumber: string): string {
  const value = rollNumber.trim();
  if (value.length <= 4) return `${value[0] ?? "?"}***`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

interface LeaderboardRow {
  id: string;
  full_name: string;
  roll_number: string;
  year: Year;
  total_points: number;
  levels_completed: number;
  last_score_at: string | null;
}

function orderByClause(rule: ContestRow["ranking_rule"]): string {
  switch (rule) {
    case "LEVELS_POINTS_TIME":
      return "levels_completed desc, total_points desc, last_score_at asc nulls last, s.created_at asc";
    case "POINTS_TIME":
      return "total_points desc, last_score_at asc nulls last, s.created_at asc";
    case "POINTS_LEVELS_TIME":
    default:
      return "total_points desc, levels_completed desc, last_score_at asc nulls last, s.created_at asc";
  }
}

export interface LeaderboardOptions {
  currentStudentId?: string;
  limit?: number;
}

export async function getLeaderboard(
  contest: ContestRow,
  year: Year,
  options: LeaderboardOptions = {},
  db: Db = getDb(),
): Promise<LeaderboardEntry[]> {
  const limit = options.limit ?? 200;
  const { rows } = await db.query<LeaderboardRow>(
    `select s.id, s.full_name, s.roll_number, s.year,
            coalesce(sum(se.points), 0)::int as total_points,
            count(distinct slp.level_id)::int as levels_completed,
            max(se.created_at) as last_score_at
       from students s
       left join score_events se on se.student_id = s.id and se.contest_id = $1
       left join student_level_progress slp on slp.student_id = s.id and slp.status = 'COMPLETED'
      where s.contest_id = $1 and s.year = $2 and s.is_active = true
      group by s.id
      order by ${orderByClause(contest.ranking_rule)}
      limit $3`,
    [contest.id, year, limit],
  );

  let previousKey: string | null = null;
  let previousRank = 0;
  return rows.map((row, index) => {
    const key = `${row.total_points}|${row.levels_completed}|${row.last_score_at ?? ""}`;
    const rank = key === previousKey ? previousRank : index + 1;
    previousKey = key;
    previousRank = rank;
    return {
      rank,
      studentId: row.id,
      name: row.full_name,
      displayId: maskIdentifier(row.roll_number),
      year: row.year,
      levelsCompleted: row.levels_completed,
      totalPoints: row.total_points,
      lastScoreAt: row.last_score_at,
      isCurrentStudent: options.currentStudentId === row.id,
    } satisfies LeaderboardEntry;
  });
}

/** Rank of one student within their year's leaderboard (1-based), or null. */
export async function getStudentRank(
  contest: ContestRow,
  studentId: string,
  year: Year,
  db: Db = getDb(),
): Promise<number | null> {
  const entries = await getLeaderboard(contest, year, { currentStudentId: studentId }, db);
  const entry = entries.find((e) => e.studentId === studentId);
  return entry?.rank ?? null;
}
