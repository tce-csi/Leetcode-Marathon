import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { isValidEvidencePath } from "@/lib/storage";
import { getContestById, isWithinContestWindowWithGrace } from "@/lib/services/contest";
import {
  detectDuplicateSubmissionUrl,
  detectOutsideWindow,
  detectRepeatedRejections,
} from "@/lib/services/flags";
import { evaluateLevelCompletion, getLevelContext } from "@/lib/services/progression";
import type { CodingSubmissionRow, LevelRow, ReviewDecision, StudentRow, SubmissionStatus, Year } from "@/lib/types";
import { runVerification, type VerificationOutcome } from "@/lib/verification";
import type { SubmissionInput } from "@/lib/validation/submission";

export interface SubmissionContext {
  db?: Db;
  ip?: string | null;
}

function assertHttpUrlOrEmpty(value: string | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw errors.badRequest("Submission URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw errors.badRequest("Submission URL must use http or https.");
  }
  return parsed.toString();
}

export async function createSubmission(
  student: StudentRow,
  input: SubmissionInput,
  ctx: SubmissionContext = {},
): Promise<CodingSubmissionRow> {
  const db = ctx.db ?? getDb();
  const { level, problem, progress } = await getLevelContext(student, input.levelId, db);
  const contest = await getContestById(student.contest_id, db);
  if (!contest) throw errors.notFound("Contest not found.");

  const now = new Date();
  if (!isWithinContestWindowWithGrace(contest, now) && !contest.allow_late_submissions) {
    throw errors.forbidden("The contest submission window has closed.");
  }

  const submissionUrl = assertHttpUrlOrEmpty(input.submissionUrl);
  const screenshotPath = input.screenshotPath?.trim() || null;
  if (screenshotPath && !isValidEvidencePath(screenshotPath)) {
    throw errors.badRequest("The screenshot reference is invalid.");
  }
  const note = input.note?.trim() || null;

  const existing = await db.query<CodingSubmissionRow>(
    `select * from coding_submissions
      where student_id = $1 and level_id = $2 and status <> 'REJECTED'
      order by created_at desc limit 1`,
    [student.id, input.levelId],
  );
  const current = existing.rows[0];
  if (current && current.status === "VERIFIED") {
    throw errors.conflict("This level has already been verified.");
  }

  const outcome = await verifySubmission(
    student,
    level,
    problem?.problem_slug ?? null,
    contest,
    submissionUrl,
    contest.require_submission_after_unlock && progress.unlocked_at
      ? new Date(progress.unlocked_at)
      : null,
  );

  const status: SubmissionStatus = outcome.status === "VERIFIED" ? "VERIFIED" : outcome.status === "REJECTED" ? "REJECTED" : "PENDING_REVIEW";
  const isAutomatic = outcome.authoritative && status === "VERIFIED";
  const verifiedSolvedAt = outcome.verifiedSolvedAt?.toISOString() ?? null;
  const verifiedAt = status === "VERIFIED" ? now.toISOString() : null;

  let saved: CodingSubmissionRow;
  if (current) {
    const updated = await db.query<CodingSubmissionRow>(
      `update coding_submissions
          set status = $2, verification_source = $3, submission_url = $4, screenshot_path = $5,
              student_note = $6, problem_slug = $7, verdict = $8,
              reported_solved_at = now(), verified_solved_at = $9, verified_at = $10
        where id = $1 returning *`,
      [
        current.id,
        status,
        isAutomatic ? "AUTOMATIC" : "MANUAL",
        submissionUrl,
        screenshotPath,
        note,
        problem?.problem_slug ?? null,
        outcome.verdict ?? null,
        verifiedSolvedAt,
        verifiedAt,
      ],
    );
    saved = updated.rows[0]!;
  } else {
    const inserted = await db.query<CodingSubmissionRow>(
      `insert into coding_submissions
         (student_id, level_id, problem_id, status, verification_source, submission_url,
          screenshot_path, student_note, problem_slug, verdict, reported_solved_at,
          verified_solved_at, verified_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12)
       returning *`,
      [
        student.id,
        input.levelId,
        problem?.id ?? null,
        status,
        isAutomatic ? "AUTOMATIC" : "MANUAL",
        submissionUrl,
        screenshotPath,
        note,
        problem?.problem_slug ?? null,
        outcome.verdict ?? null,
        verifiedSolvedAt,
        verifiedAt,
      ],
    );
    saved = inserted.rows[0]!;
  }

  await writeAudit(
    {
      actorType: "STUDENT",
      actorId: student.id,
      action: "submission.create",
      entityType: "coding_submission",
      entityId: saved.id,
      metadata: { status, provider: outcome.provider, levelId: input.levelId },
      ip: ctx.ip,
    },
    db,
  );

  if (status === "VERIFIED") {
    await evaluateLevelCompletion(db, student, level);
  }

  // Anti-cheating signals are recorded for organiser review only. They never
  // alter the submission outcome automatically.
  await detectDuplicateSubmissionUrl(
    contest.id,
    student.id,
    saved.id,
    submissionUrl,
    level.id,
    db,
  );
  await detectOutsideWindow(contest, student.id, level.id, saved.id, db);

  return saved;
}

