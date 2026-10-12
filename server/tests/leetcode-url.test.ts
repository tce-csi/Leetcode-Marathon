import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "@/lib/db/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { createContestRecord, createLevelRecord, createTrackRecord } from "./helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";
import {
  LEETCODE_SUBMISSION_URL_MESSAGE,
  isLeetcodeSubmissionDetailUrl,
  parseLeetcodeSubmissionDetailUrl,
} from "@/lib/normalize";

describe("parseLeetcodeSubmissionDetailUrl", () => {
  it("accepts the canonical detail URL", () => {
    const parsed = parseLeetcodeSubmissionDetailUrl("https://leetcode.com/submissions/detail/2165837360/");
    expect(parsed).toEqual({ id: "2165837360", url: "https://leetcode.com/submissions/detail/2165837360/" });
  });

  it("accepts a missing trailing slash and normalises it", () => {
    const parsed = parseLeetcodeSubmissionDetailUrl("https://leetcode.com/submissions/detail/1234567");
    expect(parsed?.url).toBe("https://leetcode.com/submissions/detail/1234567/");
  });

  it("accepts www and normalises it away", () => {
    const parsed = parseLeetcodeSubmissionDetailUrl("https://www.leetcode.com/submissions/detail/42/");
    expect(parsed?.url).toBe("https://leetcode.com/submissions/detail/42/");
  });

  it("accepts surrounding whitespace and trims it", () => {
    expect(parseLeetcodeSubmissionDetailUrl("  https://leetcode.com/submissions/detail/7/  ")).not.toBeNull();
  });

  it("rejects empty, missing and non-URL values", () => {
    expect(parseLeetcodeSubmissionDetailUrl("")).toBeNull();
    expect(parseLeetcodeSubmissionDetailUrl("   ")).toBeNull();
    expect(parseLeetcodeSubmissionDetailUrl(undefined)).toBeNull();
    expect(parseLeetcodeSubmissionDetailUrl(null)).toBeNull();
    expect(parseLeetcodeSubmissionDetailUrl("not a url")).toBeNull();
  });

  it.each([
    "https://leetcode.com/problems/two-sum/submissions/123/",
    "https://leetcode.com/u/octocat/",
    "https://leetcode.com/submissions/",
    "https://leetcode.com/submissions/detail/abc/",
    "https://leetcode.com/submissions/detail/123abc/",
    "https://leetcode.com/submissions/detail/123.0/",
    "https://leetcode.com/submissions/Detail/123/",
    "https://leetcode.com/submissions/detail/123/extra",
    "https://leetcode.com/submissions/detail//123/",
    "https://leetcode.com/submissions/detail/123//",
    "https://leetcode.com/submissions/detail/123/?foo=bar",
    "https://leetcode.com/submissions/detail/123/#top",
    "https://leetcode.com/submissions/detail/123#top",
    "http://leetcode.com/submissions/detail/123/",
    "ftp://leetcode.com/submissions/detail/123/",
    "https://mock-leetcode.com/submissions/detail/123/",
    "https://evil-leetcode.com/submissions/detail/123/",
    "https://leetcode.com.evil.com/submissions/detail/123/",
    "https://submissions.detail.leetcode.com/123/",
    "https://leetcode.com:8443/submissions/detail/123/",
    "https://user:pass@leetcode.com/submissions/detail/123/",
    "https://leetcode.com/submissions/detail/%31%32%33/",
    "https://leetcode.com/submissions/detail/123_/",
  ])("rejects %s", (candidate) => {
    expect(parseLeetcodeSubmissionDetailUrl(candidate)).toBeNull();
    expect(isLeetcodeSubmissionDetailUrl(candidate)).toBe(false);
  });

  it("exposes a clear shared validation message", () => {
    expect(LEETCODE_SUBMISSION_URL_MESSAGE).toContain("https://leetcode.com/submissions/detail/");
  });
});

