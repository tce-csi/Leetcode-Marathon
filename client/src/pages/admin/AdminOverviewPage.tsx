import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Activity,
  ClipboardCheck,
  Clock,
  Layers,
  ScrollText,
  Trophy,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { AdminStats, AuditLogEntry } from "@/lib/services/admin";
import type { ContestStatus } from "@/lib/services/contest";
import type { ContestRow } from "@/lib/types";

interface OverviewResponse {
  stats: AdminStats;
  contest: ContestRow;
  status: ContestStatus;
  recentAudit: AuditLogEntry[];
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<OverviewResponse>("/api/admin/overview")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <EmptyState title="Unable to load the dashboard" description="Please refresh the page." />;
  }
  if (!data) return <PageLoader label="Loading dashboard" />;

  const { stats, contest, status, recentAudit } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`${contest.name} · ${
          status.isLive ? "Live" : status.contest === "ENDED" ? "Ended" : "Scheduled"
        }`}
        actions={
          <Link to="/admin/settings">
            <Button variant="secondary" size="sm">
              Contest settings
            </Button>
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Users className="size-5" />} label="Registered students" value={stats.totalStudents} tone="brand" sub={`${stats.firstYear} first · ${stats.secondYear} second`} />
        <Stat icon={<Activity className="size-5" />} label="Active participants" value={stats.participants} tone="success" sub={`${stats.activeStudents} accounts enabled`} />
        <Stat icon={<ClipboardCheck className="size-5" />} label="Pending reviews" value={stats.pendingReviews} tone="warning" sub={`${stats.totalSubmissions} submissions total`} />
        <Stat icon={<Trophy className="size-5" />} label="Levels completed" value={stats.completedLevels} tone="accent" sub={`${stats.verifiedSubmissions} verified solutions`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-brand-soft" /> Contest health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Overall completion rate</span>
                <span className="font-semibold">{stats.completionRate}%</span>
              </div>
              <Progress value={stats.completionRate} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Levels" value={stats.totalLevels} />
              <MiniStat label="Verified" value={stats.verifiedSubmissions} />
              <MiniStat label="Submissions" value={stats.totalSubmissions} />
              <MiniStat label="Participants" value={stats.participants} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-brand-soft" /> Window
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Registration" value={status.registration} />
            <Row label="Contest" value={status.contest} />
            <Row label="Starts" value={formatRelative(status.startsAt)} />
            <Row label="Timezone" value={status.timezone} />
            <div className="pt-1">
              <Badge variant={status.canRegister ? "success" : "neutral"}>
                {status.canRegister ? "Registration open" : "Registration closed"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-brand-soft" /> Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <EmptyState title="No activity yet" description="Actions taken by admins and students will appear here." />
          ) : (
            <ul className="space-y-2">
              {recentAudit.map((log) => (
                <li
                  key={log.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant={log.actor_type === "ADMIN" ? "brand" : log.actor_type === "STUDENT" ? "info" : "neutral"}>
                      {log.actor_type}
                    </Badge>
                    <span className="font-mono text-xs text-muted-strong">{log.action}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatRelative(log.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "brand" | "accent" | "warning" | "success";
  sub?: string;
}) {
  const tones = {
    brand: "bg-brand/15 text-brand-soft",
    accent: "bg-accent/15 text-accent",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
  };
  return (
    <Card className="p-4">
      <div className={cn("mb-2 flex size-9 items-center justify-center rounded-lg", tones[tone])}>{icon}</div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {sub ? <p className="mt-1 text-[11px] text-muted/80">{sub}</p> : null}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
