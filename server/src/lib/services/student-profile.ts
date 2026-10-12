import type {
  AssessmentAttemptRow,
  CodingSubmissionRow,
  LevelRow,
  PublicStudent,
  QuestionPhase,
  QuestionType,
  StudentLevelProgressRow,
  StudentRow,
} from "@/lib/types";
import { toPublicStudent } from "@/lib/serializers";

import type { Db } from "@/lib/db/types";
import { getDb } from "@/lib/db";

export interface QuizAnswerHistory {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  phase: QuestionPhase;
  isCorrect: boolean | null;
  pointsAwarded: number;
  selectedOptionIds: string[];
  selectedOptions: { id: string; text: string }[];
  textAnswer: string | null;
}

export interface QuizAttemptHistory {
  attempt: AssessmentAttemptRow;
  answers: QuizAnswerHistory[];
}

export interface LevelSubmissionHistory {
  level: LevelRow & { problem_title: string | null; problem_url: string | null };
  progress: StudentLevelProgressRow | null;
  submissions: CodingSubmissionRow[];
  assessments: QuizAttemptHistory[];
}

export interface StudentProfile {
  student: PublicStudent;
  levelsCompleted: number;
  totalPoints: number;
  lastActivity: string | null;
  firstSubmissionAt: string | null;
  contestCompletedAt: string | null;
  totalLevels: number;
  history: LevelSubmissionHistory[];
}

/**
 * Returns a comprehensive student contest profile for the admin review UI.
 * Includes all levels (in order), all submissions per level, and key timestamps.
 */
export async function getStudentProfile(
  contestId: string,
  studentId: string,
  db: Db = getDb(),
): Promise<StudentProfile | null> {
  const studentResult = await db.query<StudentRow>(
    "select * from students where id = $1 and contest_id = $2",
    [studentId, contestId],
  );
  const student = studentResult.rows[0];
  if (!student) return null;

  // Get the track for the student's year
  const trackResult = await db.query<{ id: string }>(
    "select id from contest_tracks where contest_id = $1 and year = $2",
    [contestId, student.year],
  );
  const trackId = trackResult.rows[0]?.id;

  // Get all levels in contest order with problem info
  const levelsResult = await db.query<LevelRow & { problem_title: string | null; problem_url: string | null }>(
    `select l.*,
            p.title as problem_title,
            p.url as problem_url
       from levels l
       left join leetcode_problems p on p.level_id = l.id
      where l.track_id = $1 and l.is_active = true
      order by l.order_index asc, l.level_number asc`,
    [trackId ?? ""],
  );

  // Get all progress records for this student
  const progressResult = await db.query<StudentLevelProgressRow>(
    "select * from student_level_progress where student_id = $1",
    [studentId],
  );
  const progressMap = new Map<string, StudentLevelProgressRow>(
    progressResult.rows.map((p) => [p.level_id, p]),
  );

  // Get all submissions for this student, ordered by level and attempt
  const submissionsResult = await db.query<CodingSubmissionRow>(
    `select * from coding_submissions
      where student_id = $1
      order by level_id, attempt_number asc, created_at asc`,
    [studentId],
  );
  const submissionsByLevel = new Map<string, CodingSubmissionRow[]>();
  for (const sub of submissionsResult.rows) {
    const existing = submissionsByLevel.get(sub.level_id) ?? [];
    existing.push(sub);
    submissionsByLevel.set(sub.level_id, existing);
  }

  // All quiz attempts (with fully resolved answers) for this student, grouped
  // by level. Text answers and selected options are included so the admin
  // review UI can inspect the immutable submission alongside coding evidence.
  const assessmentsResult = await db.query<
    AssessmentAttemptRow & {
      answers: {
        question_id: string;
        question_text: string;
        question_type: QuestionType;
        phase: QuestionPhase;
        is_correct: boolean | null;
        points_awarded: number;
        selected_option_ids: string[];
        selected_options: { id: string; text: string }[];
        text_answer: string | null;
      }[];
    }
  >(
    `select a.*,
            coalesce(
              json_agg(json_build_object(
                'question_id', q.id,
                'question_text', q.question_text,
                'question_type', q.question_type,
                'phase', q.phase,
                'is_correct', aa.is_correct,
                'points_awarded', aa.points_awarded,
                'selected_option_ids', coalesce(aa.selected_option_ids, '{}'),
                'text_answer', aa.text_answer,
                'selected_options', coalesce(
                  (select json_agg(json_build_object('id', o.id, 'text', o.option_text))
                     from answer_options o
                    where o.id = any(aa.selected_option_ids)),
                  '[]'::json
                )
              ) order by q.order_index asc) filter (where q.id is not null),
              '[]'::json
            ) as answers
       from assessment_attempts a
       left join assessment_answers aa on aa.attempt_id = a.id
       left join conceptual_questions q on q.id = aa.question_id
      where a.student_id = $1
      group by a.id
      order by a.level_id, a.attempt_number asc`,
    [studentId],
  );
  const assessmentsByLevel = new Map<string, QuizAttemptHistory[]>();
  for (const row of assessmentsResult.rows) {
    const { answers, level_id, ...attempt } = row;
    const existing = assessmentsByLevel.get(level_id) ?? [];
    existing.push({
      attempt: { ...attempt, level_id },
      answers: answers.map((answer) => ({
        questionId: answer.question_id,
        questionText: answer.question_text,
        questionType: answer.question_type,
        phase: answer.phase,
        isCorrect: answer.is_correct,
        pointsAwarded: answer.points_awarded,
        selectedOptionIds: answer.selected_option_ids ?? [],
        selectedOptions: answer.selected_options ?? [],
        textAnswer: answer.text_answer,
      })),
    });
    assessmentsByLevel.set(level_id, existing);
  }

  // Build history
  const history: LevelSubmissionHistory[] = levelsResult.rows.map((level) => ({
    level,
    progress: progressMap.get(level.id) ?? null,
    submissions: submissionsByLevel.get(level.id) ?? [],
    assessments: assessmentsByLevel.get(level.id) ?? [],
  }));

  // Summary stats
  const scoreResult = await db.query<{ total: number }>(
    "select coalesce(sum(points), 0)::int as total from score_events where student_id = $1",
    [studentId],
  );
  const levelsCompleted = progressResult.rows.filter((p) => p.status === "COMPLETED").length;
  const totalPoints = scoreResult.rows[0]?.total ?? 0;

  // Last activity: most recent submission created_at
  const lastActivity = submissionsResult.rows.at(-1)?.created_at ?? null;
  const firstSubmissionAt = submissionsResult.rows.at(0)?.created_at ?? null;

  // Contest completed at: when student completed the last level
  const completedProgresses = progressResult.rows
    .filter((p) => p.status === "COMPLETED" && p.completed_at)
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime());
  const contestCompletedAt =
    levelsCompleted === levelsResult.rows.length && completedProgresses.length > 0
      ? completedProgresses[0]!.completed_at
      : null;

  return {
    student: toPublicStudent(student),
    levelsCompleted,
    totalPoints,
    lastActivity,
    firstSubmissionAt,
    contestCompletedAt,
    totalLevels: levelsResult.rows.length,
    history,
  };
}
