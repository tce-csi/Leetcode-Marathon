/**
 * Client-side copy of the admin service's public types (types only).
 */
import type { LevelRow } from "@/lib/types";

export interface AdminStats {
  totalStudents: number;
  firstYear: number;
  secondYear: number;
  activeStudents: number;
  participants: number;
  totalFinishers: number;
  pendingFinalists: number;
  verifiedFinalists: number;
  flaggedParticipants: number;
  totalSubmissions: number;
  verifiedSubmissions: number;
  completedLevels: number;
  totalLevels: number;
  completionRate: number;
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

export interface AdminLevelRow extends LevelRow {
  year: number;
  problem_title: string | null;
  problem_url: string | null;
  problem_slug: string | null;
  question_count: number;
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
  min_length: number | null;
  max_length: number | null;
  is_active: boolean;
  options: { id: string; option_text: string; is_correct: boolean; order_index: number }[];
}
