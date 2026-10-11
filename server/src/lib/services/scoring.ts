import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import type { ScoreSource } from "@/lib/types";

export interface AwardPointsInput {
  studentId: string;
  contestId: string;
  levelId?: string | null;
  source: ScoreSource;
  points: number;
  reason?: string;
  idempotencyKey: string;
}

export interface AwardResult {
  awarded: boolean;
}

/**
 * Inserts an idempotent score event. A repeated call with the same
 * idempotency key is a no-op, guaranteeing that points can never be awarded
 * twice for the same achievement.
 */
export async function awardPoints(input: AwardPointsInput, db: Db = getDb()): Promise<AwardResult> {
  const { rows } = await db.query<{ id: string }>(
    `insert into score_events (student_id, contest_id, level_id, source, points, reason, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      input.studentId,
      input.contestId,
      input.levelId ?? null,
      input.source,
      input.points,
      input.reason ?? "",
      input.idempotencyKey,
    ],
  );
  return { awarded: rows.length > 0 };
}

export interface ScoreSummary {
  totalPoints: number;
  lastScoreAt: string | null;
}

export async function getScoreSummary(db: Db, studentId: string): Promise<ScoreSummary> {
  const { rows } = await db.query<{ total: number; last_at: string | null }>(
    `select coalesce(sum(points), 0)::int as total, max(created_at) as last_at
       from score_events where student_id = $1`,
    [studentId],
  );
  return { totalPoints: rows[0]?.total ?? 0, lastScoreAt: rows[0]?.last_at ?? null };
}
