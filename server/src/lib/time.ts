/**
 * Timezone-aware helpers.
 *
 * All instants are stored and compared in UTC (Postgres `timestamptz`). Zone
 * information only matters for (a) display and (b) deciding which local
 * calendar day an instant falls on. The default contest timezone is
 * Asia/Kolkata.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getZonedParts(date: Date, timeZone = DEFAULT_TIMEZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? "0" : map.hour;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Returns a stable YYYY-MM-DD key for the local calendar day of `date`. */
export function zonedDateKey(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

export function isSameZonedDay(a: Date, b: Date, timeZone = DEFAULT_TIMEZONE): boolean {
  return zonedDateKey(a, timeZone) === zonedDateKey(b, timeZone);
}

export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    dateStyle: "medium",
  }).format(date);
}

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether `now` is within the inclusive [start, end] window. Null bounds are open. */
export function isWithinWindow(
  now: Date,
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): boolean {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (startDate && now.getTime() < startDate.getTime()) return false;
  if (endDate && now.getTime() > endDate.getTime()) return false;
  return true;
}
