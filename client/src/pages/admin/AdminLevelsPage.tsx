import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import {
  LevelForm,
  emptyLevelValues,
  type LevelFormValues,
} from "@/components/admin/level-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api-client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { difficultyMeta } from "@/lib/format";
import type { AdminLevelRow } from "@/lib/services/admin";
import type { ContestRow, ContestTrackRow } from "@/lib/types";

interface LevelsResponse {
  tracks: ContestTrackRow[];
  levels: AdminLevelRow[];
  contest: ContestRow;
}

interface LevelMutationResponse {
  level: AdminLevelRow;
  levels: AdminLevelRow[];
  totalLevels: number;
}

interface LevelDeleteResponse {
  deleted: true;
  archived: boolean;
  levels: AdminLevelRow[];
  totalLevels: number;
}

interface LevelImpact {
  contestStarted: boolean;
  contestState: string;
  participants: number;
  submissions: number;
  activeProgress: number;
  requiresConfirmation: boolean;
}

function isConfirmationRequired(error: unknown): error is { code: string; details?: LevelImpact } {
  return isApiError(error) && error.code === "LEVEL_CHANGE_CONFIRMATION_REQUIRED";
}

function ImpactSummary({ impact }: { impact: LevelImpact }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="text-sm text-muted">
          This contest is <span className="font-medium text-foreground">{impact.contestState.toLowerCase()}</span> with{" "}
          <span className="font-medium text-foreground">{impact.participants}</span> registered participant
          {impact.participants === 1 ? "" : "s"}. Changing the question set now affects their competition.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-border px-3 py-2">
          <dt className="text-xs text-muted">Submissions</dt>
          <dd className="font-semibold">{impact.submissions}</dd>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <dt className="text-xs text-muted">Levels in progress</dt>
          <dd className="font-semibold">{impact.activeProgress}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        Existing submissions, source code, completion timestamps and finisher results are preserved.
      </p>
    </div>
  );
}

