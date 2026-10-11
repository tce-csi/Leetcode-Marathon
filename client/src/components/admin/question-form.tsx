import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { QuestionPhase, QuestionType } from "@/lib/types";

export interface QuestionOptionValue {
  optionText: string;
  isCorrect: boolean;
}

export interface QuestionFormValues {
  questionText: string;
  questionType: QuestionType;
  phase: QuestionPhase;
  points: number;
  correctText: string;
  explanation: string;
  variantGroup: string;
  isActive: boolean;
  options: QuestionOptionValue[];
}

export const emptyQuestionValues: QuestionFormValues = {
  questionText: "",
  questionType: "SINGLE_CHOICE",
  phase: "BEFORE",
  points: 1,
  correctText: "",
  explanation: "",
  variantGroup: "",
  isActive: true,
  options: [
    { optionText: "", isCorrect: true },
    { optionText: "", isCorrect: false },
  ],
};

export function QuestionForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: QuestionFormValues;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: QuestionFormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<QuestionFormValues>(initial);
  const isText = values.questionType === "SHORT_TEXT";
  const singleCorrect = values.questionType === "SINGLE_CHOICE" || values.questionType === "TRUE_FALSE";

  const setOption = (index: number, patch: Partial<QuestionOptionValue>) =>
    setValues((prev) => ({
      ...prev,
      options: prev.options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    }));

  const toggleCorrect = (index: number, checked: boolean) =>
    setValues((prev) => ({
      ...prev,
      options: prev.options.map((option, i) => {
        if (i === index) return { ...option, isCorrect: checked };
        if (singleCorrect && checked) return { ...option, isCorrect: false };
        return option;
      }),
    }));

  const submit = () => {
    const options = isText
      ? []
      : values.options.filter((option) => option.optionText.trim() !== "");
    onSubmit({
      ...values,
      options,
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Question text">
        <Textarea
          value={values.questionText}
          onChange={(e) => setValues((prev) => ({ ...prev, questionText: e.target.value }))}
          placeholder="Which data structure gives O(1) average lookup?"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type">
          <Select
            value={values.questionType}
            onChange={(e) => setValues((prev) => ({ ...prev, questionType: e.target.value as QuestionType }))}
          >
            <option value="SINGLE_CHOICE">Single choice</option>
            <option value="MULTIPLE_CHOICE">Multiple choice</option>
            <option value="TRUE_FALSE">True / False</option>
            <option value="SHORT_TEXT">Short text</option>
          </Select>
        </Field>
        <Field label="Phase">
          <Select
            value={values.phase}
            onChange={(e) => setValues((prev) => ({ ...prev, phase: e.target.value as QuestionPhase }))}
          >
            <option value="BEFORE">Before</option>
            <option value="AFTER">After</option>
          </Select>
        </Field>
        <Field label="Points">
          <Input
            type="number"
            min={0}
            value={values.points}
            onChange={(e) => setValues((prev) => ({ ...prev, points: Number(e.target.value) }))}
          />
        </Field>
      </div>

      {isText ? (
        <Field label="Expected answer" hint="Grading is case-insensitive and trims whitespace.">
          <Input
            value={values.correctText}
            onChange={(e) => setValues((prev) => ({ ...prev, correctText: e.target.value }))}
            placeholder="hash map"
          />
        </Field>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-strong">Options</p>
          {values.options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Checkbox
                checked={option.isCorrect}
                onChange={(checked) => toggleCorrect(index, checked)}
              />
              <Input
                value={option.optionText}
                onChange={(e) => setOption(index, { optionText: e.target.value })}
                placeholder={`Option ${index + 1}`}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setValues((prev) => ({
                    ...prev,
                    options: prev.options.filter((_, i) => i !== index),
                  }))
                }
                aria-label="Remove option"
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                options: [...prev.options, { optionText: "", isCorrect: false }],
              }))
            }
          >
            <Plus className="size-4" /> Add option
          </Button>
        </div>
      )}

      <Field label="Explanation (shown after grading)">
        <Textarea
          value={values.explanation}
          onChange={(e) => setValues((prev) => ({ ...prev, explanation: e.target.value }))}
          placeholder="Why the correct answer is correct."
        />
      </Field>

      <Field
        label="Variant group (optional)"
        hint="Questions sharing a group are interchangeable variants; each student sees one."
      >
        <Input
          value={values.variantGroup}
          onChange={(e) => setValues((prev) => ({ ...prev, variantGroup: e.target.value }))}
          placeholder="e.g. two-sum-before"
        />
      </Field>

      <Switch
        checked={values.isActive}
        onChange={(v) => setValues((prev) => ({ ...prev, isActive: v }))}
        label="Active"
        description="Inactive questions are not shown to students."
      />

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
