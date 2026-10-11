import { z } from "zod";

export const assessmentSubmitSchema = z.object({
  levelId: z.string().uuid("Invalid level."),
  phase: z.enum(["BEFORE", "AFTER"]),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid("Invalid question."),
        selectedOptionIds: z.array(z.string().uuid()).max(30).optional(),
        textAnswer: z.string().max(4000).optional(),
      }),
    )
    .min(1, "Answer at least one question."),
});

export type AssessmentSubmitInput = z.infer<typeof assessmentSubmitSchema>;
