import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { isWithinWindow, toDate } from "@/lib/time";
import type { ContestRow, ContestTrackRow, Year } from "@/lib/types";

export interface ContestStatus {
  registration: "OPEN" | "SCHEDULED" | "CLOSED";
  contest: "SCHEDULED" | "LIVE" | "ENDED" | "UNAVAILABLE";
  canRegister: boolean;
  canParticipate: boolean;
  isLive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  timezone: string;
}

export function computeContestStatus(contest: ContestRow, now: Date = new Date()): ContestStatus {
  const regOpenAt = toDate(contest.registration_open_at);
  const regCloseAt = toDate(contest.registration_close_at);
  const startAt = toDate(contest.start_at);
  const endAt = toDate(contest.end_at);

  let registration: ContestStatus["registration"];
  if (!contest.registration_open || !contest.is_active) {
    registration = "CLOSED";
  } else if (regOpenAt && now.getTime() < regOpenAt.getTime()) {
    registration = "SCHEDULED";
  } else if (regCloseAt && now.getTime() > regCloseAt.getTime()) {
    registration = "CLOSED";
  } else {
    registration = "OPEN";
  }

  let contestState: ContestStatus["contest"];
  if (!contest.is_active) {
    contestState = "UNAVAILABLE";
  } else if (startAt && now.getTime() < startAt.getTime()) {
    contestState = "SCHEDULED";
  } else if (endAt && now.getTime() > endAt.getTime()) {
    contestState = "ENDED";
  } else {
    contestState = "LIVE";
  }

  return {
    registration,
    contest: contestState,
    canRegister: registration === "OPEN",
    canParticipate: contestState === "LIVE",
    isLive: contestState === "LIVE",
    startsAt: contest.start_at,
    endsAt: contest.end_at,
    registrationOpensAt: contest.registration_open_at,
    registrationClosesAt: contest.registration_close_at,
    timezone: contest.timezone,
  };
}

export async function getActiveContest(db: Db = getDb()): Promise<ContestRow | null> {
  const { rows } = await db.query<ContestRow>(
    `select * from contests where is_active = true order by created_at asc limit 1`,
  );
  return rows[0] ?? null;
}

export async function requireActiveContest(db: Db = getDb()): Promise<ContestRow> {
  const contest = await getActiveContest(db);
  if (!contest) throw errors.notFound("No active contest is configured.");
  return contest;
}

/**
 * Returns the configured contest regardless of its `is_active` flag. Admin
 * tooling must be able to manage (and re-enable) a contest that has been
 * switched off, so it uses this instead of {@link requireActiveContest}.
 */
export async function getCurrentContest(db: Db = getDb()): Promise<ContestRow | null> {
  const { rows } = await db.query<ContestRow>(
    `select * from contests order by created_at asc limit 1`,
  );
  return rows[0] ?? null;
}

export async function requireCurrentContest(db: Db = getDb()): Promise<ContestRow> {
  const contest = await getCurrentContest(db);
  if (!contest) throw errors.notFound("No contest is configured. Run the seed script.");
  return contest;
}

export async function getContestById(id: string, db: Db = getDb()): Promise<ContestRow | null> {
  const { rows } = await db.query<ContestRow>("select * from contests where id = $1", [id]);
  return rows[0] ?? null;
}

export async function getTracks(contestId: string, db: Db = getDb()): Promise<ContestTrackRow[]> {
  const { rows } = await db.query<ContestTrackRow>(
    "select * from contest_tracks where contest_id = $1 order by year asc",
    [contestId],
  );
  return rows;
}

export async function getTrackByYear(
  contestId: string,
  year: Year,
  db: Db = getDb(),
): Promise<ContestTrackRow | null> {
  const { rows } = await db.query<ContestTrackRow>(
    "select * from contest_tracks where contest_id = $1 and year = $2",
    [contestId, year],
  );
  return rows[0] ?? null;
}

