import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  FileCode,
  Flag,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/field";
import { api, isApiError } from "@/lib/api-client";
import {
  difficultyMeta,
  finalistStatusMeta,
  formatElapsed,
  formatIST,
  formatISTTime,
  progressMeta,
  reviewStateMeta,
  submissionMeta,
  yearLabel,
} from "@/lib/format";
import type {
  CodingSubmissionRow,
  FinalistStatus,
  LevelSubmissionHistory,
  StudentProfile,
  SubmissionReviewState,
} from "@/lib/types";

export default function AdminStudentReviewProfilePage() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const [filter, setFilter] = useState<"ALL" | "ATTEMPTED" | "PENDING">("ALL");
  const [finalistNotes, setFinalistNotes] = useState("");
  const [disqualifyReason, setDisqualifyReason] = useState("");
  const [updatingFinalist, setUpdatingFinalist] = useState(false);

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["admin", "student-profile", studentId],
    queryFn: async () => {
      const res = await api.get<{ profile: StudentProfile }>(
        `/api/admin/students/${studentId}/profile`,
      );
      return res.profile;
    },
    enabled: Boolean(studentId),
  });

  if (loading) return <PageLoader label="Loading student profile" />;
  if (queryError || !data) {
    const errorMsg = queryError
      ? isApiError(queryError)
        ? queryError.message
        : "Failed to load student profile."
      : "Student profile not found.";
    return (
      <EmptyState
        icon={<AlertCircle className="size-5" />}
        title="Student not found"
        description={errorMsg}
        action={
          <Link to="/admin/students">
            <Button variant="secondary">
              <ArrowLeft className="size-4" /> Back to Students
            </Button>
          </Link>
        }
      />
    );
  }

  const { student, levelsCompleted, totalPoints, totalLevels, history } = data;

  const filteredHistory = history.filter((item) => {
    if (filter === "ATTEMPTED") return item.submissions.length > 0;
    if (filter === "PENDING") {
      return item.submissions.some((s) => s.status === "PENDING_REVIEW");
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/students">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <ArrowLeft className="size-3.5" /> Back to Students
          </Button>
        </Link>
      </div>

      {/* Student Overview Header Card */}
      <Card className="border-border-strong bg-surface-1">
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {student.full_name}
                </h1>
                <Badge variant="info">{yearLabel(student.year)}</Badge>
                {student.identity_verified_at ? (
                  <Badge variant="success">Identity Verified</Badge>
                ) : (
                  <Badge variant="neutral">Unverified Identity</Badge>
                )}
                <Badge variant={student.is_active ? "neutral" : "danger"}>
                  {student.is_active ? "Active" : "Disabled"}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-muted">
                <span>Roll: <strong className="text-foreground">{student.roll_number}</strong></span>
                <span>•</span>
                {student.leetcode_profile_url ? (
                  <a
                    href={student.leetcode_profile_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                  >
                    @{student.leetcode_username}
                    <ExternalLink className="size-3 opacity-70" />
                  </a>
                ) : (
                  <span>@{student.leetcode_username}</span>
                )}
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="flex flex-wrap items-center gap-6 border-t border-border pt-4 lg:border-t-0 lg:pt-0">
              <div className="text-left lg:text-right">
                <p className="text-xs uppercase tracking-wider text-muted font-medium">Contest Score</p>
                <p className="text-2xl font-bold text-accent">{totalPoints} <span className="text-xs font-normal text-muted">pts</span></p>
              </div>

              <div className="text-left lg:text-right">
                <p className="text-xs uppercase tracking-wider text-muted font-medium">Progress</p>
                <p className="text-2xl font-bold text-foreground">
                  {levelsCompleted} <span className="text-xs font-normal text-muted">/ {totalLevels}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Timeline Summary Row (All in IST) */}
          <div className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-2/60 p-3.5 sm:grid-cols-4 text-xs">
            <div>
              <p className="text-muted font-medium">Contest Started (IST)</p>
              <p className="font-mono mt-0.5 text-foreground">
                {student.contest_started_at ? formatIST(student.contest_started_at) : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted font-medium">Finished At (IST)</p>
              <p className="font-mono mt-0.5 text-foreground font-semibold">
                {student.finished_at ? formatIST(student.finished_at) : "In Progress"}
              </p>
            </div>
            <div>
              <p className="text-muted font-medium">Elapsed Duration</p>
              <p className="font-mono mt-0.5 text-foreground font-semibold">
                {student.elapsed_duration_ms ? formatElapsed(student.elapsed_duration_ms) : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted font-medium">Last Activity (IST)</p>
              <p className="font-mono mt-0.5 text-foreground">{formatIST(data.lastActivity)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Finalist Verification & Winner Confirmation Card */}
      {(() => {
        const allSubs = history.flatMap((h) => h.submissions);
        const reviewedCount = allSubs.filter((s) => s.review_state !== "NOT_REVIEWED").length;
        const validCount = allSubs.filter((s) => s.review_state === "REVIEWED_VALID").length;
        const invalidCount = allSubs.filter((s) => s.review_state === "REVIEWED_INVALID").length;
        const flaggedCount = allSubs.filter((s) => s.review_state === "FLAGGED").length;
        const statusMeta = finalistStatusMeta[student.finalist_status];

        const handleSetFinalistStatus = async (status: FinalistStatus) => {
          if (status === "DISQUALIFIED" && !disqualifyReason.trim()) {
            toast.error("Please provide a reason for disqualification.");
            return;
          }
          setUpdatingFinalist(true);
          try {
            await api.patch(`/api/admin/students/${student.id}/finalist-status`, {
              finalistStatus: status,
              reviewNotes: finalistNotes.trim() || undefined,
              disqualificationReason: status === "DISQUALIFIED" ? disqualifyReason.trim() : undefined,
            });
            toast.success(`Finalist status updated to ${statusMeta.label}.`);
            refetch();
          } catch (error) {
            toast.error(isApiError(error) ? error.message : "Failed to update status.");
          } finally {
            setUpdatingFinalist(false);
          }
        };

        return (
          <Card className="border border-border-strong bg-surface-1">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-foreground" />
                  <CardTitle className="text-base font-bold">
                    Official Finalist & Winner Verification
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Contest Status:</span>
                  <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {/* Evidence Checklist */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
                <div className="rounded-md border border-border bg-surface-2/40 p-2.5">
                  <span className="text-muted">Required Levels</span>
                  <p className="font-mono text-sm font-bold text-foreground mt-0.5">
                    {levelsCompleted} / {totalLevels}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-2/40 p-2.5">
                  <span className="text-muted">Reviewed Attempts</span>
                  <p className="font-mono text-sm font-bold text-foreground mt-0.5">
                    {reviewedCount} / {allSubs.length}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-2/40 p-2.5">
                  <span className="text-muted">Valid Solutions</span>
                  <p className="font-mono text-sm font-bold text-foreground mt-0.5">
                    {validCount}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-2/40 p-2.5">
                  <span className="text-muted">Invalid Solutions</span>
                  <p className="font-mono text-sm font-bold text-foreground mt-0.5">
                    {invalidCount}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-2/40 p-2.5">
                  <span className="text-muted">Flagged Submissions</span>
                  <p className="font-mono text-sm font-bold text-foreground mt-0.5">
                    {flaggedCount}
                  </p>
                </div>
              </div>

              {/* Status Details / Previous notes */}
              {student.finalist_review_notes && (
                <div className="rounded-md border border-border bg-surface-2/50 p-3 text-xs">
                  <span className="font-semibold text-foreground">Reviewer Notes: </span>
                  <span className="text-muted-strong">{student.finalist_review_notes}</span>
                </div>
              )}

              {student.finalist_disqualification_reason && (
                <div className="rounded-md border border-foreground bg-foreground/5 p-3 text-xs text-foreground">
                  <span className="font-bold">Disqualification Reason: </span>
                  <span>{student.finalist_disqualification_reason}</span>
                </div>
              )}

              {/* Action Inputs */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1 text-xs">
                <div>
                  <label className="font-semibold text-muted mb-1 block">
                    Organizer Review Notes (Optional)
                  </label>
                  <Textarea
                    rows={2}
                    placeholder="Enter notes about code review, verification, or integrity check..."
                    value={finalistNotes}
                    onChange={(e) => setFinalistNotes(e.target.value)}
                    className="text-xs font-sans"
                  />
                </div>
                <div>
                  <label className="font-semibold text-muted mb-1 block">
                    Disqualification Reason (Required only if disqualifying)
                  </label>
                  <Textarea
                    rows={2}
                    placeholder="Enter reason if disqualifying candidate (e.g. plagiarized code)..."
                    value={disqualifyReason}
                    onChange={(e) => setDisqualifyReason(e.target.value)}
                    className="text-xs font-sans"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-8 gap-1.5 text-xs font-semibold"
                    onClick={() => handleSetFinalistStatus("VERIFIED")}
                    loading={updatingFinalist}
                  >
                    <Award className="size-3.5" /> Confirm & Verify Winner
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => handleSetFinalistStatus("UNDER_REVIEW")}
                    loading={updatingFinalist}
                  >
                    Mark Under Review
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => handleSetFinalistStatus("DISQUALIFIED")}
                    loading={updatingFinalist}
                  >
                    <Ban className="size-3.5" /> Disqualify Candidate
                  </Button>
                </div>

                {student.finalist_status !== "PROVISIONAL" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 text-xs text-muted hover:text-foreground"
                    onClick={() => handleSetFinalistStatus("PROVISIONAL")}
                    loading={updatingFinalist}
                    title="Reopen review"
                  >
                    <RotateCcw className="size-3" /> Reopen Review
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={filter === "ALL" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setFilter("ALL")}
            className="text-xs"
          >
            All Questions ({history.length})
          </Button>
          <Button
            variant={filter === "ATTEMPTED" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setFilter("ATTEMPTED")}
            className="text-xs"
          >
            Attempted ({history.filter((h) => h.submissions.length > 0).length})
          </Button>
          <Button
            variant={filter === "PENDING" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setFilter("PENDING")}
            className="text-xs"
          >
            Pending Review ({history.filter((h) => h.submissions.some((s) => s.status === "PENDING_REVIEW")).length})
          </Button>
        </div>
      </div>

      {/* 10 Questions Review Sequence */}
      <div className="space-y-4">
        {filteredHistory.map((item) => (
          <QuestionReviewCard
            key={item.level.id}
            item={item}
            onUpdate={refetch}
          />
        ))}
      </div>
    </div>
  );
}

function QuestionReviewCard({
  item,
  onUpdate,
}: {
  item: LevelSubmissionHistory;
  onUpdate: () => void;
}) {
  const { level, progress, submissions } = item;
  const statusMeta = progress ? progressMeta[progress.status] : progressMeta.LOCKED;
  const diffMeta = difficultyMeta[level.difficulty];

  return (
    <Card className="border border-border bg-surface-1">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md border border-border bg-surface-2 font-mono text-xs font-semibold">
              #{level.level_number}
            </span>
            <div>
              <CardTitle className="text-base font-semibold">
                {level.problem_title || level.title}
              </CardTitle>
              {level.problem_url && (
                <a
                  href={level.problem_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-foreground mt-0.5"
                >
                  View on LeetCode <ExternalLink className="size-3 opacity-60" />
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={diffMeta.className}>{diffMeta.label}</Badge>
            <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
            <span className="font-mono text-xs font-semibold text-accent">
              {level.points} pts
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Timeline Chips for this level in IST */}
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border/80 bg-surface-2/40 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-muted" />
            <span className="text-muted">Unlocked:</span>
            <span className="font-mono text-foreground">{formatISTTime(progress?.unlocked_at)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Eye className="size-3.5 text-muted" />
            <span className="text-muted">Opened:</span>
            <span className="font-mono text-foreground">
              {formatISTTime(progress?.challenge_opened_at)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-muted" />
            <span className="text-muted">Completed:</span>
            <span className="font-mono text-foreground">{formatISTTime(progress?.completed_at)}</span>
          </div>

          <div className="ml-auto text-muted">
            {submissions.length} attempt{submissions.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Submissions List */}
        {submissions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
            No submissions recorded yet for this question.
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => (
              <AttemptItem key={sub.id} submission={sub} onUpdate={onUpdate} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttemptItem({
  submission,
  onUpdate,
}: {
  submission: CodingSubmissionRow;
  onUpdate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);

  const copyCode = () => {
    if (submission.source_code) {
      navigator.clipboard.writeText(submission.source_code);
      setCopied(true);
      toast.success("Source code copied to clipboard.");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReviewState = async (state: SubmissionReviewState) => {
    setReviewBusy(true);
    try {
      await api.patch(`/api/admin/submissions/${submission.id}/review-state`, {
        reviewState: state,
      });
      toast.success(`Marked as ${state.replace(/_/g, " ").toLowerCase()}.`);
      onUpdate();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Failed to update review state.");
    } finally {
      setReviewBusy(false);
    }
  };

  const handleApprove = async () => {
    setReviewBusy(true);
    try {
      await api.post("/api/admin/submissions/review", {
        submissionId: submission.id,
        decision: "APPROVED",
        reason: "Approved from student review dashboard",
      });
      toast.success("Submission approved and verified.");
      onUpdate();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Approval failed.");
    } finally {
      setReviewBusy(false);
    }
  };

  const handleReject = async () => {
    setReviewBusy(true);
    try {
      await api.post("/api/admin/submissions/review", {
        submissionId: submission.id,
        decision: "REJECTED",
        reason: "Rejected from student review dashboard",
      });
      toast.success("Submission rejected.");
      onUpdate();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Rejection failed.");
    } finally {
      setReviewBusy(false);
    }
  };

  const handleRequestCode = async () => {
    setRequestBusy(true);
    try {
      await api.post(`/api/admin/submissions/${submission.id}/request-code`, {});
      toast.success("Requested source code from student.");
      onUpdate();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Failed to request code.");
    } finally {
      setRequestBusy(false);
    }
  };

  const statusInfo = submissionMeta[submission.status];
  const reviewInfo = submission.review_state
    ? reviewStateMeta[submission.review_state]
    : reviewStateMeta.NOT_REVIEWED;

  return (
    <div className="rounded-lg border border-border bg-surface-2/30 p-3.5 space-y-3">
      {/* Attempt Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold font-mono bg-surface-3 px-2 py-0.5 rounded text-foreground">
            Attempt #{submission.attempt_number || 1}
          </span>
          <span className="font-mono text-muted">{formatIST(submission.created_at)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
          <Badge className={reviewInfo.className}>Audit: {reviewInfo.label}</Badge>
        </div>
      </div>

      {/* Submission Link & Note */}
      <div className="space-y-1.5 text-xs">
        {submission.submission_url && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">LeetCode URL:</span>
            <a
              href={submission.submission_url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-foreground underline-offset-4 hover:underline break-all"
            >
              {submission.submission_url}
              <ExternalLink className="inline size-3 ml-1 opacity-70" />
            </a>
          </div>
        )}

        {submission.student_note && (
          <div className="flex items-start gap-1.5 rounded bg-surface-1 p-2 text-muted-strong">
            <MessageSquare className="size-3.5 mt-0.5 shrink-0 text-muted" />
            <span>{submission.student_note}</span>
          </div>
        )}

        {submission.verdict && (
          <div className="text-xs text-muted">
            Verdict: <strong className="text-foreground">{submission.verdict}</strong>
          </div>
        )}
      </div>

      {/* Source Code Evidence Section */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <FileCode className="size-3.5 text-muted" />
            <span className="font-semibold uppercase tracking-wider text-muted-strong">
              Source Code Evidence
            </span>
            {submission.programming_language && (
              <Badge variant="neutral" className="text-[10px] font-mono">
                {submission.programming_language}
              </Badge>
            )}
            {submission.code_file_name && (
              <span className="font-mono text-[11px] text-muted">
                ({submission.code_file_name})
              </span>
            )}
            {submission.code_requested && (
              <Badge variant="warning" className="text-[10px]">
                Code Requested
              </Badge>
            )}
          </div>

          {submission.source_code ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={copyCode}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy Code"}
            </Button>
          ) : (
            !submission.code_requested && (
              <Button
                variant="secondary"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={handleRequestCode}
                loading={requestBusy}
              >
                <Code2 className="size-3" /> Request Code
              </Button>
            )
          )}
        </div>

        {submission.source_code ? (
          <pre className="max-h-60 overflow-y-auto rounded-lg border border-border bg-surface-1 p-3 font-mono text-xs leading-relaxed text-foreground select-text whitespace-pre-wrap break-all">
            {submission.source_code}
          </pre>
        ) : (
          <p className="text-xs italic text-muted">No source code file or text attached with this attempt.</p>
        )}
      </div>

      {/* Review Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted mr-1">Audit status:</span>
          <Button
            variant={submission.review_state === "REVIEWED_VALID" ? "primary" : "secondary"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => handleReviewState("REVIEWED_VALID")}
            loading={reviewBusy}
          >
            Valid
          </Button>
          <Button
            variant={submission.review_state === "REVIEWED_INVALID" ? "primary" : "secondary"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => handleReviewState("REVIEWED_INVALID")}
            loading={reviewBusy}
          >
            Invalid
          </Button>
          <Button
            variant={submission.review_state === "FLAGGED" ? "primary" : "secondary"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => handleReviewState("FLAGGED")}
            loading={reviewBusy}
          >
            <Flag className="size-3" /> Flag
          </Button>
        </div>

        {/* Traditional Approve / Reject if pending */}
        {submission.status === "PENDING_REVIEW" && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={handleApprove}
              loading={reviewBusy}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={handleReject}
              loading={reviewBusy}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
