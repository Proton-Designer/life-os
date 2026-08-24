import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionPlan, DistractionDomain, ReviewItem, TriggerSummary } from "./types";

type TypedClient = SupabaseClient<Database>;

// Review order, per spec §5 — domains with zero events today are skipped
// entirely rather than rendered empty.
const REVIEW_DOMAIN_ORDER: DistractionDomain[] = ["deen", "business", "school", "fitness", "co_op"];

type TriggerRow = {
  id: string;
  domain: string;
  name: string;
  description: string | null;
  created_at: string;
};

type PlanRow = {
  id: string;
  trigger_id: string;
  body: string;
  version: number;
  created_at: string;
};

type OutcomeRow = {
  plan_id: string;
  followed: boolean;
};

type EventRow = {
  trigger_id: string;
  date: string;
  created_at: string;
};

/**
 * Assembles TriggerSummary[] for an arbitrary set of trigger rows — the
 * shared join logic behind every read in this module (capture dialog,
 * Action Plan dialog, nightly review). Four parallel queries scoped to the
 * given trigger ids, aggregated in JS rather than a single relational
 * query, matching the existing assembly style (see workouts/page.tsx).
 */
async function assembleSummaries(
  supabase: TypedClient,
  userId: string,
  todayDate: string,
  triggers: TriggerRow[]
): Promise<TriggerSummary[]> {
  if (triggers.length === 0) return [];
  const triggerIds = triggers.map((t) => t.id);

  const [{ data: events }, { data: plans }] = await Promise.all([
    supabase
      .from("distraction_events")
      .select("trigger_id, date, created_at")
      .eq("user_id", userId)
      .in("trigger_id", triggerIds),
    supabase
      .from("trigger_action_plans")
      .select("id, trigger_id, body, version, created_at")
      .eq("user_id", userId)
      .in("trigger_id", triggerIds)
      .is("superseded_at", null),
  ]);

  const planRows = (plans ?? []) as PlanRow[];
  const planIds = planRows.map((p) => p.id);
  const { data: outcomes } = planIds.length
    ? await supabase.from("trigger_plan_outcomes").select("plan_id, followed").eq("user_id", userId).in("plan_id", planIds)
    : { data: [] as OutcomeRow[] };

  const eventsByTrigger = new Map<string, EventRow[]>();
  for (const event of (events ?? []) as EventRow[]) {
    const list = eventsByTrigger.get(event.trigger_id) ?? [];
    list.push(event);
    eventsByTrigger.set(event.trigger_id, list);
  }

  const outcomesByPlan = new Map<string, { followed: number; skipped: number }>();
  for (const outcome of (outcomes ?? []) as OutcomeRow[]) {
    const counts = outcomesByPlan.get(outcome.plan_id) ?? { followed: 0, skipped: 0 };
    if (outcome.followed) counts.followed += 1;
    else counts.skipped += 1;
    outcomesByPlan.set(outcome.plan_id, counts);
  }

  const planByTrigger = new Map<string, PlanRow>();
  for (const plan of planRows) planByTrigger.set(plan.trigger_id, plan);

  return triggers.map((trigger) => {
    const triggerEvents = eventsByTrigger.get(trigger.id) ?? [];
    const totalCount = triggerEvents.length;
    const todayCount = triggerEvents.filter((e) => e.date === todayDate).length;
    const lastOccurredAtIso = triggerEvents.reduce<string | null>((latest, e) => {
      if (!latest) return e.created_at;
      return new Date(e.created_at).getTime() > new Date(latest).getTime() ? e.created_at : latest;
    }, null);

    const planRow = planByTrigger.get(trigger.id) ?? null;
    let currentPlan: ActionPlan | null = null;
    if (planRow) {
      const counts = outcomesByPlan.get(planRow.id) ?? { followed: 0, skipped: 0 };
      currentPlan = {
        id: planRow.id,
        body: planRow.body,
        version: planRow.version,
        createdAtIso: planRow.created_at,
        followedCount: counts.followed,
        skippedCount: counts.skipped,
        mustRewrite: counts.skipped >= 3 && counts.followed === 0,
      };
    }

    return {
      id: trigger.id,
      domain: trigger.domain as DistractionDomain,
      name: trigger.name,
      description: trigger.description,
      totalCount,
      todayCount,
      lastOccurredAtIso,
      createdDate: trigger.created_at.slice(0, 10),
      currentPlan,
    };
  });
}

/** Every non-archived trigger in a domain — the capture dialog's step 2 list. */
export async function getTriggersForDomain(
  supabase: TypedClient,
  userId: string,
  todayDate: string,
  domain: DistractionDomain
): Promise<TriggerSummary[]> {
  const { data: triggers, error } = await supabase
    .from("distraction_triggers")
    .select("id, domain, name, description, created_at")
    .eq("user_id", userId)
    .eq("domain", domain)
    .eq("archived", false);
  if (error) throw error;
  return assembleSummaries(supabase, userId, todayDate, (triggers ?? []) as TriggerRow[]);
}

/** Every non-archived trigger across all domains — Home's Action Plan dialog (§6) filters via rankTriggersForPlanList. */
export async function getAllTriggers(supabase: TypedClient, userId: string, todayDate: string): Promise<TriggerSummary[]> {
  const { data: triggers, error } = await supabase
    .from("distraction_triggers")
    .select("id, domain, name, description, created_at")
    .eq("user_id", userId)
    .eq("archived", false);
  if (error) throw error;
  return assembleSummaries(supabase, userId, todayDate, (triggers ?? []) as TriggerRow[]);
}

/** Today's total distraction count across all domains — Home Focus module's subtitle. */
export async function getTodayDistractionCount(supabase: TypedClient, userId: string, todayDate: string): Promise<number> {
  const { count, error } = await supabase
    .from("distraction_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("date", todayDate);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Every trigger with at least one event today, grouped by domain in review
 * order, domains with zero events omitted entirely (spec §5). isNew is true
 * when the trigger has no current plan — the review demands one with no
 * follow/skip question in that case.
 */
export async function getReviewItems(
  supabase: TypedClient,
  userId: string,
  todayDate: string
): Promise<{ domain: DistractionDomain; items: ReviewItem[] }[]> {
  const summaries = await getAllTriggers(supabase, userId, todayDate);
  const todaysSummaries = summaries.filter((t) => t.todayCount > 0);

  const groups: { domain: DistractionDomain; items: ReviewItem[] }[] = [];
  for (const domain of REVIEW_DOMAIN_ORDER) {
    const items = todaysSummaries
      .filter((t) => t.domain === domain)
      .map((trigger) => ({ trigger, todayCount: trigger.todayCount, isNew: trigger.currentPlan === null }));
    if (items.length > 0) groups.push({ domain, items });
  }
  return groups;
}
