import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import type { DistractionDomain } from "./types";

/**
 * `core(supabase, userId, ...)` extraction for the MCP write path — same
 * rule as lib/deen/actions-core.ts: NEVER calls `requireUser()`/
 * `getProfile()`/`getAuthedUser()`. `timezone`/`now` are explicit
 * parameters (never fetched or `new Date()`'d inside this file), mirroring
 * deen's core for the same reason: the date-boundary logic below (`date`
 * is always the caller's LOCAL calendar day, never derived from a raw
 * `Date`) is pinned by a test that controls `now`/`timezone` directly,
 * with zero Supabase mocking needed for the date math itself.
 */

/**
 * Deen Mode (profiles.deen_mode) gate for the religious corners of
 * distractions: a NEW "deen"-domain trigger, and a reflection tier (which
 * writes a reflection_entries row -- deen data). Existing rows are never
 * touched; OFF only refuses new writes. Fails closed (missing row/column =
 * OFF). Reads the one profile column directly because this core never calls
 * getProfile() (see header).
 */
export const DEEN_MODE_OFF_MESSAGE = "Faith Mode is off -- turn it on in Settings to use Faith distractions or reflection tiers.";

async function assertDeenModeOn(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase.from("profiles").select("deen_mode").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if ((data as { deen_mode?: boolean | null } | null)?.deen_mode !== true) throw new Error(DEEN_MODE_OFF_MESSAGE);
}

const DISTRACTION_DOMAINS: readonly DistractionDomain[] = ["deen", "business", "school", "fitness", "co_op"];

function isDistractionDomain(value: unknown): value is DistractionDomain {
  return typeof value === "string" && (DISTRACTION_DOMAINS as readonly string[]).includes(value);
}

