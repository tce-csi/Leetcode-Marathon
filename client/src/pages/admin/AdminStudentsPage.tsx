import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Download, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api-client";
import { formatDate, yearLabel } from "@/lib/format";
import type { AdminLevelRow } from "@/lib/services/admin";
import type { StudentListRow } from "@/lib/services/students";

type ActionKind = "setActive" | "resetProgress" | "adjustPoints" | "grantLevel";

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentListRow[]>([]);
  const [levels, setLevels] = useState<AdminLevelRow[]>([]);
  const [search, setSearch] = useState("");
  const [year, setYear] = useState<"" | "1" | "2">("");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<StudentListRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (year) params.set("year", year);
      const { students: rows } = await api.get<{ students: StudentListRow[] }>(
        `/api/admin/students?${params.toString()}`,
      );
      setStudents(rows);
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to load students.");
    } finally {
      setLoading(false);
    }
  }, [search, year]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    api
      .get<{ levels: AdminLevelRow[] }>("/api/admin/levels")
      .then((data) => setLevels(data.levels))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={`${students.length} participant${students.length === 1 ? "" : "s"} shown`}
        actions={
          <a href="/api/admin/students/export">
            <Button variant="secondary" size="sm">
              <Download className="size-4" /> Export CSV
            </Button>
          </a>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            placeholder="Search by name, roll number or LeetCode handle"
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

      {loading ? (
        <PageLoader label="Loading students" />
      ) : students.length === 0 ? (
        <EmptyState title="No students found" description="Try a different search or year filter." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Year</th>
                <th className="px-4 py-3 font-semibold">Identity</th>
                <th className="px-4 py-3 text-right font-semibold">Points</th>
                <th className="px-4 py-3 text-right font-semibold">Levels</th>
                <th className="px-4 py-3 text-right font-semibold">Pending</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((student) => (
                <tr key={student.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <p className="font-medium">{student.full_name}</p>
                    <p className="font-mono text-xs text-muted">{student.roll_number}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="info">{yearLabel(student.year)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {student.identity_verified_at ? (
                      <Badge variant="success">Verified</Badge>
                    ) : (
                      <Badge variant="neutral">Unverified</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-accent">{student.total_points}</td>
                  <td className="px-4 py-3 text-right">{student.levels_completed}</td>
                  <td className="px-4 py-3 text-right">
                    {student.pending_reviews > 0 ? (
                      <Badge variant="warning">{student.pending_reviews}</Badge>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={student.is_active ? "success" : "danger"}>
                      {student.is_active ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setActive(student)}>
                      <Settings2 className="size-4" /> Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ManageDialog
        student={active}
        levels={levels}
        onClose={() => setActive(null)}
        onDone={() => {
          setActive(null);
          load();
        }}
      />
    </div>
  );
}

function ManageDialog({
  student,
  levels,
  onClose,
  onDone,
}: {
  student: StudentListRow | null;
  levels: AdminLevelRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = useState<ActionKind>("setActive");
  const [activeValue, setActiveValue] = useState(true);
  const [points, setPoints] = useState("0");
  const [reason, setReason] = useState("");
  const [levelId, setLevelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileUrl, setProfileUrl] = useState("");
  const [identityYear, setIdentityYear] = useState<"1" | "2">("1");
  const [identityBusy, setIdentityBusy] = useState(false);

  useEffect(() => {
    if (student) {
      setAction("setActive");
      setActiveValue(student.is_active);
      setPoints("0");
      setReason("");
      setLevelId(levels[0]?.id ?? "");
      setProfileUrl(student.leetcode_profile_url ?? "");
      setIdentityYear(String(student.year) as "1" | "2");
    }
  }, [student, levels]);

  const correctIdentity = async () => {
    if (!student) return;
    setIdentityBusy(true);
    try {
      await api.patch("/api/admin/students/identity", {
        studentId: student.id,
        leetcodeProfileUrl: profileUrl.trim() || undefined,
        year: Number(identityYear),
      });
      toast.success("Identity details updated.");
      onDone();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not update identity.");
    } finally {
      setIdentityBusy(false);
    }
  };

  const verifyIdentity = async () => {
    if (!student) return;
    setIdentityBusy(true);
    try {
      await api.post(`/api/admin/students/${student.id}/verify`, {});
      toast.success("Identity marked as verified.");
      onDone();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not verify identity.");
    } finally {
      setIdentityBusy(false);
    }
  };

  const submit = async () => {
    if (!student) return;
    if (action === "adjustPoints" && !reason.trim()) {
      toast.error("A reason is required for point adjustments.");
      return;
    }
    if (action === "grantLevel" && !levelId) {
      toast.error("Select a level to grant.");
      return;
    }
    setBusy(true);
    try {
      const payload =
        action === "setActive"
          ? { action, studentId: student.id, value: activeValue }
          : action === "resetProgress"
            ? { action, studentId: student.id }
            : action === "adjustPoints"
              ? { action, studentId: student.id, points: Number(points), reason }
              : { action, studentId: student.id, levelId };
      await api.post("/api/admin/students/action", payload);
      toast.success("Action applied.");
      onDone();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not apply the action.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={Boolean(student)}
      onClose={onClose}
      title="Manage student"
      description={student ? `${student.full_name} · ${student.roll_number}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Apply
          </Button>
        </>
      }
    >
      {student ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Metric label="Points" value={student.total_points} />
            <Metric label="Levels" value={student.levels_completed} />
            <Metric label="Joined" value={formatDate(student.created_at)} small />
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {student.leetcode_username || "No LeetCode handle"}
                </p>
                <p className="text-xs text-muted">
                  {student.identity_verified_at
                    ? `Identity verified ${formatDate(student.identity_verified_at)}`
                    : "Identity not yet verified"}
                  {student.integrity_accepted_at ? " · integrity accepted" : ""}
                </p>
              </div>
              {student.identity_verified_at ? (
                <Badge variant="success">
                  <BadgeCheck className="size-3.5" /> Verified
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={identityBusy}
                  onClick={verifyIdentity}
                >
                  <BadgeCheck className="size-4" /> Verify
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Year (admin correction)">
                <Select
                  value={identityYear}
                  onChange={(e) => setIdentityYear(e.target.value as "1" | "2")}
                >
                  <option value="1">First Year</option>
                  <option value="2">Second Year</option>
                </Select>
              </Field>
              <Field label="LeetCode profile URL">
                <Input
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  placeholder="https://leetcode.com/u/username/"
                />
              </Field>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={identityBusy}
              onClick={correctIdentity}
            >
              Save identity details
            </Button>
          </div>

          <RadioGroup
            value={action}
            onChange={(value) => setAction(value)}
            options={[
              { value: "setActive", label: "Enable / disable account" },
              { value: "resetProgress", label: "Reset all progress" },
              { value: "adjustPoints", label: "Adjust points" },
              { value: "grantLevel", label: "Grant a level" },
            ]}
          />

          {action === "setActive" ? (
            <Field label="Account state">
              <Select
                value={activeValue ? "true" : "false"}
                onChange={(e) => setActiveValue(e.target.value === "true")}
              >
                <option value="true">Active</option>
                <option value="false">Disabled</option>
              </Select>
            </Field>
          ) : null}

          {action === "resetProgress" ? (
            <p className="rounded-lg border border-foreground bg-transparent p-3 text-sm text-foreground">
              This permanently deletes all attempts, submissions and points for this student.
            </p>
          ) : null}

          {action === "adjustPoints" ? (
            <>
              <Field label="Points (negative to deduct)">
                <Input
                  type="number"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </Field>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. bonus for first solve" />
              </Field>
            </>
          ) : null}

          {action === "grantLevel" ? (
            <Field label="Level">
              <Select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.year === 1 ? "1st" : "2nd"} · L{level.level_number} — {level.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function Metric({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-2.5">
      <p className={small ? "text-xs font-semibold" : "text-lg font-bold"}>{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
