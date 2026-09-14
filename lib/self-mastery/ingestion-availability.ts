import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";

/**
 * Is book ingestion actually available in this deployment?
 *
 * WHY THIS EXISTS (2026-09-01, found by the stranger-journey acceptance run)
 *
 * `uploadBook` does exactly what it claims: stores the PDF, sets the book to
 * `processing`, and inserts an `ingestion_jobs` row at `stage: "queued"`.
 * If nothing consumes that queue, the book strands at "processing" forever
 * with no timeout and no failure path. **That is worse than not offering
 * the feature.** An absent feature is a gap; an inviting button that
 * silently eats a file is a broken promise, and the user's reasonable
 * conclusion is that the app is broken rather than incomplete.
 *
 * GATED ON A LIVE CONSUMER, NOT ON A CREDENTIAL — and this distinction is
 * the whole point of this file, unchanged from its original form.
 *
 * When bring-your-own-key landed, the obvious move was to light uploads up
 * for any user who supplied a DeepSeek key. That would have re-created the
 * exact bug this file exists to prevent: a key lets you CALL a model, but
 * ingestion needs a process that claims `ingestion_jobs`, parses a PDF, and
 * writes lessons and cards. A user's personal key can never satisfy this
 * gate, because a credential is not a consumer.
 *
 * REVISION (S6, 2026-09-14): THE SIGNAL CHANGED, THE ARGUMENT DID NOT.
 * The original gate keyed off `SELF_MASTERY_INGESTION_URL` — the address of
 * a separate worker service (ULM's `apps/worker`) that was never ported to
 * this repo. That architecture is retired: the real consumer is now
 * `app/api/self-mastery/ingestion/step`, an in-app route driven by a
 * pg_cron + pg_net poll (the same proven idiom as `mcp-scheduled-actions`,
 * jobid 2) — there is no separate worker URL for an env var to name.
 *
 * The tempting replacement — gate on `SELF_MASTERY_INGESTION_SECRET`, the
 * route's own bearer secret, being set — is REJECTED here on purpose, for
 * the identical reason a DeepSeek key was rejected: **a secret that lets a
 * caller authenticate to the route is a credential, not proof anything
 * calls it on a schedule.** An operator could set that secret while
 * forgetting (or failing) to actually create the cron job, and the gate
 * would open on a route nobody is polling — the exact bug this file exists
 * to prevent, wearing a different credential.
 *
 * So the signal is `ingestion_driver_heartbeats` — a one-row table the
 * route itself writes to on every authenticated invocation, INCLUDING when
 * there was no eligible job to claim (see `recordIngestionDriverHeartbeat`
 * below and the route's own call site). Its recency is not "a worker
 * process exists" or "a cron job is scheduled" — both of those can be true
 * while nothing actually happens (a paused cron job, a broken deploy, a
 * secret mismatch that 401s every tick). It is "something authenticated
 * hit this route within the last few minutes," which is the actual
 * invariant a user uploading a book needs to hold. If the driver stops —
 * disabled, broken, mis-scheduled — this gate closes itself within
 * `HEARTBEAT_STALE_AFTER_MS`, with no one needing to remember to flip a
 * flag back off. That is a STRONGER form of the same "gate on the worker,
 * not a credential" argument, not a departure from it.
 *
 * Server-only. The UI hides the affordance and `uploadBook` refuses
 * independently — a UI-only guard and a server guard produce the same
 * observation from a click-through, and only one of them is the invariant.
 * That is the same rule `e2e/onboarding.spec.ts` asserts for the
 * minimum-one-subdomain rule.
 */

// The recommended cron cadence for the driver is every 1 minute (pg_cron's
// native granularity — see the build report for the throughput math this
// is based on). Five whole missed ticks' worth of slack before the gate
// closes: enough to absorb an ordinary blip (a slow deploy, a transient
// pg_net failure) without flapping the upload button on and off, while
// still closing well within a user's own session if the driver genuinely
// stops.
const HEARTBEAT_STALE_AFTER_MS = 5 * 60 * 1000;

const HEARTBEAT_COLLECTION = "ingestion_driver_heartbeats";
const HEARTBEAT_ROW_ID = 1;

/**
 * Reads the driver's own liveness signal. Uses its OWN service-role client
 * rather than accepting the caller's session client — this is
 * infrastructure state (is the driver alive), not user data, and every
 * call site (a Server Component rendering the library, a Server Action
 * deciding whether to accept an upload) needs the same answer regardless
 * of whose session is asking. Fails CLOSED: any read error (table not yet
 * migrated, connection failure, no row) reads as unavailable — the same
 * "absence is a guarded presence, never assumed" posture as the pre-S6
 * env-var check.
 */
export async function isIngestionAvailable(): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await untypedFrom(supabase, HEARTBEAT_COLLECTION)
    .select("last_polled_at")
    .eq("id", HEARTBEAT_ROW_ID)
    .maybeSingle()
    .returns<{ last_polled_at: string } | null>();
  if (error || !data) return false;

  const ageMs = Date.now() - new Date(data.last_polled_at).getTime();
  return ageMs < HEARTBEAT_STALE_AFTER_MS;
}

/**
 * Writes the driver's liveness signal. Called by
 * app/api/self-mastery/ingestion/step's route on every authenticated
 * invocation — success, failure, or "nothing to do" alike — because the
 * fact being recorded is "something authenticated reached this route just
 * now," not "a job existed" or "a job succeeded." Best-effort: a failure to
 * write the heartbeat must never fail the invocation that's actually doing
 * (or attempting) real ingestion work, so this only logs and returns
 * false rather than throwing. The caller passes its own already-created
 * service-role client rather than this file creating a second one per
 * invocation.
 */
export async function recordIngestionDriverHeartbeat(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await untypedFrom(supabase, HEARTBEAT_COLLECTION)
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", HEARTBEAT_ROW_ID);
  if (error) {
    console.error("[self-mastery] recordIngestionDriverHeartbeat: write failed", error.message);
    return false;
  }
  return true;
}

/** Shown wherever the upload affordance would otherwise be. Honest, not coy. */
export const INGESTION_UNAVAILABLE_MESSAGE =
  "Adding your own books isn't available yet — the service that turns a PDF into lesson cards isn't connected. Your starter deck is ready to study in the meantime.";
