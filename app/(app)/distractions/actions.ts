"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getTriggersForDomain, getTodayDistractionCount, getSessionDistractionCount } from "@/lib/distractions/queries";
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
  const date = await todayForUser(supabase, userId);
  return getTriggersForDomain(supabase, userId, date, domain);
}

/**
 * Client-callable wrapper for the top bar's live badge (#50) — same idiom as
 * app/(app)/actions.ts's getNotificationsForNow: the topbar (client component)
 * polls this directly rather than being handed a count as a prop from a Server
 * Component (AGENTS.md's Server->Client boundary rule is actually about never
 * passing a FUNCTION, but a polled value sidesteps the staleness problem a
 * server-rendered prop would have too — the count would otherwise only update
 * on whatever page's own revalidatePath("/") happened to fire, not on every
 * route the topbar renders on). Reuses todayForUser/getTodayDistractionCount,
 * the exact same query Home's Focus module and the evening close already call.
 */
export async function getTodayDistractionCountForNow(): Promise<number> {
  const { supabase, userId } = await requireUser();
  const date = await todayForUser(supabase, userId);
  return getTodayDistractionCount(supabase, userId, date);
}

/**
 * #52's live "N this session" counter — same client-polls-a-server-action
 * idiom as `getTodayDistractionCountForNow` above and `topbar.tsx`'s own
 * `DistractionCountBadge` (60s poll), scoped to one session id instead of
 * "today." Returns 0 for an unowned/foreign session id rather than leaking
 * whether it exists — `getSessionDistractionCount` is itself scoped to
 * `user_id = userId`, so a session belonging to someone else can never
 * return a nonzero count here.
 */
export async function getSessionDistractionCountForNow(sessionId: string): Promise<number> {
  const { supabase, userId } = await requireUser();
  return getSessionDistractionCount(supabase, userId, sessionId);
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
  const date = await todayForUser(supabase, userId);
  await insertEvent(supabase, userId, triggerId, date, tier, sessionId);
  revalidatePath("/");
  if (tier) revalidatePath("/deen");
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
  revalidatePath("/");
  if (input.tier) revalidatePath("/deen");
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

  revalidatePath("/");
  revalidatePath("/review");
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

  revalidatePath("/");
  revalidatePath("/review");
}
