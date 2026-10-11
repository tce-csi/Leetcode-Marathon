import { env } from "@/lib/env";
import type { VerificationInput, VerificationOutcome, VerificationProvider } from "./types";

const LEETCODE_GRAPHQL_ENDPOINT = "https://leetcode.com/graphql";

interface RecentSubmission {
  title: string;
  titleSlug: string;
  statusDisplay: string;
  timestamp: string;
}

/**
 * Best-effort verification against LeetCode's public GraphQL endpoint.
 *
 * IMPORTANT: LeetCode does not publish a stable, officially supported API for
 * this purpose. This provider is therefore DISABLED by default and must be
 * explicitly enabled by an administrator who has reviewed and accepted the
 * relevant terms of use. When it is disabled or fails for any reason, the
 * application transparently falls back to manual review.
 */
export class LeetCodeGraphQLVerificationProvider implements VerificationProvider {
  readonly name = "leetcode-graphql";

  available(): boolean {
    return env.enableLeetcodeGraphqlProvider && env.verificationProviders.includes(this.name);
  }

  async verify(input: VerificationInput): Promise<VerificationOutcome> {
    if (!input.problemSlug) {
      return {
        provider: this.name,
        status: "UNAVAILABLE",
        reason: "No problem slug configured for this level.",
        authoritative: false,
      };
    }

    try {
      const response = await fetch(LEETCODE_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "CodeQuest/1.0 (+contest verification; contact organizer)",
        },
        body: JSON.stringify({
          query: `query recentSubmissionList($username: String!, $limit: Int!) {
            recentSubmissionList(username: $username, limit: $limit) {
              title
              titleSlug
              statusDisplay
              timestamp
            }
          }`,
          variables: { username: input.leetcodeUsername, limit: 20 },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return {
          provider: this.name,
          status: "UNAVAILABLE",
          reason: `LeetCode endpoint returned HTTP ${response.status}.`,
          authoritative: false,
        };
      }

      const payload = (await response.json()) as {
        data?: { recentSubmissionList?: RecentSubmission[] };
      };
      const submissions = payload.data?.recentSubmissionList;
      if (!Array.isArray(submissions)) {
        return {
          provider: this.name,
          status: "UNAVAILABLE",
          reason: "LeetCode returned no usable submission list (account may be private).",
          authoritative: false,
        };
      }

      const match = submissions.find(
        (s) => s.titleSlug === input.problemSlug && s.statusDisplay === "Accepted",
      );
      if (!match) {
        return {
          provider: this.name,
          status: "PENDING_REVIEW",
          reason: "No recent accepted submission found for this problem; queued for review.",
          authoritative: false,
        };
      }

      const solvedAt = new Date(Number(match.timestamp) * 1000);
      if (input.notBefore && solvedAt.getTime() < input.notBefore.getTime()) {
        return {
          provider: this.name,
          status: "PENDING_REVIEW",
          reason: "Accepted submission predates this level being unlocked; queued for review.",
          account: input.leetcodeUsername,
          problemSlug: match.titleSlug,
          verdict: match.statusDisplay,
          verifiedSolvedAt: solvedAt,
          authoritative: true,
        };
      }
      if (input.notAfter && solvedAt.getTime() > input.notAfter.getTime()) {
        return {
          provider: this.name,
          status: "PENDING_REVIEW",
          reason: "Accepted submission is after the contest window; queued for review.",
          account: input.leetcodeUsername,
          problemSlug: match.titleSlug,
          verdict: match.statusDisplay,
          verifiedSolvedAt: solvedAt,
          authoritative: true,
        };
      }

      return {
        provider: this.name,
        status: "VERIFIED",
        reason: "Accepted submission verified via LeetCode GraphQL.",
        account: input.leetcodeUsername,
        problemSlug: match.titleSlug,
        verdict: match.statusDisplay,
        verifiedSolvedAt: solvedAt,
        authoritative: true,
      };
    } catch (error) {
      return {
        provider: this.name,
        status: "UNAVAILABLE",
        reason: `Verification provider error: ${(error as Error).message}`,
        authoritative: false,
      };
    }
  }
}
