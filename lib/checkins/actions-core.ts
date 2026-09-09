import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPendingAllocationQueue, supabaseDataSource } from "./get-allocation-queue";
import { TOTAL_MINUTES, DOMAIN_KEYS, wastedMinutes, emptyAllocation, type Allocation } from "./allocation";

/**
 * `core(supabase, userId, ...)` extraction for the MCP write path — same
 * rule as lib/deen/actions-core.ts: NEVER calls `requireUser()`/
 * `getProfile()`/`getAuthedUser()`. `now` is an explicit parameter, never
 * `new Date()` inside this file, for the same testability reason deen's
 * core gives (a test pins the instant, no Supabase mocking needed for the
 * window-selection logic itself).
 *
 * UNLIKE deen's core, `timezone` is NOT threaded through here at all —
 * genuinely not needed. `getPendingAllocationQueue` (below) does its own
 * internal timezone handling (it reads `profiles.timezone` itself, the same
 * as every other caller of it), and the ad-hoc fallback window is pure
 * instant arithmetic (`now` minus a fixed number of minutes), which is
 * timezone-INVARIANT by construction — Date subtraction never needs a
 * timezone, only a CALENDAR DATE derivation does (AGENTS.md's rule), and
 * this file never derives one.
 */

export interface SaveAllocationCheckinResult {
  id: string;
  windowStart: string;
  windowEnd: string;
  allocations: Allocation;
  wastedMinutes: number;
  /** True when this call's window is today's fixed 120-minute (or trailing-partial, see below) scheduled slot; false when nothing was pending/recent and an ad-hoc now-120min window was used instead — see resolveTargetWindow's own comment. Surfaced so a caller can tell "answered a real scheduled slot" from "logged an ad-hoc block" if it matters downstream. */
  wasScheduledWindow: boolean;
}

/**
 * Picks the window to record against — REUSES, byte-for-byte, the same
 * three-tier fallback `AllocationCheckinGate` (components/checkin/
 * allocation-checkin-gate.tsx) already uses for its own "always available"
 * manual check-in, rather than reimplementing window selection here. That
 * component's own comment: "pressing the icon must ALWAYS open a real,
 * saveable check-in, never a silent no-op" — exactly the guarantee an MCP
 * caller needs too, and reusing the same three tiers means a check-in
 * recorded through MCP is indistinguishable from one recorded through the
 * real UI, not a second, subtly different notion of "the current window":
 *
 *   1. `queue[0]`             — a window that fired within its answer window.
 *   2. `mostRecentUnanswered` — fired today but the answer window lapsed
 *      (still a real window — no "un-expire" step needed, see
 *      AllocationQueueResult's own doc comment).
 *   3. an ad-hoc `TOTAL_MINUTES`-long window ending `now` — no real window
 *      exists today at all (e.g. before checkin_window_start, or
 *      everything already answered).
 *
 * DELIBERATELY NOT exposed as a caller-suppliable `window_start`/
 * `window_end` patch field: letting the model freehand a window risks
 * producing a block that doesn't correspond to anything
 * `resolveAllocationSlots` (lib/checkins/schedule.ts) would ever generate,
 * and reimplementing that scheduling logic (prayer suppression, Lock-In
 * session overlap, trailing partial windows near sleep time) a second time
 * here — just to validate a caller-supplied window against it — would be
 * exactly the kind of drift-prone duplication `core()` extraction exists to
 * avoid.
 *
 * Passes `supabaseDataSource(supabase)` explicitly — NEVER the default,
 * cookie-based data source `getPendingAllocationQueue` falls back to when
 * called with no third argument. This file must never touch cookies (the
 * one rule that makes a `core()` extraction real, not cosmetic — see this
 * file's own header and lib/deen/actions-core.ts's).
 */
async function resolveTargetWindow(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ windowStart: string; windowEnd: string; wasScheduledWindow: boolean }> {
  const queueResult = await getPendingAllocationQueue(userId, now, supabaseDataSource(supabase));
  const pending = queueResult.items[0];
  if (pending) return { windowStart: pending.windowStartIso, windowEnd: pending.windowEndIso, wasScheduledWindow: true };
  if (queueResult.mostRecentUnanswered) {
    return {
      windowStart: queueResult.mostRecentUnanswered.windowStartIso,
      windowEnd: queueResult.mostRecentUnanswered.windowEndIso,
      wasScheduledWindow: true,
    };
  }
  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - TOTAL_MINUTES * 60 * 1000);
  return { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), wasScheduledWindow: false };
}

