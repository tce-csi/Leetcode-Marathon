import { Router } from "express";
import multer from "multer";
import { requireStudentMutation } from "@/lib/auth/route-guard";
import { getStudentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { errors } from "@/lib/errors";
import { asyncHandler, ok } from "@/lib/http";
import { getClientIp } from "@/lib/request";
import {
  getAssessmentState,
  getAttemptsForStudent,
  submitAssessment,
} from "@/lib/services/assessments";
import { computeContestStatus, requireActiveContest } from "@/lib/services/contest";
import { finalizeContest } from "@/lib/services/finalization";
import { getStudentRank } from "@/lib/services/leaderboard";
import {
  getLevelContext,
  getProgressSummary,
  getStudentLevels,
  nextRoadmapLevel,
  startPersonalContest,
} from "@/lib/services/progression";
import { createSubmission, getSubmissionsForStudent } from "@/lib/services/submissions";
import { toPublicStudent } from "@/lib/serializers";
import { isStorageConfigured, uploadEvidence } from "@/lib/storage";
import type { StudentRow } from "@/lib/types";
import { assessmentSubmitSchema } from "@/lib/validation/assessment";
import { submissionSchema } from "@/lib/validation/submission";

export const studentRoutes = Router();

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function detectContentType(bytes: Buffer, declared: string): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return ALLOWED_TYPES.has(declared) ? declared : null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

/**
 * Once a student submits their contest for review the attempt is frozen. Every
 * mutating student route (and opening a level) is rejected with 403 so the lock
 * is enforced on the server regardless of client state.
 */
function assertContestEditable(student: StudentRow): void {
  if (student.finalized_at) {
    throw errors.forbidden(
      "This contest has been submitted for review and is now locked.",
    );
  }
}

/**
 * The personal contest timer is the gateway to the challenges. Before the
 * student presses "Start Contest" the roadmap is read-only (NOT_STARTED state)
 * but every route that opens or mutates a level is rejected with 403. The route
 * layer enforces this without extra queries: the session already carries the
 * student row. The roadmap and the start endpoint itself stay ungated.
 */
function assertContestStarted(student: StudentRow): void {
  if (!student.started_at) {
    throw errors.forbidden(
      "Start your contest timer before accessing challenges.",
    );
  }
}

studentRoutes.get(
  "/roadmap",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const student = session.studentRow;

    const contest = await requireActiveContest(db);
    const [levels, summary] = await Promise.all([
      getStudentLevels(student, db),
      getProgressSummary(db, student),
    ]);

    ok(res, {
      student: session.student,
      contest: { name: contest.name, endAt: contest.end_at, timezone: contest.timezone },
      status: computeContestStatus(contest),
      levels,
      summary,
      serverTime: new Date().toISOString(),
    });
  }),
);

/**
 * Starts the student's personal contest timer exactly once (server-authoritative
 * timestamp), unlocking challenge access. Idempotent — a second click returns
 * the original `started_at` untouched.
 */
studentRoutes.post(
  "/contest/start",
  asyncHandler(async (req, res) => {
    const session = await requireStudentMutation(req);
    const db = getDb();
    const student = session.studentRow;

    const contest = await requireActiveContest(db);
    const status = computeContestStatus(contest);
    if (!status.isLive) {
      throw errors.forbidden(
        status.contest === "SCHEDULED"
          ? "The contest has not started yet."
          : "The contest has ended.",
      );
    }

    const result = await startPersonalContest(db, student);
    ok(res, {
      startedAt: result.startedAt,
      alreadyStarted: result.alreadyStarted,
      student: toPublicStudent(result.student),
      serverTime: new Date().toISOString(),
    });
  }),
);

studentRoutes.get(
  "/progress",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const student = session.studentRow;
    assertContestStarted(student);

    const contest = await requireActiveContest(db);
    const [levels, summary, submissions, rank] = await Promise.all([
      getStudentLevels(student, db),
      getProgressSummary(db, student),
      getSubmissionsForStudent(student.id, db),
      getStudentRank(contest, student.id, student.year, db),
    ]);

    ok(res, {
      student: session.student,
      status: computeContestStatus(contest),
      levels,
      summary,
      submissions,
      rank,
      contest: { name: contest.name, endAt: contest.end_at, timezone: contest.timezone },
      serverTime: new Date().toISOString(),
    });
  }),
);