async function verifySubmission(
  student: StudentRow,
  level: LevelRow,
  problemSlug: string | null,
  contest: { timezone: string; verification_mode: string; start_at: string | null; end_at: string | null },
  submissionUrl: string | null,
  notBefore: Date | null,
): Promise<VerificationOutcome> {
  if (contest.verification_mode === "MANUAL") {
    return {
      provider: "manual",
      status: "PENDING_REVIEW",
      reason: "Manual verification is enabled for this contest.",
      authoritative: false,
    };
  }
  const { outcome } = await runVerification({
    studentId: student.id,
    levelId: level.id,
    problemSlug,
    leetcodeUsername: student.leetcode_username,
    submissionUrl,
    contestTimezone: contest.timezone,
    notBefore,
    notAfter: contest.end_at ? new Date(contest.end_at) : null,
  });
  return outcome;
}

export interface SubmissionWithContext extends CodingSubmissionRow {
  student_name: string;
  student_roll: string;
  student_year: Year;
  leetcode_username: string;
  level_number: number;
  level_title: string;
  problem_title: string | null;
}

export async function getSubmissionsForStudent(
  studentId: string,
  db: Db = getDb(),
): Promise<CodingSubmissionRow[]> {
  const { rows } = await db.query<CodingSubmissionRow>(
    "select * from coding_submissions where student_id = $1 order by created_at desc",
    [studentId],
  );
  return rows;
}

export interface ReviewQueueFilters {
  status?: SubmissionStatus;
  year?: Year;
  search?: string;
}

export async function listSubmissionsForReview(
  contestId: string,
  filters: ReviewQueueFilters = {},
  db: Db = getDb(),
): Promise<SubmissionWithContext[]> {
  const clauses = ["s.contest_id = $1"];
  const values: unknown[] = [contestId];
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`cs.status = $${values.length}`);
  }
  if (filters.year) {
    values.push(filters.year);
    clauses.push(`s.year = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search.trim().toLowerCase()}%`);
    clauses.push(
      `(lower(s.full_name) like $${values.length} or lower(s.normalized_roll_number) like $${values.length})`,
    );
  }

  const { rows } = await db.query<SubmissionWithContext>(
    `select cs.*, s.full_name as student_name, s.roll_number as student_roll,
            s.year as student_year, s.leetcode_username,
            l.level_number, l.title as level_title, p.title as problem_title
       from coding_submissions cs
       join students s on s.id = cs.student_id
       join levels l on l.id = cs.level_id
       left join leetcode_problems p on p.id = cs.problem_id
      where ${clauses.join(" and ")}
      order by cs.created_at asc`,
    values,
  );
  return rows;
}

export async function getSubmissionWithContext(
  submissionId: string,
  db: Db = getDb(),
): Promise<SubmissionWithContext | null> {
  const { rows } = await db.query<SubmissionWithContext>(
    `select cs.*, s.full_name as student_name, s.roll_number as student_roll,
            s.year as student_year, s.leetcode_username,
            l.level_number, l.title as level_title, p.title as problem_title
       from coding_submissions cs
       join students s on s.id = cs.student_id
       join levels l on l.id = cs.level_id
       left join leetcode_problems p on p.id = cs.problem_id
      where cs.id = $1`,
    [submissionId],
  );
  return rows[0] ?? null;
}

export interface ReviewContext {
  db?: Db;
  ip?: string | null;
}

export async function reviewSubmission(
  adminId: string,
  submissionId: string,
  decision: ReviewDecision,
  reason: string,
  ctx: ReviewContext = {},
): Promise<CodingSubmissionRow> {
  const db = ctx.db ?? getDb();
  return db.transaction(async (tx) => {
    const result = await tx.query<CodingSubmissionRow>(
      "select * from coding_submissions where id = $1 for update",
      [submissionId],
    );
    const submission = result.rows[0];
    if (!submission) throw errors.notFound("Submission not found.");
    if (submission.status !== "PENDING_REVIEW") {
      throw errors.conflict("This submission has already been reviewed.");
    }

    await tx.query(
      `insert into submission_reviews (submission_id, reviewer_id, decision, reason)
       values ($1, $2, $3, $4)`,
      [submissionId, adminId, decision, reason || ""],
    );

    const now = new Date().toISOString();
    const updated = await tx.query<CodingSubmissionRow>(
      `update coding_submissions
          set status = $2,
              verified_at = $3,
              verified_solved_at = $3,
              verdict = $4
        where id = $1 returning *`,
      [
        submissionId,
        decision === "APPROVED" ? "VERIFIED" : "REJECTED",
        decision === "APPROVED" ? now : null,
        decision === "APPROVED" ? "Accepted (manual review)" : "Rejected (manual review)",
      ],
    );

    const student = await tx.query<StudentRow>("select * from students where id = $1", [
      submission.student_id,
    ]);
    const level = await tx.query<LevelRow>("select * from levels where id = $1", [
      submission.level_id,
    ]);

    if (decision === "APPROVED" && student.rows[0] && level.rows[0]) {
      await evaluateLevelCompletion(tx, student.rows[0], level.rows[0]);
    }
    if (decision === "REJECTED" && student.rows[0]) {
      await detectRepeatedRejections(student.rows[0].contest_id, student.rows[0].id, tx);
    }

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: decision === "APPROVED" ? "submission.approve" : "submission.reject",
        entityType: "coding_submission",
        entityId: submissionId,
        metadata: { reason },
        ip: ctx.ip,
      },
      tx,
    );

    return updated.rows[0]!;
  });
}
