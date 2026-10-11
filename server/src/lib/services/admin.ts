import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import { extractLeetcodeSlug, isLeetcodeProblemUrl, normalizeName, normalizeRollNumber, parseLeetcodeProfileUrl } from "@/lib/normalize";
import { randomIdempotencyKey } from "@/lib/auth/tokens";
import { awardPoints } from "@/lib/services/scoring";
import { requireCurrentContest } from "@/lib/services/contest";
import { flagIdentityChanged } from "@/lib/services/flags";
import { resetStudentProgress, unlockNextLevel } from "@/lib/services/progression";
import type {
  ConceptualQuestionRow,
  ContestTrackRow,
  LevelRow,
  LeetCodeProblemRow,
  StudentRow,
  Year,
} from "@/lib/types";
import type {
  LevelCreateInput,
  LevelUpdateInput,
  QuestionCreateInput,
  QuestionUpdateInput,
  StudentAdminActionInput,
} from "@/lib/validation/admin";

export interface AdminStats {
  totalStudents: number;
  firstYear: number;
  secondYear: number;
  activeStudents: number;
  participants: number;
  totalSubmissions: number;
  verifiedSubmissions: number;
  pendingReviews: number;
  completedLevels: number;
  totalLevels: number;
  completionRate: number;
}

export async function getDashboardStats(
  contestId: string,
  db: Db = getDb(),
): Promise<AdminStats> {
  const { rows } = await db.query<{
    total_students: number;
    first_year: number;
    second_year: number;
    active_students: number;
    participants: number;
    total_submissions: number;
    verified_submissions: number;
    pending_reviews: number;
    completed_levels: number;
    total_levels: number;
  }>(
    `select
       (select count(*) from students where contest_id = $1)::int as total_students,
       (select count(*) from students where contest_id = $1 and year = 1)::int as first_year,
       (select count(*) from students where contest_id = $1 and year = 2)::int as second_year,
       (select count(*) from students where contest_id = $1 and is_active = true)::int as active_students,
       (select count(*) from students s where s.contest_id = $1
          and exists (select 1 from score_events se where se.student_id = s.id))::int as participants,
       (select count(*) from coding_submissions cs join students s on s.id = cs.student_id where s.contest_id = $1)::int as total_submissions,
       (select count(*) from coding_submissions cs join students s on s.id = cs.student_id where s.contest_id = $1 and cs.status = 'VERIFIED')::int as verified_submissions,
       (select count(*) from coding_submissions cs join students s on s.id = cs.student_id where s.contest_id = $1 and cs.status = 'PENDING_REVIEW')::int as pending_reviews,
       (select count(*) from student_level_progress p join students s on s.id = p.student_id where s.contest_id = $1 and p.status = 'COMPLETED')::int as completed_levels,
       (select count(*) from levels l join contest_tracks t on t.id = l.track_id where t.contest_id = $1 and l.is_active = true)::int as total_levels`,
    [contestId],
  );
  const row = rows[0]!;
  const denominator = row.total_students * row.total_levels;
  return {
    totalStudents: row.total_students,
    firstYear: row.first_year,
    secondYear: row.second_year,
    activeStudents: row.active_students,
    participants: row.participants,
    totalSubmissions: row.total_submissions,
    verifiedSubmissions: row.verified_submissions,
    pendingReviews: row.pending_reviews,
    completedLevels: row.completed_levels,
    totalLevels: row.total_levels,
    completionRate: denominator === 0 ? 0 : Math.round((row.completed_levels / denominator) * 100),
  };
}

// ---------------------------------------------------------------------------
// Track (year) management
// ---------------------------------------------------------------------------

/**
 * Enables or disables a year's track. This is the server-controlled feature
 * flag behind "Second Year open / First Year coming soon".
 */
export async function setTrackActive(
  adminId: string,
  year: Year,
  isActive: boolean,
  db: Db = getDb(),
): Promise<ContestTrackRow> {
  return db.transaction(async (tx) => {
    const contest = await requireCurrentContest(tx);
    const { rows } = await tx.query<ContestTrackRow>(
      `update contest_tracks
          set is_active = $3
        where contest_id = $1 and year = $2
        returning *`,
      [contest.id, year, isActive],
    );
    const track = rows[0];
    if (!track) throw errors.notFound("Track not found.");
    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "track.update",
        entityType: "track",
        entityId: track.id,
        metadata: { year, isActive },
      },
      tx,
    );
    return track;
  });
}

