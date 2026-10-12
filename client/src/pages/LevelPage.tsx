import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileImage,
  Lock,
  Send,
  ShieldCheck,
  Trophy,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, RadioGroup } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageLoader } from "@/components/ui/feedback";
import { FinalizeContestCard } from "@/components/finalize-contest-card";
import { api, isApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  LEETCODE_SUBMISSION_URL_MESSAGE,
  parseLeetcodeSubmissionDetailUrl,
} from "@/lib/leetcode-url";
import { difficultyMeta, formatDate, progressMeta, submissionMeta } from "@/lib/format";
import type {
  AttemptDetail,
  AssessmentState,
  PhaseState,
  SubmitResult,
} from "@/lib/services/assessments";
import type { ContestStatus } from "@/lib/services/contest";
import type {
  CodingSubmissionRow,
  Difficulty,
  ProgressStatus,
  QuestionPhase,
  RoadmapLevel,
} from "@/lib/types";

import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { LanguageSelect } from "@/components/ui/language-select";

interface LevelResponse {
  level: {
    id: string;
    levelNumber: number;
    totalLevels?: number;
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
  totalLevels?: number;
  nextLevel: RoadmapLevel | null;
  problem: { title: string; url: string; slug: string } | null;
  assessment: AssessmentState;
  attempts: AttemptDetail[];
  submission: CodingSubmissionRow | null;
  contest: ContestStatus;
  screenshotStorageEnabled: boolean;
}

interface SubmissionResponse {
  submission: CodingSubmissionRow;
  nextLevel: RoadmapLevel | null;
  completed: boolean;
  totalLevels?: number;
}

export default function LevelPage() {
  const params = useParams<{ levelId: string }>();
  const levelId = params.levelId ?? "";

  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery<LevelResponse>({
    queryKey: ["student", "level", levelId],
    queryFn: () => api.get<LevelResponse>(`/api/student/levels/${levelId}`),
    refetchInterval: 12000,
    enabled: Boolean(levelId),
  });

  const load = useCallback(() => {
    // Background-refresh every student-scoped query (level + roadmap + profile).
    queryClient.invalidateQueries({ queryKey: ["student"] });
  }, []);

  // Warms the cache for a level the student is now authorised to open, so the
  // "Continue" click renders instantly instead of waiting on a network trip.
  const prefetchLevel = useCallback((id: string) => {
    void queryClient.prefetchQuery({
      queryKey: ["student", "level", id],
      queryFn: () => api.get<LevelResponse>(`/api/student/levels/${id}`),
      staleTime: 15_000,
    });
  }, []);

  // Applies the server's authoritative completion result to the local cache so
  // the next-level banner appears immediately after a successful response.
  const applyProgressUpdate = useCallback(
    (completed: boolean, nextLevel: RoadmapLevel | null, totalLevels?: number) => {
      queryClient.setQueryData<LevelResponse>(["student", "level", levelId], (old) => {
        if (!old) return old;
        return {
          ...old,
          level: {
            ...old.level,
            status: completed ? "COMPLETED" : old.level.status,
            totalLevels: totalLevels ?? old.totalLevels,
          },
          totalLevels: totalLevels ?? old.totalLevels,
          nextLevel: nextLevel ?? old.nextLevel,
        };
      });
    },
    [levelId],
  );

  const handleSubmissionSuccess = useCallback(
    (res: SubmissionResponse) => {
      queryClient.setQueryData<LevelResponse>(["student", "level", levelId], (old) => {
        if (!old) return old;
        return {
          ...old,
          submission: res.submission,
        };
      });
      applyProgressUpdate(res.completed, res.nextLevel, res.totalLevels);
      if (res.nextLevel) prefetchLevel(res.nextLevel.id);
      load();
    },
    [levelId, applyProgressUpdate, load, prefetchLevel],
  );

  if (loading) return <PageLoader label="Loading challenge" />;
  if (queryError || !data) {
    const errorMsg = queryError
      ? isApiError(queryError)
        ? queryError.message
        : "Unable to load this level."
      : "This level could not be loaded.";
    return (
      <EmptyState
        icon={<AlertCircle className="size-5" />}
        title="Level unavailable"
        description={errorMsg}
        action={
          <Link to="/dashboard">
            <Button variant="secondary">Back to contest</Button>
          </Link>
        }
      />
    );
  }

  const { level, problem, assessment, attempts, submission, screenshotStorageEnabled, nextLevel } = data;
  // Server always returns the true track total; fall back to the next/current
  // level number rather than any hardcoded maximum.
  const totalLevels =
    data.totalLevels ?? level.totalLevels ?? (nextLevel ? nextLevel.levelNumber : level.levelNumber);
  const difficulty = difficultyMeta[level.difficulty];
  const status = progressMeta[level.status];
  const beforePhases = assessment.phases.filter((phase) => phase.phase === "BEFORE");
  const afterPhases = assessment.phases.filter((phase) => phase.phase === "AFTER");
  const isCompleted = level.status === "COMPLETED";
  // The immutable one-submission attempt for a phase, when it exists.
  const submissionDetailFor = (phase: QuestionPhase) =>
    attempts.find((detail) => detail.attempt.phase === phase && detail.attempt.is_submission) ?? null;

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
            LEVEL {String(level.levelNumber).padStart(2, "0")} / {String(totalLevels).padStart(2, "0")}
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
          submittedDetail={submissionDetailFor("BEFORE")}
          onSubmitted={(result) => {
            toast[result.passed ? "success" : "warning"](
              result.passed
                ? `Assessment passed with ${result.score}/${result.maxScore}.`
                : result.requiresManualGrading
                  ? "Submitted. Your text answers will be reviewed by the organisers."
                  : `Submit recorded. Scored ${result.score}/${result.maxScore} (${result.percent}%).`,
            );
            applyProgressUpdate(result.completed ?? false, result.nextLevel ?? null, result.totalLevels);
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

      {/* Submission verification. Under the one-submission policy a level accepts
          exactly one non-rejected solution, so a recorded attempt renders as a
          read-only summary. Only a rejected attempt re-opens the form. */}
      {level.requireVerifiedSubmission ? (
        submission && submission.status !== "REJECTED" ? (
          <SubmittedSolutionPanel submission={submission} />
        ) : (
          <SubmissionPanel
            key={level.id}
            levelId={level.id}
            screenshotStorageEnabled={screenshotStorageEnabled}
            existing={submission}
            onSubmissionSuccess={handleSubmissionSuccess}
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
          submittedDetail={submissionDetailFor("AFTER")}
          onSubmitted={(result) => {
            toast[result.passed ? "success" : "warning"](
              result.passed
                ? `Assessment passed with ${result.score}/${result.maxScore}.`
                : result.requiresManualGrading
                  ? "Submitted. Your text answers will be reviewed by the organisers."
                  : `Submit recorded. Scored ${result.score}/${result.maxScore} (${result.percent}%).`,
            );
            applyProgressUpdate(result.completed ?? false, result.nextLevel ?? null, result.totalLevels);
            load();
          }}
        />
      ))}

      {/* Completion + next level. */}
      {isCompleted ? (
        <Card className="border-foreground/40 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-6 text-foreground" />
              <div>
                <p className="font-semibold">Attempt Recorded · Next Level Unlocked</p>
                <p className="text-sm text-muted">
                  {nextLevel
                    ? `Up next: Level ${String(nextLevel.levelNumber).padStart(2, "0")} — ${nextLevel.title}`
                    : "You've reached the final level of your track."}
                </p>
              </div>
            </div>
            {nextLevel ? (
              <Link
                to={`/dashboard/level/${nextLevel.id}`}
                className="shrink-0"
                onMouseEnter={() => prefetchLevel(nextLevel.id)}
                onFocus={() => prefetchLevel(nextLevel.id)}
              >
                <Button size="lg">
                  Continue to Level {String(nextLevel.levelNumber).padStart(2, "0")} →
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

      {isCompleted && !nextLevel ? (
        <FinalizeContestCard allCompleted finalizedAt={undefined} />
      ) : null}

      {attempts.length > 0 ? (
        <Card className="p-5">
          <CardTitle className="mb-3">Assessment attempts</CardTitle>
          <p className="mb-3 text-xs text-muted">
            Each quiz accepts exactly one submission per phase. Submitted answers are locked and
            cannot be changed.
          </p>
          <div className="space-y-3">
            {attempts.map((detail) => {
              const { attempt } = detail;
              const primary = attempt.is_submission;
              return (
                <div
                  key={attempt.id}
                  className={cn(
                    "rounded-lg border px-3.5 py-3 text-sm",
                    primary ? "border-foreground/30 bg-surface-2/60" : "border-border bg-surface-2/40",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {attempt.phase} · attempt #{attempt.attempt_number}
                      {primary ? (
                        <Badge variant="success" className="ml-2">
                          Locked submission
                        </Badge>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      {attempt.submitted_at ? (
                        <span className="hidden text-muted sm:block">
                          {formatDate(attempt.submitted_at)}
                        </span>
                      ) : null}
                      <span className="text-muted">
                        {attempt.score}/{attempt.max_score}
                      </span>
                      <Badge
                        variant={
                          attempt.passed
                            ? "success"
                            : attempt.status === "GRADED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {attempt.status === "GRADED"
                          ? attempt.passed
                            ? "Passed"
                            : "Failed"
                          : attempt.status}
                      </Badge>
                    </span>
                  </div>
                  {detail.answers.length > 0 ? (
                    <ul className="mt-3 space-y-2 border-t border-border pt-3">
                      {detail.answers.map((answer) => (
                        <li key={answer.questionId} className="text-xs">
                          <p className="flex flex-wrap items-center gap-1.5 text-muted-strong">
                            <span className="font-medium text-foreground">{answer.questionText}</span>
                            <span className="text-muted">({answer.pointsAwarded} pts)</span>
                            {answer.isCorrect === true ? (
                              <Badge variant="success">Correct</Badge>
                            ) : answer.isCorrect === null ? (
                              <Badge variant="neutral">Under review</Badge>
                            ) : (
                              <Badge variant="danger">Incorrect</Badge>
                            )}
                          </p>
                          {answer.textAnswer ? (
                            <p className="mt-1 rounded-md border border-border bg-surface-1/60 px-2.5 py-1.5 text-muted-strong">
                              {answer.textAnswer}
                            </p>
                          ) : null}
                          {answer.selectedOptions.length > 0 ? (
                            <p className="mt-1 text-muted">
                              Selected:{" "}
                              {answer.selectedOptions.map((option) => option.text).join(", ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function AssessmentPanel({
  phase,
  levelId,
  submittedDetail,
  onSubmitted,
}: {
  phase: PhaseState;
  levelId: string;
  submittedDetail: AttemptDetail | null;
  onSubmitted: (result: SubmitResult) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, { ids: string[]; text: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // One-submission policy: once a submission exists the phase is locked forever.
  const locked = phase.submitted || Boolean(submittedDetail);
  const canAttempt = !locked;

  const resultByQuestion = useMemo(() => {
    const map = new Map<string, SubmitResult["answers"][number]>();
    result?.answers.forEach((a) => map.set(a.questionId, a));
    return map;
  }, [result]);

  const boundsFor = (question: PhaseState["questions"][number]) => ({
    min: question.minLength ?? 1,
    max: question.maxLength ?? 4000,
  });

  const setAnswer = (questionId: string, patch: Partial<{ ids: string[]; text: string }>) =>
    setAnswers((prev) => {
      const current = prev[questionId] ?? { ids: [], text: "" };
      return { ...prev, [questionId]: { ...current, ...patch } };
    });

  // Mirrors the server-side validation: every question must be answered before
  // the single allowed submission is consumed.
  const validateAnswers = (): string | null => {
    for (const question of phase.questions) {
      const answer = answers[question.id] ?? { ids: [], text: "" };
      if (question.type === "SHORT_TEXT") {
        const { min, max } = boundsFor(question);
        const text = answer.text.trim();
        if (text.length < min) {
          return `Answer "${question.text}" is required (minimum ${min} characters).`;
        }
        if (text.length > max) {
          return `Answer "${question.text}" is too long (maximum ${max} characters).`;
        }
      } else if (answer.ids.length === 0) {
        return `Please choose an answer for: ${question.text}`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const invalid = validateAnswers();
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setConfirmOpen(false);

    const payload = phase.questions.map((q) => {
      const answer = answers[q.id] ?? { ids: [], text: "" };
      return {
        questionId: q.id,
        selectedOptionIds: answer.ids.length > 0 ? answer.ids : undefined,
        textAnswer: answer.text.trim() || undefined,
      };
    });

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

  const lockedAttempt = locked ? submittedDetail : null;
  const lockedPercent = lockedAttempt
    ? lockedAttempt.attempt.max_score === 0
      ? 100
      : Math.round((lockedAttempt.attempt.score / lockedAttempt.attempt.max_score) * 100)
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{phase.phase === "BEFORE" ? "Answer before you code" : "Answer after you code"}</CardTitle>
          <div className="flex items-center gap-2">
            {phase.passed ? <Badge variant="success">Passed</Badge> : null}
            {locked ? (
              <Badge variant="success">Submitted · locked</Badge>
            ) : (
              <Badge variant="neutral">1 submission</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {locked && lockedAttempt ? (
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2/40 p-3.5">
            <Lock className="mt-0.5 size-5 shrink-0 text-muted-strong" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Answers submitted — locked</p>
              <p className="mt-0.5 text-muted">
                Submitted{" "}
                {lockedAttempt.attempt.submitted_at
                  ? formatDate(lockedAttempt.attempt.submitted_at)
                  : "recently"}
                . This quiz accepts exactly one submission per phase, so these answers can no longer
                be changed.
              </p>
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted">Score</dt>
              <dd className="font-medium text-foreground">
                {lockedAttempt.attempt.score}/{lockedAttempt.attempt.max_score} ({lockedPercent}%)
              </dd>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd className="font-medium text-foreground">
                {lockedAttempt.attempt.status === "GRADED"
                  ? lockedAttempt.attempt.passed
                    ? "Passed"
                    : "Failed"
                  : "Submitted for review"}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            {lockedAttempt.answers.map((answer) => (
              <div
                key={answer.questionId}
                className="rounded-lg border border-border bg-surface-2/40 p-3.5"
              >
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {answer.questionText}
                  <span className="text-xs text-muted">({answer.pointsAwarded} pts)</span>
                  {answer.isCorrect === true ? (
                    <Badge variant="success">Correct</Badge>
                  ) : answer.isCorrect === null ? (
                    <Badge variant="neutral">Submitted for review</Badge>
                  ) : (
                    <Badge variant="danger">Incorrect</Badge>
                  )}
                </p>
                {answer.textAnswer ? (
                  <p className="mt-2 whitespace-pre-line rounded-md border border-border bg-surface-1/60 px-3 py-2 text-sm text-muted-strong">
                    {answer.textAnswer}
                  </p>
                ) : null}
                {answer.selectedOptions.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {answer.selectedOptions.map((option) => (
                      <li key={option.id} className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-border" /> {option.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      ) : (
        <CardContent className="space-y-4">
          {phase.questions.length === 0 ? (
            <p className="text-sm text-muted">No questions configured for this phase.</p>
          ) : (
            phase.questions.map((question, index) => {
              const answer = answers[question.id] ?? { ids: [], text: "" };
              const graded = resultByQuestion.get(question.id);
              const { min, max } = boundsFor(question);
              const textLength = answer.text.trim().length;
              return (
                <div key={question.id} className="rounded-xl border border-border bg-surface-2/40 p-4">
                  <p className="mb-3 text-sm font-medium">
                    <span className="mr-2 text-muted">{index + 1}.</span>
                    {question.text}
                    <span className="ml-2 text-xs text-muted">{question.points} pts</span>
                  </p>

                  {question.type === "SHORT_TEXT" ? (
                    <div className="space-y-1.5">
                      <Textarea
                        placeholder="Type your explanation…"
                        value={answer.text}
                        disabled={!canAttempt || Boolean(result)}
                        onChange={(e) => setAnswer(question.id, { text: e.target.value })}
                        className="min-h-28"
                      />
                      <p className="flex justify-between text-[11px] text-muted">
                        <span>
                          {textLength < min
                            ? `Required — at least ${min} characters.`
                            : textLength > max
                              ? `Too long — maximum ${max} characters.`
                              : "Required answer."}
                        </span>
                        <span className={cn(textLength < min || textLength > max ? "text-danger" : "")}>
                          {textLength}/{max || 4000}
                        </span>
                      </p>
                    </div>
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
                        {graded.isCorrect
                          ? "Correct"
                          : graded.isCorrect === null
                            ? "Submitted for review"
                            : "Incorrect"}
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
                    ? "Submitted. Your text answers will be reviewed by the organisers."
                    : result.passed
                      ? "You passed this assessment."
                      : "Your submission has been recorded. This quiz accepts exactly one submission, so you cannot retry."}
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
              <Button onClick={() => setConfirmOpen(true)} loading={submitting}>
                <Send className="size-4" /> Submit answers
              </Button>
            </div>
          ) : null}
        </CardContent>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Submit Quiz?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Back
            </Button>
            <Button onClick={handleSubmit} loading={submitting}>
              Submit quiz
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          You can submit this quiz only once. Your answers will be locked and you will not be able
          to change them.
        </p>
      </Dialog>
    </Card>
  );
}

function SubmittedSolutionPanel({ submission }: { submission: CodingSubmissionRow }) {
  const verified = submission.status === "VERIFIED";
  return (
    <Card className={verified ? "border-foreground/30" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Submitted Solution</CardTitle>
          <Badge className={submissionMeta[submission.status].className}>
            {submissionMeta[submission.status].label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2/40 p-3.5">
          {verified ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-foreground" />
          ) : (
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-strong" />
          )}
          <div className="text-sm">
            <p className="font-semibold text-foreground">
              {verified ? "Submission verified" : "Attempt recorded — awaiting review"}
            </p>
            <p className="mt-0.5 text-muted">
              {verified
                ? `Your solution was verified ${formatDate(submission.verified_at)}. This level is locked.`
                : "Your solution has been reported and the next level is unlocked. It will be verified during the audit."}
            </p>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted">Attempt</dt>
            <dd className="font-medium text-foreground">#{submission.attempt_number}</dd>
          </div>
          <div>
            <dt className="text-muted">Language</dt>
            <dd className="font-medium text-foreground">{submission.programming_language ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Submitted (IST)</dt>
            <dd className="font-medium text-foreground">{formatDate(submission.created_at)}</dd>
          </div>
          {submission.submission_url ? (
            <div className="sm:col-span-2">
              <dt className="text-muted">LeetCode submission</dt>
              <dd>
                <a
                  href={submission.submission_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all font-mono text-foreground hover:underline"
                >
                  {submission.submission_url}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {submission.source_code ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-strong">
              Your solution
            </p>
            <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-2/40 p-3.5 font-mono text-xs leading-relaxed text-foreground">
              {submission.source_code}
            </pre>
          </div>
        ) : null}

        <p className="rounded-md border border-border bg-surface-2/30 p-3 text-[11px] text-muted-strong">
          Each level accepts exactly one solution. If a reviewer rejects this attempt, the level
          reopens so you can submit a new one.
        </p>
      </CardContent>
    </Card>
  );
}

function SubmissionPanel({
  levelId,
  screenshotStorageEnabled,
  existing,
  onSubmissionSuccess,
  onSubmitted,
}: {
  levelId: string;
  screenshotStorageEnabled: boolean;
  existing: CodingSubmissionRow | null;
  onSubmissionSuccess?: (res: SubmissionResponse) => void;
  onSubmitted?: () => void;
}) {
  // The editable fields always start blank: `existing` is used only to render
  // read-only status/summary for the latest attempt. This keeps the form clean
  // when moving between levels and lets a student report a fresh attempt without
  // overwriting the previous one.
  const [submissionUrl, setSubmissionUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [note, setNote] = useState("");
  const [screenshotPath, setScreenshotPath] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [programmingLanguage, setProgrammingLanguage] = useState("python");
  const [codeFileName, setCodeFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleCodeFile = (file: File) => {
    setCodeFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "py") setProgrammingLanguage("python");
    else if (ext === "cpp" || ext === "cc" || ext === "cxx") setProgrammingLanguage("cpp");
    else if (ext === "c") setProgrammingLanguage("c");
    else if (ext === "java") setProgrammingLanguage("java");
    else if (ext === "js") setProgrammingLanguage("javascript");
    else if (ext === "ts") setProgrammingLanguage("typescript");
    else if (ext === "go") setProgrammingLanguage("go");
    else if (ext === "rs") setProgrammingLanguage("rust");

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setSourceCode(content);
        toast.success(`Loaded ${file.name}`);
      }
    };
    reader.readAsText(file);
  };

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
    const parsedUrl = parseLeetcodeSubmissionDetailUrl(submissionUrl);
    if (!parsedUrl) {
      setUrlError(LEETCODE_SUBMISSION_URL_MESSAGE);
      return;
    }
    if (!sourceCode.trim()) {
      toast.error("Complete solution source code is required. Please paste your code or upload a solution file.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<SubmissionResponse>("/api/student/submissions", {
        levelId,
        submissionUrl: parsedUrl.url,
        screenshotPath: screenshotPath || undefined,
        note: note || undefined,
        sourceCode: sourceCode.trim(),
        programmingLanguage: programmingLanguage || "python",
        codeFileName: codeFileName || undefined,
      });
      toast.success("Attempt recorded. Next level unlocked.");
      if (onSubmissionSuccess) {
        onSubmissionSuccess(res);
      }
      onSubmitted?.();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  const status = existing
    ? existing.status === "PENDING_REVIEW"
      ? { label: "Attempt Recorded", className: "border-border-strong bg-surface-3 text-foreground" }
      : existing.status === "REJECTED"
        ? { label: "Rejected", className: "border-foreground bg-transparent text-foreground" }
        : { label: "Verified", className: "border-foreground bg-foreground text-background" }
    : { label: "Not Submitted", className: "border-border bg-surface-2 text-muted" };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Report Your Solution</CardTitle>
          <Badge className={status.className}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {existing?.code_requested ? (
          <div className="flex items-start gap-2 rounded-lg border border-foreground bg-foreground/5 p-3 text-sm text-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div>
              <p className="font-semibold">Source code requested by organizer</p>
              <p className="text-xs text-muted-strong mt-0.5">
                The contest administrators have requested you to provide your source code solution for this level.
              </p>
            </div>
          </div>
        ) : null}

        {existing?.status === "PENDING_REVIEW" ? (
          <div className="flex items-start gap-2 rounded-lg border border-border-strong bg-surface-2 p-3 text-sm text-muted-strong">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>Attempt recorded. Next level unlocked. Official score will be verified during audit.</p>
          </div>
        ) : null}

        {existing?.status === "REJECTED" ? (
          <div className="flex items-start gap-2 rounded-lg border border-foreground bg-transparent p-3 text-sm text-foreground">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <p>Your previous submission was rejected. You may submit again with better evidence.</p>
          </div>
        ) : null}

        {existing ? (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-strong">
                Latest submission · Attempt #{existing.attempt_number}
              </span>
              <Badge className={status.className}>{status.label}</Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted">Language</dt>
                <dd className="font-medium text-foreground">
                  {existing.programming_language ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Submitted (IST)</dt>
                <dd className="font-medium text-foreground">{formatDate(existing.created_at)}</dd>
              </div>
              {existing.submission_url ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">LeetCode submission</dt>
                  <dd>
                    <a
                      href={existing.submission_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all font-mono text-foreground hover:underline"
                    >
                      {existing.submission_url}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="text-[11px] text-muted">
              A level accepts a single solution. This will replace the rejected attempt once submitted.
            </p>
          </div>
        ) : null}

        <Field label="LeetCode Submission Detail URL (Required)" error={urlError || undefined}>
          <Input
            placeholder="https://leetcode.com/submissions/detail/2165837360/"
            value={submissionUrl}
            aria-invalid={Boolean(urlError)}
            onChange={(e) => {
              setSubmissionUrl(e.target.value);
              if (urlError) setUrlError("");
            }}
          />
        </Field>

        {/* Solution Code Section (Mandatory) */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-strong">
              Solution Code (Required)
            </label>
            <span className="text-[11px] text-muted">
              Paste your solution or upload a code file below
            </span>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] uppercase font-bold text-muted mb-1 block">
                  Programming Language
                </label>
                <LanguageSelect
                  value={programmingLanguage}
                  onChange={setProgrammingLanguage}
                />
              </div>

              <div className="pt-4">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs font-medium hover:border-border-strong">
                  <Upload className="size-3.5 text-muted" />
                  {codeFileName ? codeFileName : "Upload solution file"}
                  <input
                    type="file"
                    accept=".py,.cpp,.cc,.c,.java,.js,.ts,.go,.rs,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCodeFile(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <Textarea
              rows={8}
              className="font-mono text-xs leading-relaxed"
              placeholder="Paste your complete solution source code here..."
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
            />
          </div>
        </div>

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

        <Button onClick={handleSubmit} loading={submitting} disabled={submitting}>
          <Send className="size-4" /> Submit & Continue →
        </Button>
      </CardContent>
    </Card>
  );
}
