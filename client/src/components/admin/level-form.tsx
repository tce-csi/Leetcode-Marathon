import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/controls";
import type { ContestTrackRow, Difficulty } from "@/lib/types";

export interface LevelFormValues {
  trackId: string;
  title: string;
  description: string;
  teaser: string;
  difficulty: Difficulty;
  points: number;
  assessmentMode: "NONE" | "BEFORE" | "AFTER" | "BOTH";
  requireAssessmentPass: boolean;
  passingScore: number;
  maxAttempts: number;
  requireVerifiedSubmission: boolean;
  isStarting: boolean;
  isActive: boolean;
  problem: {
    title: string;
    url: string;
    problemSlug?: string;
    difficulty: Difficulty;
  } | null;
}

export function emptyLevelValues(tracks: ContestTrackRow[]): LevelFormValues {
  return {
    trackId: tracks[0]?.id ?? "",
    title: "",
    description: "",
    teaser: "",
    difficulty: "EASY",
    points: 10,
    assessmentMode: "NONE",
    requireAssessmentPass: false,
    passingScore: 60,
    maxAttempts: 3,
    requireVerifiedSubmission: true,
    isStarting: false,
    isActive: true,
    problem: null,
  };
}

export function LevelForm({
  tracks,
  initial,
  submitLabel,
  busy,
  trackLocked,
  onSubmit,
  onCancel,
}: {
  tracks: ContestTrackRow[];
  initial: LevelFormValues;
  submitLabel: string;
  busy?: boolean;
  /** Editing an existing level: the track cannot be changed. */
  trackLocked?: boolean;
  onSubmit: (values: LevelFormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<LevelFormValues>(initial);
  const [attachProblem, setAttachProblem] = useState(Boolean(initial.problem));

  const set = <K extends keyof LevelFormValues>(key: K, value: LevelFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    const payload: LevelFormValues = {
      ...values,
      problem: attachProblem
        ? {
            title: values.problem?.title ?? "",
            url: values.problem?.url ?? "",
            problemSlug: values.problem?.problemSlug || undefined,
            difficulty: values.problem?.difficulty ?? "EASY",
          }
        : null,
    };
    onSubmit(payload);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Track">
          <Select
            value={values.trackId}
            disabled={trackLocked}
            onChange={(e) => set("trackId", e.target.value)}
          >
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name} ({track.year === 1 ? "1st" : "2nd"} year)
              </option>
            ))}
          </Select>
        </Field>
        {!trackLocked ? (
          <Field label="Level number">
            <p className="flex h-10 items-center rounded-lg border border-dashed border-border bg-surface-2/40 px-3 text-sm text-muted">
              New level will be added at the end of this track.
            </p>
          </Field>
        ) : null}
      </div>

      <Field label="Title">
        <Input value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="Two Sum" />
      </Field>

      <Field
        label="Challenge teaser"
        hint="A short, non-solution introduction shown before the LeetCode link unlocks."
      >
        <Textarea
          value={values.teaser}
          onChange={(e) => set("teaser", e.target.value)}
          placeholder="You're given a collection of numbers and a target. Can you identify the right pair efficiently?"
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What the student must solve and any hints."
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Difficulty">
          <Select value={values.difficulty} onChange={(e) => set("difficulty", e.target.value as Difficulty)}>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </Select>
        </Field>
        <Field label="Points">
          <Input type="number" min={0} value={values.points} onChange={(e) => set("points", Number(e.target.value))} />
        </Field>
        <Field label="Assessment mode">
          <Select
            value={values.assessmentMode}
            onChange={(e) => set("assessmentMode", e.target.value as LevelFormValues["assessmentMode"])}
          >
            <option value="NONE">None</option>
            <option value="BEFORE">Before</option>
            <option value="AFTER">After</option>
            <option value="BOTH">Both</option>
          </Select>
        </Field>
      </div>

      {values.assessmentMode !== "NONE" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Passing score (%)">
            <Input
              type="number"
              min={0}
              max={100}
              value={values.passingScore}
              onChange={(e) => set("passingScore", Number(e.target.value))}
            />
          </Field>
          <Field label="Max attempts">
            <Input
              type="number"
              min={1}
              value={values.maxAttempts}
              onChange={(e) => set("maxAttempts", Number(e.target.value))}
            />
          </Field>
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-4">
        <Switch
          checked={values.requireAssessmentPass}
          onChange={(v) => set("requireAssessmentPass", v)}
          label="Require passing the assessment"
          description="Level completes only after the assessment is passed."
        />
        <Switch
          checked={values.requireVerifiedSubmission}
          onChange={(v) => set("requireVerifiedSubmission", v)}
          label="Require a verified submission"
          description="A reviewer or provider must verify the solution."
        />
        <Switch
          checked={values.isStarting}
          onChange={(v) => set("isStarting", v)}
          label="Starting level"
          description="Unlocked immediately when a student begins."
        />
        <Switch
          checked={values.isActive}
          onChange={(v) => set("isActive", v)}
          label="Active"
          description="Inactive levels are hidden from students."
        />
      </div>

      <div className="rounded-xl border border-border bg-surface-2/40 p-4">
        <Switch
          checked={attachProblem}
          onChange={setAttachProblem}
          label="Attach a LeetCode problem"
          description="Links the level to an external challenge."
        />
        {attachProblem ? (
          <div className="mt-4 space-y-3">
            <Field label="Problem title">
              <Input
                value={values.problem?.title ?? ""}
                onChange={(e) =>
                  set("problem", {
                    title: e.target.value,
                    url: values.problem?.url ?? "",
                    problemSlug: values.problem?.problemSlug,
                    difficulty: values.problem?.difficulty ?? "EASY",
                  })
                }
                placeholder="Two Sum"
              />
            </Field>
            <Field label="Problem URL" hint="Must be a leetcode.com problem link.">
              <Input
                value={values.problem?.url ?? ""}
                onChange={(e) =>
                  set("problem", {
                    title: values.problem?.title ?? "",
                    url: e.target.value,
                    problemSlug: values.problem?.problemSlug,
                    difficulty: values.problem?.difficulty ?? "EASY",
                  })
                }
                placeholder="https://leetcode.com/problems/two-sum/"
              />
            </Field>
            <Field label="Slug (optional)" hint="Auto-detected from the URL if left blank.">
              <Input
                value={values.problem?.problemSlug ?? ""}
                onChange={(e) =>
                  set("problem", {
                    title: values.problem?.title ?? "",
                    url: values.problem?.url ?? "",
                    problemSlug: e.target.value,
                    difficulty: values.problem?.difficulty ?? "EASY",
                  })
                }
                placeholder="two-sum"
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button onClick={submit} loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
