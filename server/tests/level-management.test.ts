import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/types";
import type { StudentRow } from "@/lib/types";
import { createLevel, deleteLevel, reorderLevels } from "@/lib/services/admin";
import { getStudentLevels } from "@/lib/services/progression";
import type { LevelCreateInput } from "@/lib/validation/admin";
import { createTestDb, type TestDb } from "./helpers/testDb";
import { createAdminRecord, createStudentRecord, createTrackRecord } from "./helpers/factories";

let test: TestDb;
let db: Db;
let adminId: string;

function levelInput(
  trackId: string,
  title: string,
  extra: Partial<LevelCreateInput> = {},
): LevelCreateInput {
  return {
    trackId,
    force: false,
    title,
    description: "",
    teaser: "",
    difficulty: "EASY",
    points: 10,
    isActive: true,
    isStarting: false,
    assessmentMode: "NONE",
    requireAssessmentPass: false,
    passingScore: 60,
    maxAttempts: 3,
    requireVerifiedSubmission: true,
    ...extra,
  };
}

interface LiveLevel {
  id: string;
  level_number: number;
  order_index: number;
  title: string;
}

async function liveLevels(trackId: string): Promise<LiveLevel[]> {
  const { rows } = await db.query<LiveLevel>(
    `select id, level_number, order_index, title
       from levels
      where track_id = $1 and archived_at is null
      order by level_number asc`,
    [trackId],
  );
  return rows;
}

/** Creates a fresh contest with no tracks so tests never share numbering state. */
async function freshContest(startAt: "past" | "future" = "future"): Promise<string> {
  const startExpr = startAt === "past" ? "now() - interval '1 hour'" : "now() + interval '1 day'";
  const { rows } = await db.query<{ id: string }>(
    `insert into contests (slug, name, timezone, registration_open, is_active, start_at)
     values ($1, 'Level Test', 'Asia/Kolkata', true, true, ${startExpr})
     returning id`,
    [`lvl-${randomUUID()}`],
  );
  return rows[0]!.id;
}

/** Creates a fresh contest + one track so tests never share numbering state. */
async function freshTrack(
  options: { year?: 1 | 2; startAt?: "past" | "future" } = {},
): Promise<{ contestId: string; trackId: string }> {
  const contestId = await freshContest(options.startAt ?? "future");
  const trackId = await createTrackRecord(db, contestId, options.year ?? 1);
  return { contestId, trackId };
}

async function seedLevels(trackId: string, titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const res = await createLevel(adminId, levelInput(trackId, title), db);
    ids.push(res.level.id);
  }
  return ids;
}

async function studentRow(id: string): Promise<StudentRow> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0]!;
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  adminId = await createAdminRecord(db);
});

afterAll(async () => {
  await test.close();
});

describe("automatic level numbering", () => {
  it("assigns number 1 to the first level in a track", async () => {
    const { trackId } = await freshTrack();
    const res = await createLevel(adminId, levelInput(trackId, "First"), db);
    expect(res.level.level_number).toBe(1);
    expect(res.totalLevels).toBe(1);
  });

  it("assigns number 11 after ten existing levels", async () => {
    const { trackId } = await freshTrack();
    await seedLevels(trackId, Array.from({ length: 10 }, (_, i) => `L${i + 1}`));
    const res = await createLevel(adminId, levelInput(trackId, "Eleventh"), db);
    expect(res.level.level_number).toBe(11);
    expect(res.totalLevels).toBe(11);
  });

  it("ignores a client-submitted level number", async () => {
    const { trackId } = await freshTrack();
    await seedLevels(trackId, ["A", "B"]);
    // Directly passing a bogus number must not be honoured.
    const res = await createLevel(
      adminId,
      { ...levelInput(trackId, "C"), levelNumber: 99 } as LevelCreateInput,
      db,
    );
    expect(res.level.level_number).toBe(3);
  });

  it("never reuses a number for back-to-back creations in the same track", async () => {
    // NOTE: the PGlite test harness is single-connection, so genuinely parallel
    // transactions (Promise.all over createLevel) cannot be executed here.
    // Concurrency safety relies on `lockTrackForUpdate` (SELECT ... FOR UPDATE on
    // the track row) serialising creators; the guarantee we can exercise locally
    // is that consecutive creations in one track always get distinct, strictly
    // increasing numbers.
    const { trackId } = await freshTrack();
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await createLevel(adminId, levelInput(trackId, `Race ${i}`), db);
      seen.push(res.level.level_number);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps First-Year and Second-Year numbering independent", async () => {
    const contestId = await freshContest();
    const year1 = await createTrackRecord(db, contestId, 1);
    const year2 = await createTrackRecord(db, contestId, 2);

    await seedLevels(year1, ["1A", "1B"]);
    const firstSecondYear = await createLevel(adminId, levelInput(year2, "2A"), db);
    expect(firstSecondYear.level.level_number).toBe(1);
    const thirdFirstYear = await createLevel(adminId, levelInput(year1, "1C"), db);
    expect(thirdFirstYear.level.level_number).toBe(3);

    expect((await liveLevels(year1)).map((l) => l.level_number)).toEqual([1, 2, 3]);
    expect((await liveLevels(year2)).map((l) => l.level_number)).toEqual([1]);
  });
});

