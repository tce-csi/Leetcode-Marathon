import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Db } from "@/lib/db/types";
import { createTestDb, type TestDb } from "./helpers/testDb";

/**
 * The app obtains its database through `getDb()`. We mock that module so the
 * routes run against the in-process PGlite database, giving a true end-to-end
 * check of the public contest endpoint through the Express app.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/db", () => ({
  getDb: () => state.db,
}));

import { createApp } from "@/app";

let test: TestDb;

beforeAll(async () => {
  test = await createTestDb();
  state.db = test.db;
});

afterAll(async () => {
  await test.close();
});

describe("GET /api/contest", () => {
  it("returns a null contest bundle when none is configured", async () => {
    const res = await request(createApp()).get("/api/contest");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { contest: null, tracks: [], status: null } });
  });

  it("returns the contest, tracks and computed status", async () => {
    const { rows } = await state.db.query<{ id: string }>(
      `insert into contests (slug, name, timezone, registration_open, is_active, start_at, end_at)
       values ('api-test', 'API Test', 'Asia/Kolkata', true, true, now() - interval '1 hour', now() + interval '1 hour')
       returning id`,
    );
    const contestId = rows[0]!.id;
    await state.db.query(
      `insert into contest_tracks (contest_id, year, name) values ($1, 1, 'First Year')`,
      [contestId],
    );
    await state.db.query(
      `insert into contest_tracks (contest_id, year, name) values ($1, 2, 'Second Year')`,
      [contestId],
    );

    const res = await request(createApp()).get("/api/contest");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.contest.name).toBe("API Test");
    expect(res.body.data.tracks.map((t: { year: number }) => t.year).sort()).toEqual([1, 2]);
    expect(res.body.data.status.isLive).toBe(true);
    expect(res.body.data.status.canParticipate).toBe(true);
  });

  it("returns the envelope failure for unknown routes", async () => {
    const res = await request(createApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});