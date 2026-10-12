/**
 * Client-side copy of the progression service's public types (types only).
 */
export interface ProgressSummary {
  totalPoints: number;
  levelsCompleted: number;
  totalLevels: number;
  percent: number;
  pendingSubmissions: number;
  currentLevelId: string | null;
  currentLevelNumber: number | null;
  lastScoreAt: string | null;
  /** ISO UTC string set once the student completes every level. Null otherwise. */
  finishedAt: string | null;
  /** UTC time when the student's contest effectively started. */
  contestStartedAt: string | null;
  /** Milliseconds elapsed from effective start to finish. */
  elapsedDurationMs: number | null;
  /** Human-readable HH:MM:SS elapsed time, or null. */
  elapsedFormatted: string | null;
}