describe("automatic renumbering after deletion", () => {
  it("deleting level 7 of 12 produces a contiguous 1-11 sequence", async () => {
    const { trackId } = await freshTrack();
    const titles = "ABCDEFGHIJKL".split("");
    await seedLevels(trackId, titles);
    const before = await liveLevels(trackId);
    const level7 = before.find((l) => l.title === "G")!;

    await deleteLevel(adminId, level7.id, {}, db);

    const after = await liveLevels(trackId);
    expect(after.map((l) => l.level_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(after.map((l) => l.title)).toEqual([
      "A", "B", "C", "D", "E", "F", "H", "I", "J", "K", "L",
    ]);
  });

  it("deleting level 1 shifts every remaining level", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B", "C", "D"]);
    await deleteLevel(adminId, ids[0]!, {}, db);
    const after = await liveLevels(trackId);
    expect(after.map((l) => l.title)).toEqual(["B", "C", "D"]);
    expect(after.map((l) => l.level_number)).toEqual([1, 2, 3]);
  });

  it("deleting the final level updates the total", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B", "C"]);
    const res = await deleteLevel(adminId, ids[2]!, {}, db);
    expect(res.totalLevels).toBe(2);
    expect((await liveLevels(trackId)).map((l) => l.level_number)).toEqual([1, 2]);
  });

  it("deleting the only level produces an empty visible level set", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["Only"]);
    const res = await deleteLevel(adminId, ids[0]!, {}, db);
    expect(res.totalLevels).toBe(0);
    expect(await liveLevels(trackId)).toHaveLength(0);
  });

  it("creating after a deletion uses the next correct number", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B", "C"]);
    await deleteLevel(adminId, ids[2]!, {}, db);
    const res = await createLevel(adminId, levelInput(trackId, "D"), db);
    expect(res.level.level_number).toBe(3);
  });

  it("keeps numbers contiguous after reordering", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B", "C"]);
    await reorderLevels(adminId, trackId, [
      { id: ids[0]!, orderIndex: 3 },
      { id: ids[1]!, orderIndex: 1 },
      { id: ids[2]!, orderIndex: 2 },
    ], db);
    const after = await liveLevels(trackId);
    expect(after.map((l) => l.title)).toEqual(["B", "C", "A"]);
    expect(after.map((l) => l.level_number)).toEqual([1, 2, 3]);
  });
});

