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
import { evaluateLevelCompletion, getLevelContext, getNextLevel } from "@/lib/services/progression";
import type {
  CodingSubmissionRow,
  LevelRow,
  ReviewDecision,
  RoadmapLevel,
  StudentRow,
  SubmissionReviewState,
  SubmissionStatus,
  Year,
} from "@/lib/types";
import { runVerification, type VerificationOutcome } from "@/lib/verification";
import type { AdminReviewStateInput, SubmissionInput } from "@/lib/validation/submission";

export interface CodingSubmissionResult extends CodingSubmissionRow {
  nextLevel?: RoadmapLevel | null;
  completed?: boolean;
}

export interface SubmissionContext {
  db?: Db;
  ip?: string | null;
}

function assertLeetCodeSubmissionUrl(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw errors.badRequest("LeetCode submission URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw errors.badRequest("Submission URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw errors.badRequest("Submission URL must use http or https.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "leetcode.com" && !host.endsWith(".leetcode.com")) {
    throw errors.badRequest("Submission URL must be from leetcode.com.");
  }
  return parsed.toString();
}

export async function createSubmission(
  student: StudentRow,
  input: SubmissionInput,
  ctx: SubmissionContext = {},
): Promise<CodingSubmissionResult> {
  const db = ctx.db ?? getDb();

  const submissionUrl = assertLeetCodeSubmissionUrl(input.submissionUrl);
  if (!input.sourceCode || !input.sourceCode.trim()) {
    throw errors.badRequest("Complete solution source code is required.");
  }
  const sourceCode = input.sourceCode.trim();
  const screenshotPath = input.screenshotPath?.trim() || null;
  if (screenshotPath && !isValidEvidencePath(screenshotPath)) {
    throw errors.badRequest("The screenshot reference is invalid.");
  }
  const note = input.note?.trim() || null;
  const programmingLanguage = input.programmingLanguage?.trim() || "python";
  const codeFileName = input.codeFileName?.trim() || null;

  return db.transaction(async (tx) => {
    const { level, problem, progress } = await getLevelContext(student, input.levelId, tx);
    const contest = await getContestById(student.contest_id, tx);
    if (!contest) throw errors.notFound("Contest not found.");

    const now = new Date();
    if (!isWithinContestWindowWithGrace(contest, now) && !contest.allow_late_submissions) {
      throw errors.forbidden("The contest submission window has closed.");
    }

    // Check if level already has an active (non-rejected) submission
    const existingActive = await tx.query<CodingSubmissionRow>(
      `select * from coding_submissions
        where student_id = $1 and level_id = $2 and status <> 'REJECTED'
        order by created_at desc limit 1`,
      [student.id, input.levelId],
    );

    if (existingActive.rows.length > 0) {
      const existing = existingActive.rows[0]!;
      if (existing.status === "VERIFIED") {
        throw errors.conflict("This level has already been verified.");
      }
      // Idempotent retry: ensure progression completed and return with next level
      await evaluateLevelCompletion(tx, student, level);
      const nextLevel = await getNextLevel(tx, student.id, level);
      return Object.assign(existing, { nextLevel, completed: true });
    }

    // Count existing attempts for attempt_number (all statuses preserved for audit)
    const attemptCountResult = await tx.query<{ count: number }>(
      `select count(*)::int as count from coding_submissions
        where student_id = $1 and level_id = $2`,
      [student.id, input.levelId],
    );
    const attemptNumber = (attemptCountResult.rows[0]?.count ?? 0) + 1;

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

    const status: SubmissionStatus =
      outcome.status === "VERIFIED"
        ? "VERIFIED"
        : outcome.status === "REJECTED"
          ? "REJECTED"
          : "PENDING_REVIEW";
    const isAutomatic = outcome.authoritative && status === "VERIFIED";
    const verifiedSolvedAt = outcome.verifiedSolvedAt?.toISOString() ?? null;
    const verifiedAt = status === "VERIFIED" ? now.toISOString() : null;

    // Always INSERT a new row in tx to preserve the complete attempt history for audit purposes.
    const inserted = await tx.query<CodingSubmissionRow>(
      `insert into coding_submissions
         (student_id, level_id, problem_id, status, verification_source, submission_url,
          screenshot_path, student_note, problem_slug, verdict, reported_solved_at,
          verified_solved_at, verified_at, attempt_number, source_code,
          programming_language, code_file_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12, $13, $14, $15, $16)
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
        attemptNumber,
        sourceCode,
        programmingLanguage,
        codeFileName,
      ],
    );
    const saved = inserted.rows[0]!;

    await writeAudit(
      {
        actorType: "STUDENT",
        actorId: student.id,
        action: "submission.create",
        entityType: "coding_submission",
        entityId: saved.id,
        metadata: { status, provider: outcome.provider, levelId: input.levelId, attemptNumber },
        ip: ctx.ip,
      },
      tx,
    );

    // Evaluate completion immediately after any non-rejected submission. Progression
    // no longer requires admin verification — admin review is an auditing step only.
    let nextLevel: RoadmapLevel | null = null;
    let completed = false;
    if (status !== "REJECTED") {
      completed = await evaluateLevelCompletion(tx, student, level);
      nextLevel = await getNextLevel(tx, student.id, level);
    }

    // Anti-cheating signals are recorded for organiser review only. They never
    // alter the submission outcome automatically.
    await detectDuplicateSubmissionUrl(
      contest.id,
      student.id,
      saved.id,
      submissionUrl,
      level.id,
      tx,
    );
    await detectOutsideWindow(contest, student.id, level.id, saved.id, tx);

    return Object.assign(saved, { nextLevel, completed });
  });
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
              review_state = $5,
              verified_at = $3,
              verified_solved_at = $3,
              verdict = $4
        where id = $1 returning *`,
      [
        submissionId,
        decision === "APPROVED" ? "VERIFIED" : "REJECTED",
        decision === "APPROVED" ? now : null,
        decision === "APPROVED" ? "Accepted (manual review)" : "Rejected (manual review)",
        decision === "APPROVED" ? "REVIEWED_VALID" : "REVIEWED_INVALID",
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

/**
 * Update the admin-side review state for a submission without changing its
 * PENDING_REVIEW/VERIFIED/REJECTED status. This allows admins to mark
 * submissions as reviewed, flagged, etc. without blocking student progression.
 */
export async function setSubmissionReviewState(
  adminId: string,
  input: AdminReviewStateInput,
  ctx: ReviewContext = {},
): Promise<CodingSubmissionRow> {
  const db = ctx.db ?? getDb();
  const result = await db.query<CodingSubmissionRow>(
    `update coding_submissions
        set review_state = $2
      where id = $1
      returning *`,
    [input.submissionId, input.reviewState],
  );
  if (!result.rows[0]) throw errors.notFound("Submission not found.");

  await writeAudit(
    {
      actorType: "ADMIN",
      actorId: adminId,
      action: "submission.review_state",
      entityType: "coding_submission",
      entityId: input.submissionId,
      metadata: { reviewState: input.reviewState, notes: input.notes },
      ip: ctx.ip,
    },
    db,
  );

  return result.rows[0];
}

/**
 * Request source-code evidence from the student for a given submission.
 * The admin can request code from any submission that doesn't already have source code.
 */
export async function requestSubmissionCode(
  adminId: string,
  submissionId: string,
  ctx: ReviewContext = {},
): Promise<CodingSubmissionRow> {
  const db = ctx.db ?? getDb();
  const result = await db.query<CodingSubmissionRow>(
    `update coding_submissions
        set code_requested = true
      where id = $1
      returning *`,
    [submissionId],
  );
  if (!result.rows[0]) throw errors.notFound("Submission not found.");

  await writeAudit(
    {
      actorType: "ADMIN",
      actorId: adminId,
      action: "submission.code_requested",
      entityType: "coding_submission",
      entityId: submissionId,
      metadata: {},
      ip: ctx.ip,
    },
    db,
  );

  return result.rows[0];
}

// Re-export for use in student profile queries
export type { SubmissionReviewState };
