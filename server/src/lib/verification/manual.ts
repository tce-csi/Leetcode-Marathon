import type { VerificationInput, VerificationOutcome, VerificationProvider } from "./types";

/**
 * Manual verification provider.
 *
 * This is the required, always-available fallback. It never claims to have
 * verified anything: it records the evidence and hands the decision to a human
 * reviewer. Manual evidence is explicitly not treated as cryptographic proof of
 * account ownership or submission timing.
 */
export class ManualVerificationProvider implements VerificationProvider {
  readonly name = "manual";

  available(): boolean {
    return true;
  }

  async verify(_input: VerificationInput): Promise<VerificationOutcome> {
    return {
      provider: this.name,
      status: "PENDING_REVIEW",
      reason: "Queued for manual review by a contest administrator.",
      authoritative: false,
    };
  }
}