describe("data integrity while renumbering", () => {
  it("never leaves duplicate level numbers", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, "ABCDEFGHIJKL".split(""));
    await deleteLevel(adminId, ids[2]!, {}, db); // delete C
    await deleteLevel(adminId, ids[0]!, {}, db); // delete A
    await createLevel(adminId, levelInput(trackId, "NEW"), db);

    const { rows } = await db.query<{ level_number: number; count: number }>(
      `select level_number, count(*)::int as count
         from levels
        where track_id = $1 and archived_at is null
        group by level_number
       having count(*) > 1`,
      [trackId],
    );
    expect(rows).toHaveLength(0);
  });

  it("relies on the (track_id, level_number) uniqueness constraint for protection", async () => {
    const { trackId } = await freshTrack();
    await seedLevels(trackId, ["A"]);
    await expect(
      db.query(
        "insert into levels (track_id, level_number, title) values ($1, 1, 'duplicate')",
        [trackId],
      ),
    ).rejects.toThrow();
  });

  it("preserves the problem attached to a level whose number changes", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B", "C"]);
    const res = await createLevel(
      adminId,
      levelInput(trackId, "D", {
        problem: {
          title: "Two Sum",
          url: "https://leetcode.com/problems/two-sum/",
          difficulty: "EASY",
        },
      }),
      db,
    );
    const problemBefore = await db.query<{ id: string; problem_slug: string; level_id: string }>(
      "select id, problem_slug, level_id from leetcode_problems where level_id = $1",
      [res.level.id],
    );

    await deleteLevel(adminId, ids[0]!, {}, db); // D shifts 4 -> 3

    const problemAfter = await db.query<{ id: string; problem_slug: string; level_id: string }>(
      "select id, problem_slug, level_id from leetcode_problems where level_id = $1",
      [res.level.id],
    );
    const levelAfter = await db.query<{ level_number: number }>(
      "select level_number from levels where id = $1",
      [res.level.id],
    );
    expect(levelAfter.rows[0]!.level_number).toBe(3);
    expect(problemAfter.rows[0]!.id).toBe(problemBefore.rows[0]!.id);
    expect(problemAfter.rows[0]!.problem_slug).toBe("two-sum");
    expect(problemAfter.rows[0]!.level_id).toBe(res.level.id);
  });
});

