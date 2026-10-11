import { env } from "@/lib/env";
import { LeetCodeGraphQLVerificationProvider } from "./leetcode-graphql";
import { ManualVerificationProvider } from "./manual";
import type { VerificationInput, VerificationOutcome, VerificationProvider } from "./types";

const registry: Record<string, VerificationProvider> = {
  manual: new ManualVerificationProvider(),
  "leetcode-graphql": new LeetCodeGraphQLVerificationProvider(),
};

export function getProvider(name: string): VerificationProvider | null {
  return registry[name] ?? null;
}

/** Providers that are configured and currently usable, in priority order. */
export function getEnabledProviders(): VerificationProvider[] {
  return env.verificationProviders
    .map((name) => registry[name])
    .filter((p): p is VerificationProvider => Boolean(p && p.available()));
}

export interface VerificationRun {
  outcome: VerificationOutcome;
  provider: VerificationProvider | null;
}

/**
 * Runs the configured providers in order and returns the first non-`UNAVAILABLE`
 * outcome. Always falls back to manual verification so the platform remains
 * fully usable when no automatic provider is available.
 */
export async function runVerification(input: VerificationInput): Promise<VerificationRun> {
  const providers = getEnabledProviders();
  for (const provider of providers) {
    const outcome = await provider.verify(input);
    if (outcome.status !== "UNAVAILABLE") {
      return { outcome, provider };
    }
    console.warn(`[verification] provider "${provider.name}" unavailable: ${outcome.reason}`);
  }
  const manual = new ManualVerificationProvider();
  return { outcome: await manual.verify(input), provider: manual };
}

export type { VerificationInput, VerificationOutcome, VerificationProvider } from "./types";
