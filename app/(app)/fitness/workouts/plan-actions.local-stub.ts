/**
 * TEMPORARY local stand-ins for Engineer A's four plan server actions
 * (docs/superpowers/plans/2026-08-22-fitness-system.md, "Server action
 * signatures"). Delete this file and swap the import at plan-workouts-client's
 * call site for the real "use server" actions once A lands them — same
 * signatures, so it's a one-line change, not a rewrite.
 *
 * These do NOT persist anything. They exist only so Phase 2 UI is testable
 * end-to-end (create → list → edit → activate → delete) before Phase 1's
 * savePlan/deletePlan/activatePlan/deactivateSlot exist for real.
 */
import type { ActivePlans, PlanDraft, PlanKind } from "@/lib/fitness/plan-types";

export async function savePlanStub(draft: PlanDraft): Promise<{ id: string }> {
  return { id: draft.id ?? `local-${Math.floor(Math.random() * 1_000_000)}` };
}

export async function deletePlanStub(_planId: string): Promise<void> {}

export async function activatePlanStub(_planId: string, _kind: PlanKind): Promise<void> {}

export async function deactivateSlotStub(_kind: PlanKind): Promise<void> {}

export const EMPTY_ACTIVE_PLANS: ActivePlans = { microPlanId: null, routinePlanId: null };
