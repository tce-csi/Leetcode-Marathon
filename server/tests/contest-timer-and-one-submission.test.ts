/**
 * Personal contest timer + strict one-submission policy regression suite.
 *
 * Covers the end-to-end contract the frontend depends on:
 *  1. `POST /contest/start` requires auth and is idempotent; the first call
 *     stamps `started_at` with the server clock and later calls never move it.
 *  2. Every challenge route (level, assessments, submissions, progress, finalize,
 *     uploads) is rejected with 403 before the timer is started, while the
 *     roadmap stays reachable so the Start button can render.
 *  3. A SCHEDULED or ENDED contest rejects `POST /contest/start` with 403.
 *  4. Exactly one non-rejected submission per (student, level): changed evidence
 *     is rejected (409), an identical retry idempotently returns the same row,
 *     and a rejected submission frees the slot for a fresh attempt.
 *  5. SQL backstop: a second non-rejected insert violates the partial unique
 *     index and the trigger keeps `is_official` in sync with `status`.
 *  6. The official elapsed duration is anchored to `started_at` (never the
 *     legacy `contest_started_at`) and is frozen at finalize.
 *  7. Finisher ranking/summary and `getProgressSummary` surface `startedAt`;
 *     `resetStudentProgress` clears the timer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "@/lib/db/types";
import type { StudentRow } from "@/lib/types";
import { STUDENT_COOKIE, STUDENT_CSRF_COOKIE } from "@/lib/auth/cookies";
import { createStudentSessionRecord } from "@/lib/auth/session-store";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createContestRecord,
  createLevelRecord,
  createStudentRecord,
  createTrackRecord,
  getStudentRow,
} from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";
import {
  getProgressSummary,
  resetStudentProgress,
  startPersonalContest,
} from "@/lib/services/progression";
import { finalizeContest } from "@/lib/services/finalization";
import { getFinisherStats, listFinishers } from "@/lib/services/finishers";

let test: TestDb;
let db: Db;
let app: Express;
let contestId: string;
let level1: string;
let level2: string;

function cookieHeader(token: string, csrf: string): string[] {
  return [`${STUDENT_COOKIE}=${token}`, `${STUDENT_CSRF_COOKIE}=${csrf}`];
}

function getReq(path: string, token: string, csrf: string) {
  return request(app).get(path).set("Cookie", cookieHeader(token, csrf));
}

function postReq(path: string, token: string, csrf: string) {
  return request(app)
    .post(path)
    .set("Cookie", cookieHeader(token, csrf))
    .set("x-csrf-token", csrf);
}

async function fresh(id: string): Promise<StudentRow> {
  return (await getStudentRow(db, id)) as unknown as StudentRow;
}

async function session(studentId: string) {
  const tokens = await createStudentSessionRecord(db, studentId);
  return { token: tokens.token, csrf: tokens.csrfToken };
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  state.db = db;
  app = createApp();

  contestId = await createContestRecord(db, "timer-contest");
  const trackId = await createTrackRecord(db, contestId, 1);
  level1 = await createLevelRecord(db, trackId, {
    levelNumber: 1,
    title: "Two Sum",
    isStarting: true,
    requireVerifiedSubmission: false,
    problemSlug: "two-sum",
  });

  // A dedicated second-year track isolates the elapsed/finisher assertions from
  // the year-1 students whose submissions auto-complete their single level.
  const track2Id = await createTrackRecord(db, contestId, 2);
  level2 = await createLevelRecord(db, track2Id, {
    levelNumber: 1,
    title: "Two Sum",
    isStarting: true,
    requireVerifiedSubmission: false,
    problemSlug: "two-sum",
  });
});

afterAll(async () => {
  await test.close();
});

describe("POST /contest/start", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).post("/api/student/contest/start").send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("stamps started_at once and is idempotent on retry", async () => {
    const studentId = await createStudentRecord(db, contestId, {
      rollNumber: "TMR-START",
      year: 1,
      fullName: "Timer Starter",
      leetcodeUsername: "lc-tmr-start",
    });
    const { token, csrf } = await session(studentId);

    const first = await postReq("/api/student/contest/start", token, csrf).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.alreadyStarted).toBe(false);
    expect(first.body.data.startedAt).toBeTruthy();
    expect(first.body.data.serverTime).toBeTruthy();
    expect(first.body.data.student.started_at).toBeTruthy();

    const second = await postReq("/api/student/contest/start", token, csrf).send({});
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyStarted).toBe(true);
    expect(second.body.data.startedAt).toBe(first.body.data.startedAt);

    const row = await fresh(studentId);
    expect(new Date(row.started_at!).toISOString()).toBe(first.body.data.startedAt);

    const service = await startPersonalContest(db, row);
    expect(service.alreadyStarted).toBe(true);
    expect(new Date(service.startedAt).toISOString()).toBe(first.body.data.startedAt);
  });
});

describe("challenge routes are gated until the timer starts", () => {
  let token: string;
  let csrf: string;

  beforeAll(async () => {
    const studentId = await createStudentRecord(db, contestId, {
      rollNumber: "TMR-GATED",
      year: 1,
      fullName: "Gated Student",
      leetcodeUsername: "lc-tmr-gated",
    });
    const s = await session(studentId);
    token = s.token;
    csrf = s.csrf;
  });

  it("keeps the roadmap reachable (NOT_STARTED state)", async () => {
    const res = await getReq("/api/student/roadmap", token, csrf);
    expect(res.status).toBe(200);
    expect(res.body.data.student.started_at).toBeNull();
    expect(res.body.data.serverTime).toBeTruthy();
  });

  it("blocks opening a level", async () => {
    const res = await getReq(`/api/student/levels/${level1}`, token, csrf);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("Start your contest timer");
  });

  it("blocks reading progress", async () => {
    const res = await getReq("/api/student/progress", token, csrf);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("blocks listing submissions", async () => {
    const res = await getReq("/api/student/submissions", token, csrf);
    expect(res.status).toBe(403);
  });

  it("blocks reading assessments", async () => {
    const res = await getReq(
      `/api/student/assessments?levelId=${level1}`,
      token,
      csrf,
    );
    expect(res.status).toBe(403);
  });

  it("blocks posting a submission", async () => {
    const res = await postReq("/api/student/submissions", token, csrf).send({});
    expect(res.status).toBe(403);
  });

  it("blocks submitting an assessment", async () => {
    const res = await postReq("/api/student/assessments", token, csrf).send({});
    expect(res.status).toBe(403);
  });

  it("blocks finalizing the contest", async () => {
    const res = await postReq("/api/student/contest/finalize", token, csrf).send({});
    expect(res.status).toBe(403);
  });

  it("blocks screenshot uploads", async () => {
    // Storage is configured lazily from process.env; enabling it here lets the
    // request pass the storage gate so the contest-start gate (which runs before
    // any Supabase call) is the one that fires.
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    try {
      const res = await request(app)
        .post("/api/student/uploads")
        .set("Cookie", cookieHeader(token, csrf))
        .set("x-csrf-token", csrf)
        .field("levelId", level1)
        .attach("file", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), {
          filename: "shot.png",
          contentType: "image/png",
        });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain("Start your contest timer");
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_URL;
    }
  });
});

describe("contest window gating on POST /contest/start", () => {
  it("rejects starting a SCHEDULED contest", async () => {
    const scheduled = await createTestDb();
    const scheduledDb = scheduled.db;
    state.db = scheduledDb;
    const scheduledApp = createApp();

    const { rows } = await scheduledDb.query<{ id: string }>(
      `insert into contests (slug, name, timezone, registration_open, start_at, end_at)
       values ('scheduled-contest', 'Scheduled', 'Asia/Kolkata', true,
               now() + interval '1 day', now() + interval '2 days')
       returning id`,
    );
    const scheduledContestId = rows[0]!.id;
    const studentId = await createStudentRecord(scheduledDb, scheduledContestId, {
      rollNumber: "TMR-SCHED",
      year: 1,
      fullName: "Scheduled Student",
      leetcodeUsername: "lc-tmr-sched",
    });
    const tokens = await createStudentSessionRecord(scheduledDb, studentId);

    const res = await request(scheduledApp)
      .post("/api/student/contest/start")
      .set("Cookie", cookieHeader(tokens.token, tokens.csrfToken))
      .set("x-csrf-token", tokens.csrfToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("has not started yet");

    state.db = db;
    await scheduled.close();
  });

  it("rejects starting an ENDED contest", async () => {
    const ended = await createTestDb();
    const endedDb = ended.db;
    state.db = endedDb;
    const endedApp = createApp();

    const { rows } = await endedDb.query<{ id: string }>(
      `insert into contests (slug, name, timezone, registration_open, start_at, end_at)
       values ('ended-contest', 'Ended', 'Asia/Kolkata', true,
               now() - interval '2 days', now() - interval '1 day')
       returning id`,
    );
    const endedContestId = rows[0]!.id;
    const studentId = await createStudentRecord(endedDb, endedContestId, {
      rollNumber: "TMR-END",
      year: 1,
      fullName: "Ended Student",
      leetcodeUsername: "lc-tmr-end",
    });
    const tokens = await createStudentSessionRecord(endedDb, studentId);

    const res = await request(endedApp)
      .post("/api/student/contest/start")
      .set("Cookie", cookieHeader(tokens.token, tokens.csrfToken))
      .set("x-csrf-token", tokens.csrfToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("has ended");

    state.db = db;
    await ended.close();
  });
});

describe("one submission per level", () => {
  let studentId: string;
  let token: string;
  let csrf: string;

  const payload = {
    levelId: "",
    submissionUrl: "https://leetcode.com/submissions/detail/111/",
    sourceCode: "def solve(): pass",
    programmingLanguage: "python",
  };

  beforeAll(async () => {
    studentId = await createStudentRecord(db, contestId, {
      rollNumber: "TMR-ONE",
      year: 1,
      fullName: "One Submission",
      leetcodeUsername: "lc-tmr-one",
    });
    const s = await session(studentId);
    token = s.token;
    csrf = s.csrf;
    payload.levelId = level1;
    await postReq("/api/student/contest/start", token, csrf).send({}).expect(200);
  });

  function rowsForLevel() {
    return db.query<{ count: number; attempt: number; is_official: boolean }>(
      `select count(*) over ()::int as count,
              attempt_number as attempt,
              is_official
         from coding_submissions
        where student_id = $1 and level_id = $2
        order by attempt_number asc`,
      [studentId, level1],
    );
  }

  it("accepts the first submission and marks it official", async () => {
    const res = await postReq("/api/student/submissions", token, csrf).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data.submission.attempt_number).toBe(1);

    const { rows } = await rowsForLevel();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_official).toBe(true);
  });

  it("rejects changed evidence with 409 while the slot is taken", async () => {
    const res = await postReq("/api/student/submissions", token, csrf).send({
      ...payload,
      submissionUrl: "https://leetcode.com/submissions/detail/222/",
    });
    expect(res.status).toBe(409);

    const { rows } = await rowsForLevel();
    expect(rows).toHaveLength(1);
  });

  it("idempotently returns the same row for an identical retry", async () => {
    const first = await postReq("/api/student/submissions", token, csrf).send(payload);
    expect(first.status).toBe(200);
    const second = await postReq("/api/student/submissions", token, csrf).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.submission.id).toBe(first.body.data.submission.id);

    const { rows } = await rowsForLevel();
    expect(rows).toHaveLength(1);
  });

  it("frees the slot once the submission is rejected", async () => {
    await db.query(
      "update coding_submissions set status = 'REJECTED' where student_id = $1 and level_id = $2",
      [studentId, level1],
    );
    const { rows: afterReject } = await rowsForLevel();
    expect(afterReject[0]!.is_official).toBe(false);

    const res = await postReq("/api/student/submissions", token, csrf).send({
      ...payload,
      submissionUrl: "https://leetcode.com/submissions/detail/333/",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.submission.attempt_number).toBe(2);

    const { rows } = await rowsForLevel();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_official)).toHaveLength(1);
  });

  it("rejects a second non-rejected insert at the SQL level", async () => {
    await expect(
      db.query(
        `insert into coding_submissions (student_id, level_id, status, attempt_number)
         values ($1, $2, 'PENDING_REVIEW', 3)`,
        [studentId, level1],
      ),
    ).rejects.toThrow();

    // Rejected rows never contend for the slot.
    await db.query(
      `insert into coding_submissions (student_id, level_id, status, attempt_number)
       values ($1, $2, 'REJECTED', 4)`,
      [studentId, level1],
    );
    const { rows } = await rowsForLevel();
    expect(rows.filter((r) => r.is_official)).toHaveLength(1);
  });
});

describe("trigger keeps is_official in sync with status", () => {
  it("does not mark a REJECTED insert official", async () => {
    const studentId = await createStudentRecord(db, contestId, {
      rollNumber: "TMR-TRIG",
      year: 1,
      fullName: "Trigger Student",
      leetcodeUsername: "lc-tmr-trig",
    });
    const inserted = await db.query<{ is_official: boolean }>(
      `insert into coding_submissions (student_id, level_id, status, attempt_number)
       values ($1, $2, 'PENDING_REVIEW', 1) returning is_official`,
      [studentId, level1],
    );
    expect(inserted.rows[0]!.is_official).toBe(true);

    const updated = await db.query<{ is_official: boolean }>(
      `update coding_submissions set status = 'REJECTED'
        where student_id = $1 and level_id = $2 returning is_official`,
      [studentId, level1],
    );
    expect(updated.rows[0]!.is_official).toBe(false);
  });
});

describe("official elapsed time anchors to started_at", () => {
  let studentId: string;

  beforeAll(async () => {
    studentId = await createStudentRecord(db, contestId, {
      rollNumber: "TMR-ELAPSED",
      year: 2,
      fullName: "Elapsed Student",
      leetcodeUsername: "lc-tmr-elapsed",
    });
    // Simulate a start 90s ago and a stale legacy contest_started_at 10 minutes
    // ago; the official duration must follow started_at.
    await db.query(
      `update students
          set started_at = now() - interval '90 seconds',
              contest_started_at = now() - interval '600 seconds'
        where id = $1`,
      [studentId],
    );
    await db.query(
      `insert into student_level_progress (student_id, level_id, status, unlocked_at, completed_at)
       values ($1, $2, 'COMPLETED', now(), now())`,
      [studentId, level2],
    );
  });

  it("freezes the elapsed duration from started_at at finalize", async () => {
    const before = await fresh(studentId);
    const result = await finalizeContest(before, { db });

    expect(result.alreadyFinalized).toBe(false);
    expect(result.student.finalized_at).toBeTruthy();
    const elapsed = Number(result.student.elapsed_duration_ms);
    expect(elapsed).toBeGreaterThanOrEqual(88_000);
    expect(elapsed).toBeLessThan(93_000);
  });

  it("exposes startedAt on the progress summary", async () => {
    const summary = await getProgressSummary(db, await fresh(studentId));
    expect(summary.startedAt).toBeTruthy();
    expect(summary.finalizedAt).toBeTruthy();
  });

  it("ranks finishers by the official elapsed duration and surfaces startedAt", async () => {
    const finishers = await listFinishers(contestId, { year: 2, finalizedOnly: true }, db);
    const entry = finishers.find((f) => f.studentId === studentId);
    expect(entry).toBeDefined();
    expect(entry!.startedAt).toBeTruthy();
    expect(entry!.elapsedDurationMs).toBeGreaterThanOrEqual(88_000);
    expect(entry!.elapsedDurationMs).toBeLessThan(93_000);

    const stats = await getFinisherStats(contestId, 2, db);
    expect(stats.fastestElapsedMs).not.toBeNull();
    expect(stats.fastestElapsedMs!).toBeGreaterThanOrEqual(88_000);
    expect(stats.fastestElapsedMs!).toBeLessThan(93_000);
  });
});

describe("resetStudentProgress clears the personal timer", () => {
  it("nulls started_at and contest_started_at", async () => {
    const studentId = await createStudentRecord(db, contestId, {
      rollNumber: "TMR-RESET",
      year: 1,
      fullName: "Reset Student",
      leetcodeUsername: "lc-tmr-reset",
    });
    await db.query(
      `update students
          set started_at = now(),
              contest_started_at = now(),
              finished_at = now(),
              elapsed_duration_ms = 1234
        where id = $1`,
      [studentId],
    );

    await resetStudentProgress(db, await fresh(studentId));
    const row = await fresh(studentId);
    expect(row.started_at).toBeNull();
    expect(row.contest_started_at).toBeNull();
    expect(row.finished_at).toBeNull();
  });
});
