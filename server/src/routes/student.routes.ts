import { Router } from "express";
import multer from "multer";
import { requireStudentMutation } from "@/lib/auth/route-guard";
import { getStudentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { errors } from "@/lib/errors";
import { asyncHandler, ok } from "@/lib/http";
import {
  getAssessmentState,
  getAttemptsForStudent,
  submitAssessment,
} from "@/lib/services/assessments";
import { computeContestStatus, requireActiveContest } from "@/lib/services/contest";
import { getStudentRank } from "@/lib/services/leaderboard";
import { getLevelContext, getProgressSummary, getStudentLevels } from "@/lib/services/progression";
import { createSubmission, getSubmissionsForStudent } from "@/lib/services/submissions";
import { getStudentById } from "@/lib/services/students";
import { isStorageConfigured, uploadEvidence } from "@/lib/storage";
import type { CodingSubmissionRow } from "@/lib/types";
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

studentRoutes.get(
  "/roadmap",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const student = await getStudentById(db, session.student.id);
    if (!student) throw errors.unauthorized();

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
    });
  }),
);

studentRoutes.get(
  "/progress",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const student = await getStudentById(db, session.student.id);
    if (!student) throw errors.unauthorized();

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
    const student = await getStudentById(db, session.student.id);
    if (!student) throw errors.unauthorized();

    const contest = await requireActiveContest(db);
    const { level, problem, progress } = await getLevelContext(student, levelId, db);
    const assessment = await getAssessmentState(student, level, db);
    const attempts = await getAttemptsForStudent(student.id, level.id, db);

    const submissionResult = await db.query<CodingSubmissionRow>(
      `select * from coding_submissions
        where student_id = $1 and level_id = $2
        order by created_at desc limit 1`,
      [student.id, level.id],
    );

    ok(res, {
      level: {
        id: level.id,
        levelNumber: level.level_number,
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
      problem: problem
        ? { title: problem.title, url: problem.url, slug: problem.problem_slug }
        : null,
      assessment,
      attempts,
      submission: submissionResult.rows[0] ?? null,
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
    const student = await getStudentById(db, session.student.id);
    if (!student) throw errors.unauthorized();

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
    const student = await getStudentById(db, session.student.id);
    if (!student) throw errors.unauthorized();
    const body = assessmentSubmitSchema.parse(req.body);
    const result = await submitAssessment(student, body, db);
    ok(res, result);
  }),
);

studentRoutes.get(
  "/submissions",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await getStudentSession(req, db);
    if (!session) throw errors.unauthorized();
    const submissions = await getSubmissionsForStudent(session.student.id, db);
    ok(res, { submissions });
  }),
);

studentRoutes.post(
  "/submissions",
  asyncHandler(async (req, res) => {
    const session = await requireStudentMutation(req);
    const db = getDb();
    const student = await getStudentById(db, session.student.id);
    if (!student) throw errors.unauthorized();
    const body = submissionSchema.parse(req.body);
    const submission = await createSubmission(student, body, { db });
    ok(res, { submission });
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