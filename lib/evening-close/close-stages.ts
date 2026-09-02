import type { NightPlanState } from "@/lib/night-plan/night-plan";

/**
 * The evening close's stage order, as a mechanism rather than a UI flow.
 *
 * BOSS-VISION §6 structures the ceremony as (a) account, (b) reflect,
 * (c) plan, and the Night Plan SPEC insists the plan stage itself is
 * dump → star three → crown one, "in that order, verbatim". Both orderings are
 * load-bearing and both are the kind of thing a surface erodes by accident:
 * a "skip" affordance here, a combined tap there, and the ceremony still
 * renders perfectly while no longer doing anything.
 *
 * Keeping the order here — rather than as the sequence of screens a component
 * happens to render — means a surface cannot quietly reorder it, and the
 * ordering can be tested without a browser.
 */

export type CloseStage = "account" | "reflect" | "plan" | "done";

export type PlanProgress = {
  /** True when `closeBlockers` found anything — a forced rewrite outstanding. */
  blocked: boolean;
  plan: NightPlanState;
};

/**
 * Which of dump → star → crown the user is actually on.
 *
 * Exists so the surface cannot render a crown affordance beside an unstarred
 * line and become "pick your top item" — the collapse the SPEC names
 * explicitly. `crown()` already refuses an unstarred id; this stops the
 * interface from offering the tap in the first place, which is the difference
 * between a rule and a rule nobody can break by accident.
 */
export type PlanStep = "dump" | "star" | "crown" | "complete";

export function planStep(plan: NightPlanState): PlanStep {
  if (plan.crowned !== null) return "complete";
  if (plan.items.length === 0) return "dump";
  if (plan.starred.length === 0) return "star";
  return "crown";
}

/**
 * The next stage from where you are.
 *
 * A BLOCKER SENDS ANY STAGE BACK TO ACCOUNT. The forced rewrite is a property
 * of the night, not a screen you get past once — otherwise a plan that fails
 * its third strike midway through the ceremony is escapable by having already
 * walked through the account step, and the rule silently becomes "we checked
 * at the start". BOSS-VISION: "If the close makes that optional the feature is
 * gone though the screen remains."
 */
export function nextStage(current: CloseStage, progress: PlanProgress): CloseStage {
  if (progress.blocked) return "account";

  switch (current) {
    case "account":
      return "reflect";
    case "reflect":
      return "plan";
    case "plan": {
      const step = planStep(progress.plan);
      // An empty dump is a legitimate night — dismissing every seeded line is a
      // real planning act, not an error state — and it simply cannot reach a
      // crown. The close ends without one rather than refusing to end.
      if (step === "complete" || progress.plan.items.length === 0) return "done";
      return "plan";
    }
    case "done":
      return "done";
  }
}