function isReflectionTier(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

/**
 * Verifies `triggerId` actually belongs to `userId` before anything writes
 * against it. THE ORIGINAL cookie-authed `insertEvent` (app/(app)/
 * distractions/actions.ts) does NOT do this check — it inserts
 * `distraction_events` with a caller-supplied `trigger_id` with no
 * ownership lookup at all, trusting RLS on the EVENT row's own `user_id`
 * alone. That leaves a real, PRE-EXISTING gap: nothing stops a
 * `distraction_events` row from pointing `trigger_id` at another user's
 * trigger (the FK only requires the trigger to exist, not that it belongs
 * to the same user), which would show up cross-tenant on whichever side
 * ever reads `distraction_events.trigger_id` and joins back to
 * `distraction_triggers`. Found while wiring this domain, not assumed
 * away — flagged to the lead in the handoff report, same posture
 * write-registry.ts's own header already takes on the analogous school/
 * co_op gap. Added HERE rather than "fixed" in the original cookie path,
 * which is a separate decision belonging to whoever owns that file.
 */
async function assertTriggerOwnership(supabase: SupabaseClient, userId: string, triggerId: string): Promise<void> {
  const { data, error } = await supabase.from("distraction_triggers").select("id").eq("id", triggerId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No trigger found with id "${triggerId}" for this user.`);
}

async function insertEventCore(
  supabase: SupabaseClient,
  userId: string,
  triggerId: string,
  date: string,
  tier?: 1 | 2 | 3,
  /**
   * The work_sessions row active when this distraction was captured (#52,
   * migration 169) — null/undefined whenever no Lock-In/Deep Study session
   * is running, which is the common case for both the capture dialog and
   * this MCP write path. Added as the LAST, optional parameter deliberately
   * so `lib/mcp/write-registry.ts`'s existing calls into `captureCore`/
   * `logEventCore` (which have no notion of a browser-side active session)
   * keep working unchanged.
   */
  sessionId?: string | null,
): Promise<{ eventId: string; reflectionEntryId: string | null }> {
  let reflectionEntryId: string | null = null;
  if (tier) {
    const { data: entry, error: entryError } = await supabase.from("reflection_entries").insert({ user_id: userId, date, tier }).select("id").single();
    if (entryError) throw entryError;
    reflectionEntryId = entry.id;
  }

  const { data: event, error } = await supabase
    .from("distraction_events")
    .insert({
      user_id: userId,
      trigger_id: triggerId,
      date,
      reflection_tier: tier ?? null,
      reflection_entry_id: reflectionEntryId,
      session_id: sessionId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { eventId: event.id, reflectionEntryId };
}

export interface CaptureResult {
  triggerId: string;
  eventId: string;
  reflectionEntryId: string | null;
}

/**
 * "I just got distracted by my phone" — the natural-language shape: the
 * model has a NAME, not a trigger id. Mirrors `createTriggerAndLog`
 * (app/(app)/distractions/actions.ts) exactly, including its
 * find-or-reuse-by-name idempotency (a double-submit of the same name
 * reuses the existing non-archived trigger rather than erroring or
 * duplicating, via the same 23505-on-`distraction_triggers_unique_name`
 * branch that function uses).
 */
export async function captureCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  domain: unknown,
  name: unknown,
  description: unknown,
  tier: unknown,
  /** See insertEventCore's own doc comment — optional, last, defaults to no link. */
  sessionId?: string | null,
): Promise<CaptureResult> {
  if (!isDistractionDomain(domain)) {
    throw new Error(`patch.domain must be one of: ${DISTRACTION_DOMAINS.join(", ")}. Got: ${JSON.stringify(domain)}.`);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("patch.name is required and must be a non-empty string.");
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    throw new Error(`patch.description must be a string or null. Got: ${JSON.stringify(description)}.`);
  }
  if (tier !== undefined && !isReflectionTier(tier)) {
    throw new Error(`patch.tier must be 1, 2, or 3 if given. Got: ${JSON.stringify(tier)}.`);
  }

  if (domain === "deen" || tier !== undefined) await assertDeenModeOn(supabase, userId);

  const date = localDateString(now, timezone);
  const trimmedName = name.trim();
  const trimmedDescription = typeof description === "string" ? description.trim() || null : (description ?? null);

  const { data: created, error } = await supabase
    .from("distraction_triggers")
    .insert({ user_id: userId, domain, name: trimmedName, description: trimmedDescription })
    .select("id")
    .single();

  let triggerId: string;
  if (error) {
    if (error.code !== "23505") throw error;
    const { data: existing, error: lookupError } = await supabase
      .from("distraction_triggers")
      .select("id")
      .eq("user_id", userId)
      .eq("domain", domain)
      .ilike("name", trimmedName)
      .eq("archived", false)
      .single();
    if (lookupError) throw lookupError;
    triggerId = existing.id;
  } else {
    triggerId = created.id;
  }

  const { eventId, reflectionEntryId } = await insertEventCore(supabase, userId, triggerId, date, tier as 1 | 2 | 3 | undefined, sessionId);
  return { triggerId, eventId, reflectionEntryId };
}

export interface LogEventResult {
  eventId: string;
  reflectionEntryId: string | null;
}

/**
 * Logs against an ALREADY-KNOWN trigger id (the model just read the
 * trigger list via `read`, or captured it moments ago) — mirrors
 * `logDistraction` exactly, plus the ownership check `assertTriggerOwnership`
 * documents adding on top of the original.
 */
export async function logEventCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  triggerId: unknown,
  tier: unknown,
  /** See insertEventCore's own doc comment — optional, last, defaults to no link. */
  sessionId?: string | null,
): Promise<LogEventResult> {
  if (typeof triggerId !== "string" || triggerId.length === 0) {
    throw new Error("patch.trigger_id is required and must be a non-empty string.");
  }
  if (tier !== undefined && !isReflectionTier(tier)) {
    throw new Error(`patch.tier must be 1, 2, or 3 if given. Got: ${JSON.stringify(tier)}.`);
  }

  if (tier !== undefined) await assertDeenModeOn(supabase, userId);
  await assertTriggerOwnership(supabase, userId, triggerId);
  const date = localDateString(now, timezone);
  const { eventId, reflectionEntryId } = await insertEventCore(supabase, userId, triggerId, date, tier as 1 | 2 | 3 | undefined, sessionId);
  return { eventId, reflectionEntryId };
}

export interface SaveActionPlanResult {
  triggerId: string;
  /** True when this call created version 1 via save_trigger_plan; false when it edited the existing current version's body in place. */
  createdNewVersion: boolean;
}

/**
 * Mirrors `saveActionPlan` exactly: edits the current version's body in
 * place if one exists, otherwise creates version 1 via the
 * `save_trigger_plan` RPC (migration 041) — the RPC's own supersede-then-
 * insert transaction is only invoked for an actual NEW version (via
 * `recordPlanOutcomeCore` below), never reimplemented here.
 */
export async function saveActionPlanCore(supabase: SupabaseClient, userId: string, triggerId: unknown, body: unknown): Promise<SaveActionPlanResult> {
  if (typeof triggerId !== "string" || triggerId.length === 0) {
    throw new Error("patch.trigger_id is required and must be a non-empty string.");
  }
  if (typeof body !== "string" || body.trim().length === 0) {
    throw new Error("patch.body is required and must be a non-empty string.");
  }

  await assertTriggerOwnership(supabase, userId, triggerId);

  const { data: current, error: currentError } = await supabase
    .from("trigger_action_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("trigger_id", triggerId)
    .is("superseded_at", null)
    .maybeSingle();
  if (currentError) throw currentError;

  if (current) {
    const { error } = await supabase.from("trigger_action_plans").update({ body }).eq("id", current.id).eq("user_id", userId);
    if (error) throw error;
    return { triggerId, createdNewVersion: false };
  }

  const { error } = await supabase.rpc("save_trigger_plan", { p_trigger_id: triggerId, p_body: body });
  if (error) throw error;
  return { triggerId, createdNewVersion: true };
}

export interface RecordPlanOutcomeResult {
  triggerId: string;
  date: string;
  followed: boolean;
}

/**
 * "That plan didn't work" — mirrors `recordPlanOutcome` exactly, calling
 * the SAME `record_plan_outcome` RPC (migration 043) the cookie-authed path
 * uses, for the same reason `save_allocation_checkin` is called rather than
 * reimplemented: the "3 skips, 0 follows forces a rewrite" business rule is
 * duplicated INSIDE that RPC's own transaction deliberately (its own header
 * comment: "only a check made INSIDE this transaction can raise before the
 * outcome row commits") — reimplementing it a second time here, in
 * app-layer TypeScript, would be exactly the kind of drift the RPC's design
 * was built to prevent. The one thing added on top: a friendlier pre-check
 * for "no current plan at all," so a caller gets a message pointing at
 * `action_plan.save` rather than the RPC's own `no current plan for
 * trigger <uuid>` — a light existence check, not a duplication of the real
 * (multi-row-counting) forced-rewrite rule.
 */
export async function recordPlanOutcomeCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  triggerId: unknown,
  followed: unknown,
  newPlanBody: unknown,
): Promise<RecordPlanOutcomeResult> {
  if (typeof triggerId !== "string" || triggerId.length === 0) {
    throw new Error("patch.trigger_id is required and must be a non-empty string.");
  }
  if (typeof followed !== "boolean") {
    throw new Error(`patch.followed is required and must be a boolean. Got: ${JSON.stringify(followed)}.`);
  }
  if (newPlanBody !== undefined && (typeof newPlanBody !== "string" || newPlanBody.trim().length === 0)) {
    throw new Error("patch.new_plan_body must be a non-empty string if given.");
  }

  await assertTriggerOwnership(supabase, userId, triggerId);

  const { data: current, error: currentError } = await supabase
    .from("trigger_action_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("trigger_id", triggerId)
    .is("superseded_at", null)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) {
    throw new Error(`Trigger "${triggerId}" has no action plan yet — call distractions.action_plan.save first.`);
  }

  const date = localDateString(now, timezone);
  const { error } = await supabase.rpc("record_plan_outcome", {
    p_trigger_id: triggerId,
    p_followed: followed,
    p_date: date,
    p_new_plan_body: newPlanBody ?? null,
  });
  if (error) throw new Error(error.message);

  return { triggerId, date, followed };
}
