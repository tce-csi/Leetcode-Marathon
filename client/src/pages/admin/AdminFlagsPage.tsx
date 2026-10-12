import { useCallback, useEffect, useState } from "react";
import { Flag, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { api, isApiError } from "@/lib/api-client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { formatDate } from "@/lib/format";
import type { FlagKind, FlagSeverity, Year } from "@/lib/types";

interface ReviewFlag {
  id: string;
  kind: FlagKind;
  severity: FlagSeverity;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  student_name: string | null;
  student_roll: string | null;
  student_year: Year | null;
  level_number: number | null;
  level_title: string | null;
}

const KIND_LABELS: Record<FlagKind, string> = {
  DUPLICATE_SUBMISSION_URL: "Duplicate submission link",
  REPEATED_REJECTED_EVIDENCE: "Repeated rejected evidence",
  SUBMISSION_OUTSIDE_WINDOW: "Submission outside contest window",
  RAPID_LEVEL_COMPLETION: "Rapid level completion",
  IDENTITY_CHANGED: "LeetCode identity changed",
};

const SEVERITY_VARIANT: Record<FlagSeverity, "neutral" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "danger",
};

export default function AdminFlagsPage() {
  const [openOnly, setOpenOnly] = useState<"open" | "all">("open");
  const [flags, setFlags] = useState<ReviewFlag[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFlags(null);
    try {
      const { flags: result } = await api.get<{ flags: ReviewFlag[] }>(
        `/api/admin/flags?openOnly=${openOnly === "open"}`,
      );
      setFlags(result);
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to load review flags.");
      setFlags([]);
    }
  }, [openOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // Silent background refresh without resetting to the loading state or toasting.
  const refresh = useCallback(async () => {
    try {
      const { flags: result } = await api.get<{ flags: ReviewFlag[] }>(
        `/api/admin/flags?openOnly=${openOnly === "open"}`,
      );
      setFlags(result);
    } catch {
      // transient background failures keep the last good data
    }
  }, [openOnly]);

  useAutoRefresh(refresh, 8000);

  const resolve = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/api/admin/flags/${id}/resolve`, {});
      toast.success("Flag marked as reviewed.");
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not resolve the flag.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review flags"
        description="Signals for organiser review. Flags never disqualify a student automatically."
      />

      <Tabs
        className="sm:max-w-xs"
        items={[
          { id: "open", label: "Open" },
          { id: "all", label: "All" },
        ]}
        active={openOnly}
        onChange={(id) => setOpenOnly(id as "open" | "all")}
      />

      {flags === null ? (
        <PageLoader label="Loading flags" />
      ) : flags.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-5" />}
          title={openOnly === "open" ? "No open flags" : "No flags recorded"}
          description="Activity that may need a closer look will appear here."
        />
      ) : (
        <div className="grid gap-3">
          {flags.map((flag) => (
            <Card key={flag.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SEVERITY_VARIANT[flag.severity]}>{flag.severity}</Badge>
                    <p className="font-semibold">{KIND_LABELS[flag.kind] ?? flag.kind}</p>
                  </div>
                  <p className="text-sm text-muted">
                    {flag.student_name
                      ? `${flag.student_name}${flag.student_roll ? ` · ${flag.student_roll}` : ""}`
                      : "Contest-level flag"}
                    {flag.level_number ? ` · Level ${flag.level_number}` : ""}
                  </p>
                  <p className="text-xs text-muted">{formatDate(flag.created_at)}</p>
                  {Object.keys(flag.details ?? {}).length > 0 ? (
                    <pre className="mt-1 max-w-xl overflow-x-auto rounded-lg border border-border bg-surface-2/40 p-2.5 text-xs text-muted-strong">
                      {JSON.stringify(flag.details, null, 2)}
                    </pre>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {flag.resolved_at ? (
                    <Badge variant="neutral">
                      <ShieldCheck className="size-3.5" /> Reviewed
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyId === flag.id}
                      onClick={() => resolve(flag.id)}
                    >
                      <Flag className="size-4" /> Mark reviewed
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
