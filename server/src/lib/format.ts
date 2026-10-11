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

export const difficultyMeta: Record<Difficulty, { label: string; className: string }> = {
  EASY: { label: "Easy", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  MEDIUM: { label: "Medium", className: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  HARD: { label: "Hard", className: "border-rose-400/40 bg-rose-400/10 text-rose-300" },
};

export const progressMeta: Record<ProgressStatus, { label: string; className: string }> = {
  LOCKED: { label: "Locked", className: "border-slate-500/40 bg-slate-500/10 text-slate-300" },
  UNLOCKED: { label: "Unlocked", className: "border-sky-400/40 bg-sky-400/10 text-sky-300" },
  IN_PROGRESS: { label: "In progress", className: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  COMPLETED: { label: "Completed", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
};

export const submissionMeta: Record<SubmissionStatus, { label: string; className: string }> = {
  PENDING_REVIEW: { label: "Pending review", className: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  VERIFIED: { label: "Verified", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  REJECTED: { label: "Rejected", className: "border-rose-400/40 bg-rose-400/10 text-rose-300" },
};

export function yearLabel(year: Year): string {
  return year === 1 ? "1st Year" : "2nd Year";
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}