describe("submission URL validation and API contract", () => {
  let test: TestDb;
  let db: Db;
  let app: Express;
  let contestId: string;
  let trackId: string;
  let level1: string;
  let level2: string;
  let studentCookie: string[];
  let studentCsrf: string;
  let studentId: string;
  let retryStudentId: string;
  let retryStudentCookie: string[];
  let retryStudentCsrf: string;

  function extractCookies(res: request.Response) {
    const setCookie = res.headers["set-cookie"];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookies = list.map((c) => c.split(";")[0]);
    const csrf = list
      .find((c) => c.includes("csrf="))
      ?.split(";")[0]
      .split("=")[1];
    return { cookies, csrf: csrf ?? "" };
  }

  beforeAll(async () => {
    test = await createTestDb();
    db = test.db;
    state.db = db;
    app = createApp();

    contestId = await createContestRecord(db, "leetcode-url-contest");
    trackId = await createTrackRecord(db, contestId, 1);
    level1 = await createLevelRecord(db, trackId, {
      levelNumber: 1,
      title: "Two Sum",
      points: 100,
      isStarting: true,
      requireVerifiedSubmission: true,
      requireAssessmentPass: false,
      assessmentMode: "NONE",
    });
    level2 = await createLevelRecord(db, trackId, {
      levelNumber: 2,
      title: "Reverse Integer",
      points: 100,
      isStarting: false,
      requireVerifiedSubmission: true,
      requireAssessmentPass: false,
      assessmentMode: "NONE",
    });

    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        fullName: "Url Tester",
        rollNumber: "URL001",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/url_tester/",
        password: "secret123",
      })
      .expect(200);

    studentId = regRes.body.data.student.id;
    const auth = extractCookies(regRes);
    studentCookie = auth.cookies;
    studentCsrf = auth.csrf;

    // Start the personal contest timer (gates challenge access).
    await request(app)
      .post("/api/student/contest/start")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .expect(200);

    // A second student exercises the normalisation-equivalent idempotent retry
    // on a completely fresh level, so the old "changed evidence" behaviour
    // cannot leak into the assertion.
    const retryRes = await request(app)
      .post("/api/auth/register")
      .send({
        fullName: "Url Retry Tester",
        rollNumber: "URL002",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/url_retry_tester/",
        password: "secret123",
      })
      .expect(200);
    retryStudentId = retryRes.body.data.student.id;
    const retryAuth = extractCookies(retryRes);
    retryStudentCookie = retryAuth.cookies;
    retryStudentCsrf = retryAuth.csrf;

    await request(app)
      .post("/api/student/contest/start")
      .set("Cookie", retryStudentCookie)
      .set("x-csrf-token", retryStudentCsrf)
      .expect(200);
  });

  afterAll(async () => {
    await test.close();
  });

  it("accepts a valid detail URL and stores the canonical form", async () => {
    const res = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .send({
        levelId: level1,
        submissionUrl: "https://www.leetcode.com/submissions/detail/123456",
        sourceCode: "def two_sum(): pass",
        programmingLanguage: "python",
      })
      .expect(200);

    expect(res.body.data.submission.status).toBe("PENDING_REVIEW");
    expect(res.body.data.submission.submission_url).toBe(
      "https://leetcode.com/submissions/detail/123456/",
    );
    // Level 1 completes and Level 2 unlocks with a valid submission.
    const roadmap = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);
    expect(roadmap.body.data.levels[0].status).toBe("COMPLETED");
    expect(roadmap.body.data.levels[1].status).toBe("UNLOCKED");
  });

  it("treats a normalised-equivalent URL as an idempotent retry, not a new attempt", async () => {
    const first = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", retryStudentCookie)
      .set("x-csrf-token", retryStudentCsrf)
      .send({
        levelId: level1,
        submissionUrl: "https://leetcode.com/submissions/detail/999999",
        sourceCode: "def same(): pass",
        programmingLanguage: "python",
      })
      .expect(200);

    const second = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", retryStudentCookie)
      .set("x-csrf-token", retryStudentCsrf)
      .send({
        levelId: level1,
        submissionUrl: "https://leetcode.com/submissions/detail/999999/",
        sourceCode: "def same(): pass",
        programmingLanguage: "python",
      })
      .expect(200);

    expect(first.body.data.submission.id).toBe(second.body.data.submission.id);
    const { rows } = await db.query<{ attempt_number: number }>(
      "select attempt_number from coding_submissions where student_id = $1 and level_id = $2",
      [retryStudentId, level1],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempt_number).toBe(1);
  });

  it.each([
    "https://leetcode.com/problems/two-sum/",
    "https://leetcode.com/u/url_tester/",
    "http://leetcode.com/submissions/detail/777/",
    "https://fake-leetcode.com/submissions/detail/777/",
    "https://leetcode.com/submissions/detail/abc/",
    "https://leetcode.com/submissions/detail/777?tab=rejected",
    "git@github.com:user/repo.git",
  ])("rejects %s with HTTP 400 and a clear message", async (badUrl) => {
    const res = await request(app)
      .post("/api/student/submissions")
      .set("Cookie", studentCookie)
      .set("x-csrf-token", studentCsrf)
      .send({
        levelId: level2,
        submissionUrl: badUrl,
        sourceCode: "def wrong(): pass",
        programmingLanguage: "python",
      })
      .expect(400);

    expect(res.body.error.message).toBe(LEETCODE_SUBMISSION_URL_MESSAGE);
  });

  it("never mutates progression or records attempts for rejected URLs", async () => {
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from coding_submissions where student_id = $1 and level_id = $2",
      [studentId, level2],
    );
    expect(rows[0]!.count).toBe(0);

    const roadmap = await request(app)
      .get("/api/student/roadmap")
      .set("Cookie", studentCookie)
      .expect(200);
    expect(roadmap.body.data.levels[1].status).toBe("UNLOCKED");
    expect(roadmap.body.data.summary.levelsCompleted).toBe(1);
    expect(roadmap.body.data.summary.totalPoints).toBe(0);
  });
});