// ---------------------------------------------------------------------------
// Level management
// ---------------------------------------------------------------------------

const LEVEL_COLUMNS: Record<string, string> = {
  trackId: "track_id",
  levelNumber: "level_number",
  title: "title",
  description: "description",
  teaser: "teaser",
  difficulty: "difficulty",
  points: "points",
  orderIndex: "order_index",
  isActive: "is_active",
  isStarting: "is_starting",
  assessmentMode: "assessment_mode",
  requireAssessmentPass: "require_assessment_pass",
  passingScore: "passing_score",
  maxAttempts: "max_attempts",
  requireVerifiedSubmission: "require_verified_submission",
};

async function upsertProblem(
  db: Db,
  levelId: string,
  problem: NonNullable<LevelCreateInput["problem"]>,
): Promise<LeetCodeProblemRow> {
  if (!isLeetcodeProblemUrl(problem.url)) {
    throw errors.badRequest("Problem URL must be a valid leetcode.com problem link.");
  }
  const slug = problem.problemSlug?.trim() || extractLeetcodeSlug(problem.url) || "";
  const { rows } = await db.query<LeetCodeProblemRow>(
    `insert into leetcode_problems (level_id, title, url, problem_slug, difficulty)
     values ($1, $2, $3, $4, $5)
     on conflict (level_id) do update
       set title = excluded.title, url = excluded.url,
           problem_slug = excluded.problem_slug, difficulty = excluded.difficulty
     returning *`,
    [levelId, problem.title, problem.url, slug, problem.difficulty ?? "EASY"],
  );
  return rows[0]!;
}

export async function createLevel(
  adminId: string,
  input: LevelCreateInput,
  db: Db = getDb(),
): Promise<LevelRow> {
  return db.transaction(async (tx) => {
    const orderIndex = input.orderIndex ?? input.levelNumber;
    let level: LevelRow;
    try {
      const inserted = await tx.query<LevelRow>(
        `insert into levels
           (track_id, level_number, title, description, difficulty, points, order_index,
            is_active, is_starting, assessment_mode, require_assessment_pass, passing_score,
            max_attempts, require_verified_submission)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning *`,
        [
          input.trackId,
          input.levelNumber,
          input.title,
          input.description ?? "",
          input.difficulty ?? "EASY",
          input.points ?? 10,
          orderIndex,
          input.isActive ?? true,
          input.isStarting ?? false,
          input.assessmentMode ?? "NONE",
          input.requireAssessmentPass ?? false,
          input.passingScore ?? 60,
          input.maxAttempts ?? 3,
          input.requireVerifiedSubmission ?? true,
        ],
      );
      level = inserted.rows[0]!;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
        throw errors.conflict("A level with that number already exists in this track.");
      }
      throw error;
    }
    if (input.problem) await upsertProblem(tx, level.id, input.problem);
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "level.create", entityType: "level", entityId: level.id },
      tx,
    );
    return level;
  });
}

export async function updateLevel(
  adminId: string,
  input: LevelUpdateInput,
  db: Db = getDb(),
): Promise<LevelRow> {
  return db.transaction(async (tx) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(LEVEL_COLUMNS)) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length > 0) {
      values.push(input.id);
      await tx.query(`update levels set ${sets.join(", ")} where id = $${values.length}`, values);
    }
    const level = await tx.query<LevelRow>("select * from levels where id = $1", [input.id]);
    if (!level.rows[0]) throw errors.notFound("Level not found.");
    if (input.problem) await upsertProblem(tx, input.id, input.problem);
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "level.update", entityType: "level", entityId: input.id },
      tx,
    );
    return level.rows[0];
  });
}

export async function deleteLevel(adminId: string, levelId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.query("delete from levels where id = $1", [levelId]);
    if (result.rowCount === 0) throw errors.notFound("Level not found.");
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "level.delete", entityType: "level", entityId: levelId },
      tx,
    );
  });
}

