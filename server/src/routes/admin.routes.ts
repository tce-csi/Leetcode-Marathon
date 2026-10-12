import { Router } from "express";
import { requireAdmin } from "@/lib/auth/guard";
import { requireAdminMutation } from "@/lib/auth/route-guard";
import { writeAudit } from "@/lib/audit";
import { errors } from "@/lib/errors";
import { asyncHandler, ok } from "@/lib/http";
import {
  applyStudentAdminAction,
  createLevel,
  createQuestion,
  deleteLevel,
  deleteQuestion,
  getDashboardStats,
  getQuestionsForLevel,
  listAuditLogs,
  listLevelsDetailed,
  reorderLevels,
  setTrackActive,
  updateLevel,
  updateQuestion,
  updateStudentIdentity,
  verifyStudentIdentity,
} from "@/lib/services/admin";
import { getTracks, requireCurrentContest, updateContest } from "@/lib/services/contest";
import { computeContestStatus } from "@/lib/services/contest";
import { listFlags, resolveFlag } from "@/lib/services/flags";
import { listStudents, getStudentProfile, type StudentListFilters } from "@/lib/services/students";
import {
  listSubmissionsForReview,
  reviewSubmission,
  setSubmissionReviewState,
  requestSubmissionCode,
  type ReviewQueueFilters,
} from "@/lib/services/submissions";
import { getEvidenceSignedUrl } from "@/lib/storage";
import { listFinishers, getFinisherStats, updateFinalistStatus } from "@/lib/services/finishers";
import type { FinalistStatus, SubmissionStatus, Year } from "@/lib/types";
import {
  contestUpdateSchema,
  levelCreateSchema,
  levelUpdateSchema,
  questionCreateSchema,
  questionUpdateSchema,
  reorderLevelsSchema,
  studentAdminActionSchema,
  studentIdentityUpdateSchema,
  trackUpdateSchema,
} from "@/lib/validation/admin";
import {
  reviewSchema,
  adminReviewStateSchema,
  codeRequestSchema,
  finalistStatusSchema,
} from "@/lib/validation/submission";

export const adminRoutes = Router();

const STATUSES = new Set<SubmissionStatus>(["PENDING_REVIEW", "VERIFIED", "REJECTED"]);

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

// ------------------------------ contest ------------------------------------

adminRoutes.get(
  "/contest",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const tracks = await getTracks(contest.id);
    ok(res, { contest, tracks });
  }),
);

adminRoutes.put(
  "/contest",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN"]);
    const contest = await requireCurrentContest();
    const body = contestUpdateSchema.parse(req.body);
    const updated = await updateContest(contest.id, body);
    await writeAudit({
      actorType: "ADMIN",
      actorId: session.admin.id,
      action: "contest.update",
      entityType: "contest",
      entityId: contest.id,
      metadata: body,
    });
    ok(res, { contest: updated });
  }),
);

adminRoutes.patch(
  "/tracks/:year",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN"]);
    const year = Number(req.params.year);
    if (year !== 1 && year !== 2) throw errors.badRequest("Year must be 1 or 2.");
    const body = trackUpdateSchema.parse(req.body);
    const track = await setTrackActive(session.admin.id, year as Year, body.isActive);
    ok(res, { track });
  }),
);

adminRoutes.get(
  "/overview",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const [stats, audit] = await Promise.all([
      getDashboardStats(contest.id),
      listAuditLogs(15),
    ]);
    ok(res, {
      stats,
      contest,
      status: computeContestStatus(contest),
      recentAudit: audit,
    });
  }),
);

adminRoutes.get(
  "/audit",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const limitParam = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
    const logs = await listAuditLogs(limit);
    ok(res, { logs });
  }),
);

// ------------------------------ students -----------------------------------

adminRoutes.get(
  "/students",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const yearParam = String(req.query.year ?? "");
    const filters: StudentListFilters = {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      activeOnly: req.query.activeOnly === "true",
    };
    if (yearParam === "1" || yearParam === "2") filters.year = Number(yearParam) as Year;
    const students = await listStudents(contest.id, filters);
    ok(res, { students });
  }),
);

adminRoutes.get(
  "/students/export",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const students = await listStudents(contest.id, {});

    const headers = [
      "Roll Number",
      "Full Name",
      "Year",
      "LeetCode Username",
      "LeetCode Profile URL",
      "Levels Completed",
      "Total Points",
      "Pending Reviews",
      "Active",
      "Registered At",
      "Last Login At",
    ];
    const lines = [headers.join(",")];
    for (const s of students) {
      lines.push(
        [
          s.roll_number,
          s.full_name,
          s.year,
          s.leetcode_username,
          s.leetcode_profile_url,
          s.levels_completed,
          s.total_points,
          s.pending_reviews,
          s.is_active ? "yes" : "no",
          s.created_at,
          s.last_login_at ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="codequest-participants-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }),
);

adminRoutes.post(
  "/students/action",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN"]);
    const body = studentAdminActionSchema.parse(req.body);
    await applyStudentAdminAction(session.admin.id, body);
    ok(res, { applied: true });
  }),
);

adminRoutes.patch(
  "/students/identity",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN"]);
    const body = studentIdentityUpdateSchema.parse(req.body);
    const student = await updateStudentIdentity(session.admin.id, body);
    ok(res, { student });
  }),
);

