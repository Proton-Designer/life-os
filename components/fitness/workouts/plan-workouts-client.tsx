"use client";

import { useMemo, useOptimistic, useState } from "react";
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

type PlansAction = { type: "upsert"; plan: PlanDraft } | { type: "remove"; planId: string };

function plansReducer(state: PlanDraft[], action: PlansAction): PlanDraft[] {
  if (action.type === "upsert") {
    return [...state.filter((p) => p.id !== action.plan.id), action.plan];
  }
  return state.filter((p) => p.id !== action.planId);
}

type ActiveAction =
  | { type: "activate"; planId: string; kind: PlanKind }
  | { type: "deactivate"; kind: PlanKind }
  | { type: "clearSlotsHolding"; planId: string };

function activeReducer(state: ActivePlans, action: ActiveAction): ActivePlans {
  if (action.type === "activate") {
    return action.kind === "micro" ? { ...state, microPlanId: action.planId } : { ...state, routinePlanId: action.planId };
  }
  if (action.type === "deactivate") {
    return action.kind === "micro" ? { ...state, microPlanId: null } : { ...state, routinePlanId: null };
  }
  return {
    microPlanId: state.microPlanId === action.planId ? null : state.microPlanId,
    routinePlanId: state.routinePlanId === action.planId ? null : state.routinePlanId,
  };
}

function emptyDraft(kind: PlanKind, name: string): PlanDraft {
  return kind === "micro" ? { kind, id: null, name, exercises: [] } : { kind, id: null, name, sessions: [] };
}

/**
 * My Workouts orchestrator — list ⟷ create fork ⟷ builder, plus the
 * detailed hourly calendar at the bottom. Defaults to the active plan(s);
 * tapping a plan row in the list previews it here WITHOUT activating it
 * (spec row 5 + gap resolution).
 *
 * `plans`/`activePlans` are useOptimistic over the Server Component's own
 * props, not a useState mirror kept in sync by hand — same pattern as
 * components/home/next-actions.tsx. Every action here (savePlan,
 * deletePlan, activatePlan, deactivateSlot, createPlanFromTemplate) calls
 * revalidatePath, and Next.js automatically re-renders this route's Server
 * Components as part of resolving that same transition. An earlier version
 * of this file kept `plans` in a separate useState synced from props via a
 * blanket useEffect — that resynced on EVERY one of those refetches and
 * raced against this component's own optimistic updates, reproduced live
 * against the real account: a plan existed in the database but the list
 * rendered "No workout plans yet" right after Save (Opus Lead, 2026-08-22).
 * useOptimistic removes the race structurally: there's no second copy of
 * the state to go stale, so there's nothing for the auto-refetch to
 * clobber — its fresh props simply become the new base state once the
 * dispatching transition settles. Every mutation handler below is called
 * from a `startTransition` in its caller (plan-list.tsx's row actions,
 * new-plan-flow.tsx's template buttons, both builders' Save), which is
 * what makes calling the optimistic dispatch inside them valid — see
 * https://react.dev/reference/react/useOptimistic.
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
  const [plans, dispatchPlans] = useOptimistic(initialPlans, plansReducer);
  const [activePlans, dispatchActive] = useOptimistic(initialActivePlans, activeReducer);
  const [mode, setMode] = useState<Mode>({ view: "list" });
  const [previewedPlanId, setPreviewedPlanId] = useState<string | null>(null);

  // handleSave is the one handler that dispatches AFTER awaiting, not
  // before: a brand-new plan (draft.id === null) has no id to render
  // optimistically until the server assigns one, so there's nothing
  // truthful to show before the round trip completes. The other three
  // handlers dispatch first (true optimism, matching next-actions.tsx's
  // Row.handleClick) since planId/kind are already known upfront.
  async function handleSave(draft: PlanDraft): Promise<{ id: string }> {
    const result = await savePlan(draft);
    dispatchPlans({ type: "upsert", plan: { ...draft, id: result.id } as PlanDraft });
    return result;
  }

  async function handleDelete(planId: string) {
    dispatchPlans({ type: "remove", planId });
    dispatchActive({ type: "clearSlotsHolding", planId });
    if (previewedPlanId === planId) setPreviewedPlanId(null);
    await deletePlan(planId);
  }

  async function handleActivate(planId: string, kind: PlanKind) {
    dispatchActive({ type: "activate", planId, kind });
    await activatePlan(planId, kind);
  }

  async function handleDeactivate(kind: PlanKind) {
    dispatchActive({ type: "deactivate", kind });
    await deactivateSlot(kind);
  }

  async function handleCreateFromTemplate(key: TemplateKey) {
    await createPlanFromTemplate(key);
    // No draft to dispatch optimistically (a template's materialized
    // sessions/exercises are server-only) — the automatic post-Server-
    // Action refetch delivers the new plan via fresh props, same as any
    // other revalidatePath-backed mutation here.
    setMode({ view: "list" });
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
