"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { ActivePlans, PlanDraft } from "@/lib/fitness/plan-types";
import { Button } from "@/components/ui/button";

function itemCount(plan: PlanDraft): number {
  return plan.kind === "micro" ? plan.exercises.length : plan.sessions.length;
}

/**
 * My Workouts list — row 1 (currently active, both slots), row 2 (every
 * plan with Edit/Delete/Activate), row 3 ("+ Create workout"). Tapping a
 * row previews it in the bottom hourly calendar WITHOUT activating it
 * (onPreview) — a distinct affordance from onActivate, since a mis-tap
 * here would silently change what the user trains today.
 *
 * Deleting a plan that's currently active is allowed (the DB's
 * `on delete set null` just clears the slot) but the confirm dialog must
 * say so explicitly, or the consequence is invisible.
 */
export function PlanList({
  plans,
  activePlans,
  previewedPlanId,
  onPreview,
  onCreateNew,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
}: {
  plans: PlanDraft[];
  activePlans: ActivePlans;
  previewedPlanId: string | null;
  onPreview: (planId: string | null) => void;
  onCreateNew: () => void;
  onEdit: (planId: string) => void;
  onDelete: (planId: string) => Promise<void>;
  onActivate: (planId: string, kind: "micro" | "routine") => Promise<void>;
  onDeactivate: (kind: "micro" | "routine") => Promise<void>;
}) {
  const microActive = plans.find((p) => p.id === activePlans.microPlanId) ?? null;
  const routineActive = plans.find((p) => p.id === activePlans.routinePlanId) ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="plan-list">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="active-plan-slots">
        <ActiveSlot label="Micro" plan={microActive} kind="micro" onDeactivate={onDeactivate} />
        <ActiveSlot label="Routine" plan={routineActive} kind="routine" onDeactivate={onDeactivate} />
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="plan-list-empty">
          No workout plans yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="plan-rows">
          {plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              isActive={plan.id === activePlans.microPlanId || plan.id === activePlans.routinePlanId}
              isPreviewed={plan.id === previewedPlanId}
              onPreview={onPreview}
              onEdit={onEdit}
              onDelete={onDelete}
              onActivate={onActivate}
            />
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" onClick={onCreateNew} className="min-h-11 w-fit">
        + Create workout
      </Button>
    </div>
  );
}

function ActiveSlot({
  label,
  plan,
  kind,
  onDeactivate,
}: {
  label: string;
  plan: PlanDraft | null;
  kind: "micro" | "routine";
  onDeactivate: (kind: "micro" | "routine") => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <div
      data-testid={`active-slot-${kind}`}
      className="flex items-center justify-between gap-2 rounded-lg border border-border/40 p-3"
    >
      <div>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{plan ? plan.name : "none selected"}</span>
      </div>
      {plan && (
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => startTransition(() => onDeactivate(kind))}
          className="min-h-11"
        >
          Turn off
        </Button>
      )}
    </div>
  );
}

function PlanRow({
  plan,
  isActive,
  isPreviewed,
  onPreview,
  onEdit,
  onDelete,
  onActivate,
}: {
  plan: PlanDraft;
  isActive: boolean;
  isPreviewed: boolean;
  onPreview: (planId: string | null) => void;
  onEdit: (planId: string) => void;
  onDelete: (planId: string) => Promise<void>;
  onActivate: (planId: string, kind: "micro" | "routine") => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const planId = plan.id;

  function handlePreview() {
    if (!planId) return;
    onPreview(isPreviewed ? null : planId);
  }

  function handleDelete() {
    if (!planId) return;
    startTransition(async () => {
      await onDelete(planId);
      setConfirmingDelete(false);
    });
  }

  return (
    <li
      data-testid={`plan-row-${planId}`}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3",
        isPreviewed ? "border-accent-fitness" : "border-border/40"
      )}
    >
      <button type="button" onClick={handlePreview} className="min-h-11 flex-1 text-left">
        <span className="text-sm font-medium">{plan.name}</span>
        <span className="block text-xs text-muted-foreground">
          {plan.kind === "micro" ? "Micro" : "Routine"} · {itemCount(plan)}{" "}
          {plan.kind === "micro" ? "exercise" : "session"}
          {itemCount(plan) === 1 ? "" : "s"}
          {isActive ? " · Active" : ""}
        </span>
      </button>

      <div className="flex flex-wrap gap-1.5">
        {!isActive && planId && (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => startTransition(() => onActivate(planId, plan.kind))}
            className="min-h-11"
          >
            Activate
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => planId && onEdit(planId)} className="min-h-11">
          Edit
        </Button>
        {confirmingDelete ? (
          <div className="flex items-center gap-1.5" data-testid={`delete-confirm-${planId}`}>
            <span className="text-xs text-muted-foreground">
              {isActive ? "This is your active plan. Delete anyway?" : "Delete this plan?"}
            </span>
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleDelete} className="min-h-11">
              Delete
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)} className="min-h-11">
              Cancel
            </Button>
          </div>
        ) : (
          <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)} className="min-h-11">
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}
