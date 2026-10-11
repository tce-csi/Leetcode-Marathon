import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award, CheckCircle2, ExternalLink, FileText, Target, Trophy } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate, progressMeta, submissionMeta } from "@/lib/format";
import type { ProgressSummary } from "@/lib/services/progression";
import type { ContestStatus } from "@/lib/services/contest";
import type { CodingSubmissionRow, PublicStudent, RoadmapLevel } from "@/lib/types";

interface ProgressResponse {
  student: PublicStudent;
  status: ContestStatus;
  levels: RoadmapLevel[];
  summary: ProgressSummary;
  submissions: CodingSubmissionRow[];
  rank: number | null;
  contest: { name: string; endAt: string | null; timezone: string };
}

export default function ProgressPage() {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [tab, setTab] = useState("levels");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<ProgressResponse>("/api/student/progress")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <EmptyState title="We couldn't load your progress" description="Please refresh the page." />
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <PageLoader label="Loading your progress" />
        </main>
      </div>
    );
  }

  const { student, summary, levels, submissions, rank, contest } = data;
  const verified = submissions.filter((s) => s.status === "VERIFIED").length;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <header>
          <p className="text-sm text-muted">{contest.name}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">My progress</h1>
          <p className="mt-1 text-sm text-muted">
            {student.full_name} · {student.roll_number}
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<Trophy className="size-5" />} label="Points" value={summary.totalPoints} tone="accent" />
          <Metric
            icon={<Target className="size-5" />}
            label="Levels completed"
            value={`${summary.levelsCompleted}/${summary.totalLevels}`}
            tone="brand"
          />
          <Metric icon={<Award className="size-5" />} label="Rank (year)" value={rank ? `#${rank}` : "—"} tone="success" />
          <Metric icon={<CheckCircle2 className="size-5" />} label="Verified solutions" value={verified} tone="info" />
        </section>

        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Completion</span>
            <span className="text-muted">{summary.percent}%</span>
          </div>
          <Progress value={summary.percent} />
        </Card>

        <Tabs
          items={[
            { id: "levels", label: "Levels", count: levels.length },
            { id: "submissions", label: "Submissions", count: submissions.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "levels" ? (
          <Card>
            <CardContent className="p-0">
              {levels.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No levels in your track yet" />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {levels.map((level) => {
                    const status = progressMeta[level.status];
                    return (
                      <li key={level.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex size-8 items-center justify-center rounded-lg text-xs font-bold",
                              level.status === "COMPLETED"
                                ? "bg-success/15 text-success"
                                : "bg-surface-3 text-muted-strong",
                            )}
                          >
                            {level.levelNumber}
                          </span>
                          <div>
                            <p className="text-sm font-medium">{level.title}</p>
                            <p className="text-xs text-muted">{level.points} pts</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={status.className}>{status.label}</Badge>
                          {level.status !== "LOCKED" ? (
                            <Link to={`/dashboard/level/${level.id}`}>
                              <Button variant="ghost" size="sm">
                                Open
                              </Button>
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Submission history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {submissions.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={<FileText className="size-5" />}
                    title="No submissions yet"
                    description="Submit your solution on a level to see it here."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {submissions.map((submission) => {
                    const status = submissionMeta[submission.status];
                    return (
                      <li key={submission.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {submission.problem_slug ?? "Submission"}
                          </p>
                          <p className="text-xs text-muted">
                            {formatDate(submission.created_at)}
                            {submission.verdict ? ` · ${submission.verdict}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={status.className}>{status.label}</Badge>
                          {submission.submission_url ? (
                            <a
                              href={submission.submission_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted hover:text-foreground"
                              aria-label="Open submission"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: "brand" | "accent" | "success" | "info";
}) {
  const tones = {
    brand: "bg-brand/15 text-brand-soft",
    accent: "bg-accent/15 text-accent",
    success: "bg-success/15 text-success",
    info: "bg-info/15 text-info",
  };
  return (
    <Card className="p-4">
      <div className={cn("mb-2 flex size-9 items-center justify-center rounded-lg", tones[tone])}>{icon}</div>
      <p className="text-xl font-bold tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Card>
  );
}
