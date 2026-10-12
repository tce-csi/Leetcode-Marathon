import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import {
  LEETCODE_SUBMISSION_URL_MESSAGE,
  parseLeetcodeSubmissionDetailUrl,
} from "@/lib/normalize";
import { isValidEvidencePath } from "@/lib/storage";
import { isWithinContestWindowWithGrace } from "@/lib/services/contest";
import {
  detectDuplicateSubmissionUrl,
  detectOutsideWindow,
  detectRepeatedRejections,
} from "@/lib/services/flags";
import {
  evaluateLevelCompletion,
  getLevelContext,
  nextRoadmapLevel,
} from "@/lib/services/progression";
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
  totalLevels?: number;
}

export interface SubmissionContext {
  db?: Db;
  ip?: string | null;
}

function assertLeetCodeSubmissionUrl(value: string | undefined): string {
  const parsed = parseLeetcodeSubmissionDetailUrl(value);
  if (!parsed) {
    throw errors.badRequest(LEETCODE_SUBMISSION_URL_MESSAGE);
  }
  return parsed.url;
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
    const { level, problem, progress, contest, trackLevels, totalLevels, activeSubmission } =
      await getLevelContext(student, input.levelId, tx);
    if (!contest) throw errors.notFound("Contest not found.");

    const now = new Date();
    if (!isWithinContestWindowWithGrace(contest, now) && !contest.allow_late_submissions) {
      throw errors.forbidden("The contest submission window has closed.");
    }

    // A finalized contest is frozen: the attempt has been submitted for review
    // and no further submissions may change it. Lock the student row so a
    // concurrent finalize cannot race past this check.
    const lockedStudent = await tx.query<Pick<StudentRow, "finalized_at">>(
      "select finalized_at from students where id = $1 for update",
      [student.id],
    );
    if (lockedStudent.rows[0]?.finalized_at) {
      throw errors.conflict(
        "This contest has been submitted for review and can no longer be changed.",
      );
    }

    // Strict one-submission policy: a level is locked by its active (non-rejected)
    // submission. An identical report is an idempotent retry; changed evidence is
    // rejected because each level accepts exactly one submission. Rejected rows
    // never lock the level (the DB trigger keeps `is_official` in sync), so a
    // fresh attempt after a rejection flows past this check.
    if (activeSubmission) {
      const existing = activeSubmission;
      const sameUrl = (existing.submission_url ?? "").trim() === submissionUrl.trim();
      const sameCode = (existing.source_code ?? "").trim() === sourceCode;
      if (sameUrl && sameCode) {
        // Idempotent retry: ensure progression completed and return with next level
        const completed = await evaluateLevelCompletion(tx, student, level, {
          trackTotalLevels: totalLevels,
          trackCompletedLevels: trackLevels.filter(
            (t) => t.progress_status === "COMPLETED" && t.id !== level.id,
          ).length,
        });
        const nextLevel = completed ? nextRoadmapLevel(trackLevels, level) : null;
        return Object.assign(existing, { nextLevel, completed, totalLevels });
      }
      throw errors.conflict(
        "This level already has a solution submitted for review. Each level accepts exactly one submission.",
      );
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
    // attempt_number is computed inside the statement so no separate COUNT round trip is needed.
    // `is_official` is derived from status by the database trigger on INSERT.
    let inserted;
    try {
      inserted = await tx.query<CodingSubmissionRow>(
        `insert into coding_submissions
           (student_id, level_id, problem_id, status, verification_source, submission_url,
            screenshot_path, student_note, problem_slug, verdict, reported_solved_at,
            verified_solved_at, verified_at, attempt_number, source_code,
            programming_language, code_file_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12,
                 (select coalesce(count(*), 0) + 1 from coding_submissions sub
                   where sub.student_id = $1 and sub.level_id = $2),
                 $13, $14, $15)
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
          sourceCode,
          programmingLanguage,
          codeFileName,
        ],
      );
    } catch (error) {
      // Race guard: a concurrent request slipped an official row in between our
      // check and the INSERT. The partial unique index rejects it, so surface the
      // same one-submission conflict instead of a bare database error.
      if ((error as { code?: string }).code === "23505") {
        throw errors.conflict(
          "This level already has a solution submitted for review. Each level accepts exactly one submission.",
        );
      }
      throw error;
    }
    const saved = inserted.rows[0]!;
    const attemptNumber = saved.attempt_number;

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
      // Hints skip re-querying the submission we just inserted: there is a
      // non-rejected submission (this one) and its verified status is known.
      completed = await evaluateLevelCompletion(tx, student, level, {
        submissionSatisfied: true,
        verifiedSubmissionSatisfied: status === "VERIFIED",
        trackTotalLevels: totalLevels,
        trackCompletedLevels: trackLevels.filter(
          (t) => t.progress_status === "COMPLETED" && t.id !== level.id,
        ).length,
      });
      nextLevel = completed ? nextRoadmapLevel(trackLevels, level) : null;
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

    return Object.assign(saved, { nextLevel, completed, totalLevels });
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
