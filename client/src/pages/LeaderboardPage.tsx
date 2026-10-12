import { useState } from "react";
import { Lock, Medal, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { api, isApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/types";

type YearKey = "1" | "2";

export default function LeaderboardPage() {
  const [year, setYear] = useState<YearKey>("1");

  const {
    data: entries = [],
    isLoading: loading,
    error: queryError,
  } = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard", year],
    queryFn: async () => {
      const res = await api.get<{ entries: LeaderboardEntry[] }>(`/api/leaderboard?year=${year}`);
      return res.entries;
    },
    refetchInterval: 12000,
  });

  const error = queryError
    ? isApiError(queryError)
      ? queryError.message
      : "Unable to load the leaderboard."
    : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <Trophy className="size-6" /> Leaderboard
            </h1>
            <p className="mt-1 text-sm text-muted">
              Provisional marathon progression and official verified scores.
            </p>
          </div>
          <Tabs
            className="sm:w-64"
            items={[
              { id: "1", label: "1st Year" },
              { id: "2", label: "2nd Year" },
            ]}
            active={year}
            onChange={(id) => setYear(id as YearKey)}
          />
        </header>

        {loading ? (
          <PageLoader label="Loading standings" />
        ) : error ? (
          <EmptyState icon={<Lock className="size-5" />} title="Leaderboard unavailable" description={error} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Medal className="size-5" />}
            title="No scores yet"
            description="Once participants complete levels their ranks will appear here."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[2.5rem_1fr_4rem_4.5rem] gap-3 border-b border-border bg-surface-2/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted sm:grid-cols-[3rem_1fr_5rem_5.5rem]">
              <span>Rank</span>
              <span>Participant</span>
              <span className="text-right">Levels</span>
              <span className="text-right">Verified Pts</span>
            </div>
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li
                  key={entry.studentId}
                  className={cn(
                    "grid grid-cols-[2.5rem_1fr_4rem_4.5rem] items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[3rem_1fr_5rem_5.5rem]",
                    entry.isCurrentStudent && "bg-surface-2",
                  )}
                >
                  <RankBadge rank={entry.rank} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {entry.name}
                      {entry.isCurrentStudent ? (
                        <span className="ml-2 text-xs text-muted">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">{entry.displayId}</p>
                  </div>
                  <span className="text-right font-medium">{entry.levelsCompleted}</span>
                  <span className="text-right font-semibold">{entry.totalPoints}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
    <span
      className={cn(
        "inline-flex w-9 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-bold",
        rank === 1
          ? "border-foreground bg-foreground text-background"
          : top
            ? "border-foreground/60 bg-transparent text-foreground"
            : "border-border bg-surface-2 text-muted-strong",
      )}
    >
      {rank}
    </span>
  );
}
