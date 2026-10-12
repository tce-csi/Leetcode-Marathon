import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Db } from "@/lib/db/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { createContestRecord, createTrackRecord, createLevelRecord } from "./helpers/factories";
import type { Express } from "express";

/**
 * Latency regression guards.
 *
 * Every database query is a network round trip to Supabase from the Netlify
 * function, so the number of queries per HTTP operation dominates wall-clock
 * latency. These tests pin the per-operation query budgets and fail if future
 * changes reintroduce chatty query loops.
 *
 * Measured originally (in-process PGlite, same harness):
 *   POST /api/student/submissions = 34 queries
 *   GET  /api/student/roadmap      = 17 queries
 *   GET  /api/student/levels/:id   = 12 queries
 *
 * Measured after the first optimisation pass: 17 / 14 / 10.
 * Measured after the query-merge pass:        9 /  6 /  6.
 *
 * Budgets keep a small headroom above the measured counts so incidental
 * extra state combinations do not flake, while still failing loudly if a
 * chatty query loop is reintroduced.
 */

function countingDb(base: Db) {
  const counters: { queries: number } = { queries: 0 };
  const makeWrapped = (q: Db): Db => ({
    async query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      counters.queries += 1;
      return q.query<T>(text, params);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return q.transaction((tx) => fn(makeWrapped(tx)));
    },
  });
  return { tracked: makeWrapped(base), count: () => counters.queries };
}

const state = vi.hoisted(() => ({ db: null as unknown as Db, counter: null as null | { count(): number } }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";

const SUBMISSION_QUERY_BUDGET = 12;
const ROADMAP_QUERY_BUDGET = 9;
const LEVEL_OPEN_QUERY_BUDGET = 9;

let test: TestDb;
let db: Db;
let app: Express;
let level1: string;
let level2: string;
let auth: ReturnType<typeof extractCookies>;

function extractCookies(res: request.Response) {
  const setCookie = res.headers["set-cookie"];
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookies = list.map((c) => c.split(";")[0]);
  const csrf = list.find((c) => c.includes("csrf="))?.split(";")[0].split("=")[1];
  return { cookies, csrf: csrf ?? "" };
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  const counting = countingDb(db);
  state.db = counting.tracked;
  state.counter = counting;
  app = createApp();

  const contestId = await createContestRecord(db, "latency-contest");
  const track = await createTrackRecord(db, contestId, 1);
  level1 = await createLevelRecord(db, track, {
    levelNumber: 1,
    title: "Two Sum",
    points: 10,
    isStarting: true,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });
  level2 = await createLevelRecord(db, track, {
    levelNumber: 2,
    title: "Reverse",
    points: 20,
    isStarting: false,
    requireVerifiedSubmission: true,
  });
  await createLevelRecord(db, track, { levelNumber: 3, title: "L3", isStarting: false, requireVerifiedSubmission: true });
  await createLevelRecord(db, track, { levelNumber: 4, title: "L4", isStarting: false, requireVerifiedSubmission: true });

  const regRes = await request(app).post("/api/auth/register").send({
    fullName: "Latency Student",
    rollNumber: "22LATC01",
    year: 1,
    leetcodeProfileUrl: "https://leetcode.com/u/latency_student/",
    password: "password123",
  });
  auth = extractCookies(regRes);

  // Start the personal contest timer (gates challenge access). Runs before the
  // query budgets are measured, so it does not affect the per-request counts.
  await request(app)
    .post("/api/student/contest/start")
    .set("Cookie", auth.cookies)
    .set("x-csrf-token", auth.csrf)
    .expect(200);
});

afterAll(async () => {
  await test.close();
});

describe("per-request database query budgets", () => {
  it("opens a level within the query budget", async () => {
    const n = state.counter!.count();
    const res = await request(app).get(`/api/student/levels/${level1}`).set("Cookie", auth.cookies).expect(200);
    const queries = state.counter!.count() - n;
    expect(queries).toBeLessThanOrEqual(LEVEL_OPEN_QUERY_BUDGET);
    expect(res.body.data.totalLevels).toBe(4);
    expect(res.body.data.level.status).toBe("UNLOCKED");
  });

  it("loads the roadmap within the query budget", async () => {
    const n = state.counter!.count();
    const res = await request(app).get("/api/student/roadmap").set("Cookie", auth.cookies).expect(200);
    const queries = state.counter!.count() - n;
    expect(queries).toBeLessThanOrEqual(ROADMAP_QUERY_BUDGET);
    expect(res.body.data.levels).toHaveLength(4);
    expect(res.body.data.levels[0].status).toBe("UNLOCKED");
  });

  it("submits within the query budget and returns the single authoritative response", async () => {
    const n = state.counter!.count();
    const res = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", auth.cookies)
      .set("x-csrf-token", auth.csrf)
      .send({
        levelId: level1,
        submissionUrl: "https://leetcode.com/submissions/detail/123456/",
        sourceCode: "def two_sum(): pass",
        programmingLanguage: "python",
      })
      .expect(200);
    const queries = state.counter!.count() - n;
    expect(queries).toBeLessThanOrEqual(SUBMISSION_QUERY_BUDGET);

    expect(res.body.data.submission.status).toBe("PENDING_REVIEW");
    expect(res.body.data.completed).toBe(true);
    expect(res.body.data.nextLevel.levelNumber).toBe(2);
    expect(res.body.data.nextLevel).toHaveProperty("problem");
    expect(res.body.data.totalLevels).toBe(4);
    // The slimmer response must not drag the full roadmap/summary along.
    expect(res.body.data.levels).toBeUndefined();
    expect(res.body.data.summary).toBeUndefined();
  });

  it("emits per-request instrumentation headers", async () => {
    const res = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", auth.cookies)
      .set("x-csrf-token", auth.csrf)
      .send({
        levelId: level2,
        submissionUrl: "https://leetcode.com/submissions/detail/654321/",
        sourceCode: "def reverse(): pass",
        programmingLanguage: "python",
      })
      .expect(200);
    expect(res.headers["server-timing"]).toMatch(/^total;dur=\d+/);
    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect(res.body.data.completed).toBe(true);
    expect(res.body.data.nextLevel.levelNumber).toBe(3);
  });
});