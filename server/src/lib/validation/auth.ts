import { z } from "zod";
import { isLeetcodeProfileUrl, normalizeLeetcodeUsername } from "@/lib/normalize";

const yearSchema = z.union([z.literal(1), z.literal(2)]);

const rollNumberSchema = z
  .string()
  .trim()
  .min(2, "Roll number is too short.")
  .max(40, "Roll number is too long.")
  .regex(/^[A-Za-z0-9/_-]+$/, "Roll number may contain letters, digits, '/', '-' and '_' only.");

/**
 * Students register with their LeetCode **profile URL** (not just a username).
 * The URL must be HTTPS and must point at a user profile on leetcode.com
 * (e.g. https://leetcode.com/u/your-username/). Problem, contest and other
 * LeetCode feature URLs are rejected.
 */
const leetcodeProfileUrlSchema = z
  .string()
  .trim()
  .min(1, "LeetCode profile URL is required.")
  .refine(isLeetcodeProfileUrl, {
    message: "Enter a valid LeetCode profile URL, for example https://leetcode.com/u/your-username/",
  });

const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters.")
  .max(128, "Password is too long.");

export const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Please enter your full name.")
    .max(120, "Name is too long."),
  rollNumber: rollNumberSchema,
  year: yearSchema,
  leetcodeProfileUrl: leetcodeProfileUrlSchema,
  password: passwordSchema,
  /**
   * Acknowledgement of the contest integrity notice. Kept optional so existing
   * API clients and tests remain valid; the web form always sends it.
   */
  acceptIntegrity: z.boolean().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Legacy alias: non-null only for backward-compatible callers. */
export function leetcodeInputFromRegister(input: RegisterInput): {
  leetcodeUsername: string;
  normalizedLeetcodeUsername: string;
} {
  const normalized = normalizeLeetcodeUsername(input.leetcodeProfileUrl.trim());
  return {
    leetcodeUsername: input.leetcodeProfileUrl.trim(),
    normalizedLeetcodeUsername: normalized,
  };
}

export const studentLoginSchema = z.object({
  rollNumber: z.string().trim().min(1, "Roll number is required."),
  password: z.string().min(1, "Password is required."),
});

export const adminLoginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});