import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .max(600, "URL is too long.")
  .optional()
  .or(z.literal(""));

export const submissionSchema = z
  .object({
    levelId: z.string().uuid("Invalid level."),
    submissionUrl: optionalUrl,
    screenshotPath: z.string().trim().max(600).optional().or(z.literal("")),
    note: z.string().trim().max(2000, "Note is too long.").optional().or(z.literal("")),
  })
  .refine((value) => Boolean(value.submissionUrl || value.screenshotPath || value.note), {
    message: "Provide a submission URL, a screenshot, or an explanatory note.",
    path: ["submissionUrl"],
  });

export type SubmissionInput = z.infer<typeof submissionSchema>;

export const reviewSchema = z.object({
  submissionId: z.string().uuid("Invalid submission."),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(1000, "Reason is too long.").optional().or(z.literal("")),
});

export type ReviewInput = z.infer<typeof reviewSchema>;
