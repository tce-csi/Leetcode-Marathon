import { createStudentSessionRecord, type SessionTokens } from "@/lib/auth/session-store";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { errors } from "@/lib/errors";
import {
  normalizeName,
  normalizeRollNumber,
  parseLeetcodeProfileUrl,
} from "@/lib/normalize";
import { toPublicStudent } from "@/lib/serializers";
import {
  computeContestStatus,
  getTrackByYear,
  requireActiveContest,
} from "@/lib/services/contest";
import { initializeStudentProgress } from "@/lib/services/progression";
import type { PublicStudent, StudentRow, Year } from "@/lib/types";
import type { RegisterInput } from "@/lib/validation/auth";

// Re-export the profile function from the dedicated module
export { getStudentProfile } from "@/lib/services/student-profile";
export type { StudentProfile, LevelSubmissionHistory } from "@/lib/services/student-profile";

export interface ServiceContext {
  db?: Db;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthResult {
  student: PublicStudent;
  tokens: SessionTokens;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505",
  );
}

export async function registerStudent(
  input: RegisterInput,
  ctx: ServiceContext = {},
): Promise<AuthResult> {
  const db = ctx.db ?? getDb();
  const contest = await requireActiveContest(db);
  const status = computeContestStatus(contest);
  if (!status.canRegister) {
    throw errors.forbidden("Registration is currently closed.");
  }

  // Per-year feature flag: only years whose track is active may register.
  const track = await getTrackByYear(contest.id, input.year, db);
  if (!track || !track.is_active) {
    if (input.year === 1) {
      throw errors.forbidden(
        "First Year registration is not open yet — it's coming soon. Only Second Year students can register right now.",
      );
    }
    throw errors.forbidden("Registration for your year is not currently open.");
  }

  const normalizedRoll = normalizeRollNumber(input.rollNumber);
  const profile = parseLeetcodeProfileUrl(input.leetcodeProfileUrl);
  // The register schema already rejects invalid URLs; this re-check guards
  // against callers that bypass validation.
  if (!profile) {
    throw errors.badRequest(
      "Enter a valid LeetCode profile URL, for example https://leetcode.com/u/your-username/.",
    );
  }
  const fullName = normalizeName(input.fullName);

  const existing = await db.query<{ id: string }>(
    "select id from students where contest_id = $1 and normalized_roll_number = $2",
    [contest.id, normalizedRoll],
  );
  if (existing.rows.length > 0) {
    throw errors.conflict("A student with this roll number is already registered.");
  }

  const sameLeetcode = await db.query<{ id: string }>(
    "select id from students where contest_id = $1 and leetcode_username_normalized = $2",
    [contest.id, profile.normalizedUsername],
  );
  if (sameLeetcode.rows.length > 0) {
    throw errors.conflict(
      "The LeetCode profile you provided is already registered. " +
        "If you believe this is a mistake, contact an administrator.",
    );
  }

  const passwordHash = await hashPassword(input.password);

  let student: StudentRow;
  try {
    const inserted = await db.query<StudentRow>(
      `insert into students
         (contest_id, full_name, roll_number, normalized_roll_number, year,
          leetcode_username, leetcode_username_normalized, leetcode_profile_url, password_hash,
          integrity_accepted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [
        contest.id,
        fullName,
        input.rollNumber.trim(),
        normalizedRoll,
        input.year,
        profile.username,
        profile.normalizedUsername,
        profile.profileUrl,
        passwordHash,
        input.acceptIntegrity ? new Date().toISOString() : null,
      ],
    );
    student = inserted.rows[0]!;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict("A student with this roll number is already registered.");
    }
    throw error;
  }

  await initializeStudentProgress(db, student);
  const tokens = await createStudentSessionRecord(db, student.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await writeAudit(
    {
      actorType: "STUDENT",
      actorId: student.id,
      action: "student.register",
      entityType: "student",
      entityId: student.id,
      metadata: { year: student.year, rollNumber: student.roll_number },
      ip: ctx.ip,
    },
    db,
  );

  return { student: toPublicStudent(student), tokens };
}

export async function authenticateStudent(
  rollNumber: string,
  password: string,
  ctx: ServiceContext = {},
): Promise<AuthResult> {
  const db = ctx.db ?? getDb();
  const contest = await requireActiveContest(db);
  const normalizedRoll = normalizeRollNumber(rollNumber);

  const result = await db.query<StudentRow>(
    "select * from students where contest_id = $1 and normalized_roll_number = $2",
    [contest.id, normalizedRoll],
  );
  const student = result.rows[0];
  if (!student) throw errors.unauthorized("Invalid roll number or password.");
  if (!student.is_active) throw errors.forbidden("This account has been disabled.");

  const valid = await verifyPassword(password, student.password_hash);
  if (!valid) throw errors.unauthorized("Invalid roll number or password.");

  await db.query("update students set last_login_at = now() where id = $1", [student.id]);
  const tokens = await createStudentSessionRecord(db, student.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await writeAudit(
    {
      actorType: "STUDENT",
      actorId: student.id,
      action: "student.login",
      entityType: "student",
      entityId: student.id,
      ip: ctx.ip,
    },
    db,
  );

  return { student: toPublicStudent(student), tokens };
}

export async function getStudentById(db: Db, id: string): Promise<StudentRow | null> {
  const { rows } = await db.query<StudentRow>("select * from students where id = $1", [id]);
  return rows[0] ?? null;
}

export interface StudentListFilters {
  search?: string;
  year?: Year;
  activeOnly?: boolean;
}

export interface StudentListRow extends PublicStudent {
  total_points: number;
  levels_completed: number;
  pending_reviews: number;
  total_levels: number;
}

export async function listStudents(
  contestId: string,
  filters: StudentListFilters = {},
  db: Db = getDb(),
): Promise<StudentListRow[]> {
  const clauses: string[] = ["s.contest_id = $1"];
  const values: unknown[] = [contestId];
  if (filters.year) {
    values.push(filters.year);
    clauses.push(`s.year = $${values.length}`);
  }
  if (filters.activeOnly) {
    clauses.push("s.is_active = true");
  }
  if (filters.search) {
    values.push(`%${filters.search.trim().toLowerCase()}%`);
    clauses.push(
      `(lower(s.full_name) like $${values.length} or lower(s.normalized_roll_number) like $${values.length} or lower(s.leetcode_username) like $${values.length})`,
    );
  }

  const { rows } = await db.query<StudentListRow & { password_hash: string; normalized_roll_number: string; leetcode_username_normalized: string }>(
    `select s.*,
            coalesce((select sum(se.points) from score_events se where se.student_id = s.id), 0)::int as total_points,
            coalesce((select count(*) from student_level_progress p where p.student_id = s.id and p.status = 'COMPLETED'), 0)::int as levels_completed,
            coalesce((select count(*) from coding_submissions cs where cs.student_id = s.id and cs.status = 'PENDING_REVIEW'), 0)::int as pending_reviews,
            coalesce((
              select count(l.id)::int
                from levels l
                join contest_tracks ct on ct.id = l.track_id
               where ct.contest_id = s.contest_id and ct.year = s.year and ct.is_active = true and l.is_active = true
            ), 0)::int as total_levels
       from students s
      where ${clauses.join(" and ")}
      order by total_points desc, s.created_at asc`,
    values,
  );

  return rows.map((row) => {
    const {
      password_hash: _p,
      normalized_roll_number: _n,
      leetcode_username_normalized: _l,
      ...rest
    } = row;
    return rest;
  });
}