adminRoutes.post(
  "/students/:id/verify",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN", "REVIEWER"]);
    const id = String(req.params.id ?? "");
    const student = await verifyStudentIdentity(session.admin.id, id);
    ok(res, { student });
  }),
);

// ------------------------------ review flags -------------------------------

adminRoutes.get(
  "/flags",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const openOnly = req.query.openOnly !== "false";
    const flags = await listFlags(contest.id, { openOnly });
    ok(res, { flags });
  }),
);

adminRoutes.post(
  "/flags/:id/resolve",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN", "REVIEWER"]);
    const id = String(req.params.id ?? "");
    const flag = await resolveFlag(session.admin.id, id);
    ok(res, { flag });
  }),
);

// ------------------------------ levels -------------------------------------

adminRoutes.get(
  "/levels",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const [tracks, levels] = await Promise.all([
      getTracks(contest.id),
      listLevelsDetailed(contest.id),
    ]);
    ok(res, { tracks, levels, contest });
  }),
);

adminRoutes.post(
  "/levels",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const body = levelCreateSchema.parse(req.body);
    const level = await createLevel(session.admin.id, body);
    ok(res, { level }, 201);
  }),
);

adminRoutes.post(
  "/levels/reorder",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const body = reorderLevelsSchema.parse(req.body);
    await reorderLevels(session.admin.id, body.trackId, body.order);
    ok(res, { reordered: true });
  }),
);

adminRoutes.get(
  "/levels/:id",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const id = String(req.params.id ?? "");
    const questions = await getQuestionsForLevel(id);
    ok(res, { questions });
  }),
);

adminRoutes.patch(
  "/levels/:id",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const { id } = req.params;
    const body = levelUpdateSchema.parse({ ...req.body, id });
    const level = await updateLevel(session.admin.id, body);
    ok(res, { level });
  }),
);

adminRoutes.delete(
  "/levels/:id",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const id = String(req.params.id ?? "");
    await deleteLevel(session.admin.id, id);
    ok(res, { deleted: true });
  }),
);

// ------------------------------ questions ----------------------------------

adminRoutes.get(
  "/questions",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const levelId = String(req.query.levelId ?? "");
    if (!levelId) throw errors.badRequest("Query parameter 'levelId' is required.");
    const questions = await getQuestionsForLevel(levelId);
    ok(res, { questions });
  }),
);

adminRoutes.post(
  "/questions",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const body = questionCreateSchema.parse(req.body);
    const question = await createQuestion(session.admin.id, body);
    ok(res, { question }, 201);
  }),
);

adminRoutes.patch(
  "/questions/:id",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const { id } = req.params;
    const body = questionUpdateSchema.parse({ ...req.body, id });
    const question = await updateQuestion(session.admin.id, body);
    ok(res, { question });
  }),
);

adminRoutes.delete(
  "/questions/:id",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req);
    const id = String(req.params.id ?? "");
    await deleteQuestion(session.admin.id, id);
    ok(res, { deleted: true });
  }),
);

// ------------------------------ submissions --------------------------------

adminRoutes.get(
  "/submissions",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const statusParam = (String(req.query.status ?? "PENDING_REVIEW")) as SubmissionStatus;
    const yearParam = String(req.query.year ?? "");
    const filters: ReviewQueueFilters = {
      status: STATUSES.has(statusParam) ? statusParam : "PENDING_REVIEW",
      search: typeof req.query.search === "string" ? req.query.search : undefined,
    };
    if (yearParam === "1" || yearParam === "2") filters.year = Number(yearParam) as Year;

    const submissions = await listSubmissionsForReview(contest.id, filters);
    const withUrls = await Promise.all(
      submissions.map(async (submission) => ({
        ...submission,
        screenshotUrl: submission.screenshot_path
          ? await getEvidenceSignedUrl(submission.screenshot_path)
          : null,
      })),
    );
    ok(res, { submissions: withUrls });
  }),
);

adminRoutes.post(
  "/submissions/review",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN", "REVIEWER"]);
    const body = reviewSchema.parse(req.body);
    const submission = await reviewSubmission(
      session.admin.id,
      body.submissionId,
      body.decision,
      body.reason ?? "",
    );
    ok(res, { submission });
  }),
);

