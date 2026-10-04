"use server";

import { isDeenModeOnForRequest } from "@/lib/deen/deen-mode-guard";
import { withoutDeenDomain } from "@/lib/distractions/deen-filter";
import { DEEN_MODE_OFF_MESSAGE } from "@/lib/distractions/actions-core";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getTriggersForDomain, getAllTriggers, getTodayDistractionCount, getSessionDistractionCount } from "@/lib/distractions/queries";
import type { DistractionDomain, TriggerSummary } from "@/lib/distractions/types";
import type { TablesInsert } from "@/lib/supabase/database.types";

async function todayForUser(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string) {
  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return localDateString(new Date(), profile?.timezone ?? "UTC");
}

/**
 * The capture dialog (client component) can't call lib/distractions/queries.ts
 * directly — that module talks to Supabase server-side. This is the thin
 * "use server" wrapper it calls instead, same idiom as every other client
 * component that imports a server action straight into its own file.
 */
export async function listTriggersForDomain(domain: DistractionDomain): Promise<TriggerSummary[]> {
  const { supabase, userId } = await requireUser();
  // Deen Mode OFF: the deen domain lists nothing (rows kept, R4).
  if (domain === "deen" && !(await isDeenModeOnForRequest())) return [];
  const date = await todayForUser(supabase, userId);
  return getTriggersForDomain(supabase, userId, date, domain);
}

/**
 * P3-02 -- the "+1" quick-log step's own data source: EVERY trigger
 * across every domain, cross-domain, exactly like Home's Action Plan
 * dialog already reads (`getAllTriggers`, app/(app)/page.tsx) -- no new
 * query. The dialog itself calls `rankTriggersForCapture` (the SAME
 * ranking the domain-scoped step already uses) and slices to the top 6,
 * so this action stays a plain data fetch, not a second place ranking
 * logic could drift.
 */
export async function listTopTriggersForQuickLog(): Promise<TriggerSummary[]> {
  const { supabase, userId } = await requireUser();
  const date = await todayForUser(supabase, userId);
  return withoutDeenDomain(await getAllTriggers(supabase, userId, date), await isDeenModeOnForRequest());
}

/**
 * Deen tier linkage (spec §1): a tier writes a normal reflection_entries
 * row — the exact shape logReflectionEntry (deen/actions.ts) already
 * writes — so the existing Deen Reflection module lights up with no
 * changes at all, plus a distraction_events row pointing at it.
 */
async function insertEvent(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  triggerId: string,
  date: string,
  tier?: 1 | 2 | 3,
  /** #52, migration 169: the active work session at capture time, if any — see `lib/distractions/actions-core.ts`'s `insertEventCore` for the full reasoning (nullable, composite-FK'd, column-scoped ON DELETE SET NULL). */
  sessionId?: string | null
): Promise<void> {
  let reflectionEntryId: string | null = null;
  if (tier) {
    const { data: entry, error: entryError } = await supabase
      .from("reflection_entries")
      .insert({ user_id: userId, date, tier })
      .select("id")
      .single();
    if (entryError) throw entryError;
    reflectionEntryId = entry.id;
  }

  // `session_id` cast via TablesInsert — see lib/distractions/queries.ts's
  // getSessionDistractionCount comment: database.types.ts won't carry this
  // column until the Lead applies migration 169 and regenerates it. Same
  // ship-ahead-of-apply cast app/(app)/close/plan-actions.ts:253 already
  // uses for an analogous case.
  const { error } = await supabase.from("distraction_events").insert({
    user_id: userId,
    trigger_id: triggerId,
    date,
    reflection_tier: tier ?? null,
    reflection_entry_id: reflectionEntryId,
    session_id: sessionId ?? null,
  } as unknown as TablesInsert<"distraction_events">);
  if (error) throw error;
}

export async function logDistraction(triggerId: string, tier?: 1 | 2 | 3, sessionId?: string | null): Promise<void> {
  const { supabase, userId } = await requireUser();
  // A reflection tier writes a reflection_entries row (deen data): refuse when
  // Deen Mode is off. Same server-side gate as lib/distractions/actions-core.ts.
  if (tier && !(await isDeenModeOnForRequest())) throw new Error(DEEN_MODE_OFF_MESSAGE);
  const date = await todayForUser(supabase, userId);
  await insertEvent(supabase, userId, triggerId, date, tier, sessionId);
  // Hot tap: no revalidatePath here (rapid +1 taps would queue behind each other's full
  // re-render). The capture dialog schedules ONE refreshDistractionViews() (PERF-4).
}

