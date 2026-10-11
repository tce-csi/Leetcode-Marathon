import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileImage,
  RefreshCw,
  Send,
  ShieldCheck,
  Trophy,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, RadioGroup } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageLoader } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { difficultyMeta, formatDate, progressMeta } from "@/lib/format";
import type { AssessmentState, PhaseState, SubmitResult } from "@/lib/services/assessments";
import type { ContestStatus } from "@/lib/services/contest";
import type {
  AssessmentAttemptRow,
  CodingSubmissionRow,
  Difficulty,
  ProgressStatus,
  RoadmapLevel,
} from "@/lib/types";

interface LevelResponse {
  level: {
    id: string;
    levelNumber: number;
    title: string;
    description: string;
    teaser: string;
    difficulty: Difficulty;
    points: number;
    assessmentMode: string;
    requireAssessmentPass: boolean;
    requireVerifiedSubmission: boolean;
    passingScore: number;
    maxAttempts: number;
    status: ProgressStatus;
  };
  problem: { title: string; url: string; slug: string } | null;
  assessment: AssessmentState;
  attempts: AssessmentAttemptRow[];
  submission: CodingSubmissionRow | null;
  contest: ContestStatus;
  screenshotStorageEnabled: boolean;
}

interface RoadmapResponse {
  levels: RoadmapLevel[];
}

function findNextLevel(levels: RoadmapLevel[] | null, currentId: string): RoadmapLevel | null {
  if (!levels) return null;
  const index = levels.findIndex((level) => level.id === currentId);
  if (index === -1) return null;
  const next = levels[index + 1];
  return next && next.status !== "LOCKED" ? next : null;
}

