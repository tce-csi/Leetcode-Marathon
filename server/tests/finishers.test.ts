/**
 * Phase 7 � Finisher Rankings, Mandatory Source Code & Finalist Verification
 *
 * Tests cover:
 *  1. Rejection of submissions missing submissionUrl or sourceCode.
 *  2. Acceptance of valid submissions with both fields.
 *  3. Auto-completion: finished_at and elapsed_duration_ms set once all levels done.
 *  4. Idempotency: repeated completions never overwrite the first finished_at.
 *  5. listFinishers() ranking order (earliest finish, elapsed as tie-break).
 *  6. Independent rankings for Year 1 vs Year 2.
 *  7. Finalist status transitions (PROVISIONAL => VERIFIED / DISQUALIFIED).
 *  8. Disqualification preserves submission history.
 *  9. getFinisherStats() returns correct aggregates.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/types";
import { createTestDb, type TestDb } from "./helpers/testDb";
import {
  createContestRecord,
  createTrackRecord,
  createLevelRecord,
  createStudentRecord,
  createAdminRecord,
  getStudentRow,
} from "./helpers/factories";
import { createSubmission } from "@/lib/services/submissions";
import { initializeStudentProgress, checkAndRecordContestFinish } from "@/lib/services/progression";
import {
  listFinishers,
  getFinisherStats,
  updateFinalistStatus,
} from "@/lib/services/finishers";

let test: TestDb;
let db: Db;
let contestId: string;
let trackY1: string;
let trackY2: string;
let adminId: string;

let y1Level1: string;
let y1Level2: string;
let y2Level1: string;

async function freshStudent(id: string) {
  return getStudentRow(db, id);
}

function validSubmission(levelId: string, suffix = "") {
  return {
    levelId,
    submissionUrl: `https://leetcode.com/submissions/detail/${Date.now()}${suffix}/`,
    sourceCode: "def solution(nums, target): return [0, 1]",
    programmingLanguage: "python",
  };
}

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;

  contestId = await createContestRecord(db, `finisher-test-${Date.now()}`);
  trackY1 = await createTrackRecord(db, contestId, 1);
  trackY2 = await createTrackRecord(db, contestId, 2);
  adminId = await createAdminRecord(db, `admin-finisher-${Date.now()}@test.local`);

  y1Level1 = await createLevelRecord(db, trackY1, {
    levelNumber: 1,
    title: "Two Sum",
    points: 100,
    isStarting: true,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });
  y1Level2 = await createLevelRecord(db, trackY1, {
    levelNumber: 2,
    title: "Reverse Integer",
    points: 100,
    isStarting: false,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });
  y2Level1 = await createLevelRecord(db, trackY2, {
    levelNumber: 1,
    title: "Palindrome Number",
    points: 100,
    isStarting: true,
    requireVerifiedSubmission: true,
    requireAssessmentPass: false,
    assessmentMode: "NONE",
  });
});

afterAll(async () => {
  await test.close();
});

// -- 1. Mandatory submission fields --------------------------------------------
describe("mandatory submission fields", () => {
  it("rejects a submission with no submissionUrl", async () => {
    const studentId = await createStudentRecord(db, contestId, { rollNumber: "MF001", year: 1, leetcodeUsername: "lc-mf001" });
    const student = await freshStudent(studentId);
    await initializeStudentProgress(db, student);

    await expect(
      createSubmission(student, { levelId: y1Level1, sourceCode: "def s(): pass" } as any, { db }),
    ).rejects.toSatisfy((e: any) => e.statusCode === 400 || /url/i.test(e.message));
  });

  it("rejects a non-LeetCode URL", async () => {
    const studentId = await createStudentRecord(db, contestId, { rollNumber: "MF003", year: 1, leetcodeUsername: "lc-mf003" });
    const student = await freshStudent(studentId);
    await initializeStudentProgress(db, student);

    await expect(
      createSubmission(
        student,
        { levelId: y1Level1, submissionUrl: "https://github.com/fake/repo", sourceCode: "def s(): pass" },
        { db },
      ),
    ).rejects.toSatisfy((e: any) => e.statusCode === 400 || /leetcode/i.test(e.message));
  });

  it("rejects a submission with no sourceCode", async () => {
    const studentId = await createStudentRecord(db, contestId, { rollNumber: "MF004", year: 1, leetcodeUsername: "lc-mf004" });
    const student = await freshStudent(studentId);
    await initializeStudentProgress(db, student);

    await expect(
      createSubmission(
        student,
        { levelId: y1Level1, submissionUrl: "https://leetcode.com/submissions/detail/9001/" } as any,
        { db },
      ),
    ).rejects.toSatisfy((e: any) => e.statusCode === 400 || /source/i.test(e.message));
  });

  it("accepts a valid submission with both URL and sourceCode", async () => {
    const studentId = await createStudentRecord(db, contestId, { rollNumber: "MF006", year: 1, leetcodeUsername: "lc-mf006" });
    const student = await freshStudent(studentId);
    await initializeStudentProgress(db, student);

const sub = await createSubmission(student, validSubmission(y1Level1, "0"), { db });
    expect(sub.id).toBeTruthy();
    expect(sub.status).toBe("PENDING_REVIEW");
    expect(sub.source_code).toBeTruthy();
    expect(sub.submission_url).toMatch(/leetcode\.com/);
  });
});

// -- 2. Auto-finish detection ---------------------------------------------------
describe("auto-finish detection", () => {
  let finisherStudentId: string;

  beforeAll(async () => {
    finisherStudentId = await createStudentRecord(db, contestId, {
      rollNumber: "AF001",
      year: 1,
      fullName: "Finisher Alpha",
    });
    const student = await freshStudent(finisherStudentId);
    await initializeStudentProgress(db, student);
  });

  it("finished_at is null before completing any levels", async () => {
    const row = await freshStudent(finisherStudentId);
    expect(row.finished_at).toBeNull();
  });

  it("finished_at remains null after completing only Level 1 of 2", async () => {
    const student = await freshStudent(finisherStudentId);
    await createSubmission(student, validSubmission(y1Level1, "1"), { db });
    const row = await freshStudent(finisherStudentId);
    expect(row.finished_at).toBeNull();
  });

  it("finished_at and elapsed_duration_ms are recorded atomically after Level 2", async () => {
    await db.query(
      `update student_level_progress
          set status = 'UNLOCKED', unlocked_at = now()
        where student_id = $1 and level_id = $2 and status = 'LOCKED'`,
      [finisherStudentId, y1Level2],
    );
    const student = await freshStudent(finisherStudentId);
    await createSubmission(student, validSubmission(y1Level2, "2"), { db });

    const row = await freshStudent(finisherStudentId);
    expect(row.finished_at).not.toBeNull();
    expect(Number(row.elapsed_duration_ms)).toBeGreaterThanOrEqual(0);
    expect(row.finalist_status).toBe("PROVISIONAL");
    expect(row.contest_started_at).not.toBeNull();
  });

  it("finished_at is NOT overwritten by subsequent checkAndRecordContestFinish calls", async () => {
    const rowBefore = await freshStudent(finisherStudentId);
    const originalFinishedAt = rowBefore.finished_at;
    const student = await freshStudent(finisherStudentId);
    await checkAndRecordContestFinish(db, student, trackY1);
    const rowAfter = await freshStudent(finisherStudentId);
    expect(rowAfter.finished_at).toStrictEqual(originalFinishedAt);
  });
});

// -- 3. Finisher rankings ------------------------------------------------------
describe("finisher rankings", () => {
  let student1Id: string;
  let student2Id: string;
  let y2StudentId: string;

  beforeAll(async () => {
    student1Id = await createStudentRecord(db, contestId, { rollNumber: "RANK001", year: 1, fullName: "Rank First", leetcodeUsername: "lc-rank001" });
    student2Id = await createStudentRecord(db, contestId, { rollNumber: "RANK002", year: 1, fullName: "Rank Second", leetcodeUsername: "lc-rank002" });
    y2StudentId = await createStudentRecord(db, contestId, { rollNumber: "RANK003", year: 2, fullName: "Year Two Winner", leetcodeUsername: "lc-rank003" });

    const t1 = new Date(Date.now() - 10_000).toISOString();
    await db.query(
      `update students set finished_at=$2,contest_started_at=now()-interval '1 hour',elapsed_duration_ms=3600000 where id=$1`,
      [student1Id, t1],
    );
    const t2 = new Date(Date.now() - 5_000).toISOString();
    await db.query(
      `update students set finished_at=$2,contest_started_at=now()-interval '2 hours',elapsed_duration_ms=7200000 where id=$1`,
      [student2Id, t2],
    );
    const t3 = new Date(Date.now() - 3_000).toISOString();
    await db.query(
      `update students set finished_at=$2,contest_started_at=now()-interval '30 minutes',elapsed_duration_ms=1800000 where id=$1`,
      [y2StudentId, t3],
    );
  });

  it("Year 1 finishers are ordered earliest-finish-first", async () => {
    const finishers = await listFinishers(contestId, { year: 1, sortBy: "finished_at" }, db);
    const y1 = finishers.filter((f) => f.studentId === student1Id || f.studentId === student2Id);
    expect(y1.length).toBeGreaterThanOrEqual(2);
    const pos1 = y1.findIndex((f) => f.studentId === student1Id);
    const pos2 = y1.findIndex((f) => f.studentId === student2Id);
    expect(pos1).toBeLessThan(pos2);
  });

  it("Year 2 finisher is absent from Year 1 list", async () => {
    const finishers = await listFinishers(contestId, { year: 1 }, db);
    expect(finishers.find((f) => f.studentId === y2StudentId)).toBeUndefined();
  });

  it("Year 1 finishers are absent from Year 2 list", async () => {
    const finishers = await listFinishers(contestId, { year: 2 }, db);
    expect(finishers.find((f) => f.studentId === student1Id)).toBeUndefined();
    expect(finishers.find((f) => f.studentId === student2Id)).toBeUndefined();
  });

  it("Year 2 entry has correct elapsedDurationMs", async () => {
    const finishers = await listFinishers(contestId, { year: 2 }, db);
    const entry = finishers.find((f) => f.studentId === y2StudentId);
    expect(entry).toBeDefined();
    expect(entry!.elapsedDurationMs).toBe(1800000);
    expect(entry!.elapsedFormatted).toBe("00:30:00");
  });

  it("sortBy elapsed orders by elapsed_duration_ms ascending", async () => {
    const finishers = await listFinishers(contestId, { year: 1, sortBy: "elapsed" }, db);
    const y1 = finishers.filter((f) => f.studentId === student1Id || f.studentId === student2Id);
    const pos1 = y1.findIndex((f) => f.studentId === student1Id);
    const pos2 = y1.findIndex((f) => f.studentId === student2Id);
    // student1 elapsed=3600000, student2 elapsed=7200000 ? student1 ranks first
    expect(pos1).toBeLessThan(pos2);
  });

  it("search filter narrows results by name", async () => {
    const finishers = await listFinishers(contestId, { year: 1, search: "Rank First" }, db);
    expect(finishers.find((f) => f.studentId === student1Id)).toBeDefined();
    expect(finishers.find((f) => f.studentId === student2Id)).toBeUndefined();
  });

  it("non-finished students do not appear in the list", async () => {
    const nonId = await createStudentRecord(db, contestId, { rollNumber: "NOTFINISH001", year: 1, leetcodeUsername: "lc-nf001" });
    const finishers = await listFinishers(contestId, { year: 1 }, db);
    expect(finishers.find((f) => f.studentId === nonId)).toBeUndefined();
  });

  it("rank numbers start at 1 and are contiguous", async () => {
    const finishers = await listFinishers(contestId, { year: 1 }, db);
    if (finishers.length > 0) {
      expect(finishers[0]!.rank).toBe(1);
      finishers.forEach((f, i) => expect(f.rank).toBe(i + 1));
    }
  });
});

// -- 4. Finalist status transitions --------------------------------------------
describe("finalist status transitions", () => {
  let finalistId: string;

  beforeAll(async () => {
    finalistId = await createStudentRecord(db, contestId, { rollNumber: "FV001", year: 1, fullName: "Finalist Vicky", leetcodeUsername: "lc-fv001" });
    await db.query(
      `update students set finished_at=now(),contest_started_at=now()-interval '1 hour',elapsed_duration_ms=3600000 where id=$1`,
      [finalistId],
    );
  });

  it("initial finalist_status is PROVISIONAL", async () => {
    expect((await freshStudent(finalistId)).finalist_status).toBe("PROVISIONAL");
  });

  it("admin can transition to UNDER_REVIEW with notes", async () => {
    const updated = await updateFinalistStatus(adminId, finalistId, { finalistStatus: "UNDER_REVIEW", reviewNotes: "Checking" }, db);
    expect(updated.finalist_status).toBe("UNDER_REVIEW");
    expect(updated.finalist_review_notes).toBe("Checking");
    expect(updated.finalist_verified_by).toBe(adminId);
  });

  it("admin can VERIFY a finisher", async () => {
    const updated = await updateFinalistStatus(adminId, finalistId, { finalistStatus: "VERIFIED" }, db);
    expect(updated.finalist_status).toBe("VERIFIED");
  });

  it("VERIFIED finalist appears in verifiedOnly filter", async () => {
    const finishers = await listFinishers(contestId, { year: 1, verifiedOnly: true }, db);
    expect(finishers.find((f) => f.studentId === finalistId)).toBeDefined();
  });

  it("admin can DISQUALIFY with a reason", async () => {
    const updated = await updateFinalistStatus(
      adminId,
      finalistId,
      { finalistStatus: "DISQUALIFIED", disqualificationReason: "Plagiarism confirmed" },
      db,
    );
    expect(updated.finalist_status).toBe("DISQUALIFIED");
    expect(updated.finalist_disqualification_reason).toBe("Plagiarism confirmed");
  });

  it("disqualification preserves finished_at and elapsed_duration_ms", async () => {
    const row = await freshStudent(finalistId);
    expect(row.finished_at).not.toBeNull();
    expect(row.elapsed_duration_ms).not.toBeNull();
  });

  it("DISQUALIFIED student does not appear in verifiedOnly filter", async () => {
    const finishers = await listFinishers(contestId, { year: 1, verifiedOnly: true }, db);
    expect(finishers.find((f) => f.studentId === finalistId)).toBeUndefined();
  });

  it("DISQUALIFIED status filter shows disqualified students", async () => {
    const finishers = await listFinishers(contestId, { year: 1, status: "DISQUALIFIED" }, db);
    const found = finishers.find((f) => f.studentId === finalistId);
    expect(found).toBeDefined();
    expect(found!.finalistStatus).toBe("DISQUALIFIED");
  });

  it("throws not-found for unknown studentId", async () => {
    await expect(
      updateFinalistStatus(adminId, "00000000-0000-4000-8000-000000000000", { finalistStatus: "VERIFIED" }, db),
    ).rejects.toSatisfy((e: any) => e.statusCode === 404 || /not found/i.test(e.message));
  });
});

// -- 5. getFinisherStats --------------------------------------------------------
describe("getFinisherStats", () => {
  it("returns at least one finisher in the main contest", async () => {
    const stats = await getFinisherStats(contestId, 1, db);
    expect(stats.totalRegistered).toBeGreaterThan(0);
    expect(stats.totalFinished).toBeGreaterThan(0);
    expect(stats.earliestFinish).not.toBeNull();
    expect(stats.fastestElapsedMs).not.toBeNull();
    expect(stats.fastestElapsedFormatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("returns zero totalFinished for a contest with no finishers", async () => {
    const emptyId = await createContestRecord(db, `empty-${Date.now()}`);
    await createTrackRecord(db, emptyId, 2);
    const stats = await getFinisherStats(emptyId, 2, db);
    expect(stats.totalFinished).toBe(0);
    expect(stats.earliestFinish).toBeNull();
    expect(stats.fastestElapsedMs).toBeNull();
  });

  it("verifiedFinalists count is correct", async () => {
    const vc = await createContestRecord(db, `vc-${Date.now()}`);
    await createTrackRecord(db, vc, 1);
    const vsId = await createStudentRecord(db, vc, { rollNumber: "VC001", year: 1, leetcodeUsername: "lc-vc001" });
    await db.query(
      `update students set finished_at=now(),contest_started_at=now()-interval '30 minutes',elapsed_duration_ms=1800000,finalist_status='VERIFIED' where id=$1`,
      [vsId],
    );
    const stats = await getFinisherStats(vc, 1, db);
    expect(stats.verifiedFinalists).toBe(1);
  });
});


