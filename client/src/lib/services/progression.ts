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
}