export async function reorderLevels(
  adminId: string,
  trackId: string,
  order: { id: string; orderIndex: number }[],
  db: Db = getDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of order) {
      await tx.query(
        "update levels set order_index = $2 where id = $1 and track_id = $3",
        [item.id, item.orderIndex, trackId],
      );
    }
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "level.reorder", entityType: "track", entityId: trackId },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Question management
// ---------------------------------------------------------------------------

export async function createQuestion(
  adminId: string,
  input: QuestionCreateInput,
  db: Db = getDb(),
): Promise<ConceptualQuestionRow> {
  return db.transaction(async (tx) => {
    const inserted = await tx.query<ConceptualQuestionRow>(
      `insert into conceptual_questions
         (level_id, question_text, question_type, phase, order_index, points, correct_text, explanation, is_active, variant_group)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning *`,
      [
        input.levelId,
        input.questionText,
        input.questionType,
        input.phase,
        input.orderIndex ?? 0,
        input.points ?? 1,
        input.correctText || null,
        input.explanation ?? "",
        input.isActive ?? true,
        input.variantGroup || null,
      ],
    );
    const question = inserted.rows[0]!;
    await replaceOptions(tx, question.id, input.options ?? []);
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "question.create", entityType: "question", entityId: question.id },
      tx,
    );
    return question;
  });
}

export async function updateQuestion(
  adminId: string,
  input: QuestionUpdateInput,
  db: Db = getDb(),
): Promise<ConceptualQuestionRow> {
  return db.transaction(async (tx) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      questionText: "question_text",
      questionType: "question_type",
      phase: "phase",
      orderIndex: "order_index",
      points: "points",
      correctText: "correct_text",
      explanation: "explanation",
      isActive: "is_active",
      variantGroup: "variant_group",
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value === "" && (column === "correct_text" || column === "variant_group") ? null : value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length > 0) {
      values.push(input.id);
      await tx.query(`update conceptual_questions set ${sets.join(", ")} where id = $${values.length}`, values);
    }
    if (input.options) {
      await replaceOptions(tx, input.id, input.options);
    }
    const question = await tx.query<ConceptualQuestionRow>(
      "select * from conceptual_questions where id = $1",
      [input.id],
    );
    if (!question.rows[0]) throw errors.notFound("Question not found.");
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "question.update", entityType: "question", entityId: input.id },
      tx,
    );
    return question.rows[0];
  });
}

async function replaceOptions(
  db: Db,
  questionId: string,
  options: { optionText: string; isCorrect?: boolean }[],
): Promise<void> {
  await db.query("delete from answer_options where question_id = $1", [questionId]);
  for (const [index, option] of options.entries()) {
    await db.query(
      `insert into answer_options (question_id, option_text, is_correct, order_index)
       values ($1, $2, $3, $4)`,
      [questionId, option.optionText, option.isCorrect ?? false, index],
    );
  }
}

export async function deleteQuestion(adminId: string, questionId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.query("delete from conceptual_questions where id = $1", [questionId]);
    if (result.rowCount === 0) throw errors.notFound("Question not found.");
    await writeAudit(
      { actorType: "ADMIN", actorId: adminId, action: "question.delete", entityType: "question", entityId: questionId },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Student administration
// ---------------------------------------------------------------------------

export async function applyStudentAdminAction(
  adminId: string,
  input: StudentAdminActionInput,
  db: Db = getDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const studentResult = await tx.query<StudentRow>("select * from students where id = $1", [
      input.studentId,
    ]);
    const student = studentResult.rows[0];
    if (!student) throw errors.notFound("Student not found.");

    switch (input.action) {
      case "setActive":
        await tx.query("update students set is_active = $2 where id = $1", [student.id, input.value]);
        break;
      case "resetProgress":
        await resetStudentProgress(tx, student);
        break;
      case "adjustPoints":
        await awardPoints(
          {
            studentId: student.id,
            contestId: student.contest_id,
            source: "ADMIN_ADJUSTMENT",
            points: input.points,
            reason: input.reason,
            idempotencyKey: `admin-adjustment:${randomIdempotencyKey()}`,
          },
          tx,
        );
        break;
      case "grantLevel": {
        const levelResult = await tx.query<LevelRow>(
          "select * from levels where id = $1",
          [input.levelId],
        );
        const level = levelResult.rows[0];
        if (!level) throw errors.notFound("Level not found.");
        await tx.query(
          `insert into student_level_progress (student_id, level_id, status, unlocked_at, completed_at, points_awarded)
           values ($1, $2, 'COMPLETED', now(), now(), $3)
           on conflict (student_id, level_id) do update
             set status = 'COMPLETED', completed_at = now(), points_awarded = $3`,
          [student.id, level.id, level.points],
        );
        await awardPoints(
          {
            studentId: student.id,
            contestId: student.contest_id,
            levelId: level.id,
            source: "ADMIN_ADJUSTMENT",
            points: level.points,
            reason: `Admin granted level ${level.level_number}`,
            idempotencyKey: `level:${student.id}:${level.id}`,
          },
          tx,
        );
        await unlockNextLevel(tx, student.id, level);
        break;
      }
    }

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: `student.${input.action}`,
        entityType: "student",
        entityId: student.id,
        metadata: input,
      },
      tx,
    );
  });
}

