/**
 * Canonical normalisation rules. These are applied consistently before storage
 * and before lookups so that "CS 01", "cs01" and "Cs01 " are treated as one.
 */

export function normalizeRollNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeLeetcodeUsername(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "");
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/** Extracts the problem slug from a LeetCode problem URL, if present. */
export function extractLeetcodeSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)leetcode\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/problems\/([^/]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isLeetcodeProblemUrl(url: string): boolean {
  return extractLeetcodeSlug(url) !== null;
}

const LEETCODE_USERNAME_RE = /^[A-Za-z0-9_-]{3,30}$/;

/** Path segments that belong to LeetCode features rather than user profiles. */
const RESERVED_SEGMENTS = new Set([
  "problems",
  "problem",
  "contest",
  "explore",
  "studyplan",
  "discuss",
  "store",
  "subscription",
  "interview",
  "company",
  "u",
  "accounts",
  "api",
  "graphql",
  "tag",
  "tags",
]);

export interface LeetcodeProfile {
  /** Canonical profile URL: https://leetcode.com/u/<username>/ */
  profileUrl: string;
  /** Username exactly as it appears on LeetCode. */
  username: string;
  /** Lower-cased identity used for uniqueness checks. */
  normalizedUsername: string;
}

/**
 * Parses a LeetCode **profile** URL (not a problem URL).
 *
 * Accepts HTTPS URLs on leetcode.com of the form:
 *   - https://leetcode.com/u/<username>/
 *   - https://www.leetcode.com/u/<username>
 *   - https://leetcode.com/<username>/            (legacy single-segment form)
 *
 * Rejects other hosts, non-HTTPS schemes, problem/contest URLs, and usernames
 * that contain characters LeetCode does not allow.
 */
export function parseLeetcodeProfileUrl(input: string): LeetcodeProfile | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "leetcode.com") return null;

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return null;

  let candidate: string | null = null;
  if (segments.length === 2) {
    if (segments[0]!.toLowerCase() !== "u") return null;
    candidate = segments[1]!;
  } else if (!RESERVED_SEGMENTS.has(segments[0]!.toLowerCase())) {
    candidate = segments[0]!;
  }

  if (!candidate) return null;
  const decoded = decodeURIComponent(candidate);
  if (!LEETCODE_USERNAME_RE.test(decoded)) return null;

  return {
    profileUrl: `https://leetcode.com/u/${decoded}/`,
    username: decoded,
    normalizedUsername: normalizeLeetcodeUsername(decoded),
  };
}

export function isLeetcodeProfileUrl(url: string): boolean {
  return parseLeetcodeProfileUrl(url) !== null;
}
