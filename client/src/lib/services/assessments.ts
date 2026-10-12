/**
 * Client-side copy of the assessments service's public types (types only).
 */
import type { AssessmentMode, QuestionPhase, QuestionType } from "@/lib/types";

export interface QuestionOptionView {
  id: string;
  text: string;
}

export interface AssessmentQuestionView {
  id: string;
  text: string;
  type: QuestionType;
  points: number;
  options: QuestionOptionView[];
  /** Character bounds for SHORT_TEXT questions (null when the server defaults apply). */
  minLength: number | null;
  maxLength: number | null;
}

export interface PhaseState {
  phase: QuestionPhase;
  questions: AssessmentQuestionView[];
  attemptsUsed: number;
  maxAttempts: number;
  remainingAttempts: number;
  passed: boolean;
  /** Whether this phase's single submission is locked in (one-submission policy). */
  submitted: boolean;
  submittedAt: string | null;
  latestAttempt: {
    id: string;
    score: number;
    maxScore: number;
    passed: boolean;
    status: string;
    submittedAt: string | null;
  } | null;
}

export interface AssessmentState {
  mode: AssessmentMode;
  requirePass: boolean;
  passingScore: number;
  phases: PhaseState[];
  beforeSubmitted: boolean;
  linkUnlocked: boolean;
}

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean | null;
  pointsAwarded: number;
  correctOptionIds: string[];
  correctText: string | null;
  explanation: string;
}

export interface SubmitResult {
  attemptId: string;
  status: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  requiresManualGrading: boolean;
  answers: GradedAnswer[];
  nextLevel?: import("@/lib/types").RoadmapLevel | null;
  completed?: boolean;
  totalLevels?: number;
}

export interface AttemptAnswerDetail {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  isCorrect: boolean | null;
  pointsAwarded: number;
  selectedOptionIds: string[];
  selectedOptions: { id: string; text: string }[];
  textAnswer: string | null;
}

export interface AttemptDetail {
  attempt: import("@/lib/types").AssessmentAttemptRow;
  answers: AttemptAnswerDetail[];
}
