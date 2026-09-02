import type { TriggerSummary } from "@/lib/distractions/types";

/**
 * The evening close's gate — the one thing in the ceremony that is allowed to
 * refuse.
 *
 * BOSS-VISION §6, verbatim: "the three-strikes forced rewrite
 * (`skippedCount >= 3 && followedCount === 0` blocks re-confirming a plan that
 * has never worked). **If the close makes that optional the feature is gone
 * though the screen remains.**"
 *
 * That second sentence is why this module exists as a gate rather than as a
 * list the surface may render however it likes. A ceremony that shows the
 * failing plan and lets you close anyway looks completely correct — there is no
 * error, the screen is populated, the ritual completes — and the feature is
 * simply absent. That is the same silent shape as two crowned items rendering
 * perfectly (migration 113) and as an HTTP 200 redirect hiding a whole section
 * (the /personal outage): nothing reports it, so only a refusal can enforce it.
 *
 * THIS MODULE READS `mustRewrite`, IT DOES NOT RECOMPUTE IT. The rule lives in
 * lib/distractions/plan-rules.ts and arrives on the plan. Recomputing it from
 * counts here would create a second definition of "has never worked" that can
 * drift from the first — and the drift would be invisible, because both would
 * keep returning booleans.
 */

/** Why the close is refusing. Kinds are distinct so the surface cannot conflate them. */
export type CloseBlocker = {
  kind: "forced_rewrite";
  triggerId: string;
  triggerName: string;
};

export type CloseInput = {
  triggers: TriggerSummary[];
  /** Distractions captured today that have no plan yet. Account-step context — never a blocker. */
  unplannedTodayCount: number;
};

export function closeBlockers(input: CloseInput): CloseBlocker[] {
  const blockers: CloseBlocker[] = [];

  for (const trigger of input.triggers) {
    const plan = trigger.currentPlan;
    if (plan === null) continue; // nothing has failed yet — not a blocker

    // A missing flag is malformed data, not a passing plan. Reading `undefined`
    // as false would silently unblock every failing plan the day someone
    // changes the query's select list — absent read as a value, which is the
    // most expensive bug class in this codebase.
    if (plan.mustRewrite !== false) {
      blockers.push({
        kind: "forced_rewrite",
        triggerId: trigger.id,
        triggerName: trigger.name,
      });
    }
  }

  return blockers;
}

/**
 * The close completes only when nothing is refusing it.
 *
 * Unplanned distractions captured today are deliberately NOT a blocker: that is
 * work not yet done, while a forced rewrite is a plan proven not to work. The
 * vision makes only the second non-optional, and collapsing them would either
 * make the ceremony impossible to finish on an ordinary busy night or dilute
 * the one refusal that matters into a general nag.
 */
export function canCompleteClose(input: CloseInput): boolean {
  return closeBlockers(input).length === 0;
}
