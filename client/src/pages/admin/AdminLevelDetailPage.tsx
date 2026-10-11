import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  LevelForm,
  type LevelFormValues,
} from "@/components/admin/level-form";
import {
  QuestionForm,
  emptyQuestionValues,
  type QuestionFormValues,
} from "@/components/admin/question-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api-client";
import type { AdminLevelRow, AdminQuestion } from "@/lib/services/admin";
import type { ContestTrackRow, QuestionPhase } from "@/lib/types";

interface LevelsResponse {
  tracks: ContestTrackRow[];
  levels: AdminLevelRow[];
}

export default function AdminLevelDetailPage() {
  const params = useParams<{ id: string }>();
  const levelId = params.id;

  const [tracks, setTracks] = useState<ContestTrackRow[]>([]);
  const [level, setLevel] = useState<AdminLevelRow | null>(null);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [creatingPhase, setCreatingPhase] = useState<QuestionPhase | null>(null);
  const [toDelete, setToDelete] = useState<AdminQuestion | null>(null);

  const load = useCallback(async () => {
    try {
      const [levelsRes, questionsRes] = await Promise.all([
        api.get<LevelsResponse>("/api/admin/levels"),
        api.get<{ questions: AdminQuestion[] }>(`/api/admin/questions?levelId=${levelId}`),
      ]);
      setTracks(levelsRes.tracks);
      setLevel(levelsRes.levels.find((l) => l.id === levelId) ?? null);
      setQuestions(questionsRes.questions);
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to load the level.");
    } finally {
      setLoading(false);
    }
  }, [levelId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveLevel = async (values: LevelFormValues) => {
    setBusy(true);
    try {
      await api.patch(`/api/admin/levels/${levelId}`, values);
      toast.success("Level updated.");
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not update the level.");
    } finally {
      setBusy(false);
    }
  };

  const createQuestion = async (values: QuestionFormValues) => {
    setBusy(true);
    try {
      await api.post("/api/admin/questions", { ...values, levelId });
      toast.success("Question added.");
      setCreatingPhase(null);
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not add the question.");
    } finally {
      setBusy(false);
    }
  };

  const updateQuestion = async (values: QuestionFormValues) => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/questions/${editing.id}`, values);
      toast.success("Question updated.");
      setEditing(null);
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not update the question.");
    } finally {
      setBusy(false);
    }
  };

  const deleteQuestion = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/questions/${toDelete.id}`);
      toast.success("Question deleted.");
      setToDelete(null);
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not delete the question.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoader label="Loading level" />;
  if (!level) {
    return (
      <EmptyState
        title="Level not found"
        action={
          <Link to="/admin/levels">
            <Button variant="secondary">Back to levels</Button>
          </Link>
        }
      />
    );
  }

  const initialLevel: LevelFormValues = {
    trackId: level.track_id,
    levelNumber: level.level_number,
    title: level.title,
    description: level.description,
    teaser: level.teaser,
    difficulty: level.difficulty,
    points: level.points,
    assessmentMode: level.assessment_mode,
    requireAssessmentPass: level.require_assessment_pass,
    passingScore: level.passing_score,
    maxAttempts: level.max_attempts,
    requireVerifiedSubmission: level.require_verified_submission,
    isStarting: level.is_starting,
    isActive: level.is_active,
    problem: level.problem_title
      ? {
          title: level.problem_title,
          url: level.problem_url ?? "",
          problemSlug: level.problem_slug ?? undefined,
          difficulty: level.difficulty,
        }
      : null,
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/levels"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Levels
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold tracking-tight">{level.title}</h1>
        <p className="mt-1 text-sm text-muted">
          Level {level.level_number} · {level.year === 1 ? "1st Year" : "2nd Year"} track
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Level settings</CardTitle>
        </CardHeader>
        <CardContent>
          <LevelForm
            tracks={tracks}
            initial={initialLevel}
            submitLabel="Save changes"
            busy={busy}
            onSubmit={saveLevel}
          />
        </CardContent>
      </Card>

      {(["BEFORE", "AFTER"] as QuestionPhase[]).map((phase) => {
        const phaseQuestions = questions.filter((q) => q.phase === phase);
        return (
          <Card key={phase}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{phase === "BEFORE" ? "Before-challenge questions" : "After-challenge questions"}</CardTitle>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCreatingPhase(phase)}
                >
                  <Plus className="size-4" /> Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {phaseQuestions.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted">No questions in this phase.</p>
              ) : (
                phaseQuestions.map((question) => (
                  <div
                    key={question.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{question.question_text}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Badge variant="neutral">{question.question_type.replace("_", " ")}</Badge>
                        <span>{question.points} pts</span>
                        <span>{question.options.length} options</span>
                        {!question.is_active ? <Badge variant="danger">Inactive</Badge> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(question)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setToDelete(question)}
                        aria-label="Delete question"
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit question"
        className="sm:max-w-2xl"
      >
        {editing ? (
          <QuestionForm
            initial={{
              questionText: editing.question_text,
              questionType: editing.question_type as QuestionFormValues["questionType"],
              phase: editing.phase as QuestionPhase,
              points: editing.points,
              correctText: editing.correct_text ?? "",
              explanation: editing.explanation,
              variantGroup: editing.variant_group ?? "",
              isActive: editing.is_active,
              options: editing.options.map((o) => ({ optionText: o.option_text, isCorrect: o.is_correct })),
            }}
            submitLabel="Save question"
            busy={busy}
            onSubmit={updateQuestion}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(creatingPhase)}
        onClose={() => setCreatingPhase(null)}
        title="Add question"
        description={creatingPhase ? `${creatingPhase} phase` : undefined}
        className="sm:max-w-2xl"
      >
        {creatingPhase ? (
          <QuestionForm
            initial={{ ...emptyQuestionValues, phase: creatingPhase }}
            submitLabel="Add question"
            busy={busy}
            onSubmit={createQuestion}
            onCancel={() => setCreatingPhase(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Delete question"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteQuestion} loading={busy}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This question and its options will be removed.</p>
      </Dialog>
    </div>
  );
}