describe("safe archival of levels with participant activity", () => {
  it("archives the level and preserves submissions, progress and timestamps", async () => {
    const { contestId, trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B"]);
    const studentId = await createStudentRecord(db, contestId, { rollNumber: "AR1", year: 1 });

    const submission = await db.query<{ id: string; created_at: string }>(
      `insert into coding_submissions (student_id, level_id, status, submission_url)
       values ($1, $2, 'VERIFIED', 'https://leetcode.com/problems/two-sum/submissions/1/')
       returning id, created_at`,
      [studentId, ids[0]!],
    );
    await db.query(
      `insert into student_level_progress (student_id, level_id, status, completed_at)
       values ($1, $2, 'COMPLETED', now())`,
      [studentId, ids[0]!],
    );

    const res = await deleteLevel(adminId, ids[0]!, {}, db);
    expect(res.archived).toBe(true);

    // The level row still exists, archived and hidden from the live set.
    const archived = await db.query<{ archived_at: string | null; is_active: boolean }>(
      "select archived_at, is_active from levels where id = $1",
      [ids[0]!],
    );
    expect(archived.rows[0]!.archived_at).not.toBeNull();
    expect(archived.rows[0]!.is_active).toBe(false);

    // Submission and progress are intact and still point at the same level id.
    const keptSubmission = await db.query<{ id: string; created_at: string; level_id: string }>(
      "select id, created_at, level_id from coding_submissions where id = $1",
      [submission.rows[0]!.id],
    );
    expect(keptSubmission.rows).toHaveLength(1);
    expect(new Date(keptSubmission.rows[0]!.created_at).getTime()).toBe(
      new Date(submission.rows[0]!.created_at).getTime(),
    );
    expect(keptSubmission.rows[0]!.level_id).toBe(ids[0]!);

    const progress = await db.query<{ status: string }>(
      "select status from student_level_progress where student_id = $1 and level_id = $2",
      [studentId, ids[0]!],
    );
    expect(progress.rows[0]!.status).toBe("COMPLETED");

    // Only the remaining live level is visible, renumbered to 1.
    const live = await liveLevels(trackId);
    expect(live.map((l) => l.title)).toEqual(["B"]);
    expect(live.map((l) => l.level_number)).toEqual([1]);
  });

  it("hard-deletes a level that has no participant activity", async () => {
    const { trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B"]);
    const res = await deleteLevel(adminId, ids[1]!, {}, db);
    expect(res.archived).toBe(false);
    const row = await db.query("select id from levels where id = $1", [ids[1]!]);
    expect(row.rows).toHaveLength(0);
  });
});

describe("student progression remains valid after authorized changes", () => {
  it("unlocks the correct next level after a deleted level is removed", async () => {
    const { contestId, trackId } = await freshTrack();
    const ids = await seedLevels(trackId, ["A", "B", "C"]);
    const studentId = await createStudentRecord(db, contestId, { rollNumber: "PR1", year: 1 });

    // Initialise progress, then mark A completed so B is unlocked and C locked.
    await getStudentLevels(await studentRow(studentId), db);
    await db.query(
      `update student_level_progress set status = 'COMPLETED', completed_at = now()
        where student_id = $1 and level_id = $2`,
      [studentId, ids[0]!],
    );
    await getStudentLevels(await studentRow(studentId), db); // B -> UNLOCKED, C stays LOCKED

    // Delete the just-unlocked but never-attempted level B. It is archived
    // (progress activity exists) and C should become the correct next level.
    const res = await deleteLevel(adminId, ids[1]!, {}, db);
    expect(res.archived).toBe(true);

    const levels = await getStudentLevels(await studentRow(studentId), db);
    const byTitle = new Map(levels.map((l) => [l.title, l]));
    expect(levels).toHaveLength(2);
    expect(byTitle.get("A")!.levelNumber).toBe(1);
    expect(byTitle.get("A")!.status).toBe("COMPLETED");
    expect(byTitle.get("C")!.levelNumber).toBe(2);
    expect(byTitle.get("C")!.status).toBe("UNLOCKED");
  });
});

describe("active contest safeguards", () => {
  it("requires explicit confirmation before changing a live contest's question set", async () => {
    const { contestId, trackId } = await freshTrack({ startAt: "past" });
    const ids = await seedLevels(trackId, ["A", "B"]);
    await createStudentRecord(db, contestId, { rollNumber: "LIVE1", year: 1 });

    // Deletion is rejected without force and the level remains.
    await expect(deleteLevel(adminId, ids[0]!, {}, db)).rejects.toMatchObject({
      code: "LEVEL_CHANGE_CONFIRMATION_REQUIRED",
    });
    expect((await liveLevels(trackId)).map((l) => l.title)).toEqual(["A", "B"]);

    // Creation is also gated.
    await expect(createLevel(adminId, levelInput(trackId, "C"), db)).rejects.toMatchObject({
      code: "LEVEL_CHANGE_CONFIRMATION_REQUIRED",
    });

    // With explicit confirmation both succeed.
    const created = await createLevel(
      adminId,
      levelInput(trackId, "C", { force: true }),
      db,
    );
    expect(created.level.level_number).toBe(3);
    const deleted = await deleteLevel(adminId, ids[0]!, { force: true }, db);
    expect(deleted.archived).toBe(true);
    expect((await liveLevels(trackId)).map((l) => l.title)).toEqual(["B", "C"]);
  });

  it("does not gate changes when the contest has not started", async () => {
    const { contestId, trackId } = await freshTrack({ startAt: "future" });
    await createStudentRecord(db, contestId, { rollNumber: "SCH1", year: 1 });
    const res = await createLevel(adminId, levelInput(trackId, "A"), db);
    expect(res.level.level_number).toBe(1);
  });
});

describe("mutation responses enable immediate UI updates", () => {
  it("returns the full updated level list and total after create and delete", async () => {
    const { trackId } = await freshTrack();
    const created = await createLevel(adminId, levelInput(trackId, "A"), db);
    expect(created.levels.map((l) => l.level_number)).toEqual([1]);
    expect(created.totalLevels).toBe(1);

    const created2 = await createLevel(adminId, levelInput(trackId, "B"), db);
    expect(created2.levels.map((l) => l.level_number)).toEqual([1, 2]);

    const deleted = await deleteLevel(adminId, created.level.id, {}, db);
    expect(deleted.levels.map((l) => l.level_number)).toEqual([1]);
    expect(deleted.totalLevels).toBe(1);
  });
});