adminRoutes.get(
  "/submissions/export",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const statusParam = String(req.query.status ?? "") as SubmissionStatus;
    const yearParam = String(req.query.year ?? "");
    const filters: ReviewQueueFilters = {};
    if (STATUSES.has(statusParam)) filters.status = statusParam;
    if (yearParam === "1" || yearParam === "2") filters.year = Number(yearParam) as Year;

    const rows = await listSubmissionsForReview(contest.id, filters);
    const headers = [
      "Submitted At",
      "Roll Number",
      "Full Name",
      "Year",
      "Level",
      "Problem",
      "Status",
      "Submission URL",
      "Student Note",
      "Verdict",
      "Reviewed At",
    ];
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.created_at,
          row.student_roll,
          row.student_name,
          row.student_year,
          row.level_number,
          row.problem_title ?? row.problem_slug ?? "",
          row.status,
          row.submission_url ?? "",
          row.student_note ?? "",
          row.verdict ?? "",
          row.verified_at ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="codequest-submissions-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }),
);

// ------------------------------ student profile ----------------------------

adminRoutes.get(
  "/students/:studentId/profile",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const studentId = String(req.params.studentId ?? "");
    if (!studentId) throw errors.badRequest("studentId is required.");
    const profile = await getStudentProfile(contest.id, studentId);
    if (!profile) throw errors.notFound("Student not found.");
    ok(res, { profile });
  }),
);

// ------------------------------ submission review state & code requests ----

adminRoutes.patch(
  "/submissions/:id/review-state",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN", "REVIEWER"]);
    const body = adminReviewStateSchema.parse({ ...req.body, submissionId: req.params.id });
    const submission = await setSubmissionReviewState(session.admin.id, body, { ip: req.ip });
    ok(res, { submission });
  }),
);

adminRoutes.post(
  "/submissions/:id/request-code",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN", "REVIEWER"]);
    const body = codeRequestSchema.parse({ submissionId: req.params.id });
    const submission = await requestSubmissionCode(session.admin.id, body.submissionId, { ip: req.ip });
    ok(res, { submission });
  }),
);

// ------------------------------ finishers ----------------------------------

adminRoutes.get(
  "/finishers",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const yearParam = String(req.query.year ?? "1");
    const year = (yearParam === "2" ? 2 : 1) as Year;
    const status = typeof req.query.status === "string" ? (req.query.status as FinalistStatus | "ALL") : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const sortBy = req.query.sortBy === "elapsed" ? "elapsed" : "finished_at";
    const verifiedOnly = req.query.verifiedOnly === "true";

    const [finishers, stats] = await Promise.all([
      listFinishers(contest.id, { year, status, search, sortBy, verifiedOnly }),
      getFinisherStats(contest.id, year),
    ]);

    ok(res, { finishers, stats, year });
  }),
);

adminRoutes.get(
  "/finishers/export",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const contest = await requireCurrentContest();
    const yearParam = String(req.query.year ?? "1");
    const year = (yearParam === "2" ? 2 : 1) as Year;
    const status = typeof req.query.status === "string" ? (req.query.status as FinalistStatus | "ALL") : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const sortBy = req.query.sortBy === "elapsed" ? "elapsed" : "finished_at";
    const verifiedOnly = req.query.verifiedOnly === "true";

    const finishers = await listFinishers(contest.id, { year, status, search, sortBy, verifiedOnly });
    const headers = [
      "Rank",
      "Roll Number",
      "Full Name",
      "Year",
      "LeetCode Username",
      "Completed Levels",
      "Total Levels",
      "Finished At (UTC)",
      "Elapsed Duration (ms)",
      "Elapsed Time",
      "Finalist Status",
      "Total Points",
    ];
    const lines = [headers.join(",")];
    for (const f of finishers) {
      lines.push(
        [
          f.rank,
          f.rollNumber,
          f.fullName,
          f.year,
          f.leetcodeUsername,
          f.completedLevels,
          f.totalLevels,
          f.finishedAt,
          f.elapsedDurationMs,
          f.elapsedFormatted,
          f.finalistStatus,
          f.totalPoints,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="codequest-finishers-year${year}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }),
);

// ------------------------------ finalist verification ----------------------

adminRoutes.patch(
  "/students/:studentId/finalist-status",
  asyncHandler(async (req, res) => {
    const session = await requireAdminMutation(req, ["SUPER_ADMIN", "ADMIN"]);
    const studentId = String(req.params.studentId ?? "");
    const body = finalistStatusSchema.parse(req.body);
    const student = await updateFinalistStatus(session.admin.id, studentId, body);
    ok(res, { student });
  }),
);