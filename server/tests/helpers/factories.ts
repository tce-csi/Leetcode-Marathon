import type { Db } from "@/lib/db/types";

export interface QuestionFactory {
  text: string;
  type?: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_TEXT";
  phase?: "BEFORE" | "AFTER";
  points?: number;
  correctText?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  options?: { text: string; correct?: boolean }[];
}

export interface LevelFactoryOptions {
  levelNumber: number;
  title?: string;
  points?: number;
  isStarting?: boolean;
  assessmentMode?: "NONE" | "BEFORE" | "AFTER" | "BOTH";
  requireAssessmentPass?: boolean;
  requireVerifiedSubmission?: boolean;
  passingScore?: number;
  maxAttempts?: number;
  problemSlug?: string;
  questions?: QuestionFactory[];
}

export async function createContestRecord(db: Db, slug = "test-contest"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into contests (slug, name, timezone, registration_open, start_at)
     values ($1, 'Test Contest', 'Asia/Kolkata', true, now())
     returning id`,
    [slug],
  );
  return rows[0]!.id;
}

export async function createTrackRecord(
  db: Db,
  contestId: string,
  year: 1 | 2,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into contest_tracks (contest_id, year, name) values ($1, $2, $3) returning id`,
    [contestId, year, year === 1 ? "First Year" : "Second Year"],
  );
  return rows[0]!.id;
}

export async function createLevelRecord(
  db: Db,
  trackId: string,
  options: LevelFactoryOptions,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into levels
       (track_id, level_number, title, description, difficulty, points, order_index,
        is_active, is_starting, assessment_mode, require_assessment_pass, passing_score,
        max_attempts, require_verified_submission)
     values ($1,$2,$3,'', 'EASY', $4,$2, true,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      trackId,
      options.levelNumber,
      options.title ?? `Level ${options.levelNumber}`,
      options.points ?? 10,
      options.isStarting ?? false,
      options.assessmentMode ?? "NONE",
      options.requireAssessmentPass ?? false,
      options.passingScore ?? 60,
      options.maxAttempts ?? 3,
      options.requireVerifiedSubmission ?? true,
    ],
  );
  const levelId = rows[0]!.id;

  if (options.problemSlug) {
    await db.query(
      `insert into leetcode_problems (level_id, title, url, problem_slug, difficulty)
       values ($1, $2, $3, $4, 'EASY')`,
      [
        levelId,
        `Problem ${options.problemSlug}`,
        `https://leetcode.com/problems/${options.problemSlug}/`,
        options.problemSlug,
      ],
    );
  }

  for (const [index, question] of (options.questions ?? []).entries()) {
    const inserted = await db.query<{ id: string }>(
      `insert into conceptual_questions
         (level_id, question_text, question_type, phase, order_index, points, correct_text, explanation, min_length, max_length)
       values ($1,$2,$3,$4,$5,$6,$7,'',$8,$9) returning id`,
      [
        levelId,
        question.text,
        question.type ?? "SINGLE_CHOICE",
        question.phase ?? "BEFORE",
        index,
        question.points ?? 1,
        question.correctText ?? null,
        question.minLength ?? null,
        question.maxLength ?? null,
      ],
    );
    const questionId = inserted.rows[0]!.id;
    for (const [optIndex, option] of (question.options ?? []).entries()) {
      await db.query(
        `insert into answer_options (question_id, option_text, is_correct, order_index)
         values ($1,$2,$3,$4)`,
        [questionId, option.text, option.correct ?? false, optIndex],
      );
    }
  }

  return levelId;
}

export async function createStudentRecord(
  db: Db,
  contestId: string,
  overrides: Partial<{
    rollNumber: string;
    year: 1 | 2;
    fullName: string;
    leetcodeUsername: string;
  }> = {},
): Promise<string> {
  const roll = overrides.rollNumber ?? "CS001";
  const year = overrides.year ?? 1;
  const leetcodeUsername = overrides.leetcodeUsername ?? "tester";
  const { rows } = await db.query<{ id: string }>(
    `insert into students
       (contest_id, full_name, roll_number, normalized_roll_number, year,
        leetcode_username, leetcode_username_normalized, leetcode_profile_url, password_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'x') returning id`,
    [
      contestId,
      overrides.fullName ?? "Test Student",
      roll,
      roll.toLowerCase(),
      year,
      leetcodeUsername,
      leetcodeUsername.toLowerCase(),
      `https://leetcode.com/u/${leetcodeUsername}/`,
    ],
  );
  return rows[0]!.id;
}

export async function createAdminRecord(
  db: Db,
  email = "admin@test.local",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into admin_users (email, name, password_hash, role)
     values ($1, 'Admin', 'x', 'SUPER_ADMIN') returning id`,
    [email],
  );
  return rows[0]!.id;
}

export async function getStudentRow(db: Db, id: string) {
  const { rows } = await db.query<any>("select * from students where id = $1", [id]);
  return rows[0];
}
