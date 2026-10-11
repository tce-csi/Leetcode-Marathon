import type {
  Difficulty,
  ProgressStatus,
  SubmissionStatus,
  Year,
} from "@/lib/types";

export function formatDate(value: string | null | undefined, timezone?: string): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || undefined,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const seconds = Math.round(diff / 1000);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(-seconds, "second");
  for (let i = 0; i < units.length; i += 1) {
    const [limit] = units[i]!;
    const next = units[i + 1]?.[0] ?? limit * 12;
    if (Math.abs(seconds) < next) {
      return formatter.format(-Math.round(seconds / limit), units[i]![1]);
    }
  }
  return formatDateShort(value);
}

export function countdown(target: string | null | undefined): string | null {
  if (!target) return null;
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return null;
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/* Monochrome status treatments — meaning is carried by the label + icon, not colour.
   The same classes work in both themes via the semantic tokens. */
const TONE_MUTED = "border-border bg-surface-2 text-muted";
const TONE_SUBTLE = "border-border bg-surface-2 text-muted-strong";
const TONE_MEDIUM = "border-border-strong bg-surface-3 text-foreground";
const TONE_STRONG = "border-foreground bg-foreground text-background";
const TONE_OUTLINE = "border-foreground bg-transparent text-foreground";

export const difficultyMeta: Record<Difficulty, { label: string; className: string }> = {
  EASY: { label: "Easy", className: TONE_SUBTLE },
  MEDIUM: { label: "Medium", className: TONE_MEDIUM },
  HARD: { label: "Hard", className: TONE_STRONG },
};

export const progressMeta: Record<ProgressStatus, { label: string; className: string }> = {
  LOCKED: { label: "Locked", className: TONE_MUTED },
  UNLOCKED: { label: "Available", className: TONE_SUBTLE },
  IN_PROGRESS: { label: "In progress", className: TONE_MEDIUM },
  COMPLETED: { label: "Completed", className: TONE_STRONG },
};

export const submissionMeta: Record<SubmissionStatus, { label: string; className: string }> = {
  PENDING_REVIEW: { label: "Pending verification", className: TONE_MEDIUM },
  VERIFIED: { label: "Verified", className: TONE_STRONG },
  REJECTED: { label: "Rejected", className: TONE_OUTLINE },
};

export function yearLabel(year: Year): string {
  return year === 1 ? "1st Year" : "2nd Year";
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}
