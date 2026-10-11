/**
 * Client-side copy of the submissions service's public types (types only).
 */
import type { CodingSubmissionRow, Year } from "@/lib/types";

export interface SubmissionWithContext extends CodingSubmissionRow {
  student_name: string;
  student_roll: string;
  student_year: Year;
  leetcode_username: string;
  level_number: number;
  level_title: string;
  problem_title: string | null;
}
