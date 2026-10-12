import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Code2,
  ExternalLink,
  Lock,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { FinalizeContestCard } from "@/components/finalize-contest-card";
import { PersonalContestCard } from "@/components/personal-contest-card";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { difficultyMeta, formatDate, formatISTTime, progressMeta, yearLabel } from "@/lib/format";
import type { ProgressSummary } from "@/lib/services/progression";
import type { ContestStatus } from "@/lib/services/contest";
import type { PublicStudent, RoadmapLevel } from "@/lib/types";

import { useQuery } from "@tanstack/react-query";

interface RoadmapResponse {
  student: PublicStudent;
  contest: { name: string; endAt: string | null; timezone: string };
  status: ContestStatus;
  levels: RoadmapLevel[];
  summary: ProgressSummary;
  /** Server clock used to anchor the live personal timer. */
  serverTime: string;
}

function statusBadge(level: RoadmapLevel): { label: string; className: string } {
  if (level.status === "COMPLETED") return { label: "Completed", className: progressMeta.COMPLETED.className };
  if (level.submissionStatus === "PENDING_REVIEW") {
    return { label: "Attempt Recorded", className: progressMeta.IN_PROGRESS.className };
  }
  if (level.status === "LOCKED") return { label: "Locked", className: progressMeta.LOCKED.className };
  return { label: "Available", className: progressMeta.UNLOCKED.className };
}

