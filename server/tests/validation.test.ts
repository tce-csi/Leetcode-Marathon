import { describe, expect, it } from "vitest";
import { registerSchema, studentLoginSchema, adminLoginSchema } from "@/lib/validation/auth";
import {
  contestUpdateSchema,
  levelCreateSchema,
  questionCreateSchema,
  studentAdminActionSchema,
} from "@/lib/validation/admin";

describe("registerSchema", () => {
  it("accepts a valid payload and trims values", () => {
    const parsed = registerSchema.parse({
      fullName: "  Alice First  ",
      rollNumber: " CS/01 ",
      year: 1,
      leetcodeProfileUrl: "https://leetcode.com/u/Alice_LC/",
      password: "secret123",
    });
    expect(parsed.fullName).toBe("Alice First");
    expect(parsed.rollNumber).toBe("CS/01");
  });

  it("accepts a www. prefix and normalises the profile URL", () => {
    const parsed = registerSchema.parse({
      fullName: "Alice",
      rollNumber: "CS01",
      year: 1,
      leetcodeProfileUrl: "https://www.leetcode.com/u/alice-123/",
      password: "secret123",
    });
    expect(parsed.leetcodeProfileUrl).toBe("https://www.leetcode.com/u/alice-123/");
  });

  it("rejects non-HTTPS profile links", () => {
    const result = registerSchema.safeParse({
      fullName: "Alice",
      rollNumber: "CS01",
      year: 1,
      leetcodeProfileUrl: "http://leetcode.com/u/alice/",
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-leetcode hosts", () => {
    const result = registerSchema.safeParse({
      fullName: "Alice",
      rollNumber: "CS01",
      year: 1,
      leetcodeProfileUrl: "https://hackerrank.com/alice",
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects LeetCode problem URLs (not profiles)", () => {
    const result = registerSchema.safeParse({
      fullName: "Alice",
      rollNumber: "CS01",
      year: 1,
      leetcodeProfileUrl: "https://leetcode.com/problems/two-sum/",
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range year", () => {
    const result = registerSchema.safeParse({
      fullName: "Alice",
      rollNumber: "CS01",
      year: 3,
      leetcodeProfileUrl: "https://leetcode.com/u/alice/",
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects roll numbers with invalid characters", () => {
    const result = registerSchema.safeParse({
      fullName: "Alice",
      rollNumber: "CS 01!",
      year: 1,
      leetcodeProfileUrl: "https://leetcode.com/u/alice/",
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short passwords", () => {
    expect(
      registerSchema.safeParse({
        fullName: "Alice",
        rollNumber: "CS01",
        year: 1,
        leetcodeProfileUrl: "https://leetcode.com/u/alice/",
        password: "123",
      }).success,
    ).toBe(false);
  });
});

describe("login schemas", () => {
  it("requires a roll number and password", () => {
    expect(studentLoginSchema.safeParse({ rollNumber: "", password: "" }).success).toBe(false);
    expect(studentLoginSchema.safeParse({ rollNumber: "CS01", password: "x" }).success).toBe(true);
  });

  it("validates the admin email", () => {
    expect(adminLoginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(adminLoginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
});

describe("levelCreateSchema", () => {
  const base = {
    trackId: "11111111-1111-4111-8111-111111111111",
    levelNumber: "1",
    title: "Two Sum",
  };

  it("applies defaults and coerces numbers", () => {
    const parsed = levelCreateSchema.parse(base);
    expect(parsed.levelNumber).toBe(1);
    expect(parsed.points).toBe(10);
    expect(parsed.difficulty).toBe("EASY");
    expect(parsed.assessmentMode).toBe("NONE");
    expect(parsed.requireVerifiedSubmission).toBe(true);
  });

  it("rejects a non-uuid track", () => {
    expect(levelCreateSchema.safeParse({ ...base, trackId: "abc" }).success).toBe(false);
  });

  it("validates an optional problem URL", () => {
    const bad = levelCreateSchema.safeParse({
      ...base,
      problem: { title: "P", url: "not-a-url" },
    });
    expect(bad.success).toBe(false);
    const good = levelCreateSchema.safeParse({
      ...base,
      problem: { title: "P", url: "https://leetcode.com/problems/two-sum/" },
    });
    expect(good.success).toBe(true);
  });
});

describe("questionCreateSchema", () => {
  const base = {
    levelId: "11111111-1111-4111-8111-111111111111",
    questionText: "Which structure?",
  };

  it("requires exactly one correct option for single choice", () => {
    const noneCorrect = questionCreateSchema.safeParse({
      ...base,
      questionType: "SINGLE_CHOICE",
      options: [
        { optionText: "A", isCorrect: false },
        { optionText: "B", isCorrect: false },
      ],
    });
    expect(noneCorrect.success).toBe(false);

    const oneCorrect = questionCreateSchema.safeParse({
      ...base,
      questionType: "SINGLE_CHOICE",
      options: [
        { optionText: "A", isCorrect: true },
        { optionText: "B", isCorrect: false },
      ],
    });
    expect(oneCorrect.success).toBe(true);
  });

  it("accepts multiple correct options for multiple choice", () => {
    const result = questionCreateSchema.safeParse({
      ...base,
      questionType: "MULTIPLE_CHOICE",
      options: [
        { optionText: "A", isCorrect: true },
        { optionText: "B", isCorrect: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("requires an expected answer for short text", () => {
    expect(
      questionCreateSchema.safeParse({ ...base, questionType: "SHORT_TEXT" }).success,
    ).toBe(false);
    expect(
      questionCreateSchema.safeParse({
        ...base,
        questionType: "SHORT_TEXT",
        correctText: "hash map",
      }).success,
    ).toBe(true);
  });
});

describe("contestUpdateSchema", () => {
  it("accepts ISO datetimes and nulls", () => {
    const result = contestUpdateSchema.safeParse({
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: null,
      isActive: true,
      rankingRule: "POINTS_LEVELS_TIME",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-ISO datetime and unknown ranking rule", () => {
    expect(contestUpdateSchema.safeParse({ startAt: "2026-01-01" }).success).toBe(false);
    expect(
      contestUpdateSchema.safeParse({ rankingRule: "RANDOM" }).success,
    ).toBe(false);
  });
});

describe("studentAdminActionSchema", () => {
  it("accepts valid discriminated actions", () => {
    expect(
      studentAdminActionSchema.safeParse({
        action: "setActive",
        studentId: "11111111-1111-4111-8111-111111111111",
        value: false,
      }).success,
    ).toBe(true);
    expect(
      studentAdminActionSchema.safeParse({
        action: "adjustPoints",
        studentId: "11111111-1111-4111-8111-111111111111",
        points: 10,
        reason: "bonus",
      }).success,
    ).toBe(true);
  });

  it("rejects adjustPoints without a reason", () => {
    expect(
      studentAdminActionSchema.safeParse({
        action: "adjustPoints",
        studentId: "11111111-1111-4111-8111-111111111111",
        points: 10,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(
      studentAdminActionSchema.safeParse({
        action: "nuke",
        studentId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });
});