/**
 * Server-controlled per-year feature flag. A year is "enabled" when its track
 * exists and is marked active. Organisers use this to open one year (e.g.
 * Second Year) while another (e.g. First Year) stays "coming soon": the public
 * contest payload exposes each track's `is_active`, registration is rejected
 * for disabled years, and level access is blocked for disabled tracks.
 */
export async function isYearEnabled(
  contestId: string,
  year: Year,
  db: Db = getDb(),
): Promise<boolean> {
  const track = await getTrackByYear(contestId, year, db);
  return Boolean(track && track.is_active);
}

export interface ContestBundle {
  contest: ContestRow;
  tracks: ContestTrackRow[];
  status: ContestStatus;
}

export async function getContestBundle(db: Db = getDb()): Promise<ContestBundle | null> {
  const contest = await getActiveContest(db);
  if (!contest) return null;
  const tracks = await getTracks(contest.id, db);
  return { contest, tracks, status: computeContestStatus(contest) };
}

export interface ContestUpdate {
  name?: string;
  description?: string;
  timezone?: string;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  gracePeriodMinutes?: number;
  registrationOpen?: boolean;
  isActive?: boolean;
  leaderboardVisible?: boolean;
  allowLateSubmissions?: boolean;
  allowAdminOverride?: boolean;
  requireSubmissionAfterUnlock?: boolean;
  verificationMode?: "MANUAL" | "AUTOMATIC" | "HYBRID";
  rankingRule?: "POINTS_LEVELS_TIME" | "LEVELS_POINTS_TIME" | "POINTS_TIME";
}

const CONTEST_COLUMN_MAP: Record<keyof ContestUpdate, string> = {
  name: "name",
  description: "description",
  timezone: "timezone",
  registrationOpenAt: "registration_open_at",
  registrationCloseAt: "registration_close_at",
  startAt: "start_at",
  endAt: "end_at",
  gracePeriodMinutes: "grace_period_minutes",
  registrationOpen: "registration_open",
  isActive: "is_active",
  leaderboardVisible: "leaderboard_visible",
  allowLateSubmissions: "allow_late_submissions",
  allowAdminOverride: "allow_admin_override",
  requireSubmissionAfterUnlock: "require_submission_after_unlock",
  verificationMode: "verification_mode",
  rankingRule: "ranking_rule",
};

export async function updateContest(
  contestId: string,
  patch: ContestUpdate,
  db: Db = getDb(),
): Promise<ContestRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  for (const [key, column] of Object.entries(CONTEST_COLUMN_MAP)) {
    const typedKey = key as keyof ContestUpdate;
    if (patch[typedKey] === undefined) continue;
    sets.push(`${column} = $${index++}`);
    values.push(patch[typedKey]);
  }
  if (sets.length === 0) {
    const contest = await getContestById(contestId, db);
    if (!contest) throw errors.notFound("Contest not found.");
    return contest;
  }
  values.push(contestId);
  const { rows } = await db.query<ContestRow>(
    `update contests set ${sets.join(", ")} where id = $${index} returning *`,
    values,
  );
  if (!rows[0]) throw errors.notFound("Contest not found.");
  return rows[0];
}

/** Whether an instant falls inside the contest's active solving window. */
export function isWithinContestWindow(contest: ContestRow, instant: Date): boolean {
  return isWithinWindow(instant, contest.start_at, contest.end_at);
}

/**
 * Whether an instant falls inside the contest window plus the review grace
 * period. Used to decide if a submission can still be submitted for review.
 */
export function isWithinContestWindowWithGrace(contest: ContestRow, instant: Date): boolean {
  if (!contest.end_at) {
    return isWithinWindow(instant, contest.start_at, null);
  }
  const end = new Date(contest.end_at);
  const graced = new Date(end.getTime() + contest.grace_period_minutes * 60_000);
  return isWithinWindow(instant, contest.start_at, graced);
}
