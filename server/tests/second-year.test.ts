import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Db } from "@/lib/db/types";
import { AppError } from "@/lib/errors";
import { computeContestStatus, isYearEnabled, getTrackByYear } from "@/lib/services/contest";
import { registerStudent, authenticateStudent } from "@/lib/services/students";
import { getLevelContext, getStudentLevels } from "@/lib/services/progression";
import { setTrackActive } from "@/lib/services/admin";
import { createSubmission, reviewSubmission } from "@/lib/services/submissions";
import { requireAdminMutation } from "@/lib/auth/route-guard";
import { normalizeRollNumber, parseLeetcodeProfileUrl } from "@/lib/normalize";
import type { ContestRow, StudentRow } from "@/lib/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createAdminRecord,
  createLevelRecord,
  createStudentRecord,
  createTrackRecord,
} from "./helpers/factories";

/**
 * The routes and guards obtain their database through `getDb()`. Mocking it to
 * the in-process PGlite database keeps the year feature flag tests end-to-end
 * without needing a real Postgres server.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

let test: TestDb;
let db: Db;
let contestId: string;
let track1: string;
let track2: string;
let level2_1: string;
let level2_2: string;
let level1_1: string;
let adminId: string;

async function studentEntity(id: string): Promise<StudentRow> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0]!;
}

function makeContest(overrides: Partial<ContestRow>): ContestRow {
  const iso = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000000",
    slug: "s",
    name: "n",
    description: "",
    timezone: "Asia/Kolkata",
    registration_open_at: null,
    registration_close_at: null,
    start_at: null,
    end_at: null,
    grace_period_minutes: 0,
    registration_open: true,
    is_active: true,
    leaderboard_visible: true,
    allow_late_submissions: false,
    allow_admin_override: false,
    require_submission_after_unlock: false,
    verification_mode: "MANUAL",
    ranking_rule: "POINTS_LEVELS_TIME",
    created_at: iso,
    updated_at: iso,
    ...overrides,
  };
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;

  const { rows } = await db.query<{ id: string }>(
    `insert into contests
       (slug, name, timezone, registration_open, is_active, verification_mode, start_at, end_at)
     values ('second-year', 'Second Year Test', 'Asia/Kolkata', true, true, 'MANUAL',
             now() - interval '1 hour', now() + interval '1 hour')
     returning id`,
  );
  contestId = rows[0]!.id;

  track1 = await createTrackRecord(db, contestId, 1);
  track2 = await createTrackRecord(db, contestId, 2);
  // Second Year is open; First Year is "coming soon".
  await db.query("update contest_tracks set is_active = true where id = $1", [track2]);
  await db.query("update contest_tracks set is_active = false where id = $1", [track1]);

  level2_1 = await createLevelRecord(db, track2, {
    levelNumber: 1,
    isStarting: true,
    points: 10,
    problemSlug: "two-sum",
  });
  level2_2 = await createLevelRecord(db, track2, {
    levelNumber: 2,
    points: 20,
    problemSlug: "valid-parentheses",
  });
  level1_1 = await createLevelRecord(db, track1, {
    levelNumber: 1,
    isStarting: true,
    points: 10,
    problemSlug: "binary-search",
  });

  adminId = await createAdminRecord(db);
});

afterAll(async () => {
  await test.close();
});

describe("per-year feature flag", () => {
  it("reports the enabled/disabled state of each year", async () => {
    expect(await isYearEnabled(contestId, 2, db)).toBe(true);
    expect(await isYearEnabled(contestId, 1, db)).toBe(false);
    expect((await getTrackByYear(contestId, 2, db))?.is_active).toBe(true);
  });

  it("registers a Second-Year student while the track is active", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Sy Student",
        rollNumber: "SY100",
        year: 2,
        leetcodeProfileUrl: "https://leetcode.com/u/sy100/",
        password: "secret123",
      },
      { db },
    );
    expect(student.year).toBe(2);

    const levels = await getStudentLevels(await studentEntity(student.id), db);
    expect(levels).toHaveLength(2);
    expect(levels[0]!.status).toBe("UNLOCKED");
    expect(levels[1]!.status).toBe("LOCKED");
  });

  it("rejects First-Year registration while the track is coming soon", async () => {
    await expect(
      registerStudent(
        {
          fullName: "Fy Student",
          rollNumber: "FY100",
          year: 1,
          leetcodeProfileUrl: "https://leetcode.com/u/fy100/",
          password: "secret123",
        },
        { db },
      ),
    ).rejects.toThrowError(/First Year/i);
  });

  it("disables a year so its registration is blocked", async () => {
    await setTrackActive(adminId, 2, false, db);
    expect(await isYearEnabled(contestId, 2, db)).toBe(false);
    await expect(
      registerStudent(
        {
          fullName: "Blocked Sy",
          rollNumber: "SY200",
          year: 2,
          leetcodeProfileUrl: "https://leetcode.com/u/sy200/",
          password: "secret123",
        },
        { db },
      ),
    ).rejects.toThrowError(/not currently open/i);
  });

  it("re-enables a year so registration works again (coming soon → open)", async () => {
    await setTrackActive(adminId, 2, true, db);
    expect(await isYearEnabled(contestId, 2, db)).toBe(true);
    const { student } = await registerStudent(
      {
        fullName: "Reopened Sy",
        rollNumber: "SY201",
        year: 2,
        leetcodeProfileUrl: "https://leetcode.com/u/sy201/",
        password: "secret123",
      },
      { db },
    );
    expect(student.year).toBe(2);
  });

  it("writes an audit entry when a year flag changes", async () => {
    await setTrackActive(adminId, 1, true, db);
    await setTrackActive(adminId, 1, false, db);
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from audit_logs where action = 'track.update'",
    );
    expect(rows[0]!.count).toBeGreaterThanOrEqual(2);
  });
});

describe("LeetCode identity", () => {
  it("extracts and normalises the username from a profile URL", () => {
    const profile = parseLeetcodeProfileUrl("https://www.leetcode.com/u/Alice_99/");
    expect(profile).not.toBeNull();
    expect(profile!.username).toBe("Alice_99");
    expect(profile!.normalizedUsername).toBe("alice_99");
    expect(profile!.profileUrl).toBe("https://leetcode.com/u/Alice_99/");
  });

  it("canonicalises legacy single-segment profile URLs", () => {
    expect(parseLeetcodeProfileUrl("https://leetcode.com/Alice_99")?.profileUrl).toBe(
      "https://leetcode.com/u/Alice_99/",
    );
    expect(parseLeetcodeProfileUrl("https://leetcode.com/problems/two-sum/")).toBeNull();
  });

  it("normalises roll numbers for duplicate detection", () => {
    expect(normalizeRollNumber(" cs/01 ")).toBe("CS/01");
  });

  it("rejects a duplicate LeetCode profile across students", async () => {
    await expect(
      registerStudent(
        {
          fullName: "Clone Sy",
          rollNumber: "SY100B",
          year: 2,
          leetcodeProfileUrl: "https://leetcode.com/u/sy100/",
          password: "secret123",
        },
        { db },
      ),
    ).rejects.toThrowError(/already registered/i);
  });
});

describe("contest timing", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  it("treats a scheduled contest as not yet live", () => {
    const status = computeContestStatus(
      makeContest({
        start_at: "2026-01-01T13:00:00.000Z",
        end_at: "2026-01-01T14:00:00.000Z",
      }),
      now,
    );
    expect(status.contest).toBe("SCHEDULED");
    expect(status.isLive).toBe(false);
    expect(status.canParticipate).toBe(false);
    expect(status.canRegister).toBe(true);
  });

  it("treats an in-window contest as live", () => {
    const status = computeContestStatus(
      makeContest({
        start_at: "2026-01-01T11:00:00.000Z",
        end_at: "2026-01-01T13:00:00.000Z",
      }),
      now,
    );
    expect(status.contest).toBe("LIVE");
    expect(status.isLive).toBe(true);
    expect(status.canParticipate).toBe(true);
  });

  it("marks a contest ended after its end time", () => {
    const status = computeContestStatus(
      makeContest({
        start_at: "2026-01-01T09:00:00.000Z",
        end_at: "2026-01-01T11:00:00.000Z",
      }),
      now,
    );
    expect(status.contest).toBe("ENDED");
    expect(status.isLive).toBe(false);
  });

  it("closes registration when the contest is inactive", () => {
    const status = computeContestStatus(makeContest({ is_active: false }), now);
    expect(status.registration).toBe("CLOSED");
    expect(status.canRegister).toBe(false);
    expect(status.contest).toBe("UNAVAILABLE");
  });
});

describe("year access enforcement", () => {
  it("blocks access to a locked level", async () => {
    const { student } = await authenticateStudent("SY100", "secret123", { db });
    await expect(getLevelContext(await studentEntity(student.id), level2_2, db)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("blocks access to another year's track", async () => {
    const { student } = await authenticateStudent("SY100", "secret123", { db });
    await expect(getLevelContext(await studentEntity(student.id), level1_1, db)).rejects.toThrowError(
      /track/i,
    );
  });

  it("blocks access to a disabled track", async () => {
    const studentId = await createStudentRecord(db, contestId, {
      rollNumber: "FY001",
      year: 1,
      leetcodeUsername: "fy001",
    });
    await expect(
      getLevelContext(await studentEntity(studentId), level1_1, db),
    ).rejects.toThrowError(/not currently active/i);
  });

  it("rejects an admin mutation without a session", async () => {
    const fakeRequest = { headers: {}, cookies: {} } as unknown as Request;
    await expect(requireAdminMutation(fakeRequest)).rejects.toBeInstanceOf(AppError);
  });

  it("persists unlocked/completed progress across sessions", async () => {
    const { student } = await registerStudent(
      {
        fullName: "Persist Sy",
        rollNumber: "SY900",
        year: 2,
        leetcodeProfileUrl: "https://leetcode.com/u/sy900/",
        password: "secret123",
      },
      { db },
    );
    const entity = await studentEntity(student.id);

    const submission = await createSubmission(
      entity,
      {
        levelId: level2_1,
        submissionUrl: "https://leetcode.com/problems/two-sum/submissions/1/",
        sourceCode: "def solution(): pass",
      },
      { db },
    );
    expect(submission.status).toBe("PENDING_REVIEW");
    await reviewSubmission(adminId, submission.id, "APPROVED", "Verified", { db });

    // A fresh sign-in (new session) must observe the persisted progression.
    const { student: again } = await authenticateStudent("SY900", "secret123", { db });
    const levels = await getStudentLevels(await studentEntity(again.id), db);
    expect(levels[0]!.status).toBe("COMPLETED");
    expect(levels[1]!.status).toBe("UNLOCKED");
  });
});
