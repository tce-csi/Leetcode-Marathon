import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/testDb";

describe("database schema", () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb();
  });

  afterAll(async () => {
    await test.close();
  });

  it("creates all core tables", async () => {
    const { rows } = await test.db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    const names = rows.map((r) => r.tablename);
    for (const expected of [
      "admin_users",
      "contest_tracks",
      "contests",
      "levels",
      "leetcode_problems",
      "conceptual_questions",
      "answer_options",
      "students",
      "student_sessions",
      "assessment_attempts",
      "assessment_answers",
      "coding_submissions",
      "submission_reviews",
      "student_level_progress",
      "score_events",
      "audit_logs",
      "rate_limits",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("enforces unique normalized roll numbers per contest", async () => {
    const contest = await test.db.query<{ id: string }>(
      "insert into contests (slug, name) values ('c1', 'Contest') returning id",
    );
    const contestId = contest.rows[0].id;
    await test.db.query(
      `insert into students (contest_id, full_name, roll_number, normalized_roll_number, year, leetcode_username, leetcode_username_normalized, password_hash)
       values ($1, 'A', 'CS01', 'cs01', 1, 'a', 'a', 'x')`,
      [contestId],
    );
    await expect(
      test.db.query(
        `insert into students (contest_id, full_name, roll_number, normalized_roll_number, year, leetcode_username, leetcode_username_normalized, password_hash)
         values ($1, 'B', 'CS01', 'cs01', 1, 'b', 'b', 'x')`,
        [contestId],
      ),
    ).rejects.toThrow();
  });

  it("allows multiple submission attempts per student/level to preserve history", async () => {
    const { rows } = await test.db.query<{ id: string }>(
      "insert into contests (slug, name) values ('c2', 'Contest') returning id",
    );
    const contestId = rows[0].id;
    const student = await test.db.query<{ id: string }>(
      `insert into students (contest_id, full_name, roll_number, normalized_roll_number, year, leetcode_username, leetcode_username_normalized, password_hash)
       values ($1, 'A', 'CS02', 'cs02', 1, 'a', 'a', 'x') returning id`,
      [contestId],
    );
    const track = await test.db.query<{ id: string }>(
      "insert into contest_tracks (contest_id, year, name) values ($1, 1, 'First') returning id",
      [contestId],
    );
    const level = await test.db.query<{ id: string }>(
      "insert into levels (track_id, level_number, title, is_starting) values ($1, 1, 'L1', true) returning id",
      [track.rows[0].id],
    );
    const studentId = student.rows[0].id;
    const levelId = level.rows[0].id;
    await test.db.query(
      "insert into coding_submissions (student_id, level_id, status, attempt_number) values ($1, $2, 'PENDING_REVIEW', 1)",
      [studentId, levelId],
    );
    const second = await test.db.query(
      "insert into coding_submissions (student_id, level_id, status, attempt_number) values ($1, $2, 'PENDING_REVIEW', 2) returning id",
      [studentId, levelId],
    );
    expect(second.rows).toHaveLength(1);
  });

  it("enforces score event idempotency keys", async () => {
    const { rows } = await test.db.query<{ id: string }>(
      "insert into contests (slug, name) values ('c3', 'Contest') returning id",
    );
    const contestId = rows[0].id;
    const student = await test.db.query<{ id: string }>(
      `insert into students (contest_id, full_name, roll_number, normalized_roll_number, year, leetcode_username, leetcode_username_normalized, password_hash)
       values ($1, 'A', 'CS03', 'cs03', 1, 'a', 'a', 'x') returning id`,
      [contestId],
    );
    const studentId = student.rows[0].id;
    await test.db.query(
      "insert into score_events (student_id, contest_id, source, points, idempotency_key) values ($1, $2, 'SUBMISSION', 10, 'k1')",
      [studentId, contestId],
    );
    await expect(
      test.db.query(
        "insert into score_events (student_id, contest_id, source, points, idempotency_key) values ($1, $2, 'SUBMISSION', 10, 'k1')",
        [studentId, contestId],
      ),
    ).rejects.toThrow();
  });
});
