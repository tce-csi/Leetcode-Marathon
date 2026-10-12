import { useState } from "react";
import { CheckCircle2, Lock, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { api, isApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/data-sync";
import { formatIST } from "@/lib/format";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";

interface FinalizeResponse {
  finalizedAt: string;
  alreadyFinalized: boolean;
}

/**
 * "Submit Contest for Review" control.
 *
 * The button only enables once every level is complete. Submitting freezes the
 * attempt (enforced server-side), moves the student into the organiser review
 * queue and is irreversible. The card also renders the locked confirmation once
 * the contest has been submitted.
 */
export function FinalizeContestCard({
  allCompleted,
  finalizedAt,
  className,
}: {
  allCompleted: boolean;
  finalizedAt: string | null | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const stampedAt = submittedAt ?? finalizedAt ?? null;
  const finalized = Boolean(stampedAt);

  const handleFinalize = async () => {
    setSubmitting(true);
    try {
      const res = await api.post<FinalizeResponse>("/api/student/contest/finalize");
      setOpen(false);
      setSubmittedAt(res.finalizedAt);
      toast.success(
        res.alreadyFinalized
          ? "Your contest is already submitted for review."
          : "Contest submitted for review. Your attempt is now locked.",
      );
      // Refresh the student's own views and any open organiser review queue.
      queryClient.invalidateQueries({ queryKey: ["student"] });
      notifyDataChanged("admin");
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : "Could not submit the contest for review.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (finalized) {
    return (
      <Card className={cn("border-foreground bg-surface-1 p-6", className)}>
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-6 shrink-0 text-foreground" />
          <div>
            <h3 className="text-lg font-bold tracking-tight">Submitted for Review</h3>
            <p className="mt-0.5 text-sm text-muted">
              Your final submission has been locked and sent to the organisers. You can no
              longer change your attempt.
            </p>
            <p className="mt-2 font-mono text-xs text-muted-strong">
              Submitted {formatIST(stampedAt)} · Status: Under Review
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (!allCompleted) {
    return (
      <Card className={cn("border-border p-6", className)}>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-6 shrink-0 text-muted" />
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Submit Contest for Review</h3>
            <p className="mt-0.5 text-sm text-muted">
              Complete every level in your track to unlock final submission. Once submitted,
              your attempt is locked and forwarded to the organisers for verification.
            </p>
            <Button className="mt-3" disabled>
              <Send className="size-4" /> Complete all levels to submit
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className={cn("border-foreground bg-surface-1 p-6", className)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-foreground" />
            <div>
              <h3 className="text-lg font-bold tracking-tight">
                All levels complete — ready to submit
              </h3>
              <p className="mt-0.5 text-sm text-muted">
                Submitting finalises your contest and sends it to the organisers for review.
                This cannot be undone.
              </p>
            </div>
          </div>
          <Button size="lg" className="shrink-0" onClick={() => setOpen(true)}>
            <Send className="size-4" /> Submit Contest for Review
          </Button>
        </div>
      </Card>

      <Dialog
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        title="Submit contest for review?"
        description="This is final. Your attempt will be locked and you will not be able to add or change any submissions or assessments."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleFinalize} loading={submitting}>
              <Send className="size-4" /> Yes, submit for review
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm text-muted-strong">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground" />
            Every level in your track is marked complete.
          </li>
          <li className="flex items-start gap-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-foreground" />
            Your submissions and assessments will be frozen.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" />
            Organisers will verify your evidence to confirm final rankings.
          </li>
        </ul>
      </Dialog>
    </>
  );
}