export interface StudentIdentityUpdateInput {
  studentId: string;
  fullName?: string;
  rollNumber?: string;
  year?: Year;
  leetcodeProfileUrl?: string;
}

/**
 * Corrects a participant's identity details. Year changes are deliberately
 * administrator-only and are recorded as a review flag plus an audit entry,
 * since participants may not switch year tracks themselves.
 */
export async function updateStudentIdentity(
  adminId: string,
  input: StudentIdentityUpdateInput,
  db: Db = getDb(),
): Promise<StudentRow> {
  return db.transaction(async (tx) => {
    const result = await tx.query<StudentRow>("select * from students where id = $1 for update", [
      input.studentId,
    ]);
    const student = result.rows[0];
    if (!student) throw errors.notFound("Student not found.");

    const sets: string[] = [];
    const values: unknown[] = [];
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (input.fullName !== undefined) {
      const fullName = normalizeName(input.fullName);
      if (fullName) {
        values.push(fullName);
        sets.push(`full_name = $${values.length}`);
        changes.fullName = { from: student.full_name, to: fullName };
      }
    }
    if (input.rollNumber !== undefined) {
      const rollNumber = input.rollNumber.trim();
      const normalized = normalizeRollNumber(rollNumber);
      if (normalized) {
        const clash = await tx.query<{ id: string }>(
          "select id from students where contest_id = $1 and normalized_roll_number = $2 and id <> $3",
          [student.contest_id, normalized, student.id],
        );
        if (clash.rows.length > 0) throw errors.conflict("That roll number is already registered.");
        values.push(rollNumber);
        sets.push(`roll_number = $${values.length}`);
        values.push(normalized);
        sets.push(`normalized_roll_number = $${values.length}`);
        changes.rollNumber = { from: student.roll_number, to: rollNumber };
      }
    }
    if (input.leetcodeProfileUrl !== undefined) {
      const profile = parseLeetcodeProfileUrl(input.leetcodeProfileUrl);
      if (!profile) throw errors.badRequest("Enter a valid LeetCode profile URL.");
      const clash = await tx.query<{ id: string }>(
        "select id from students where contest_id = $1 and leetcode_username_normalized = $2 and id <> $3",
        [student.contest_id, profile.normalizedUsername, student.id],
      );
      if (clash.rows.length > 0) {
        throw errors.conflict("That LeetCode profile is already linked to another participant.");
      }
      values.push(profile.profileUrl);
      sets.push(`leetcode_profile_url = $${values.length}`);
      values.push(profile.username);
      sets.push(`leetcode_username = $${values.length}`);
      values.push(profile.normalizedUsername);
      sets.push(`leetcode_username_normalized = $${values.length}`);
      // The identity is unverified until re-confirmed.
      sets.push("identity_verified_at = null");
      sets.push("identity_verified_by = null");
      changes.leetcodeUsername = { from: student.leetcode_username, to: profile.username };
    }
    if (input.year !== undefined) {
      const track = await tx.query<{ id: string }>(
        "select id from contest_tracks where contest_id = $1 and year = $2",
        [student.contest_id, input.year],
      );
      if (!track.rows[0]) throw errors.badRequest("That year track is not configured.");
      values.push(input.year);
      sets.push(`year = $${values.length}`);
      changes.year = { from: student.year, to: input.year };
    }

    if (sets.length === 0) return student;

    values.push(student.id);
    const updated = await tx.query<StudentRow>(
      `update students set ${sets.join(", ")} where id = $${values.length} returning *`,
      values,
    );

    if (changes.year || changes.leetcodeUsername) {
      await flagIdentityChanged(
        student.contest_id,
        student.id,
        { changes, correctedBy: adminId },
        tx,
      );
    }

    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "student.identity.update",
        entityType: "student",
        entityId: student.id,
        metadata: { changes },
      },
      tx,
    );

    return updated.rows[0]!;
  });
}

