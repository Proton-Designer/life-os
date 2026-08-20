"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/fitness/volume";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ExerciseOption = {
  id: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
};

const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: "Chest",
  back_lats: "Lats",
  back_mid: "Mid back",
  front_delt: "Front delt",
  side_delt: "Side delt",
  rear_delt: "Rear delt",
  biceps: "Biceps",
  triceps: "Triceps",
  core: "Core",
};

/**
 * His cable machine does things no fixed list anticipates (spec §4), so
 * this always offers an inline "add new exercise" path alongside search —
 * never a dead end where the movement he wants just isn't in the list.
 * Saving untagged is always allowed: tagging is a multi-select he can skip,
 * not a gate on the Add button (spec §4 — blocking save on tags is exactly
 * the unguided-input friction that killed this screen once).
 */
export function ExercisePicker({
  exercises,
  onSelect,
  onCreate,
}: {
  exercises: ExerciseOption[];
  onSelect: (exercise: ExerciseOption) => void;
  onCreate: (name: string, primaryMuscles: MuscleGroup[], secondaryMuscles: MuscleGroup[]) => Promise<{ id: string }>;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [primary, setPrimary] = useState<MuscleGroup[]>([]);
  const [secondary, setSecondary] = useState<MuscleGroup[]>([]);
  const [isPending, startTransition] = useTransition();

  const filtered = exercises.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = exercises.some((e) => e.name.toLowerCase() === query.trim().toLowerCase());

  function toggleMuscle(list: MuscleGroup[], setList: (v: MuscleGroup[]) => void, m: MuscleGroup) {
    setList(list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  }

  function handleCreate() {
    const name = query.trim();
    if (!name || isPending) return;
    startTransition(async () => {
      const { id } = await onCreate(name, primary, secondary);
      onSelect({ id, name, primaryMuscles: primary, secondaryMuscles: secondary });
      setQuery("");
      setPrimary([]);
      setSecondary([]);
      setCreating(false);
    });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="exercise-picker">
      <Input
        placeholder="Search or add an exercise"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search exercises"
      />

      {query.trim().length > 0 && (
        <ul className="flex flex-col gap-1">
          {filtered.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="min-h-11 w-full rounded-md border border-border/40 px-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onSelect(e);
                  setQuery("");
                }}
              >
                {e.name}
              </button>
            </li>
          ))}
          {!exactMatch && (
            <li>
              <button
                type="button"
                className="min-h-11 w-full rounded-md border border-dashed border-border/60 px-3 text-left text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setCreating(true)}
              >
                + Add &quot;{query.trim()}&quot; as a new exercise
              </button>
            </li>
          )}
        </ul>
      )}

      {creating && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3" data-testid="exercise-create-form">
          <p className="text-xs text-muted-foreground">Which muscles does this work? (optional)</p>
          <div data-testid="muscle-group-primary">
            <p className="mb-1 text-xs font-medium">Primary</p>
            <div className="flex flex-wrap gap-1.5">
              {MUSCLE_GROUPS.map((m) => (
                <button
                  key={`p-${m}`}
                  type="button"
                  aria-pressed={primary.includes(m)}
                  onClick={() => toggleMuscle(primary, setPrimary, m)}
                  className={cn(
                    "min-h-11 rounded-md border px-2.5 text-xs",
                    primary.includes(m)
                      ? "border-accent-fitness bg-accent-fitness/15 text-accent-fitness"
                      : "border-border/40 text-muted-foreground"
                  )}
                >
                  {MUSCLE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div data-testid="muscle-group-secondary">
            <p className="mb-1 text-xs font-medium">Secondary</p>
            <div className="flex flex-wrap gap-1.5">
              {MUSCLE_GROUPS.map((m) => (
                <button
                  key={`s-${m}`}
                  type="button"
                  aria-pressed={secondary.includes(m)}
                  onClick={() => toggleMuscle(secondary, setSecondary, m)}
                  className={cn(
                    "min-h-11 rounded-md border px-2.5 text-xs",
                    secondary.includes(m)
                      ? "border-accent-fitness bg-accent-fitness/15 text-accent-fitness"
                      : "border-border/40 text-muted-foreground"
                  )}
                >
                  {MUSCLE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <Button type="button" onClick={handleCreate} disabled={isPending}>
            Add exercise
          </Button>
        </div>
      )}
    </div>
  );
}
