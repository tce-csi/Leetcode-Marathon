import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/controls";
import { PageLoader } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api-client";
import type { ContestRow, ContestTrackRow, Year } from "@/lib/types";

interface ContestResponse {
  contest: ContestRow;
  tracks: ContestTrackRow[];
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function AdminSettingsPage() {
  const [data, setData] = useState<ContestResponse | null>(null);
  const [form, setForm] = useState<ContestRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<ContestResponse>("/api/admin/contest")
      .then((result) => {
        setData(result);
        setForm(result.contest);
      })
      .catch(() => toast.error("Unable to load contest settings."));
  }, []);

  if (!data || !form) return <PageLoader label="Loading settings" />;

  const set = <K extends keyof ContestRow>(key: K, value: ContestRow[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/admin/contest", {
        name: form.name,
        description: form.description,
        timezone: form.timezone,
        registrationOpenAt: form.registration_open_at,
        registrationCloseAt: form.registration_close_at,
        startAt: form.start_at,
        endAt: form.end_at,
        gracePeriodMinutes: form.grace_period_minutes,
        registrationOpen: form.registration_open,
        isActive: form.is_active,
        leaderboardVisible: form.leaderboard_visible,
        allowLateSubmissions: form.allow_late_submissions,
        allowAdminOverride: form.allow_admin_override,
        requireSubmissionAfterUnlock: form.require_submission_after_unlock,
        verificationMode: form.verification_mode,
        rankingRule: form.ranking_rule,
      });
      toast.success("Settings saved.");
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleTrack = async (year: Year, isActive: boolean) => {
    try {
      const result = await api.patch<{ track: ContestTrackRow }>(`/api/admin/tracks/${year}`, {
        isActive,
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              tracks: prev.tracks.map((track) =>
                track.id === result.track.id ? result.track : track,
              ),
            }
          : prev,
      );
      toast.success(
        `${year === 1 ? "First" : "Second"} Year ${isActive ? "enabled" : "disabled (coming soon)"}.`,
      );
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not update the year.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contest settings"
        description="Control the window, registration and verification behaviour."
        actions={
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Contest name">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" hint="IANA timezone, e.g. Asia/Kolkata.">
              <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            <Field label="Grace period (minutes)">
              <Input
                type="number"
                min={0}
                value={form.grace_period_minutes}
                onChange={(e) => set("grace_period_minutes", Number(e.target.value))}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration opens">
            <Input
              type="datetime-local"
              value={toLocalInput(form.registration_open_at)}
              onChange={(e) => set("registration_open_at", fromLocalInput(e.target.value))}
            />
          </Field>
          <Field label="Registration closes">
            <Input
              type="datetime-local"
              value={toLocalInput(form.registration_close_at)}
              onChange={(e) => set("registration_close_at", fromLocalInput(e.target.value))}
            />
          </Field>
          <Field label="Contest starts">
            <Input
              type="datetime-local"
              value={toLocalInput(form.start_at)}
              onChange={(e) => set("start_at", fromLocalInput(e.target.value))}
            />
          </Field>
          <Field label="Contest ends">
            <Input
              type="datetime-local"
              value={toLocalInput(form.end_at)}
              onChange={(e) => set("end_at", fromLocalInput(e.target.value))}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Behaviour</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Verification mode">
              <Select
                value={form.verification_mode}
                onChange={(e) => set("verification_mode", e.target.value as ContestRow["verification_mode"])}
              >
                <option value="MANUAL">Manual (review every submission)</option>
                <option value="AUTOMATIC">Automatic (best-effort)</option>
                <option value="HYBRID">Hybrid</option>
              </Select>
            </Field>
            <Field label="Ranking rule">
              <Select
                value={form.ranking_rule}
                onChange={(e) => set("ranking_rule", e.target.value as ContestRow["ranking_rule"])}
              >
                <option value="POINTS_LEVELS_TIME">Points, then levels, then time</option>
                <option value="LEVELS_POINTS_TIME">Levels, then points, then time</option>
                <option value="POINTS_TIME">Points, then time</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-4">
            <Switch
              checked={form.registration_open}
              onChange={(v) => set("registration_open", v)}
              label="Registration open"
              description="Allow new students to register."
            />
            <Switch
              checked={form.is_active}
              onChange={(v) => set("is_active", v)}
              label="Contest active"
              description="Must be on for the contest to be used at all."
            />
            <Switch
              checked={form.leaderboard_visible}
              onChange={(v) => set("leaderboard_visible", v)}
              label="Leaderboard visible"
              description="Show rankings to students."
            />
            <Switch
              checked={form.allow_late_submissions}
              onChange={(v) => set("allow_late_submissions", v)}
              label="Allow late submissions"
              description="Accept submissions after the window closes."
            />
            <Switch
              checked={form.allow_admin_override}
              onChange={(v) => set("allow_admin_override", v)}
              label="Allow admin overrides"
            />
            <Switch
              checked={form.require_submission_after_unlock}
              onChange={(v) => set("require_submission_after_unlock", v)}
              label="Submission must be after unlock"
              description="Only count solutions submitted after the level was unlocked."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Years</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-4">
          <p className="text-xs text-muted">
            Enable or disable a year's track. Disabled years are shown as "coming soon" and cannot
            register or access levels.
          </p>
          {data.tracks.length === 0 ? (
            <p className="text-sm text-muted">No tracks configured yet.</p>
          ) : (
            data.tracks.map((track) => (
              <Switch
                key={track.id}
                checked={track.is_active}
                onChange={(value) => toggleTrack(track.year, value)}
                label={track.name}
                description={
                  track.is_active ? "Open for registration" : "Coming soon — registration blocked"
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
