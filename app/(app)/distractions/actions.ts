"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getTriggersForDomain } from "@/lib/distractions/queries";
import type { DistractionDomain, TriggerSummary } from "@/lib/distractions/types";

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
  tier?: 1 | 2 | 3
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

  const { error } = await supabase.from("distraction_events").insert({
    user_id: userId,
    trigger_id: triggerId,
    date,
    reflection_tier: tier ?? null,
    reflection_entry_id: reflectionEntryId,
  });
  if (error) throw error;
}

export async function logDistraction(triggerId: string, tier?: 1 | 2 | 3): Promise<void> {
  const { supabase, userId } = await requireUser();
  const date = await todayForUser(supabase, userId);
  await insertEvent(supabase, userId, triggerId, date, tier);
  revalidatePath("/");
  if (tier) revalidatePath("/deen");
}

export async function createTriggerAndLog(input: {
  domain: DistractionDomain;
  name: string;
  description: string | null;
  tier?: 1 | 2 | 3;
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

  await insertEvent(supabase, userId, triggerId, date, input.tier);
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