studentRoutes.get(
  "/levels/:levelId",
  asyncHandler(async (req, res) => {
    const levelId = String(req.params.levelId ?? "");
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const student = session.studentRow;
    assertContestStarted(student);
    assertContestEditable(student);

    const contest = await requireActiveContest(db);
    const { level, problem, progress, trackLevels, totalLevels, latestSubmission } =
      await getLevelContext(student, levelId, db);
    const assessment = await getAssessmentState(student, level, db);
    const attempts = await getAttemptsForStudent(student.id, level.id, db);

    // Record when the student first opens/views the challenge
    if (!progress.challenge_opened_at) {
      await db.query(
        `update student_level_progress set challenge_opened_at = now() where id = $1`,
        [progress.id],
      );
    }

    // When the level is already completed, return the next unlocked level so the
    // client does not need a full roadmap round trip to show progress.
    const nextLevel =
      progress.status === "COMPLETED" ? nextRoadmapLevel(trackLevels, level) : null;

    ok(res, {
      level: {
        id: level.id,
        levelNumber: level.level_number,
        totalLevels,
        title: level.title,
        description: level.description,
        teaser: level.teaser,
        difficulty: level.difficulty,
        points: level.points,
        assessmentMode: level.assessment_mode,
        requireAssessmentPass: level.require_assessment_pass,
        requireVerifiedSubmission: level.require_verified_submission,
        passingScore: level.passing_score,
        maxAttempts: level.max_attempts,
        status: progress.status,
      },
      totalLevels,
      nextLevel,
      problem: problem
        ? { title: problem.title, url: problem.url, slug: problem.problem_slug }
        : null,
      assessment,
      attempts,
      submission: latestSubmission,
      contest: computeContestStatus(contest),
      screenshotStorageEnabled: isStorageConfigured(),
    });
  }),
);

studentRoutes.get(
  "/assessments",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const student = session.studentRow;
    assertContestStarted(student);

    const levelId = String(req.query.levelId ?? "");
    if (!levelId) throw errors.badRequest("Query parameter 'levelId' is required.");
    const { level } = await getLevelContext(student, levelId, db);
    const [state, attempts] = await Promise.all([
      getAssessmentState(student, level, db),
      getAttemptsForStudent(student.id, level.id, db),
    ]);
    ok(res, { state, attempts });
  }),
);

studentRoutes.post(
  "/assessments",
  asyncHandler(async (req, res) => {
    const session = await requireStudentMutation(req);
    const db = getDb();
    const student = session.studentRow;
    assertContestStarted(student);
    assertContestEditable(student);
    const body = assessmentSubmitSchema.parse(req.body);
    const result = await submitAssessment(student, body, db);
    ok(res, {
      ...result,
      nextLevel: result.nextLevel ?? null,
      completed: result.completed ?? false,
      totalLevels: result.totalLevels ?? 0,
    });
  }),
);

studentRoutes.get(
  "/submissions",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    assertContestStarted(session.studentRow);
    const submissions = await getSubmissionsForStudent(session.student.id, db);
    ok(res, { submissions });
  }),
);

studentRoutes.post(
  "/submissions",
  asyncHandler(async (req, res) => {
    const session = await requireStudentMutation(req);
    const db = getDb();
    const student = session.studentRow;
    assertContestStarted(student);
    assertContestEditable(student);
    const body = submissionSchema.parse(req.body);
    const submission = await createSubmission(student, body, { db, ip: getClientIp(req) });
    ok(res, {
      submission,
      nextLevel: submission.nextLevel ?? null,
      completed: submission.completed ?? false,
      totalLevels: submission.totalLevels ?? 0,
    });
  }),
);

/**
 * Freeze the attempt and hand it to the organisers for review. Idempotent and
 * fully re-validated server-side; see `finalizeContest`.
 */
studentRoutes.post(
  "/contest/finalize",
  asyncHandler(async (req, res) => {
    const session = await requireStudentMutation(req);
    const db = getDb();
    const student = session.studentRow;
    assertContestStarted(student);
    const result = await finalizeContest(student, { db, ip: getClientIp(req) });
    ok(res, {
      finalizedAt: result.finalizedAt,
      alreadyFinalized: result.alreadyFinalized,
      student: toPublicStudent(result.student),
      readiness: result.readiness,
    });
  }),
);

studentRoutes.post(
  "/uploads",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const session = await requireStudentMutation(req);
    if (!isStorageConfigured()) {
      throw errors.unavailable(
        "Screenshot uploads are not enabled. Please provide a submission URL or note instead.",
      );
    }
    assertContestStarted(session.studentRow);
    assertContestEditable(session.studentRow);

    const levelId = String(req.body?.levelId ?? "");
    const file = req.file;
    if (!levelId) throw errors.badRequest("A levelId is required.");
    if (!file) throw errors.badRequest("No file was uploaded.");
    if (file.size === 0) throw errors.badRequest("The uploaded file is empty.");

    const contentType = detectContentType(file.buffer, file.mimetype);
    if (!contentType) {
      throw errors.badRequest("Only PNG, JPEG and WebP images are accepted.");
    }

    const path = await uploadEvidence({
      studentId: session.student.id,
      levelId,
      filename: file.originalname || "screenshot",
      contentType,
      data: file.buffer,
    });
    ok(res, { path });
  }),
);