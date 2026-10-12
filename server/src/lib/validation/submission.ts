import { z } from "zod";

export const submissionSchema = z.object({
  levelId: z.string().uuid("Invalid level."),
  submissionUrl: z
    .string()
    .trim()
    .min(1, "LeetCode submission URL is required.")
    .max(600, "URL is too long."),
  sourceCode: z
    .string()
    .trim()
    .min(1, "Complete solution source code is required.")
    .max(100000, "Source code is too long."),
  screenshotPath: z.string().trim().max(600).optional().or(z.literal("")),
  note: z.string().trim().max(2000, "Note is too long.").optional().or(z.literal("")),
  programmingLanguage: z.string().trim().max(50).optional().or(z.literal("")),
  codeFileName: z.string().trim().max(200).optional().or(z.literal("")),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

export const reviewSchema = z.object({
  submissionId: z.string().uuid("Invalid submission."),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(1000, "Reason is too long.").optional().or(z.literal("")),
});

export type ReviewInput = z.infer<typeof reviewSchema>;

export const adminReviewStateSchema = z.object({
  submissionId: z.string().uuid("Invalid submission."),
  reviewState: z.enum(["NOT_REVIEWED", "REVIEWED_VALID", "REVIEWED_INVALID", "FLAGGED"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type AdminReviewStateInput = z.infer<typeof adminReviewStateSchema>;

export const codeRequestSchema = z.object({
  submissionId: z.string().uuid("Invalid submission."),
});

export type CodeRequestInput = z.infer<typeof codeRequestSchema>;

export const finalistStatusSchema = z.object({
  finalistStatus: z.enum(["PROVISIONAL", "UNDER_REVIEW", "VERIFIED", "DISQUALIFIED"]),
  reviewNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  disqualificationReason: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type FinalistStatusInput = z.infer<typeof finalistStatusSchema>;
