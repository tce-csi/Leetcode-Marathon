import { useCallback, useEffect, useState } from "react";
import { Check, Download, ExternalLink, FileImage, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { api, isApiError } from "@/lib/api-client";
import { formatDate, submissionMeta, yearLabel } from "@/lib/format";
import { toast } from "sonner";
import type { SubmissionWithContext } from "@/lib/services/submissions";

type ReviewItem = SubmissionWithContext & { screenshotUrl: string | null };
type StatusKey = "PENDING_REVIEW" | "VERIFIED" | "REJECTED";

export default function AdminReviewsPage() {
  const [status, setStatus] = useState<StatusKey>("PENDING_REVIEW");
  const [year, setYear] = useState<"" | "1" | "2">("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ReviewItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (year) params.set("year", year);
      if (search.trim()) params.set("search", search.trim());
      const { submissions } = await api.get<{ submissions: ReviewItem[] }>(
        `/api/admin/submissions?${params.toString()}`,
      );
      setItems(submissions);
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to load submissions.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status, year, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    if (!active) return;
    setBusy(true);
    try {
      await api.post("/api/admin/submissions/review", {
        submissionId: active.id,
        decision,
        reason,
      });
      toast.success(decision === "APPROVED" ? "Submission approved." : "Submission rejected.");
      setActive(null);
      setReason("");
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Submission reviews"
          description="Verify student solutions by inspecting their evidence."
        />
        <a
          href={`/api/admin/submissions/export?status=${status}${year ? `&year=${year}` : ""}`}
          className="shrink-0"
        >
          <Button variant="secondary" size="sm">
            <Download className="size-4" /> Export CSV
          </Button>
        </a>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs
          className="sm:max-w-md"
          items={[
            { id: "PENDING_REVIEW", label: "Pending" },
            { id: "VERIFIED", label: "Approved" },
            { id: "REJECTED", label: "Rejected" },
          ]}
          active={status}
          onChange={(id) => setStatus(id as StatusKey)}
        />
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder="Search name or roll number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-11 rounded-lg border border-border bg-surface-2/70 px-3 text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value as typeof year)}
          >
            <option value="">All years</option>
            <option value="1">1st Year</option>
            <option value="2">2nd Year</option>
          </select>
        </div>
      </div>

      {loading ? (
        <PageLoader label="Loading submissions" />
      ) : items.length === 0 ? (
        <EmptyState
          title={status === "PENDING_REVIEW" ? "Nothing to review" : "No submissions here"}
          description="Submissions will appear as students submit their solutions."
        />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{item.student_name}</p>
                    <Badge variant="neutral">{item.student_roll}</Badge>
                    <Badge variant="info">{yearLabel(item.student_year)}</Badge>
                    <Badge className={submissionMeta[item.status].className}>
                      {submissionMeta[item.status].label}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted">
                    Level {item.level_number}: {item.level_title}
                    {item.problem_title ? ` · ${item.problem_title}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    LeetCode: <span className="font-mono">{item.leetcode_username}</span> ·{" "}
                    {formatDate(item.created_at)}
                  </p>
                  {item.student_note ? (
                    <p className="mt-1 rounded-lg border border-border bg-surface-2/40 p-2.5 text-sm text-muted-strong">
                      {item.student_note}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {item.submission_url ? (
                    <a href={item.submission_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="secondary" size="sm">
                        <ExternalLink className="size-4" /> Open
                      </Button>
                    </a>
                  ) : null}
                  {item.screenshotUrl ? (
                    <a href={item.screenshotUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm">
                        <FileImage className="size-4" /> Evidence
                      </Button>
                    </a>
                  ) : item.screenshot_path ? (
                    <Badge variant="neutral">
                      <FileImage className="size-3.5" /> Evidence attached
                    </Badge>
                  ) : null}
                  {item.status === "PENDING_REVIEW" ? (
                    <Button size="sm" onClick={() => setActive(item)}>
                      Review
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(active)}
        onClose={() => {
          setActive(null);
          setReason("");
        }}
        title="Review submission"
        description={active ? `${active.student_name} · Level ${active.level_number}` : undefined}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => decide("REJECTED")}
              loading={busy}
            >
              <X className="size-4" /> Reject
            </Button>
            <Button variant="success" onClick={() => decide("APPROVED")} loading={busy}>
              <Check className="size-4" /> Approve
            </Button>
          </>
        }
      >
        {active ? (
          <div className="space-y-4">
            <div className="space-y-1 text-sm">
              <p className="text-muted">
                Level {active.level_number}: {active.level_title}
              </p>
              {active.submission_url ? (
                <a
                  className="break-all text-brand-soft hover:underline"
                  href={active.submission_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {active.submission_url}
                </a>
              ) : null}
            </div>
            {active.screenshotUrl ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <img src={active.screenshotUrl} alt="Submission evidence" className="w-full object-contain" />
              </div>
            ) : null}
            <Field label="Reviewer note (optional)">
              <Textarea
                placeholder="Reason for approval or rejection"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
