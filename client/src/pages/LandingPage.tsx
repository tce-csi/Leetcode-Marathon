import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Code2,
  ExternalLink,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { CsiBrand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useSession } from "@/components/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { countdown, formatDate, yearLabel } from "@/lib/format";
import { EVENT_NAME, ORGANIZER } from "@/lib/organizer";
import type { ContestStatus } from "@/lib/services/contest";
import type { ContestRow, ContestTrackRow } from "@/lib/types";

interface ContestResponse {
  contest: ContestRow | null;
  tracks: ContestTrackRow[];
  status: ContestStatus | null;
}

const STEPS = [
  { title: "Register", body: "Sign up with your name, roll number and LeetCode profile URL." },
  { title: "Solve", body: "Open each unlocked challenge on LeetCode and solve it." },
  { title: "Verify", body: "Submit your solution link. Once verified, the next level unlocks." },
];

export default function LandingPage() {
  const { student } = useSession();
  const [data, setData] = useState<ContestResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ContestResponse>("/api/contest")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const status = data?.status ?? null;
  const isLive = status?.isLive ?? false;
  const tracks = [...(data?.tracks ?? [])].sort((a, b) => a.year - b.year);
  const hasOpenTrack = tracks.some((track) => track.is_active);
  const registrationAvailable = (status?.canRegister ?? false) && hasOpenTrack;
  const endCountdown = countdown(status?.endsAt);

  const statusText = loading
    ? "Loading contest…"
    : isLive
      ? "Contest live"
      : status?.contest === "ENDED"
        ? "Contest ended"
        : registrationAvailable
          ? "Registration open"
          : "Registration closed";

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="hairline-grid absolute inset-0 opacity-[0.35]" aria-hidden />
          <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-16 text-center sm:px-6 lg:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-muted">
              {ORGANIZER.shortName} presents
            </p>
            <h1 className="mt-5 text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
              {EVENT_NAME.toUpperCase()}
            </h1>
            <p className="mt-3 text-lg font-medium italic text-muted-strong">
              {ORGANIZER.tagline}
            </p>
            <p className="mt-6 max-w-xl text-balance text-sm leading-relaxed text-muted sm:text-base">
              {data?.contest?.description?.trim() ||
                "A level-based competitive coding contest. Solve challenges in order, get your solutions verified, and climb your year's leaderboard."}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {student ? (
                <Link to="/dashboard">
                  <Button size="lg">
                    Enter contest <ArrowRight className="size-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to={registrationAvailable ? "/register" : "/login"}>
                    <Button size="lg">
                      {registrationAvailable ? "Register" : "Sign in"}
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                  {registrationAvailable ? (
                    <Link to="/login">
                      <Button size="lg" variant="secondary">
                        Sign in
                      </Button>
                    </Link>
                  ) : null}
                </>
              )}
              <Link to="/leaderboard">
                <Button size="lg" variant="ghost">
                  <Trophy className="size-4" /> Leaderboard
                </Button>
              </Link>
            </div>

            <div className="mt-6">
              <Badge variant={isLive ? "success" : "neutral"}>
                {isLive ? <CheckCircle2 className="size-3.5" /> : <CalendarClock className="size-3.5" />}
                {statusText}
                {endCountdown ? ` · ends in ${endCountdown}` : ""}
              </Badge>
            </div>
          </div>
        </section>

        {/* Year selection */}
        <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight">Choose your year</h2>
          <p className="mt-1 text-sm text-muted">Each year competes on its own track and leaderboard.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {tracks.length === 0 ? (
              <Card className="p-5 text-sm text-muted">
                {loading ? "Loading tracks…" : "Tracks will appear once configured."}
              </Card>
            ) : (
              tracks.map((track) => (
                <Card
                  key={track.id}
                  className={
                    track.is_active
                      ? "flex items-center justify-between gap-3 border-foreground/30 p-5"
                      : "flex items-center justify-between gap-3 p-5 opacity-60"
                  }
                >
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted">{yearLabel(track.year)}</p>
                    <p className="mt-0.5 font-semibold">{track.name}</p>
                  </div>
                  {track.is_active ? (
                    <Badge variant="success">Available</Badge>
                  ) : (
                    <Badge variant="neutral">Coming soon</Badge>
                  )}
                </Card>
              ))
            )}
          </div>
        </section>

        {/* Contest information */}
        <section className="border-y border-border bg-surface/40">
          <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
            <h2 className="text-lg font-semibold tracking-tight">Contest information</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <InfoTile label="Starts" value={formatDate(status?.startsAt)} />
              <InfoTile label="Ends" value={formatDate(status?.endsAt)} />
              <InfoTile label="Timezone" value={status?.timezone || "—"} />
            </div>

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
              How it works
            </h3>
            <ol className="mt-3 space-y-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-sm text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Rules</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <Rule>Levels unlock in order — clear one to reach the next.</Rule>
              <Rule>Submit your own LeetCode solution; organizers verify every submission.</Rule>
              <Rule>Answer conceptual questions at their point in the contest flow.</Rule>
            </ul>
          </div>
        </section>

        {/* Organizer */}
        <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <CsiBrand />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight">{ORGANIZER.fullName}</h2>
              <p className="text-sm leading-relaxed text-muted">
                {ORGANIZER.shortName} brings students together through technology, coding and
                innovation. {EVENT_NAME} is a coding challenge brought to you by {ORGANIZER.shortName} at{" "}
                {ORGANIZER.college}.
              </p>
              {ORGANIZER.links.length > 0 ? (
                <div className="flex flex-wrap gap-3 pt-1">
                  {ORGANIZER.links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
                    >
                      {link.label} <ExternalLink className="size-3.5" />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* CTA */}
        {!student ? (
          <section className="border-t border-border">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-12 text-center sm:px-6">
              <ShieldCheck className="size-6 text-foreground" />
              <h2 className="text-xl font-bold tracking-tight">Ready to compete?</h2>
              <p className="max-w-md text-sm text-muted">
                {registrationAvailable
                  ? "Register in seconds with your roll number and LeetCode profile URL."
                  : "Registration may be closed. Sign in if you already have an account."}
              </p>
              <Link to={registrationAvailable ? "/register" : "/login"}>
                <Button size="lg">
                  {registrationAvailable ? "Register now" : "Sign in"}
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
            </div>
          </section>
        ) : null}
      </main>

      <SiteFooter showAdminLink />
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
        <Code2 className="size-3.5 text-muted" />
        {value}
      </p>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
      {children}
    </li>
  );
}
