import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, ShieldCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, isApiError } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";
import { formatElapsed, formatIST } from "@/lib/format";

interface StartContestResponse {
  startedAt: string;
  alreadyStarted: boolean;
  serverTime: string;
}

/**
 * Live, server-anchored clock. The offset between the server timestamp and the
 * browser clock is captured once (so network latency never leaks into the
 * displayed duration) and re-sampled whenever a fresher `serverTime` arrives.
 */
function useServerNow(serverTime: string | null): number {
  const offsetRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  if (serverTime) {
    offsetRef.current = Date.parse(serverTime) - Date.now();
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return now + (offsetRef.current ?? 0);
}

export function PersonalContestCard({
  startedAt,
  finalizedAt,
  serverTime,
}: {
  startedAt: string | null;
  finalizedAt: string | null;
  serverTime: string | null;
}) {
  const now = useServerNow(serverTime);

  const start = useMutation({
    mutationFn: () => api.post<StartContestResponse>("/api/student/contest/start"),
    onSuccess: (res) => {
      toast.success(
        res.alreadyStarted ? "Your contest timer was already running." : "Contest started — good luck!",
      );
      queryClient.invalidateQueries({ queryKey: ["student"] });
    },
    onError: (error) => {
      toast.error(isApiError(error) ? error.message : "Could not start the contest.");
    },
  });

  // Once the attempt is submitted for review the timer is frozen and the
  // completion card takes over — nothing to show here.
  if (finalizedAt) return null;

  if (!startedAt) {
    return (
      <Card className="border-foreground bg-surface-1 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-foreground bg-foreground text-background">
              <Play className="size-5" />
            </span>
            <div>
              <h3 className="text-lg font-bold tracking-tight">Start the contest</h3>
              <p className="mt-0.5 max-w-prose text-sm text-muted">
                Your personal timer starts the moment you press the button and runs until you
                submit your contest for review. Challenges stay locked until then.
              </p>
            </div>
          </div>
          <Button size="lg" onClick={() => start.mutate()} loading={start.isPending}>
            <Play className="size-4" /> Start Contest
          </Button>
        </div>
      </Card>
    );
  }

  const elapsedMs = Math.max(0, now - Date.parse(startedAt));

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-foreground">
            <Timer className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Elapsed time</h3>
            <p className="font-mono text-3xl font-bold tabular-nums tracking-tight">
              {formatElapsed(elapsedMs)}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5" /> Started {formatIST(startedAt)} IST
            </p>
          </div>
        </div>
        <p className="max-w-xs text-xs text-muted">
          The clock is anchored to the server, so switching tabs or devices never changes your time.
        </p>
      </div>
    </Card>
  );
}
