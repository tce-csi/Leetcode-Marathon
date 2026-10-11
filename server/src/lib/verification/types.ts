export interface VerificationInput {
  studentId: string;
  levelId: string;
  /** The LeetCode problem slug assigned to the level, if known. */
  problemSlug: string | null;
  /** The LeetCode username the student registered with. */
  leetcodeUsername: string;
  /** Optional submission URL supplied by the student. */
  submissionUrl?: string | null;
  /** Contest timezone used for window/date comparisons. */
  contestTimezone: string;
  /** The earliest acceptable solving instant (level unlock), if applicable. */
  notBefore?: Date | null;
  /** Contest end instant, if applicable. */
  notAfter?: Date | null;
}

export type VerificationStatus = "VERIFIED" | "REJECTED" | "PENDING_REVIEW" | "UNAVAILABLE";

export interface VerificationOutcome {
  provider: string;
  status: VerificationStatus;
  reason: string;
  verdict?: string | null;
  problemSlug?: string | null;
  account?: string | null;
  verifiedSolvedAt?: Date | null;
  /** True when the outcome is based on an independently verifiable source. */
  authoritative: boolean;
}

export interface VerificationProvider {
  readonly name: string;
  /** Whether the provider can currently run (configuration + dependencies). */
  available(): boolean;
  verify(input: VerificationInput): Promise<VerificationOutcome>;
}
