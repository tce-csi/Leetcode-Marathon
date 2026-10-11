import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/types";
import { AppError } from "@/lib/errors";
import {
  getActiveContest,
  getCurrentContest,
  requireActiveContest,
  requireCurrentContest,
} from "@/lib/services/contest";
import { createTestDb, type TestDb } from "./helpers/testDb";

let test: TestDb;
let db: Db;
let contestId: string;

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
  const { rows } = await db.query<{ id: string }>(
    `insert into contests (slug, name, timezone, registration_open, is_active, start_at)
     values ('current-test', 'Current Test', 'Asia/Kolkata', true, false, now())
     returning id`,
  );
  contestId = rows[0]!.id;
});

afterAll(async () => {
  await test.close();
});

describe("active vs current contest", () => {
  it("hides an inactive contest from public/student resolution", async () => {
    expect(await getActiveContest(db)).toBeNull();
    await expect(requireActiveContest(db)).rejects.toBeInstanceOf(AppError);
  });

  it("still exposes an inactive contest to admin tooling", async () => {
    const current = await requireCurrentContest(db);
    expect(current.id).toBe(contestId);
    expect(current.is_active).toBe(false);
    expect((await getCurrentContest(db))?.id).toBe(contestId);
  });

  it("resolves the contest through the public path once re-activated", async () => {
    await db.query("update contests set is_active = true where id = $1", [contestId]);
    const active = await requireActiveContest(db);
    expect(active.id).toBe(contestId);
  });
});
