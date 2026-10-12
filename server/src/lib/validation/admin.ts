import { z } from "zod";
import { isLeetcodeProblemUrl } from "@/lib/normalize";

const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
const assessmentModeSchema = z.enum(["NONE", "BEFORE", "AFTER", "BOTH"]);
const questionTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "SHORT_TEXT",
]);
const phaseSchema = z.enum(["BEFORE", "AFTER"]);

export const levelCreateSchema = z.object({
  trackId: z.string().uuid("Invalid track."),
  // Level numbers are assigned by the backend from the track's official order;
  // any client-supplied value is intentionally ignored.
  force: z.boolean().optional().default(false),
  title: z.string().trim().min(1, "Title is required.").max(200),
  description: z.string().trim().max(3000).optional().default(""),
  teaser: z.string().trim().max(500).optional().default(""),
  difficulty: difficultySchema.default("EASY"),
  points: z.coerce.number().int().min(0).max(100000).default(10),
  orderIndex: z.coerce.number().int().min(0).max(5000).optional(),
  isActive: z.boolean().optional().default(true),
  isStarting: z.boolean().optional().default(false),
  assessmentMode: assessmentModeSchema.optional().default("NONE"),
  requireAssessmentPass: z.boolean().optional().default(false),
  passingScore: z.coerce.number().int().min(0).max(100).optional().default(60),
  maxAttempts: z.coerce.number().int().min(1).max(50).optional().default(3),
  requireVerifiedSubmission: z.boolean().optional().default(true),
  problem: z
    .object({
      title: z.string().trim().min(1).max(300),
      url: z.string().trim().url("Enter a valid URL."),
      problemSlug: z.string().trim().min(1).max(200).optional(),
      difficulty: difficultySchema.optional().default("EASY"),
    })
    .optional(),
});

export const levelUpdateSchema = levelCreateSchema.partial().extend({
  id: z.string().uuid(),
  trackId: z.string().uuid().optional(),
});

export const trackUpdateSchema = z.object({
  isActive: z.boolean(),
});

export const reorderLevelsSchema = z.object({
  trackId: z.string().uuid(),
  order: z
    .array(z.object({ id: z.string().uuid(), orderIndex: z.coerce.number().int().min(0) }))
    .max(500),
});

export const questionCreateSchema = z
  .object({
    levelId: z.string().uuid("Invalid level."),
    questionText: z.string().trim().min(1, "Question text is required.").max(3000),
    questionType: questionTypeSchema.default("SINGLE_CHOICE"),
    phase: phaseSchema.default("BEFORE"),
    orderIndex: z.coerce.number().int().min(0).max(5000).optional().default(0),
    points: z.coerce.number().int().min(0).max(1000).optional().default(1),
    correctText: z.string().trim().max(1000).optional().or(z.literal("")),
    explanation: z.string().trim().max(3000).optional().default(""),
    variantGroup: z.string().trim().max(100).optional().or(z.literal("")),
    isActive: z.boolean().optional().default(true),
    // Optional character bounds for SHORT_TEXT questions. When absent the
    // server-default bounds (1..4000) apply.
    minLength: z.coerce.number().int().min(1).max(4000).optional(),
    maxLength: z.coerce.number().int().min(1).max(4000).optional(),
    options: z
      .array(
        z.object({
          optionText: z.string().trim().min(1).max(1000),
          isCorrect: z.boolean().optional().default(false),
        }),
      )
      .max(20)
      .optional()
      .default([]),
  })
  .refine(
    (value) => {
      if (value.questionType === "SHORT_TEXT") return true;
      const correct = value.options.filter((o) => o.isCorrect).length;
      if (value.questionType === "MULTIPLE_CHOICE") return correct >= 1;
      return correct === 1;
    },
    {
      message: "Single-choice and true/false questions need exactly one correct option.",
      path: ["options"],
    },
  )
  .refine(
    (value) => {
      if (value.minLength === undefined && value.maxLength === undefined) return true;
      const min = value.minLength ?? 1;
      const max = value.maxLength ?? 4000;
      return min <= max;
    },
    { message: "Minimum length must not exceed the maximum length.", path: ["minLength"] },
  );

