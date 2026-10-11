import { useEffect, useState } from "react";
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
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { difficultyMeta, formatDate, progressMeta, yearLabel } from "@/lib/format";
import type { ProgressSummary } from "@/lib/services/progression";
import type { ContestStatus } from "@/lib/services/contest";
import type { PublicStudent, RoadmapLevel } from "@/lib/types";

interface RoadmapResponse {
  student: PublicStudent;
  contest: { name: string; endAt: string | null; timezone: string };
  status: ContestStatus;
  levels: RoadmapLevel[];
  summary: ProgressSummary;
}

function statusBadge(level: RoadmapLevel): { label: string; className: string } {
  if (level.status === "COMPLETED") return { label: "Completed", className: progressMeta.COMPLETED.className };
  if (level.submissionStatus === "PENDING_REVIEW") {
    return { label: "Pending", className: progressMeta.IN_PROGRESS.className };
  }
  if (level.status === "LOCKED") return { label: "Locked", className: progressMeta.LOCKED.className };
  return { label: "Available", className: progressMeta.UNLOCKED.className };
}

export default function DashboardPage() {
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<RoadmapResponse>("/api/student/roadmap")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <EmptyState
        title="We couldn't load your contest"
        description="Please refresh the page or sign in again."
      />
    );
  }

  if (!data) return <PageLoader label="Loading your contest" />;

  const { student, summary, levels, contest, status } = data;

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

      {/* Current challenge */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Your current challenge</h2>
        {allCompleted ? (
          <Card className="border-foreground/30 p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-6" />
              <div>
                <p className="font-semibold">All levels completed</p>
                <p className="text-sm text-muted">
                  Great work — you've finished every challenge in your track.
                </p>
              </div>
            </div>
          </Card>
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
              <LevelRow key={level.id} level={level} />
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

function LevelRow({ level }: { level: RoadmapLevel }) {
  const locked = level.status === "LOCKED";
  const completed = level.status === "COMPLETED";
  const badge = statusBadge(level);

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
