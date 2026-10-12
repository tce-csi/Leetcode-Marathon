import { CheckCircle2, Lock, ShieldCheck, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatIST } from "@/lib/format";
import type { ProgressSummary } from "@/lib/services/progression";

/**
 * Full-screen completion state shown after a student submits their contest for
 * review. The backend rejects every mutating route (and level access) once
 * `finalized_at` is set, so this screen merely reflects an already-enforced lock.
 */
export function ContestCompleted({
  studentName,
  summary,
}: {
  studentName: string;
  summary: ProgressSummary;
}) {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card className="border-foreground bg-surface-1 p-8 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-foreground bg-foreground/5">
          <Trophy className="size-8 text-foreground" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Contest Submitted for Review</h1>
        <p className="mt-2 text-sm text-muted">
          Well done, {studentName}. You&apos;ve completed every level and submitted your final
          attempt. The organisers will now verify your evidence.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface-2/60 p-4 text-left">
            <p className="text-xs font-medium text-muted">Submitted At (IST)</p>
            <p className="mt-0.5 font-mono text-base font-bold text-foreground">
              {formatIST(summary.finalizedAt)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2/60 p-4 text-left">
            <p className="text-xs font-medium text-muted">Levels Completed</p>
            <p className="mt-0.5 font-mono text-base font-bold text-foreground">
              {summary.levelsCompleted} / {summary.totalLevels}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="neutral" className="gap-1.5">
            <Lock className="size-3.5" /> Attempt locked
          </Badge>
          <Badge variant="warning" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Under review
          </Badge>
        </div>

        <div className="mt-6 rounded-md border border-border bg-surface-2/30 p-3 text-left text-xs text-muted-strong">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground" />
            Your submissions and assessments are frozen. Official results and prizes are subject
            to organiser verification of your LeetCode submissions and source code.
          </p>
        </div>
      </Card>
    </div>
  );
}
