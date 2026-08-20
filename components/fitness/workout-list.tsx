"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type WorkoutSummary = {
  id: string;
  name: string;
  exerciseCount: number;
};

export type SeedPlan = {
  id: string;
  name: string;
  description: string;
};

/**
 * spec §4.1 first run: two equal-weight entry points ("Create your own" /
 * "Start from one of these"), neither reading as the fallback, plus a
 * smaller tertiary "or just log something now" — replacing the old blank
 * 7-cell grid entirely. `seedPlans` is optional and defaults to empty since
 * Phase 6 (adoption) lands separately; the two primary entry points don't
 * depend on it.
 */
export function WorkoutList({
  workouts,
  seedPlans = [],
  onCreateNew,
  onAdoptPlan,
  onQuickLog,
  onEdit,
  onDuplicate,
  onRename,
  onArchive,
}: {
  workouts: WorkoutSummary[];
  seedPlans?: SeedPlan[];
  onCreateNew: () => void;
  onAdoptPlan?: (planId: string) => Promise<void>;
  onQuickLog?: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => Promise<{ id: string }>;
  onRename: (id: string, name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}) {
  if (workouts.length === 0) {
    return (
      <div className="flex flex-col gap-4" data-testid="workout-first-run">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCreateNew}
            className="min-h-11 rounded-lg border border-border/60 p-4 text-left text-sm font-medium hover:bg-muted"
          >
            Create your own workout
          </button>
          {seedPlans.length > 0 && (
            <div className="rounded-lg border border-border/60 p-4">
              <p className="mb-2 text-sm font-medium">Start from one of these</p>
              <ul className="flex flex-col gap-2">
                {seedPlans.map((plan) => (
                  <li key={plan.id}>
                    <button
                      type="button"
                      onClick={() => onAdoptPlan?.(plan.id)}
                      className="min-h-11 w-full rounded-md border border-border/40 px-3 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{plan.name}</span>
                      <span className="block text-xs text-muted-foreground">{plan.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {onQuickLog && (
          <button
            type="button"
            onClick={onQuickLog}
            className="min-h-11 text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            or just log something now
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="workout-list">
      {workouts.map((w) => (
        <WorkoutRow
          key={w.id}
          workout={w}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onRename={onRename}
          onArchive={onArchive}
        />
      ))}
      <Button type="button" variant="outline" onClick={onCreateNew} className="min-h-11">
        + New workout
      </Button>
    </ul>
  );
}

function WorkoutRow({
  workout,
  onEdit,
  onDuplicate,
  onRename,
  onArchive,
}: {
  workout: WorkoutSummary;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => Promise<{ id: string }>;
  onRename: (id: string, name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(workout.name);
  const [isPending, startTransition] = useTransition();

  function saveRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await onRename(workout.id, trimmed);
      setRenaming(false);
    });
  }

  return (
    <li
      data-testid={`workout-row-${workout.id}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 p-3"
    >
      {renaming ? (
        <div className="flex flex-1 items-center gap-2">
          <Input
            aria-label={`Rename ${workout.name}`}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            autoFocus
          />
          <Button type="button" onClick={saveRename} disabled={isPending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => onEdit(workout.id)} className="min-h-11 flex-1 text-left">
          <span className="text-sm font-medium">{workout.name}</span>
          <span className="block text-xs text-muted-foreground">
            {workout.exerciseCount} exercise{workout.exerciseCount === 1 ? "" : "s"}
          </span>
        </button>
      )}

      {!renaming && (
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" onClick={() => setRenaming(true)} className="min-h-11">
            Rename
          </Button>
          <Button type="button" variant="outline" onClick={() => onDuplicate(workout.id)} className="min-h-11">
            Duplicate
          </Button>
          <Button type="button" variant="outline" onClick={() => onArchive(workout.id)} className="min-h-11">
            Archive
          </Button>
        </div>
      )}
    </li>
  );
}
