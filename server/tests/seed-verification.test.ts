/**
 * Seed verification — runs the LeetCode Marathon seed logic against an
 * isolated PGlite database and asserts:
 *   1. Both year tracks (1 and 2) are created and enabled by default.
 *   2. Each year contains exactly 10 levels in the correct order.
 *   3. Every level has a linked LeetCode problem URL (problem_slug set).
 *   4. Level numbers are 1..10, sequential and non-duplicate.
 *   5. Re-running the seed (idempotency) does not create duplicate records.
 *   6. The starting level (level_number = 1) has is_starting = true.
 *
 * Note: This test does NOT require a real PostgreSQL connection — it uses
 * PGlite (WASM PostgreSQL) which is the same backend used by all other
 * integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  ensureContest,
  ensureTracks,
  importLevel,
  MARATHON,
} from "../scripts/seed";

let test: TestDb;

beforeAll(async () => {
  test = await createTestDb();
});

afterAll(() => test.close());

// ── Helper: run the full seed (contest + tracks + levels) ────────────────────
async function runSeed(db: typeof test.db) {
  const contestId = await ensureContest(db);
  const tracks = await ensureTracks(db, contestId);
  for (const year of [1, 2] as const) {
    for (const level of MARATHON[year]) {
      await importLevel(db, tracks[year], level);
    }
  }
  return { contestId, tracks };
}

describe("both-year seed verification", () => {
  it("creates exactly one contest with slug 'codequest'", async () => {
    await runSeed(test.db);
    const { rows } = await test.db.query<{ count: number }>(
      "select count(*)::int as count from contests where slug = 'codequest'"
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("creates First Year and Second Year tracks, both enabled by default", async () => {
    const { rows } = await test.db.query<{ year: number; is_active: boolean }>(
      "select year, is_active from contest_tracks order by year"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.year).toBe(1);
    expect(rows[0]!.is_active).toBe(true);
    expect(rows[1]!.year).toBe(2);
    expect(rows[1]!.is_active).toBe(true);
  });

  it("imports exactly 10 levels per year", async () => {
    const { rows } = await test.db.query<{ year: number; count: number }>(
      `select ct.year, count(l.id)::int as count
         from levels l
         join contest_tracks ct on ct.id = l.track_id
        group by ct.year
        order by ct.year`
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.count).toBe(10);
    }
  });

  it("assigns sequential level_numbers 1..10 with no gaps or duplicates", async () => {
    const { rows } = await test.db.query<{ year: number; level_numbers: string }>(
      `select ct.year,
              string_agg(l.level_number::text, ',' order by l.level_number) as level_numbers
         from levels l
         join contest_tracks ct on ct.id = l.track_id
        group by ct.year
        order by ct.year`
    );
    for (const row of rows) {
      expect(row.level_numbers).toBe("1,2,3,4,5,6,7,8,9,10");
    }
  });

  it("marks only level_number = 1 as is_starting in each track", async () => {
    const { rows } = await test.db.query<{ level_number: number; is_starting: boolean }>(
      "select level_number, is_starting from levels order by level_number"
    );
    for (const row of rows) {
      if (row.level_number === 1) {
        expect(row.is_starting).toBe(true);
      } else {
        expect(row.is_starting).toBe(false);
      }
    }
  });

  it("links each level to a leetcode_problems row with a non-empty problem_slug", async () => {
    const { rows } = await test.db.query<{ level_id: string; problem_slug: string }>(
      "select level_id, problem_slug from leetcode_problems"
    );
    // One problem per level, 20 levels total.
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row.problem_slug).toBeTruthy();
      expect(row.problem_slug.length).toBeGreaterThan(0);
    }
  });

  it("matches the MARATHON constant's titles for Year 1", async () => {
    const { rows } = await test.db.query<{ level_number: number; title: string }>(
      `select l.level_number, l.title
         from levels l
         join contest_tracks ct on ct.id = l.track_id
        where ct.year = 1
        order by l.level_number`
    );
    for (const [i, expected] of MARATHON[1].entries()) {
      expect(rows[i]!.title).toBe(expected.title);
      expect(rows[i]!.level_number).toBe(expected.levelNumber);
    }
  });

  it("matches the MARATHON constant's titles for Year 2", async () => {
    const { rows } = await test.db.query<{ level_number: number; title: string }>(
      `select l.level_number, l.title
         from levels l
         join contest_tracks ct on ct.id = l.track_id
        where ct.year = 2
        order by l.level_number`
    );
    for (const [i, expected] of MARATHON[2].entries()) {
      expect(rows[i]!.title).toBe(expected.title);
      expect(rows[i]!.level_number).toBe(expected.levelNumber);
    }
  });

  it("is idempotent: re-running the seed does not create duplicate records", async () => {
    // Run a second time.
    await runSeed(test.db);

    const contests = await test.db.query<{ count: number }>(
      "select count(*)::int as count from contests where slug = 'codequest'"
    );
    const tracks = await test.db.query<{ count: number }>(
      "select count(*)::int as count from contest_tracks"
    );
    const levels = await test.db.query<{ count: number }>(
      "select count(*)::int as count from levels"
    );
    const problems = await test.db.query<{ count: number }>(
      "select count(*)::int as count from leetcode_problems"
    );

    expect(contests.rows[0]!.count).toBe(1);
    expect(tracks.rows[0]!.count).toBe(2);
    expect(levels.rows[0]!.count).toBe(20);
    expect(problems.rows[0]!.count).toBe(20);
  });
});
