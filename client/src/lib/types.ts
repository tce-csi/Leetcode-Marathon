/**
 * Shared domain types. `*Row` types mirror database tables (snake_case),
 * while DTO types are the camelCase shapes sent to the browser.
 */

export type Year = 1 | 2;
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type AssessmentMode = "NONE" | "BEFORE" | "AFTER" | "BOTH";
export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_TEXT";
export type QuestionPhase = "BEFORE" | "AFTER";
export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "GRADED";
export type SubmissionStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED";
export type VerificationSourceKind = "MANUAL" | "AUTOMATIC";
export type ProgressStatus = "LOCKED" | "UNLOCKED" | "IN_PROGRESS" | "COMPLETED";
export type ScoreSource = "ASSESSMENT" | "SUBMISSION" | "ADMIN_ADJUSTMENT";
export type ActorKind = "STUDENT" | "ADMIN" | "SYSTEM";
export type ReviewDecision = "APPROVED" | "REJECTED";
export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "REVIEWER";
export type FlagSeverity = "LOW" | "MEDIUM" | "HIGH";
export type FlagKind =
  | "DUPLICATE_SUBMISSION_URL"
  | "REPEATED_REJECTED_EVIDENCE"
  | "SUBMISSION_OUTSIDE_WINDOW"
  | "RAPID_LEVEL_COMPLETION"
  | "IDENTITY_CHANGED";

export type FinalistStatus = "PROVISIONAL" | "UNDER_REVIEW" | "VERIFIED" | "DISQUALIFIED";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: AdminRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicAdmin = Omit<AdminUserRow, "password_hash">;

export interface ContestRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  timezone: string;
  registration_open_at: string | null;
  registration_close_at: string | null;
  start_at: string | null;
  end_at: string | null;
  grace_period_minutes: number;
  registration_open: boolean;
  is_active: boolean;
  leaderboard_visible: boolean;
  allow_late_submissions: boolean;
  allow_admin_override: boolean;
  require_submission_after_unlock: boolean;
  verification_mode: "MANUAL" | "AUTOMATIC" | "HYBRID";
  ranking_rule: "POINTS_LEVELS_TIME" | "LEVELS_POINTS_TIME" | "POINTS_TIME";
  created_at: string;
  updated_at: string;
}

