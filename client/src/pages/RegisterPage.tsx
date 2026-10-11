import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Field, Input } from "@/components/ui/field";
import { api, isApiError } from "@/lib/api-client";
import { EVENT_NAME } from "@/lib/organizer";
import type { ContestTrackRow, PublicStudent, Year } from "@/lib/types";

interface ContestResponse {
  tracks: ContestTrackRow[];
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [enabledYears, setEnabledYears] = useState<Set<Year>>(new Set<Year>([1, 2]));
  const [form, setForm] = useState({
    fullName: "",
    rollNumber: "",
    year: "1" as "1" | "2",
    leetcodeProfileUrl: "",
    password: "",
  });
  const [acceptIntegrity, setAcceptIntegrity] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<ContestResponse>("/api/contest")
      .then((result) => {
        const enabled = new Set<Year>(
          result.tracks.filter((track) => track.is_active).map((track) => track.year),
        );
        setEnabledYears(enabled);
        setForm((prev) => {
          const current = Number(prev.year) as Year;
          if (enabled.has(current)) return prev;
          const fallback = ([1, 2] as Year[]).find((year) => enabled.has(year));
          return fallback ? { ...prev, year: String(fallback) as "1" | "2" } : prev;
        });
      })
      .catch(() => {
        // Keep the optimistic default; the server still enforces the flag.
      });
  }, []);

  const update = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const noYearOpen = enabledYears.size === 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    if (!acceptIntegrity) {
      toast.error("Please confirm the contest integrity notice to continue.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post<{ student: PublicStudent }>("/api/auth/register", {
        fullName: form.fullName,
        rollNumber: form.rollNumber,
        year: Number(form.year) as Year,
        leetcodeProfileUrl: form.leetcodeProfileUrl,
        password: form.password,
        acceptIntegrity: true,
      });
      await refresh();
      toast.success("You're registered. Your contest begins now.");
      navigate("/dashboard");
    } catch (error) {
      if (isApiError(error)) {
        toast.error(error.message);
        if (Array.isArray(error.details)) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of error.details as { path: (string | number)[]; message: string }[]) {
            const key = String(issue.path[0] ?? "form");
            fieldErrors[key] = issue.message;
          }
          setErrors(fieldErrors);
        }
      } else {
        toast.error("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Register for the marathon"
      description={`Create your ${EVENT_NAME} account, link your LeetCode profile, and start climbing your year's leaderboard.`}
      footer={
        <>
          Already registered?{" "}
          <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name" htmlFor="fullName" error={errors.fullName}>
          <Input
            id="fullName"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={form.fullName}
            onChange={(e) => update("fullName")(e.target.value)}
            required
          />
        </Field>

        <Field label="Roll number" htmlFor="rollNumber" error={errors.rollNumber}>
          <Input
            id="rollNumber"
            autoComplete="off"
            placeholder="21CS1042"
            value={form.rollNumber}
            onChange={(e) => update("rollNumber")(e.target.value)}
            required
          />
        </Field>

        <Field
          label="LeetCode profile URL"
          htmlFor="leetcodeProfileUrl"
          error={errors.leetcodeProfileUrl}
          hint="Open your LeetCode profile and copy the address, e.g. https://leetcode.com/u/your-username/"
        >
          <Input
            id="leetcodeProfileUrl"
            type="url"
            autoComplete="off"
            placeholder="https://leetcode.com/u/your-username/"
            value={form.leetcodeProfileUrl}
            onChange={(e) => update("leetcodeProfileUrl")(e.target.value)}
            required
          />
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-strong">
            Year of study
          </p>
          <div
            role="radiogroup"
            aria-label="Year of study"
            className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1"
          >
            {(
              [
                { value: "1" as const, label: "First Year" },
                { value: "2" as const, label: "Second Year" },
              ]
            ).map((option) => {
              const year = Number(option.value) as Year;
              const enabled = enabledYears.has(year);
              const selected = form.year === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!enabled}
                  onClick={() => setForm((prev) => ({ ...prev, year: option.value }))}
                  className={[
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    selected
                      ? "bg-foreground text-background"
                      : "text-muted hover:text-foreground",
                    !enabled ? "cursor-not-allowed opacity-50" : "",
                  ].join(" ")}
                >
                  {option.label}
                  {!enabled ? <span className="block text-[0.7rem] font-normal">Unavailable</span> : null}
                </button>
              );
            })}
          </div>
          {noYearOpen ? null : !enabledYears.has(1) || !enabledYears.has(2) ? (
            <p className="mt-2 text-xs text-muted">
              One year track is currently closed. You can only register for an open track.
            </p>
          ) : null}
        </div>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint="At least 6 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => update("password")(e.target.value)}
            required
          />
        </Field>

        {noYearOpen ? (
          <p className="rounded-lg border border-border-strong bg-surface-2 px-3.5 py-2.5 text-sm text-foreground">
            Registration is not open for any year right now. Please check back later.
          </p>
        ) : null}

        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/50 p-3.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" />
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-muted">
              You will solve problems on your own linked LeetCode account, submit your own
              submission links, and answer the conceptual questions yourself. Sharing submission
              links, using another person's profile, or misrepresenting your work may result in
              review and removal from the leaderboard.
            </p>
            <Checkbox
              label="I understand and agree to the contest integrity notice."
              checked={acceptIntegrity}
              onChange={setAcceptIntegrity}
            />
          </div>
        </div>

        <Button
          type="submit"
          block
          loading={submitting}
          size="lg"
          disabled={noYearOpen || !acceptIntegrity}
        >
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
