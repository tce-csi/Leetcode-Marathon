export const LEETCODE_SUBMISSION_URL_MESSAGE =
  "Please enter a valid LeetCode submission detail URL, for example: https://leetcode.com/submissions/detail/2165837360/";

const SUBMISSION_DETAIL_PATH_RE = /^\/submissions\/detail\/(\d+)\/?$/;

export interface LeetcodeSubmissionDetail {
  id: string;
  url: string;
}

export function parseLeetcodeSubmissionDetailUrl(
  input: string | null | undefined,
): LeetcodeSubmissionDetail | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port) return null;
  if (parsed.search) return null;
  if (parsed.hash) return null;

  const host = parsed.hostname.toLowerCase();
  if (host !== "leetcode.com" && host !== "www.leetcode.com") return null;

  const match = SUBMISSION_DETAIL_PATH_RE.exec(parsed.pathname);
  if (!match) return null;

  const id = match[1]!;
  return { id, url: `https://leetcode.com/submissions/detail/${id}/` };
}

export function isLeetcodeSubmissionDetailUrl(url: string): boolean {
  return parseLeetcodeSubmissionDetailUrl(url) !== null;
}