const VALID_DOMAINS = new Set<string>(DOMAIN_KEYS);

/**
 * Validates the caller's allocation map BEFORE the RPC ever runs, so a bad
 * shape produces a clear, actionable message instead of an opaque
 * constraint violation (team-lead's explicit instruction, re: migration
 * 108's `checkin_allocations_domain_wasted_xor` CHECK). Two things checked:
 *
 *   - every key is a REAL domain (deen/business/school/fitness/co_op) —
 *     "wasted" is never a valid key here. Unaccounted time is DERIVED
 *     (`wastedMinutes`, matching the real UI's own bar-fill model exactly —
 *     see components/checkin/allocation-checkin.tsx), never supplied, so
 *     there is no separate `is_wasted`/`domain` pair for a caller to set
 *     inconsistently in the first place — the XOR the DB enforces can't
 *     even be approached from this surface.
 *   - every value is a non-negative multiple of 15 (checkin_allocations'
 *     own `minutes >= 0 and minutes % 15 = 0` CHECK).
 *
 * Deliberately caps the total at `TOTAL_MINUTES` (120), NOT the resolved
 * window's actual length. This matches the real UI's own model exactly,
 * not a "more correct" recomputation: `wastedMinutes`/`setMinutes`
 * (lib/checkins/allocation.ts) and the bar's own width math
 * (allocation-checkin.tsx) are ALL hardcoded against `TOTAL_MINUTES`
 * regardless of the real window length, including for a trailing-partial
 * window shorter than 120 minutes near `checkin_window_end`
 * (lib/checkins/schedule.ts's own `ALLOCATION_WINDOW_MINUTES` comment).
 * That is a genuine, PRE-EXISTING inconsistency in the shipped app for the
 * trailing-partial case — not introduced here, and deliberately not
 * "fixed" on this one write surface only, which would make an MCP-recorded
 * trailing window compute wasted-minutes differently than the exact same
 * window recorded by a human through the real UI. Flagged to the lead
 * rather than silently diverged from.
 */
function validateAllocations(allocations: Record<string, unknown>): Allocation {
  const clean: Allocation = {};
  for (const [domain, raw] of Object.entries(allocations)) {
    if (!VALID_DOMAINS.has(domain)) {
      throw new Error(
        `"${domain}" is not a real domain (${DOMAIN_KEYS.join(", ")}). Unaccounted time is derived automatically from what's left over -- never pass "wasted" as an allocation key.`,
      );
    }
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw % 15 !== 0) {
      throw new Error(`allocations.${domain} must be a non-negative multiple of 15 (minutes). Got: ${JSON.stringify(raw)}.`);
    }
    clean[domain] = raw;
  }
  const assigned = Object.values(clean).reduce((sum, v) => sum + v, 0);
  if (assigned > TOTAL_MINUTES) {
    throw new Error(`Allocations sum to ${assigned} minutes, more than the ${TOTAL_MINUTES}-minute pool. Reduce one or more domains -- unaccounted time is derived, never negative.`);
  }
  return clean;
}

/**
 * Records an allocation check-in through the SAME `save_allocation_checkin`
 * RPC the real UI calls (app/(app)/checkin/allocation-actions.ts's
 * `saveAllocationCheckin`) — not a parallel reimplementation. One source of
 * truth for the actual write (the RPC's own atomicity, its idempotent
 * same-window no-op via `checkins_one_allocation_per_window`, and its
 * `is_wasted`/`domain` split from migration 108) is worth more than the
 * ability to express a partial edit of an already-recorded window, which
 * this does NOT support — see the handoff report for why that tradeoff was
 * made deliberately, not by default.
 */
export async function saveAllocationCheckinCore(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  rawAllocations: Record<string, unknown>,
): Promise<SaveAllocationCheckinResult> {
  const { windowStart, windowEnd, wasScheduledWindow } = await resolveTargetWindow(supabase, userId, now);
  const allocations = validateAllocations(rawAllocations);
  const wasted = wastedMinutes({ ...emptyAllocation(), ...allocations });

  const { data, error } = await supabase.rpc("save_allocation_checkin", {
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_allocations: allocations,
    p_wasted_minutes: wasted,
  });
  if (error) throw error;

  return { id: data as string, windowStart, windowEnd, allocations, wastedMinutes: wasted, wasScheduledWindow };
}