export interface ContestTrackRow {
  id: string;
  contest_id: string;
  year: Year;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LevelRow {
  id: string;
  track_id: string;
  level_number: number;
  title: string;
  description: string;
  teaser: string;
  difficulty: Difficulty;
  points: number;
  order_index: number;
  is_active: boolean;
  is_starting: boolean;
  assessment_mode: AssessmentMode;
  require_assessment_pass: boolean;
  passing_score: number;
  max_attempts: number;
  require_verified_submission: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeetCodeProblemRow {
  id: string;
  level_id: string;
  title: string;
  url: string;
  problem_slug: string;
  difficulty: Difficulty;
  created_at: string;
  updated_at: string;
}

export interface ConceptualQuestionRow {
  id: string;
  level_id: string;
  question_text: string;
  question_type: QuestionType;
  phase: QuestionPhase;
  order_index: number;
  points: number;
  correct_text: string | null;
  explanation: string;
  variant_group: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnswerOptionRow {
  id: string;
  question_id: string;
  option_text: string;
  is_correct: boolean;
  order_index: number;
  created_at: string;
}

export interface StudentRow {
  id: string;
  contest_id: string;
  full_name: string;
  roll_number: string;
  normalized_roll_number: string;
  year: Year;
  leetcode_username: string;
  leetcode_username_normalized: string;
  leetcode_profile_url: string;
  password_hash: string;
  is_active: boolean;
  integrity_accepted_at: string | null;
  identity_verified_at: string | null;
  identity_verified_by: string | null;
  last_login_at: string | null;
  /** Set once the student presses "Start Contest" (anchors the personal timer). */
  started_at: string | null;
  contest_started_at: string | null;
  finished_at: string | null;
  elapsed_duration_ms: number | null;
  /** Set once the student explicitly submits the contest for organiser review. */
  finalized_at: string | null;
  previous_finished_at?: string | null;
  previous_elapsed_duration_ms?: number | null;
  finalist_status: FinalistStatus;
  finalist_verified_at: string | null;
  finalist_verified_by: string | null;
  finalist_review_notes: string | null;
  finalist_disqualification_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicStudent = Omit<StudentRow, "password_hash" | "normalized_roll_number" | "leetcode_username_normalized">;

export interface AssessmentAttemptRow {
  id: string;
  student_id: string;
  level_id: string;
  phase: QuestionPhase;
  attempt_number: number;
  status: AttemptStatus;
  score: number;
  max_score: number;
  passed: boolean;
  /** Whether this attempt is the permanent one-submission for the (student, level, phase). */
  is_submission: boolean;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
  graded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SubmissionReviewState = "NOT_REVIEWED" | "REVIEWED_VALID" | "REVIEWED_INVALID" | "FLAGGED";

export interface CodingSubmissionRow {
  id: string;
  student_id: string;
  level_id: string;
  problem_id: string | null;
  status: SubmissionStatus;
  verification_source: VerificationSourceKind;
  /** Whether this submission currently holds the one-submission slot for the level. */
  is_official: boolean;
  submission_url: string | null;
  screenshot_path: string | null;
  student_note: string | null;
  problem_slug: string | null;
  verdict: string | null;
  reported_solved_at: string | null;
  verified_solved_at: string | null;
  verified_at: string | null;
  attempt_number: number;
  source_code: string | null;
  programming_language: string | null;
  code_file_name: string | null;
  code_requested: boolean;
  review_state: SubmissionReviewState;
  created_at: string;
  updated_at: string;
}

export interface StudentLevelProgressRow {
  id: string;
  student_id: string;
  level_id: string;
  status: ProgressStatus;
  points_awarded: number;
  unlocked_at: string | null;
  completed_at: string | null;
  challenge_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A student's view of a single level in their roadmap. */
export interface RoadmapLevel {
  id: string;
  levelNumber: number;
  title: string;
  description: string;
  teaser: string;
  /** True when future-level details are withheld until the level unlocks. */
  hidden: boolean;
  difficulty: Difficulty;
  points: number;
  status: ProgressStatus;
  assessmentMode: AssessmentMode;
  requireAssessmentPass: boolean;
  requireVerifiedSubmission: boolean;
  passingScore: number;
  maxAttempts: number;
  problem: {
    title: string;
    url: string;
    slug: string;
  } | null;
  submissionStatus: SubmissionStatus | null;
  beforeAssessmentPassed: boolean;
  afterAssessmentPassed: boolean;
  completedAt: string | null;
  unlockedAt: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  displayId: string;
  year: Year;
  levelsCompleted: number;
  totalPoints: number;
  lastScoreAt: string | null;
  isCurrentStudent?: boolean;
}

export interface SuspiciousFlagRow {
  id: string;
  contest_id: string;
  student_id: string | null;
  level_id: string | null;
  submission_id: string | null;
  kind: FlagKind;
  severity: FlagSeverity;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

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

export interface FinisherEntry {
  rank: number;
  studentId: string;
  fullName: string;
  rollNumber: string;
  year: Year;
  leetcodeUsername: string;
  leetcodeProfileUrl: string;
  completedLevels: number;
  totalLevels: number;
  /** Personal contest start (falls back to the recorded contest start). */
  startedAt: string | null;
  contestStartedAt: string | null;
  finishedAt: string;
  /** Set once the student explicitly submitted the contest for review. */
  finalizedAt: string | null;
  elapsedDurationMs: number;
  elapsedFormatted: string;
  finalistStatus: FinalistStatus;
  finalistVerifiedAt: string | null;
  finalistVerifiedBy: string | null;
  finalistReviewNotes: string | null;
  finalistDisqualificationReason: string | null;
  totalPoints: number;
}

export interface FinisherStats {
  totalRegistered: number;
  currentlyParticipating: number;
  totalFinished: number;
  earliestFinish: string | null;
  fastestElapsedMs: number | null;
  fastestElapsedFormatted: string | null;
  verifiedFinalists: number;
}
