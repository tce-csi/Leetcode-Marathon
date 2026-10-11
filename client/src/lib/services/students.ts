/**
 * Client-side copy of the students service's public types (types only).
 */
import type { PublicStudent } from "@/lib/types";

export interface StudentListRow extends PublicStudent {
  total_points: number;
  levels_completed: number;
  pending_reviews: number;
}