export const questionUpdateSchema = z
  .object({
    id: z.string().uuid(),
    questionText: z.string().trim().min(1).max(3000).optional(),
    questionType: questionTypeSchema.optional(),
    phase: phaseSchema.optional(),
    orderIndex: z.coerce.number().int().min(0).max(5000).optional(),
    points: z.coerce.number().int().min(0).max(1000).optional(),
    correctText: z.string().trim().max(1000).optional().or(z.literal("")),
    explanation: z.string().trim().max(3000).optional(),
    variantGroup: z.string().trim().max(100).optional().or(z.literal("")),
    isActive: z.boolean().optional(),
    minLength: z.coerce.number().int().min(1).max(4000).optional(),
    maxLength: z.coerce.number().int().min(1).max(4000).optional(),
    options: z
      .array(
        z.object({
          optionText: z.string().trim().min(1).max(1000),
          isCorrect: z.boolean().optional().default(false),
        }),
      )
      .max(20)
      .optional(),
  })
  .refine(
    (value) => {
      if (value.minLength === undefined && value.maxLength === undefined) return true;
      const min = value.minLength ?? 1;
      const max = value.maxLength ?? 4000;
      return min <= max;
    },
    { message: "Minimum length must not exceed the maximum length.", path: ["minLength"] },
  );

export const contestUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  registrationOpenAt: z.string().datetime().nullable().optional(),
  registrationCloseAt: z.string().datetime().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  gracePeriodMinutes: z.coerce.number().int().min(0).max(100000).optional(),
  registrationOpen: z.boolean().optional(),
  isActive: z.boolean().optional(),
  leaderboardVisible: z.boolean().optional(),
  allowLateSubmissions: z.boolean().optional(),
  allowAdminOverride: z.boolean().optional(),
  requireSubmissionAfterUnlock: z.boolean().optional(),
  verificationMode: z.enum(["MANUAL", "AUTOMATIC", "HYBRID"]).optional(),
  rankingRule: z
    .enum(["POINTS_LEVELS_TIME", "LEVELS_POINTS_TIME", "POINTS_TIME"])
    .optional(),
});

export const studentAdminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setActive"), studentId: z.string().uuid(), value: z.boolean() }),
  z.object({ action: z.literal("resetProgress"), studentId: z.string().uuid() }),
  z.object({
    action: z.literal("adjustPoints"),
    studentId: z.string().uuid(),
    points: z.coerce.number().int().min(-100000).max(100000),
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("grantLevel"),
    studentId: z.string().uuid(),
    levelId: z.string().uuid(),
  }),
]);

export const studentIdentityUpdateSchema = z
  .object({
    studentId: z.string().uuid(),
    fullName: z.string().trim().min(1).max(200).optional(),
    rollNumber: z.string().trim().min(1).max(50).optional(),
    year: z.union([z.literal(1), z.literal(2)]).optional(),
    leetcodeProfileUrl: z.string().trim().url("Enter a valid URL.").optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.rollNumber !== undefined ||
      value.year !== undefined ||
      value.leetcodeProfileUrl !== undefined,
    { message: "Provide at least one field to update." },
  );

export { isLeetcodeProblemUrl };

export type LevelCreateInput = z.infer<typeof levelCreateSchema>;
export type LevelUpdateInput = z.infer<typeof levelUpdateSchema>;
export type TrackUpdateInput = z.infer<typeof trackUpdateSchema>;
export type QuestionCreateInput = z.infer<typeof questionCreateSchema>;
export type QuestionUpdateInput = z.infer<typeof questionUpdateSchema>;
export type ContestUpdateInput = z.infer<typeof contestUpdateSchema>;
export type StudentAdminActionInput = z.infer<typeof studentAdminActionSchema>;
export type StudentIdentityUpdateInputFields = z.infer<typeof studentIdentityUpdateSchema>;
