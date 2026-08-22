"use client";

import { useMemo, useState } from "react";
import { expandPlanToWeek } from "@/lib/fitness/plan-schedule";
import type { ActivePlans, PlanDraft, PlanKind } from "@/lib/fitness/plan-types";
import type { ExerciseOption } from "../exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";
import { PlanList } from "./plan-list";
import { NewPlanFlow, type TemplateKey } from "./new-plan-flow";
import { MicroBuilder } from "./micro-builder";
import { RoutineBuilder } from "./routine-builder";
import { HourlyWeekCalendar } from "./hourly-week-calendar";
import { mergeWeekPreviews } from "./day-grid";

type Mode = { view: "list" } | { view: "new" } | { view: "builder"; plan: PlanDraft };

function emptyDraft(kind: PlanKind, name: string): PlanDraft {
  return kind === "micro" ? { kind, id: null, name, exercises: [] } : { kind, id: null, name, sessions: [] };
}

/**
 * My Workouts orchestrator — list ⟷ create fork ⟷ builder, plus the
 * detailed hourly calendar at the bottom. Defaults to the active plan(s);
 * tapping a plan row in the list previews it here WITHOUT activating it
 * (spec row 5 + gap resolution).
 *
 * The list/builder switch lives here as client state, same reasoning as
 * the pre-existing WorkoutsClient — every server action passed in is a
 * real bound reference from the Server Component parent (RSC boundary,
 * AGENTS.md), never wrapped in a new arrow function at this layer.
 */
export function PlanWorkoutsClient({
  initialPlans,
  initialActivePlans,
  allExercises,
  onCreateExercise,
  savePlan,
  deletePlan,
  activatePlan,
  deactivateSlot,
  createPlanFromTemplate,
}: {
  initialPlans: PlanDraft[];
  initialActivePlans: ActivePlans;
  allExercises: ExerciseOption[];
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
  savePlan: (draft: PlanDraft) => Promise<{ id: string }>;
  deletePlan: (planId: string) => Promise<void>;
  activatePlan: (planId: string, kind: PlanKind) => Promise<void>;
  deactivateSlot: (kind: PlanKind) => Promise<void>;
  createPlanFromTemplate: (key: TemplateKey) => Promise<{ id: string }>;
}) {
  const [plans, setPlans] = useState<PlanDraft[]>(initialPlans);
  const [activePlans, setActivePlans] = useState<ActivePlans>(initialActivePlans);
  const [mode, setMode] = useState<Mode>({ view: "list" });
  const [previewedPlanId, setPreviewedPlanId] = useState<string | null>(null);

  // Deliberately NOT synced from `initialPlans`/`initialActivePlans` via a
  // useEffect on every prop change. Every action here (savePlan, deletePlan,
  // activatePlan, deactivateSlot, createPlanFromTemplate) calls
  // revalidatePath, and Next.js automatically re-renders this route's Server
  // Components as part of resolving that same transition — a blanket
  // useEffect resyncing on every resulting prop change raced against this
  // component's own optimistic setPlans/setActivePlans calls and clobbered
  // them with props from a still-in-flight refetch (reproduced live against
  // the SEED account: a saved plan briefly existed in the DB but the list
  // rendered "No workout plans yet" right after Save). Optimistic state
  // updates below are the source of truth for the four actions that HAVE
  // full draft data to update it with; createPlanFromTemplate is the one
  // exception (it returns only an id, not the plan's materialized content)
  // and forces a full reload rather than trusting this same race.

  async function handleSave(draft: PlanDraft): Promise<{ id: string }> {
    const result = await savePlan(draft);
    const saved: PlanDraft = { ...draft, id: result.id } as PlanDraft;
    setPlans((prev) => {
      const withoutThis = prev.filter((p) => p.id !== saved.id);
      return [...withoutThis, saved];
    });
    return result;
  }

  async function handleDelete(planId: string) {
    await deletePlan(planId);
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    setActivePlans((prev) => ({
      microPlanId: prev.microPlanId === planId ? null : prev.microPlanId,
      routinePlanId: prev.routinePlanId === planId ? null : prev.routinePlanId,
    }));
    if (previewedPlanId === planId) setPreviewedPlanId(null);
  }

  async function handleActivate(planId: string, kind: PlanKind) {
    await activatePlan(planId, kind);
    setActivePlans((prev) => (kind === "micro" ? { ...prev, microPlanId: planId } : { ...prev, routinePlanId: planId }));
  }

  async function handleDeactivate(kind: PlanKind) {
    await deactivateSlot(kind);
    setActivePlans((prev) => (kind === "micro" ? { ...prev, microPlanId: null } : { ...prev, routinePlanId: null }));
  }

  const calendarPreview = useMemo(() => {
    if (previewedPlanId) {
      const previewed = plans.find((p) => p.id === previewedPlanId);
      return previewed ? expandPlanToWeek(previewed) : expandPlanToWeek(emptyDraft("micro", ""));
    }
    const micro = plans.find((p) => p.id === activePlans.microPlanId);
    const routine = plans.find((p) => p.id === activePlans.routinePlanId);
    return mergeWeekPreviews(
      micro ? expandPlanToWeek(micro) : {},
      routine ? expandPlanToWeek(routine) : {}
    );
  }, [previewedPlanId, plans, activePlans]);

  async function handleCreateFromTemplate(key: TemplateKey) {
    await createPlanFromTemplate(key);
    // The template's sessions/exercises exist only server-side now, and
    // there's no draft to update local state with optimistically — a full
    // reload is the only correct source, not router.refresh() (see the
    // comment above on why a soft refresh here raced against local state).
    window.location.reload();
  }

  if (mode.view === "new") {
    return (
      <div className="flex flex-col gap-4">
        <NewPlanFlow
          onChosen={(kind, name) => setMode({ view: "builder", plan: emptyDraft(kind, name) })}
          onCreateFromTemplate={handleCreateFromTemplate}
        />
      </div>
    );
  }

  if (mode.view === "builder") {
    const commonProps = {
      allExercises,
      onCreateExercise,
      onSave: handleSave,
      onDone: () => setMode({ view: "list" }),
    };
    return mode.plan.kind === "micro" ? (
      <MicroBuilder
        initialName={mode.plan.name}
        initialExercises={mode.plan.exercises}
        planId={mode.plan.id}
        {...commonProps}
      />
    ) : (
      <RoutineBuilder
        initialName={mode.plan.name}
        initialSessions={mode.plan.sessions}
        planId={mode.plan.id}
        {...commonProps}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PlanList
        plans={plans}
        activePlans={activePlans}
        previewedPlanId={previewedPlanId}
        onPreview={setPreviewedPlanId}
        onCreateNew={() => setMode({ view: "new" })}
        onEdit={(planId) => {
          const plan = plans.find((p) => p.id === planId);
          if (plan) setMode({ view: "builder", plan });
        }}
        onDelete={handleDelete}
        onActivate={handleActivate}
        onDeactivate={handleDeactivate}
      />
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {previewedPlanId ? "Previewing (not activated)" : "This week"}
        </p>
        <HourlyWeekCalendar preview={calendarPreview} />
      </div>
    </div>
  );
}
