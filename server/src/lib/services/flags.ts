import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { isWithinContestWindow } from "@/lib/services/contest";
import type {
  ContestRow,
  FlagKind,
  FlagSeverity,
  SuspiciousFlagRow,
  Year,
} from "@/lib/types";

/**
 * Lightweight, privacy-conscious review flags. Flags never disqualify a student
 * automatically - they only surface activity for an organiser to inspect.
 */
export interface FlagInput {
  contestId: string;
  kind: FlagKind;
  severity?: FlagSeverity;
  studentId?: string | null;
  levelId?: string | null;
  submissionId?: string | null;
  details?: Record<string, unknown>;
}

async function insertFlag(db: Db, input: FlagInput): Promise<void> {
  await db.query(
    `insert into suspicious_flags (contest_id, student_id, level_id, submission_id, kind, severity, details)
     select $1, $2, $3, $4, $5, $6, $7::jsonb
     where not exists (
       select 1 from suspicious_flags f
        where f.contest_id = $1
          and f.kind = $5
          and f.student_id is not distinct from $2
          and f.submission_id is not distinct from $4
          and f.resolved_at is null
     )`,
    [
      input.contestId,
      input.studentId ?? null,
      input.levelId ?? null,
      input.submissionId ?? null,
      input.kind,
      input.severity ?? "LOW",
      JSON.stringify(input.details ?? {}),
    ],
  );
}

export async function recordFlag(input: FlagInput, db: Db = getDb()): Promise<void> {
  await insertFlag(db, input);
}

/** Two participants claiming the same LeetCode submission link. */
export async function detectDuplicateSubmissionUrl(
  contestId: string,
  studentId: string,
  submissionId: string,
  submissionUrl: string | null,
  levelId: string,
  db: Db = getDb(),
): Promise<void> {
  if (!submissionUrl) return;
  const { rows } = await db.query<{ id: string; student_id: string }>(
    `select cs.id, cs.student_id
       from coding_submissions cs
       join students s on s.id = cs.student_id
      where s.contest_id = $1
        and cs.submission_url = $2
        and cs.student_id <> $3
        and cs.status <> 'REJECTED'
      limit 1`,
    [contestId, submissionUrl, studentId],
  );
  const other = rows[0];
  if (!other) return;
  await insertFlag(db, {
    contestId,
    studentId,
    levelId,
    submissionId,
    kind: "DUPLICATE_SUBMISSION_URL",
    severity: "HIGH",
    details: { submissionUrl, otherStudentId: other.student_id, otherSubmissionId: other.id },
  });
}

/** A participant whose evidence has been rejected repeatedly. */
export async function detectRepeatedRejections(
  contestId: string,
  studentId: string,
  db: Db = getDb(),
): Promise<void> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from coding_submissions
      where student_id = $1 and status = 'REJECTED'`,
    [studentId],
  );
  const rejected = rows[0]?.count ?? 0;
  if (rejected < 3) return;
  await insertFlag(db, {
    contestId,
    studentId,
    kind: "REPEATED_REJECTED_EVIDENCE",
    severity: "MEDIUM",
    details: { rejectedSubmissions: rejected },
  });
}

/** Evidence claimed outside the configured contest window. */
export async function detectOutsideWindow(
  contest: ContestRow,
  studentId: string,
  levelId: string,
  submissionId: string,
  db: Db = getDb(),
): Promise<void> {
  if (isWithinContestWindow(contest, new Date())) return;
  await insertFlag(db, {
    contestId: contest.id,
    studentId,
    levelId,
    submissionId,
    kind: "SUBMISSION_OUTSIDE_WINDOW",
    severity: "MEDIUM",
    details: { reportedAt: new Date().toISOString(), contestEndAt: contest.end_at },
  });
}

/** Several levels completed within a very short interval. */
export async function detectRapidCompletion(
  contestId: string,
  studentId: string,
  levelId: string,
  db: Db = getDb(),
): Promise<void> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from student_level_progress
      where student_id = $1 and status = 'COMPLETED'
        and completed_at > now() - interval '10 minutes'`,
    [studentId],
  );
  const completed = rows[0]?.count ?? 0;
  if (completed < 3) return;
  await insertFlag(db, {
    contestId,
    studentId,
    levelId,
    kind: "RAPID_LEVEL_COMPLETION",
    severity: "LOW",
    details: { completedInTenMinutes: completed },
  });
}

export interface FlagWithContext extends SuspiciousFlagRow {
  student_name: string | null;
  student_roll: string | null;
  student_year: Year | null;
  level_number: number | null;
  level_title: string | null;
}

export async function listFlags(
  contestId: string,
  options: { openOnly?: boolean } = {},
  db: Db = getDb(),
): Promise<FlagWithContext[]> {
  const openOnly = options.openOnly ?? true;
  const { rows } = await db.query<FlagWithContext>(
    `select f.*, s.full_name as student_name, s.roll_number as student_roll, s.year as student_year,
            l.level_number, l.title as level_title
       from suspicious_flags f
       left join students s on s.id = f.student_id
       left join levels l on l.id = f.level_id
      where f.contest_id = $1
        and ($2::boolean = false or f.resolved_at is null)
      order by f.created_at desc
      limit 200`,
    [contestId, openOnly],
  );
  return rows;
}

export async function resolveFlag(
  adminId: string,
  flagId: string,
  db: Db = getDb(),
): Promise<SuspiciousFlagRow> {
  return db.transaction(async (tx) => {
    const result = await tx.query<SuspiciousFlagRow>(
      `update suspicious_flags
          set resolved_at = now(), resolved_by = $2
        where id = $1 and resolved_at is null
        returning *`,
      [flagId, adminId],
    );
    const flag = result.rows[0];
    if (!flag) throw errors.notFound("Flag not found or already resolved.");
    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "flag.resolve",
        entityType: "suspicious_flag",
        entityId: flagId,
        metadata: { kind: flag.kind },
      },
      tx,
    );
    return flag;
  });
}

/** Records that an organiser corrected a student's linked LeetCode identity. */
export async function flagIdentityChanged(
  contestId: string,
  studentId: string,
  details: Record<string, unknown>,
  db: Db = getDb(),
): Promise<void> {
  await insertFlag(db, {
    contestId,
    studentId,
    kind: "IDENTITY_CHANGED",
    severity: "MEDIUM",
    details,
  });
}