export async function createTriggerAndLog(input: {
  domain: DistractionDomain;
  name: string;
  description: string | null;
  tier?: 1 | 2 | 3;
  /** #52 — see logDistraction's own param. */
  sessionId?: string | null;
}): Promise<{ triggerId: string }> {
  const { supabase, userId } = await requireUser();
  // New deen-domain trigger or a reflection tier = new deen data: refuse when
  // Deen Mode is off (existing rows untouched).
  if ((input.domain === "deen" || input.tier) && !(await isDeenModeOnForRequest())) throw new Error(DEEN_MODE_OFF_MESSAGE);
  const date = await todayForUser(supabase, userId);

  const { data: created, error } = await supabase
    .from("distraction_triggers")
    .insert({ user_id: userId, domain: input.domain, name: input.name, description: input.description })
    .select("id")
    .single();

  let triggerId: string;
  if (error) {
    // 23505 = unique_violation on distraction_triggers_unique_name — a
    // double-submit of the same name reuses the existing trigger rather
    // than erroring, same idempotency idiom as custom_habits' unique name.
    if (error.code !== "23505") throw error;
    const { data: existing, error: lookupError } = await supabase
      .from("distraction_triggers")
      .select("id")
      .eq("user_id", userId)
      .eq("domain", input.domain)
      .ilike("name", input.name)
      .eq("archived", false)
      .single();
    if (lookupError) throw lookupError;
    triggerId = existing.id;
  } else {
    triggerId = created.id;
  }

  await insertEvent(supabase, userId, triggerId, date, input.tier, input.sessionId);
  // No revalidatePath: the capture dialog schedules ONE refreshDistractionViews() (PERF-4).
  return { triggerId };
}

export async function updateTrigger(triggerId: string, patch: { name?: string; description?: string }): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("distraction_triggers")
    .update(patch)
    .eq("id", triggerId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/");
}

/**
 * Plain in-place edit (Home's Action Plan dialog, spec §6) — creates
 * version 1 for a trigger with no plan yet, otherwise updates the current
 * version's body without bumping it. Only recordPlanOutcome's
 * follow/skip-forced rewrites go through the save_trigger_plan RPC's
 * supersede-and-version-bump path.
 */
export async function saveActionPlan(triggerId: string, body: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: current, error: currentError } = await supabase
    .from("trigger_action_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("trigger_id", triggerId)
    .is("superseded_at", null)
    .maybeSingle();
  if (currentError) throw currentError;

  if (current) {
    const { error } = await supabase
      .from("trigger_action_plans")
      .update({ body })
      .eq("id", current.id)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.rpc("save_trigger_plan", {
      p_trigger_id: triggerId,
      p_body: body,
    });
    if (error) throw error;
  }
  // No revalidatePath: the review controls schedule ONE refreshDistractionViews() (PERF-4).
}

/**
 * "I followed it, it happened anyway" always requires a revision, and a
 * plan that's skipped 3 times with zero follows must be rewritten — the
 * client must not be able to submit either branch without one. Both the
 * check and the write happen inside record_plan_outcome's own DB
 * transaction (043_record_plan_outcome_atomic.sql), not here: a version
 * that inserted the outcome row first and rejected a missing body
 * afterward would leave that row committed, and a client retry with the
 * required body would then fail trigger_plan_outcomes_one_per_day — the
 * user could never complete the review for that trigger. The RAISE
 * EXCEPTION inside the RPC rolls the whole call back, so a rejected
 * submission never leaves partial state to retry against.
 */
export async function recordPlanOutcome(input: {
  triggerId: string;
  followed: boolean;
  newPlanBody?: string;
}): Promise<void> {
  const { supabase, userId } = await requireUser();
  const date = await todayForUser(supabase, userId);

  const { error } = await supabase.rpc("record_plan_outcome", {
    p_trigger_id: input.triggerId,
    p_followed: input.followed,
    p_date: date,
    p_new_plan_body: input.newPlanBody,
  });
  if (error) throw new Error(error.message);
  // No revalidatePath: the review controls schedule ONE refreshDistractionViews() (PERF-4).
}

/**
 * Data-free cache revalidation scheduled by the distraction capture dialog and the
 * review cards after a burst of writes (PERF-4): Home, the Deen faith surfaces a
 * reflection tier feeds, and /review.
 */
export async function refreshDistractionViews(): Promise<void> {
  await requireUser();
  revalidatePath("/");
  revalidatePath("/deen");
  // Domains-mode accounts render the Faith (Deen) surfaces under /personal/[subdomain].
  revalidatePath("/personal/[subdomain]", "page");
  revalidatePath("/review");
  // IA-P1b: the distraction-plan review lives in the evening close's Account stage now.
  revalidatePath("/close");
}
