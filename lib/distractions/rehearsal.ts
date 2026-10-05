import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString } from "@/lib/date-utils";
import { getAllTriggers } from "./queries";
import { withoutDeenDomain } from "./deen-filter";
import type { DistractionDomain, TriggerSummary } from "./types";

/**
 * The plan is written at night; the morning is when it gets used. The Launch card rehearses ONE plan: the one
 * for the trigger that hit hardest yesterday, or -- if yesterday was clean -- the one that has hit most overall.
 * A plan that must be rewritten (3 skips, 0 follows) is never rehearsed: the review makes you rewrite it first.
 */
export type RehearsalPlan = {
  trigger: string;
  domain: DistractionDomain;
  body: string;
  /** Events of this trigger yesterday (0 = chosen as the all-time most frequent instead). */
  yesterdayCount: number;
};

/** Pure. `triggers` must have been summarised against YESTERDAY's date, so `todayCount` is yesterday's count. */
export function pickRehearsalPlan(triggers: readonly TriggerSummary[]): RehearsalPlan | null {
  const planned = triggers.filter((t) => t.currentPlan !== null && !t.currentPlan.mustRewrite && t.currentPlan.body.trim() !== "");
  if (planned.length === 0) return null;
  const best = [...planned].sort((a, b) => b.todayCount - a.todayCount || b.totalCount - a.totalCount || a.name.localeCompare(b.name))[0];
  if (best.todayCount === 0 && best.totalCount === 0) return null;
  return { trigger: best.name, domain: best.domain, body: best.currentPlan!.body.trim(), yesterdayCount: best.todayCount };
}

export async function getRehearsalPlan(supabase: SupabaseClient, userId: string, today: string, deenMode: boolean): Promise<RehearsalPlan | null> {
  const all = await getAllTriggers(supabase, userId, addDaysToDateString(today, -1));
  return pickRehearsalPlan(withoutDeenDomain(all, deenMode));
}