export default function DashboardPage() {
  const { data, isError, isLoading } = useQuery<RoadmapResponse>({
    queryKey: ["student", "roadmap"],
    queryFn: () => api.get<RoadmapResponse>("/api/student/roadmap"),
    refetchInterval: 12000,
  });

  if (isError) {
    return (
      <EmptyState
        title="We couldn't load your contest"
        description="Please refresh the page or sign in again."
      />
    );
  }

  if (isLoading || !data) return <PageLoader label="Loading your contest" />;

  const { student, summary, levels, contest, status, serverTime } = data;

  const contestStarted = Boolean(student.started_at);

  const currentLevel =
    levels.find((level) => level.status === "IN_PROGRESS") ??
    levels.find((level) => level.status === "UNLOCKED") ??
    null;
  const allCompleted = levels.length > 0 && levels.every((level) => level.status === "COMPLETED");

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">
            {yearLabel(student.year)} · {contest.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome, {student.full_name}
          </h1>
        </div>
        <Badge variant={status.isLive ? "success" : "neutral"} className="w-fit">
          <Clock className="size-3.5" />
          {status.isLive ? "Contest live" : status.contest === "ENDED" ? "Contest ended" : "Not started"}
        </Badge>
      </section>

      {/* Your details */}
      <Card className="p-5">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Roll number" value={student.roll_number} mono />
          <Detail
            label="LeetCode"
            value={
              student.leetcode_profile_url ? (
                <a
                  href={student.leetcode_profile_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                >
                  {student.leetcode_username}
                  <ExternalLink className="size-3.5" />
                </a>
              ) : (
                student.leetcode_username || "—"
              )
            }
          />
          <Detail
            label="Current level"
            value={summary.currentLevelNumber ? `Level ${String(summary.currentLevelNumber).padStart(2, "0")}` : "—"}
          />
          <Detail
            label="Levels completed"
            value={`${summary.levelsCompleted} / ${summary.totalLevels}`}
          />
        </dl>
      </Card>

      {/* Personal contest timer */}
      <PersonalContestCard
        startedAt={student.started_at}
        finalizedAt={summary.finalizedAt}
        serverTime={serverTime}
      />

      {/* Current challenge */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Your current challenge</h2>
        {!contestStarted ? (
          <EmptyState
            icon={<Lock className="size-5" />}
            title="Challenges are locked"
            description="Start your personal contest timer above to unlock your first challenge."
          />
        ) : allCompleted ? (
          <div className="space-y-3">
          <Card className="border-foreground bg-surface-1 p-6 space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="size-8 text-foreground shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-foreground">
                    Marathon Completed!
                  </h3>
                  <p className="text-sm text-muted mt-0.5">
                    All assigned challenges have been reported successfully.
                  </p>
                </div>
              </div>
              <Badge variant="neutral" className="w-fit text-xs font-mono">
                {summary.levelsCompleted} / {summary.totalLevels} Challenges Completed
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-2/60 p-4 sm:grid-cols-2 text-xs">
              <div>
                <p className="text-muted font-medium">Finished At (IST)</p>
                <p className="font-mono text-base font-bold text-foreground mt-0.5">
                  {summary.finishedAt ? formatISTTime(summary.finishedAt) : "Recorded"}
                </p>
              </div>
              <div>
                <p className="text-muted font-medium">Total Time Taken</p>
                <p className="font-mono text-base font-bold text-foreground mt-0.5">
                  {summary.elapsedFormatted ?? "—"}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface-2/30 p-3 text-xs text-muted-strong">
              <p>
                <strong>Notice:</strong> Your contest completion has been recorded. Official results and prizes are subject to organizer verification of submitted source code and LeetCode submissions.
              </p>
            </div>
          </Card>
          <FinalizeContestCard allCompleted={allCompleted} finalizedAt={summary.finalizedAt} />
          </div>
        ) : currentLevel ? (
          <Card className="border-foreground/30 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Level {String(currentLevel.levelNumber).padStart(2, "0")} ·{" "}
                  {difficultyMeta[currentLevel.difficulty].label}
                </p>
                <h3 className="mt-1 text-xl font-bold tracking-tight">{currentLevel.title}</h3>
                {currentLevel.problem ? (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                    <Code2 className="size-3.5" /> {currentLevel.problem.title}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge className={statusBadge(currentLevel).className}>
                    {statusBadge(currentLevel).label}
                  </Badge>
                  <Badge variant="neutral">
                    <Trophy className="size-3.5" /> {currentLevel.points} pts
                  </Badge>
                </div>
              </div>
              <Link to={`/dashboard/level/${currentLevel.id}`} className="shrink-0">
                <Button size="lg">
                  {currentLevel.status === "IN_PROGRESS" ? "Continue challenge" : "Start challenge"}
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={<Code2 className="size-5" />}
            title="No challenge available yet"
            description="Your track has no published levels right now. Check back once the organisers set them up."
          />
        )}
      </section>

      {/* Level list */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Levels</h2>
        {levels.length === 0 ? (
          <EmptyState
            icon={<Code2 className="size-5" />}
            title="No levels yet"
            description="Your track has no published levels. Check back later."
          />
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {levels.map((level) => (
              <LevelRow key={level.id} level={level} contestStarted={contestStarted} />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-medium text-foreground", mono && "font-mono")}>
        {value}
      </dd>
    </div>
  );
}

function LevelRow({ level, contestStarted }: { level: RoadmapLevel; contestStarted: boolean }) {
  const locked = level.status === "LOCKED" || !contestStarted;
  const completed = level.status === "COMPLETED";
  const badge = contestStarted ? statusBadge(level) : { label: "Locked", className: progressMeta.LOCKED.className };

  const row = (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3.5 transition-colors sm:px-5",
        locked ? "opacity-60" : "hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
          completed
            ? "bg-foreground text-background"
            : locked
              ? "bg-surface-3 text-muted"
              : "bg-surface-2 text-foreground",
        )}
      >
        {completed ? <CheckCircle2 className="size-4" /> : locked ? <Lock className="size-4" /> : level.levelNumber}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{level.title}</p>
        <p className="text-xs text-muted">
          {difficultyMeta[level.difficulty].label} · {level.points} pts
          {completed && level.completedAt ? ` · completed ${formatDate(level.completedAt)}` : ""}
        </p>
      </div>
      <Badge className={badge.className}>{badge.label}</Badge>
      {!locked ? <ArrowRight className="size-4 shrink-0 text-muted" /> : null}
    </div>
  );

  if (locked) return row;
  return (
    <Link to={`/dashboard/level/${level.id}`} className="block">
      {row}
    </Link>
  );
}