/** Marks a participant's linked LeetCode identity as manually verified. */
export async function verifyStudentIdentity(
  adminId: string,
  studentId: string,
  db: Db = getDb(),
): Promise<StudentRow> {
  return db.transaction(async (tx) => {
    const result = await tx.query<StudentRow>(
      `update students
          set identity_verified_at = now(), identity_verified_by = $2
        where id = $1
        returning *`,
      [studentId, adminId],
    );
    const student = result.rows[0];
    if (!student) throw errors.notFound("Student not found.");
    await writeAudit(
      {
        actorType: "ADMIN",
        actorId: adminId,
        action: "student.identity.verify",
        entityType: "student",
        entityId: studentId,
      },
      tx,
    );
    return student;
  });
}

export interface AuditLogEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function listAuditLogs(limit = 50, db: Db = getDb()): Promise<AuditLogEntry[]> {
  const { rows } = await db.query<AuditLogEntry>(
    "select * from audit_logs order by created_at desc limit $1",
    [limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Content queries for the admin dashboard
// ---------------------------------------------------------------------------

export interface AdminLevelRow extends LevelRow {
  year: number;
  problem_title: string | null;
  problem_url: string | null;
  problem_slug: string | null;
  question_count: number;
}

export async function listLevelsDetailed(
  contestId: string,
  db: Db = getDb(),
): Promise<AdminLevelRow[]> {
  const { rows } = await db.query<AdminLevelRow>(
    `select l.*, t.year, p.title as problem_title, p.url as problem_url, p.problem_slug,
            (select count(*) from conceptual_questions q where q.level_id = l.id)::int as question_count
       from levels l
       join contest_tracks t on t.id = l.track_id
       left join leetcode_problems p on p.level_id = l.id
      where t.contest_id = $1
      order by t.year asc, l.order_index asc, l.level_number asc`,
    [contestId],
  );
  return rows;
}

export interface AdminQuestion {
  id: string;
  level_id: string;
  question_text: string;
  question_type: string;
  phase: string;
  order_index: number;
  points: number;
  correct_text: string | null;
  explanation: string;
  variant_group: string | null;
  is_active: boolean;
  options: { id: string; option_text: string; is_correct: boolean; order_index: number }[];
}

export async function getQuestionsForLevel(
  levelId: string,
  db: Db = getDb(),
): Promise<AdminQuestion[]> {
  const { rows } = await db.query<ConceptualQuestionRow & { option_id: string | null; option_text: string | null; is_correct: boolean | null; option_order: number | null }>(
    `select q.*, o.id as option_id, o.option_text, o.is_correct, o.order_index as option_order
       from conceptual_questions q
       left join answer_options o on o.question_id = q.id
      where q.level_id = $1
      order by q.phase asc, q.order_index asc, o.order_index asc`,
    [levelId],
  );
  const map = new Map<string, AdminQuestion>();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        level_id: row.level_id,
        question_text: row.question_text,
        question_type: row.question_type,
        phase: row.phase,
        order_index: row.order_index,
        points: row.points,
        correct_text: row.correct_text,
        explanation: row.explanation,
        variant_group: row.variant_group,
        is_active: row.is_active,
        options: [],
      });
    }
    if (row.option_id) {
      map.get(row.id)!.options.push({
        id: row.option_id,
        option_text: row.option_text ?? "",
        is_correct: row.is_correct ?? false,
        order_index: row.option_order ?? 0,
      });
    }
  }
  return [...map.values()];
}
