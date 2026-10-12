import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Medal,
  RefreshCw,
  Search,
  Timer,
  Trophy,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageLoader } from "@/components/ui/feedback";
import { api } from "@/lib/api-client";
import {
  finalistStatusMeta,
  formatISTTime,
  yearLabel,
} from "@/lib/format";
import type {
  FinalistStatus,
  FinisherEntry,
  FinisherStats,
  Year,
} from "@/lib/types";

export default function AdminFinishersPage() {
  const [year, setYear] = useState<Year>(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FinalistStatus | "ALL">("ALL");
  const [sortBy, setSortBy] = useState<"finished_at" | "elapsed">("finished_at");

  const {
    data,
    isLoading: loading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin", "finishers", year, statusFilter, sortBy, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("year", String(year));
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      params.set("sortBy", sortBy);

      return api.get<{
        finishers: FinisherEntry[];
        stats: FinisherStats;
        year: Year;
      }>(`/api/admin/finishers?${params.toString()}`);
    },
    refetchInterval: 12000,
  });

  const finishers = data?.finishers ?? [];
  const stats = data?.stats;

  const exportUrl = `/api/admin/finishers/export?year=${year}&sortBy=${sortBy}${
    statusFilter !== "ALL" ? `&status=${statusFilter}` : ""
  }${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contest Finishers"
        description="Fastest participants who completed all required levels in their track. Review leading finishers to confirm winners."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-8 gap-1.5 text-xs"
              title="Refresh results"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <a href={exportUrl}>
              <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs">
                <Download className="size-3.5" /> Export CSV
              </Button>
            </a>
          </div>
        }
      />

      {/* Year Track Selection Tabs */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setYear(1)}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
            year === 1
              ? "border-foreground text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Trophy className="size-4" /> 1st Year Finishers
        </button>
        <button
          type="button"
          onClick={() => setYear(2)}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
            year === 2
              ? "border-foreground text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Trophy className="size-4" /> 2nd Year Finishers
        </button>
      </div>

      {/* Track Stats Overview Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card className="bg-surface-1">
            <CardContent className="p-3.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Registered</p>
              <p className="text-xl font-bold text-foreground">{stats.totalRegistered}</p>
              <p className="text-[10px] text-muted">In {yearLabel(year)}</p>
            </CardContent>
          </Card>

          <Card className="bg-surface-1">
            <CardContent className="p-3.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Active</p>
              <p className="text-xl font-bold text-foreground">{stats.currentlyParticipating}</p>
              <p className="text-[10px] text-muted">Participating</p>
            </CardContent>
          </Card>

          <Card className="bg-surface-1 border-foreground/30">
            <CardContent className="p-3.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Finishers</p>
              <p className="text-xl font-bold text-accent">{stats.totalFinished}</p>
              <p className="text-[10px] text-muted">All levels completed</p>
            </CardContent>
          </Card>

          <Card className="bg-surface-1">
            <CardContent className="p-3.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Earliest Finish</p>
              <p className="font-mono text-sm font-semibold text-foreground truncate">
                {stats.earliestFinish ? formatISTTime(stats.earliestFinish) : "—"}
              </p>
              <p className="text-[10px] text-muted">IST Clock</p>
            </CardContent>
          </Card>

          <Card className="bg-surface-1">
            <CardContent className="p-3.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Fastest Elapsed</p>
              <p className="font-mono text-sm font-semibold text-foreground">
                {stats.fastestElapsedFormatted ?? "—"}
              </p>
              <p className="text-[10px] text-muted">HH:MM:SS</p>
            </CardContent>
          </Card>

          <Card className="bg-surface-1">
            <CardContent className="p-3.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Verified</p>
              <p className="text-xl font-bold text-foreground">{stats.verifiedFinalists}</p>
              <p className="text-[10px] text-muted">Confirmed winners</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter and Search Controls Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9 text-xs"
            placeholder="Search by student name or roll number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Filter className="size-3.5 text-muted" />
            <select
              className="h-9 rounded-md border border-border bg-surface-1 px-2.5 text-xs font-medium"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PROVISIONAL">Provisional</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="VERIFIED">Verified Finalists</option>
              <option value="DISQUALIFIED">Disqualified</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Timer className="size-3.5 text-muted" />
            <select
              className="h-9 rounded-md border border-border bg-surface-1 px-2.5 text-xs font-medium"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            >
              <option value="finished_at">Sort by Finish Time (Clock)</option>
              <option value="elapsed">Sort by Elapsed Duration</option>
            </select>
          </div>
        </div>
      </div>

      {/* Finisher Table */}
      {loading ? (
        <PageLoader label="Loading finishers..." />
      ) : finishers.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-6 text-muted" />}
          title={`No ${yearLabel(year)} Finishers Yet`}
          description={
            search
              ? "No finishers matched your search criteria."
              : "Participants in this track will appear here automatically as soon as they complete all required levels."
          }
        />
      ) : (
        <Card className="overflow-x-auto border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted bg-surface-2/40">
                <th className="px-4 py-3 font-semibold w-16 text-center">Rank</th>
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Roll Number</th>
                <th className="px-4 py-3 font-semibold text-center">Completed</th>
                <th className="px-4 py-3 font-semibold font-mono">Finished At (IST)</th>
                <th className="px-4 py-3 font-semibold font-mono">Elapsed</th>
                <th className="px-4 py-3 font-semibold text-center">Verification</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {finishers.map((finisher) => {
                const statusMeta = finalistStatusMeta[finisher.finalistStatus];
                const isTop3 = finisher.rank <= 3;

                return (
                  <tr
                    key={finisher.studentId}
                    className={`hover:bg-surface-2/40 transition-colors ${
                      finisher.finalistStatus === "VERIFIED"
                        ? "bg-foreground/[0.02]"
                        : finisher.finalistStatus === "DISQUALIFIED"
                          ? "opacity-60"
                          : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex size-7 items-center justify-center rounded-md font-mono text-xs font-bold ${
                          finisher.rank === 1
                            ? "bg-foreground text-background"
                            : finisher.rank === 2
                              ? "border border-foreground bg-surface-3 text-foreground"
                              : finisher.rank === 3
                                ? "border border-border-strong bg-surface-2 text-foreground"
                                : "text-muted"
                        }`}
                      >
                        {finisher.rank}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-foreground">{finisher.fullName}</p>
                        {isTop3 && <Medal className="size-3.5 text-foreground opacity-80" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {finisher.leetcodeProfileUrl ? (
                          <a
                            href={finisher.leetcodeProfileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-foreground"
                          >
                            @{finisher.leetcodeUsername}
                            <ExternalLink className="size-2.5 opacity-60" />
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-muted">@{finisher.leetcodeUsername}</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs text-muted-strong">
                      {finisher.rollNumber}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="font-mono text-xs font-bold text-foreground">
                        {finisher.completedLevels}/{finisher.totalLevels}
                      </span>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock className="size-3.5 text-muted shrink-0" />
                        <span>{formatISTTime(finisher.finishedAt)}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                      <div className="flex items-center gap-1.5">
                        <Timer className="size-3.5 text-muted shrink-0" />
                        <span>{finisher.elapsedFormatted}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <Link to={`/admin/students/${finisher.studentId}`}>
                        <Button
                          variant={finisher.finalistStatus === "VERIFIED" ? "secondary" : "primary"}
                          size="sm"
                          className="h-8 text-xs gap-1.5"
                        >
                          <Eye className="size-3.5" /> Review Candidate
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