export default function AdminLevelsPage() {
  const [data, setData] = useState<LevelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<AdminLevelRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<LevelImpact | null>(null);
  const [pendingCreate, setPendingCreate] = useState<LevelFormValues | null>(null);
  const [createImpact, setCreateImpact] = useState<LevelImpact | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<LevelsResponse>("/api/admin/levels");
      setData(result);
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Unable to load levels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Silent background refresh so admin changes elsewhere show up without a reload.
  const refresh = useCallback(async () => {
    try {
      const result = await api.get<LevelsResponse>("/api/admin/levels");
      setData(result);
    } catch {
      // transient background failures keep the last good data
    }
  }, []);

  useAutoRefresh(refresh, 8000);

  // Applies the authoritative level order returned by a create/delete mutation,
  // so the list, numbering and totals update immediately without a page refresh.
  const applyLevels = useCallback((levels: AdminLevelRow[]) => {
    setData((prev) => (prev ? { ...prev, levels } : prev));
  }, []);

  const handleCreate = async (values: LevelFormValues, force = false) => {
    setBusy(true);
    try {
      const result = await api.post<LevelMutationResponse>("/api/admin/levels", { ...values, force });
      applyLevels(result.levels);
      toast.success(`Level created as level ${result.level.level_number}.`);
      setShowCreate(false);
      setPendingCreate(null);
      setCreateImpact(null);
    } catch (error) {
      if (isConfirmationRequired(error)) {
        setShowCreate(false);
        setPendingCreate(values);
        setCreateImpact(error.details ?? null);
      } else {
        toast.error(isApiError(error) ? error.message : "Could not create the level.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (force = false) => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const result = await api.del<LevelDeleteResponse>(
        `/api/admin/levels/${toDelete.id}${force ? "?force=true" : ""}`,
      );
      applyLevels(result.levels);
      toast.success(
        result.archived
          ? "Level removed. Student history was archived and preserved."
          : "Level deleted.",
      );
      setToDelete(null);
      setDeleteImpact(null);
    } catch (error) {
      if (isConfirmationRequired(error)) {
        setDeleteImpact(error.details ?? null);
      } else if (isApiError(error) && error.code === "NOT_FOUND") {
        toast.error(error.message);
        setToDelete(null);
        setDeleteImpact(null);
        load();
      } else {
        toast.error(isApiError(error) ? error.message : "Could not delete the level.");
      }
    } finally {
      setBusy(false);
    }
  };

  const move = async (trackId: string, index: number, direction: -1 | 1) => {
    if (!data) return;
    const trackLevels = data.levels
      .filter((l) => l.track_id === trackId)
      .sort((a, b) => a.order_index - b.order_index || a.level_number - b.level_number);
    const target = index + direction;
    if (target < 0 || target >= trackLevels.length) return;
    const reordered = [...trackLevels];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    try {
      await api.post("/api/admin/levels/reorder", {
        trackId,
        order: reordered.map((level, i) => ({ id: level.id, orderIndex: i + 1 })),
      });
      toast.success("Order updated.");
      load();
    } catch (error) {
      toast.error(isApiError(error) ? error.message : "Could not reorder levels.");
    }
  };

  if (loading) return <PageLoader label="Loading levels" />;
  if (!data) return <EmptyState title="Unable to load levels" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Levels"
        description="Build each year's track. Levels unlock in order as students progress."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="size-4" /> New level
          </Button>
        }
      />

      {data.tracks.length === 0 ? (
        <EmptyState title="No tracks configured" description="Create a contest track first." />
      ) : (
        data.tracks.map((track) => {
          const trackLevels = data.levels
            .filter((l) => l.track_id === track.id)
            .sort((a, b) => a.order_index - b.order_index || a.level_number - b.level_number);
          return (
            <Card key={track.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <ListChecks className="size-4 text-brand-soft" />
                    {track.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">
                      {trackLevels.length} level{trackLevels.length === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="info">{track.year === 1 ? "1st Year" : "2nd Year"}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {trackLevels.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted">No levels in this track yet.</p>
                ) : (
                  trackLevels.map((level, index) => {
                    const difficulty = difficultyMeta[level.difficulty];
                    return (
                      <div
                        key={level.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-3"
                      >
                        <div className="flex flex-col">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => move(track.id, index, -1)}
                            className="text-muted hover:text-foreground disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <ArrowUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === trackLevels.length - 1}
                            onClick={() => move(track.id, index, 1)}
                            className="text-muted hover:text-foreground disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ArrowDown className="size-4" />
                          </button>
                        </div>
                        <span className="flex size-8 items-center justify-center rounded-lg bg-surface-3 text-xs font-bold">
                          {level.level_number}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-medium">{level.title}</p>
                            <Badge className={difficulty.className}>{difficulty.label}</Badge>
                            {level.is_starting ? (
                              <Badge variant="accent">
                                <Star className="size-3" /> Starting
                              </Badge>
                            ) : null}
                            {!level.is_active ? <Badge variant="neutral">Inactive</Badge> : null}
                          </div>
                          <p className="truncate text-xs text-muted">
                            {level.points} pts · {level.question_count} questions
                            {level.problem_title ? ` · ${level.problem_title}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Link to={`/admin/levels/${level.id}`}>
                            <Button variant="ghost" size="sm">
                              <Pencil className="size-4" /> Edit
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setDeleteImpact(null);
                              setToDelete(level);
                            }}
                            aria-label="Delete level"
                          >
                            <Trash2 className="size-4 text-danger" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create level"
        description="Add a new level to one of the tracks."
        className="sm:max-w-2xl"
      >
        <LevelForm
          tracks={data.tracks}
          initial={emptyLevelValues(data.tracks)}
          submitLabel="Create level"
          busy={busy}
          onSubmit={(values) => handleCreate(values)}
          onCancel={() => setShowCreate(false)}
        />
      </Dialog>

      <Dialog
        open={Boolean(pendingCreate)}
        onClose={() => {
          setPendingCreate(null);
          setCreateImpact(null);
        }}
        title="Confirm level change"
        description="This change affects a running contest."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingCreate(null);
                setCreateImpact(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => pendingCreate && handleCreate(pendingCreate, true)}
            >
              Add level anyway
            </Button>
          </>
        }
      >
        {createImpact ? <ImpactSummary impact={createImpact} /> : null}
      </Dialog>

      <Dialog
        open={Boolean(toDelete)}
        onClose={() => {
          setToDelete(null);
          setDeleteImpact(null);
        }}
        title="Delete level"
        description={toDelete ? `"${toDelete.title}" will be removed from the track.` : undefined}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setToDelete(null);
                setDeleteImpact(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => handleDelete(Boolean(deleteImpact))}
              loading={busy}
            >
              {deleteImpact ? "Delete anyway" : "Delete"}
            </Button>
          </>
        }
      >
        {deleteImpact ? (
          <ImpactSummary impact={deleteImpact} />
        ) : toDelete ? (
          <p className="text-sm text-muted">
            The remaining levels will be renumbered so the sequence stays continuous. If this level has
            participant activity, its submissions, source code and completion history are archived and
            preserved rather than deleted.
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