export default function LevelPage() {
  const params = useParams<{ levelId: string }>();
  const levelId = params.levelId;
  const [data, setData] = useState<LevelResponse | null>(null);
  const [nextLevel, setNextLevel] = useState<RoadmapLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [result, roadmap] = await Promise.all([
        api.get<LevelResponse>(`/api/student/levels/${levelId}`),
        api.get<RoadmapResponse>("/api/student/roadmap").catch(() => null),
      ]);
      setData(result);
      setNextLevel(findNextLevel(roadmap?.levels ?? null, levelId ?? ""));
      setError(null);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Unable to load this level.");
    } finally {
      setLoading(false);
    }
  }, [levelId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageLoader label="Loading challenge" />;
  if (error || !data) {
    return (
      <EmptyState
        icon={<AlertCircle className="size-5" />}
        title="Level unavailable"
        description={error ?? "This level could not be loaded."}
        action={
          <Link to="/dashboard">
            <Button variant="secondary">Back to contest</Button>
          </Link>
        }
      />
    );
  }

  const { level, problem, assessment, attempts, submission, screenshotStorageEnabled } = data;
  const difficulty = difficultyMeta[level.difficulty];
  const status = progressMeta[level.status];
  const beforePhases = assessment.phases.filter((phase) => phase.phase === "BEFORE");
  const afterPhases = assessment.phases.filter((phase) => phase.phase === "AFTER");
  const isCompleted = level.status === "COMPLETED";

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Contest
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            LEVEL {String(level.levelNumber).padStart(2, "0")} / 10
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{level.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={difficulty.className}>{difficulty.label}</Badge>
            <Badge className={status.className}>{status.label}</Badge>
            <Badge variant="neutral">
              <Trophy className="size-3.5" /> {level.points} pts
            </Badge>
          </div>
        </div>
      </header>

      {level.teaser || level.description ? (
        <Card className="p-5">
          {level.teaser ? (
            <p className="text-sm leading-relaxed text-foreground">{level.teaser}</p>
          ) : null}
          {level.description ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
              {level.description}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Conceptual questions that must be answered before the challenge. */}
      {beforePhases.map((phase) => (
        <AssessmentPanel
          key={phase.phase}
          phase={phase}
          levelId={level.id}
          onSubmitted={(result) => {
            toast[result.passed ? "success" : "warning"](
              result.passed
                ? `Assessment passed with ${result.score}/${result.maxScore}.`
                : result.requiresManualGrading
                  ? "Submitted. Some answers need manual grading."
                  : `Scored ${result.score}/${result.maxScore}. ${result.percent}% (needs ${level.passingScore}%).`,
            );
            load();
          }}
        />
      ))}

      {/* The challenge problem + prominent solve button. */}
      {problem ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-foreground">
                <Trophy className="size-5" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Challenge problem</p>
                <p className="text-lg font-semibold">{problem.title}</p>
              </div>
            </div>
            {assessment.linkUnlocked ? (
              <a href={problem.url} target="_blank" rel="noopener noreferrer">
                <Button size="lg">
                  Solve on LeetCode ↗
                </Button>
              </a>
            ) : (
              <Badge variant="warning">Pass the assessment to unlock</Badge>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-sm text-muted">No LeetCode problem is attached to this level.</p>
        </Card>
      )}

      {/* Submission verification. */}
      {level.requireVerifiedSubmission ? (
        submission?.status === "VERIFIED" ? (
          <Card className="border-foreground/30 p-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-6" />
              <div>
                <p className="font-semibold">Submission verified</p>
                <p className="text-sm text-muted">
                  Your solution was verified {formatDate(submission.verified_at)}.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <SubmissionPanel
            levelId={level.id}
            screenshotStorageEnabled={screenshotStorageEnabled}
            existing={submission}
            onSubmitted={load}
          />
        )
      ) : (
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6" />
            <p className="text-sm text-muted">
              No submission is required for this level. Complete the assessment to proceed.
            </p>
          </div>
        </Card>
      )}

      {/* Conceptual questions configured for after the challenge. */}
      {afterPhases.map((phase) => (
        <AssessmentPanel
          key={phase.phase}
          phase={phase}
          levelId={level.id}
          onSubmitted={(result) => {
            toast[result.passed ? "success" : "warning"](
              result.passed
                ? `Assessment passed with ${result.score}/${result.maxScore}.`
                : result.requiresManualGrading
                  ? "Submitted. Some answers need manual grading."
                  : `Scored ${result.score}/${result.maxScore}. ${result.percent}% (needs ${level.passingScore}%).`,
            );
            load();
          }}
        />
      ))}

      {/* Completion + next level. */}
      {isCompleted ? (
        <Card className="border-foreground/40 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-6" />
              <div>
                <p className="font-semibold">Level Completed</p>
                <p className="text-sm text-muted">
                  {nextLevel
                    ? `Up next: Level ${String(nextLevel.levelNumber).padStart(2, "0")} — ${nextLevel.title}`
                    : "You've reached the final level of your track."}
                </p>
              </div>
            </div>
            {nextLevel ? (
              <Link to={`/dashboard/level/${nextLevel.id}`} className="shrink-0">
                <Button size="lg">
                  Next Level →
                </Button>
              </Link>
            ) : (
              <Link to="/dashboard" className="shrink-0">
                <Button size="lg" variant="secondary">
                  Back to contest
                </Button>
              </Link>
            )}
          </div>
        </Card>
      ) : null}

      {attempts.length > 0 ? (
        <Card className="p-5">
          <CardTitle className="mb-3">Assessment attempts</CardTitle>
          <div className="space-y-2">
            {attempts.map((attempt) => (
              <div
                key={attempt.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-sm"
              >
                <span className="text-muted">
                  {attempt.phase} · attempt #{attempt.attempt_number}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted">
                    {attempt.score}/{attempt.max_score}
                  </span>
                  <Badge variant={attempt.passed ? "success" : attempt.status === "GRADED" ? "danger" : "warning"}>
                    {attempt.status === "GRADED" ? (attempt.passed ? "Passed" : "Failed") : attempt.status}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function AssessmentPanel({
  phase,
  levelId,
  onSubmitted,
}: {
  phase: PhaseState;
  levelId: string;
  onSubmitted: (result: SubmitResult) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, { ids: string[]; text: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const canAttempt = phase.remainingAttempts > 0;
  const resultByQuestion = useMemo(() => {
    const map = new Map<string, SubmitResult["answers"][number]>();
    result?.answers.forEach((a) => map.set(a.questionId, a));
    return map;
  }, [result]);

  const setAnswer = (questionId: string, patch: Partial<{ ids: string[]; text: string }>) =>
    setAnswers((prev) => {
      const current = prev[questionId] ?? { ids: [], text: "" };
      return { ...prev, [questionId]: { ...current, ...patch } };
    });

  const handleSubmit = async () => {
    const payload = phase.questions.map((q) => {
      const answer = answers[q.id] ?? { ids: [], text: "" };
      return {
        questionId: q.id,
        selectedOptionIds: answer.ids.length > 0 ? answer.ids : undefined,
        textAnswer: answer.text.trim() || undefined,
      };
    });

    if (payload.every((p) => !p.selectedOptionIds && !p.textAnswer)) {
      toast.error("Please answer at least one question.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<SubmitResult>("/api/student/assessments", {
        levelId,
        phase: phase.phase,
        answers: payload,
      });
      setResult(res);
      onSubmitted(res);
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not submit the assessment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{phase.phase === "BEFORE" ? "Answer before you code" : "Answer after you code"}</CardTitle>
          <div className="flex items-center gap-2">
            {phase.passed ? <Badge variant="success">Passed</Badge> : null}
            <Badge variant="neutral">
              {phase.remainingAttempts}/{phase.maxAttempts} attempts left
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase.questions.length === 0 ? (
          <p className="text-sm text-muted">No questions configured for this phase.</p>
        ) : (
          phase.questions.map((question, index) => {
            const answer = answers[question.id] ?? { ids: [], text: "" };
            const graded = resultByQuestion.get(question.id);
            return (
              <div key={question.id} className="rounded-xl border border-border bg-surface-2/40 p-4">
                <p className="mb-3 text-sm font-medium">
                  <span className="mr-2 text-muted">{index + 1}.</span>
                  {question.text}
                  <span className="ml-2 text-xs text-muted">{question.points} pts</span>
                </p>

                {question.type === "SHORT_TEXT" ? (
                  <Input
                    placeholder="Your answer"
                    value={answer.text}
                    disabled={!canAttempt || Boolean(result)}
                    onChange={(e) => setAnswer(question.id, { text: e.target.value })}
                  />
                ) : question.type === "MULTIPLE_CHOICE" ? (
                  <div className="space-y-2">
                    {question.options.map((option) => (
                      <Checkbox
                        key={option.id}
                        label={option.text}
                        checked={answer.ids.includes(option.id)}
                        disabled={!canAttempt || Boolean(result)}
                        onChange={(checked) =>
                          setAnswer(question.id, {
                            ids: checked
                              ? [...answer.ids, option.id]
                              : answer.ids.filter((id) => id !== option.id),
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <RadioGroup
                    value={answer.ids[0] ?? ""}
                    onChange={(value) => setAnswer(question.id, { ids: [value] })}
                    options={question.options.map((option) => ({ value: option.id, label: option.text }))}
                  />
                )}

                {graded ? (
                  <div
                    className={cn(
                      "mt-3 rounded-lg border p-3 text-xs",
                      graded.isCorrect
                        ? "border-foreground/40 bg-foreground/10 text-foreground"
                        : graded.isCorrect === null
                          ? "border-border-strong bg-surface-2 text-muted-strong"
                          : "border-foreground bg-transparent text-foreground",
                    )}
                  >
                    <p className="flex items-center gap-1.5 font-semibold">
                      {graded.isCorrect ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : graded.isCorrect === null ? (
                        <ShieldCheck className="size-3.5" />
                      ) : (
                        <XCircle className="size-3.5" />
                      )}
                      {graded.isCorrect ? "Correct" : graded.isCorrect === null ? "Awaiting manual grading" : "Incorrect"}
                      <span className="ml-1 text-muted-strong">({graded.pointsAwarded} pts)</span>
                    </p>
                    {graded.explanation ? (
                      <p className="mt-1 text-muted-strong">{graded.explanation}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        {result ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/50 p-4">
            <div>
              <p className="text-sm font-semibold">
                Result: {result.score}/{result.maxScore} ({result.percent}%)
              </p>
              <p className="text-xs text-muted">
                {result.requiresManualGrading
                  ? "Some answers will be reviewed manually."
                  : result.passed
                    ? "You passed this assessment."
                    : "You did not meet the passing threshold. You may retry if attempts remain."}
              </p>
            </div>
            {result.passed ? (
              <Badge variant="success">Passed</Badge>
            ) : (
              <Badge variant="danger">Not passed</Badge>
            )}
          </div>
        ) : null}

        {canAttempt ? (
          <div className="flex items-center gap-3">
            {result ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setAnswers({});
                  setResult(null);
                }}
              >
                <RefreshCw className="size-4" /> Try again
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={submitting}>
                <Send className="size-4" /> Submit answers
              </Button>
            )}
          </div>
        ) : !result ? (
          <p className="text-sm text-muted">No attempts remaining for this assessment.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SubmissionPanel({
  levelId,
  screenshotStorageEnabled,
  existing,
  onSubmitted,
}: {
  levelId: string;
  screenshotStorageEnabled: boolean;
  existing: CodingSubmissionRow | null;
  onSubmitted: () => void;
}) {
  const [submissionUrl, setSubmissionUrl] = useState(existing?.submission_url ?? "");
  const [note, setNote] = useState(existing?.student_note ?? "");
  const [screenshotPath, setScreenshotPath] = useState(existing?.screenshot_path ?? "");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("levelId", levelId);
      const { path } = await api.upload<{ path: string }>("/api/student/uploads", formData);
      setScreenshotPath(path);
      toast.success("Screenshot uploaded.");
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!submissionUrl && !screenshotPath && !note.trim()) {
      toast.error("Add a submission URL, screenshot, or note.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/student/submissions", {
        levelId,
        submissionUrl: submissionUrl || undefined,
        screenshotPath: screenshotPath || undefined,
        note: note || undefined,
      });
      toast.success("Submission received. Awaiting verification.");
      onSubmitted();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  const status = existing
    ? existing.status === "PENDING_REVIEW"
      ? { label: "Pending Review", className: "border-border-strong bg-surface-3 text-foreground" }
      : existing.status === "REJECTED"
        ? { label: "Rejected", className: "border-foreground bg-transparent text-foreground" }
        : { label: "Verified", className: "border-foreground bg-foreground text-background" }
    : { label: "Not Submitted", className: "border-border bg-surface-2 text-muted" };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Report Your Submission</CardTitle>
          <Badge className={status.className}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {existing?.status === "PENDING_REVIEW" ? (
          <div className="flex items-start gap-2 rounded-lg border border-border-strong bg-surface-2 p-3 text-sm text-muted-strong">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>Submission received. Awaiting verification.</p>
          </div>
        ) : null}

        {existing?.status === "REJECTED" ? (
          <div className="flex items-start gap-2 rounded-lg border border-foreground bg-transparent p-3 text-sm text-foreground">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <p>Your previous submission was rejected. You may submit again with better evidence.</p>
          </div>
        ) : null}

        <Field label="Solution URL (LeetCode submission link)">
          <Input
            placeholder="https://leetcode.com/submissions/detail/..."
            value={submissionUrl}
            onChange={(e) => setSubmissionUrl(e.target.value)}
          />
        </Field>

        <Field label="Note (optional)">
          <Textarea
            placeholder="Anything the reviewer should know about your approach."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-strong">
            Screenshot (optional)
          </p>
          {screenshotStorageEnabled ? (
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-sm hover:border-border-strong">
                <FileImage className="size-4 text-muted" />
                {screenshotPath ? "Replace screenshot" : "Upload screenshot"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                />
              </label>
              {uploading ? <span className="text-xs text-muted">Uploading…</span> : null}
              {screenshotPath ? (
                <span className="flex items-center gap-1 text-xs text-foreground">
                  <CheckCircle2 className="size-3.5" /> Attached
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted">
              Screenshot uploads are disabled. Provide a submission URL or a note instead.
            </p>
          )}
        </div>

        <Button onClick={handleSubmit} loading={submitting}>
          <Send className="size-4" /> Submit for Verification
        </Button>
      </CardContent>
    </Card>
  );
}
