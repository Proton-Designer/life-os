import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, resolveLocalTime } from "@/lib/date-utils";
import { sendPushToUser } from "./send-push";
import { countDueCards } from "@/lib/self-mastery/session/build-session";

/**
 * #10: a daily push naming a real due item — "a spaced-repetition product
 * with no return trigger dies quietly" (the build plan's own words). At
 * most one per user per local day (`due_card_notification_log`, migration
 * 170, APPLIED), only for a user with a push subscription AND at least one
 * real due item, at or after a morning send threshold, copy naming that
 * item's actual front (truncated), deep-linking to `/` — where the
 * due-card entry point (`components/self-mastery/session/session-entry-
 * card.tsx`) lives; there is no separate `/review` route, the retrieval
 * session is a client overlay opened from Home.
 *
 * COVERS BOTH BOOK CARDS AND SCHOOL QUESTIONS (fixed 2026-09-14, once
 * migration 179 made questions schedulable through the SAME `card_states`
 * table) — see `getOneDueItemPrompt`'s own header for the bug this closed
 * and why `countDueCards` itself never had it. The push title still says
 * "card(s)" regardless of kind, matching this app's own existing
 * vocabulary (`components/self-mastery/session/session-entry-card.tsx`'s
 * "N cards due" already uses the identical `countDueCards` number for a
 * mixed card/question queue — this file is not introducing a new usage,
 * only following the established one).
 *
 * TRIGGER: polled by the SAME 15-minute pg_cron heartbeat as
 * `supabase/functions/dispatch-notifications` (jobid 1's schedule) via
 * `app/api/cron/daily-due-card/route.ts` — NOT a second parallel cron
 * schedule (Opus Lead's explicit instruction). That Edge Function itself
 * is left untouched (prayer-specific, Deno-only, "leave it alone" per
 * `send-push.ts`'s own header) — this is reached by a SEPARATE HTTP call
 * the SAME cron job also makes (a second `net.http_post` inside jobid 1's
 * own `cron.job` command), which is an operator-state change (not a
 * migration; see migration 166's own comment on why `cron.schedule()`
 * registration lives outside `supabase/migrations/`), so it is the lead's
 * to apply, not a file this track edits.
 *
 * THE SEND WINDOW (Opus Lead review, 2026-09-14): a 15-minute cron with no
 * time-of-day gate would push every user with due cards the moment
 * midnight passes locally — real, but not what "daily notification" means
 * to a person. `profiles.checkin_window_start` (the user's own configured
 * start-of-day, already used by `lib/home/get-day-shape.ts` and the
 * check-in scheduler for the identical "when does this user's day begin"
 * question) doubles as the send threshold here rather than inventing a
 * SECOND per-user time preference — `components/settings/notification-
 * settings.tsx` was checked first and manages only push PERMISSION
 * grants, no timing at all. Falls back to `DEFAULT_SEND_HOUR_LOCAL`
 * ("08:00", the SAME default `get-day-shape.ts` already uses for a profile
 * with no `checkin_window_start`) when the profile has none. Computed via
 * `resolveLocalTime` (never raw `Date` math, CLAUDE.md's hard constraint).
 *
 * THE WINDOW IS BOUNDED, `[threshold, threshold + 3h)`, not open-ended —
 * see `isWithinSendWindow`'s own comment for why an open "any time at or
 * after threshold" reading can't simultaneously satisfy "23:59 local ->
 * no send" and "08:00 local -> send" on the same day. 3 hours (widened
 * from an initial 1h, Opus Lead review, 2026-09-14): a 1h/four-tick window
 * gives a transient push-service outage, or a card that first becomes due
 * at 09:05, no real retry room before the day's slot is gone for good.
 * 3h still can never reach evening or midnight.
 *
 * REUSES `countDueCards` (lib/self-mastery/session/build-session.ts)
 * rather than re-deriving "how many cards are due" a second way — the
 * Phase 1 build plan's own rule for #24 ("don't build a second scheduler")
 * applies here too: one definition of "due," not two that could disagree.
 *
 * CLAIM-FIRST, NOT CHECK-THEN-SEND-THEN-RECORD (Opus Lead review,
 * 2026-09-14 — the first version of this file used check-then-send-then-
 * record, matching notify-core.ts's own idiom, but that idiom is only
 * double-send-safe when the caller can never genuinely overlap; a 15-
 * minute cron poller calling an HTTP route has no such guarantee). The
 * `due_card_notification_log_user_date_key` UNIQUE INDEX (migration 170)
 * is used as the actual lock: this file INSERTS the `(user_id, sent_date)`
 * claim row FIRST, before ever calling `sendPushToUser`. Two overlapping
 * invocations both attempting to claim the same user's day race on that
 * one INSERT — exactly one wins; the other's insert hits `23505` and it
 * skips, never calling `sendPushToUser` at all, making a double-send for
 * the same local day structurally impossible (not just unlikely). If the
 * claim succeeds but nothing sendable turns up after all (a data
 * inconsistency — the due-card read disagrees with `countDueCards`) OR
 * `sendPushToUser` reports `delivered: 0` (every device rejected it), the
 * claim row is DELETED, releasing the day back to the next tick — this is
 * what preserves the original "a transient failure doesn't burn the day's
 * one shot" property under the new locking scheme.
 */

const PROMPT_TRUNCATE_LENGTH = 80;

/** No per-user notification-time setting exists yet (confirmed by reading components/settings/notification-settings.tsx, which manages only push permission) — this mirrors lib/home/get-day-shape.ts's own DEFAULT_WAKE_TIME fallback for profiles.checkin_window_start, not a new constant invented for this feature. */
const DEFAULT_SEND_HOUR_LOCAL = "08:00";

/** Collapses whitespace/newlines to single spaces (a card's prompt can be multi-line) and truncates to a push-notification-appropriate length with an ellipsis — never mid-surrogate-pair since this is plain truncation on a already-collapsed string, same posture as every other user-content truncation in this codebase. */
function truncatePrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PROMPT_TRUNCATE_LENGTH) return collapsed;
  return `${collapsed.slice(0, PROMPT_TRUNCATE_LENGTH - 1).trimEnd()}…`;
}

/** How long the morning send window stays open past its start — 3 hours (Opus Lead review, 2026-09-14: widened from an initial 1h, which left no real retry room for a transient push-service outage or a card that first becomes due shortly after the threshold). Not the cron's own 15-minute cadence (this app-layer window shouldn't be coupled to that ops-level interval): wide enough to absorb several missed/late ticks, narrow enough that a genuinely missed window reads as "no notification today," never a stale one arriving in the evening. */
const SEND_WINDOW_DURATION_MS = 3 * 60 * 60 * 1000;

/**
 * Whether `now` falls within this user's morning send window on `sentDate`
 * (their own local calendar day) — `[threshold, threshold + 3h)`, not an
 * open-ended "any time after threshold": a bounded window is what makes
 * "23:59 local -> no send" and "08:00 local -> send" both true at once,
 * per the Opus Lead's own test spec. See this file's header for why
 * `checkinWindowStart` is reused as the threshold rather than a new
 * per-user setting.
 */
function isWithinSendWindow(now: Date, timezone: string, sentDate: string, checkinWindowStart: string | null): boolean {
  const clockTime = (checkinWindowStart ?? DEFAULT_SEND_HOUR_LOCAL).slice(0, 5);
  const windowStart = resolveLocalTime(sentDate, clockTime, timezone);
  const windowEnd = new Date(windowStart.getTime() + SEND_WINDOW_DURATION_MS);
  return now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Attempts to claim `(user_id, sent_date)` — the lock this file's own
 * header describes. Returns true if THIS call won the claim (the insert
 * succeeded), false if someone else already holds it (a real prior send,
 * OR a genuinely concurrent tick that got there first).
 */
async function claimSendSlot(supabase: SupabaseClient, userId: string, sentDate: string): Promise<boolean> {
  const { error } = await supabase.from("due_card_notification_log").insert({ user_id: userId, sent_date: sentDate });
  if (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  return true;
}

/** Releases a claim this call itself just won, after determining nothing was actually sent — safe to call unconditionally on that path: only the winner of claimSendSlot ever reaches here for this (user_id, sent_date) pair. */
async function releaseSendSlot(supabase: SupabaseClient, userId: string, sentDate: string): Promise<void> {
  const { error } = await supabase.from("due_card_notification_log").delete().eq("user_id", userId).eq("sent_date", sentDate);
  if (error) throw error;
}

/**
 * The actual front (prompt) of ONE due item — a book card OR a school
 * question — truncated. Picks the MOST OVERDUE row (earliest `due_at`) so
 * the copy names a specific, real piece of content rather than an
 * arbitrary one.
 *
 * BOTH KINDS, because `card_states` is the ONE FSRS-scheduled table for
 * both (migration 111's unification, 179's "every question gets a
 * card_states row" — `card_states_item_xor` guarantees exactly one of
 * `card_id`/`question_id` is set per row). `countDueCards` (lib/self-
 * mastery/session/build-session.ts) already counts both kinds — its
 * `.select("card_id", {count:"exact",head:true})` filters on `user_id`/
 * `state`/`due_at` only, never on `card_id` being non-null, so a
 * question-only due queue was already reflected in the NUMBER this file
 * sends. The bug this function used to have was narrower but real: it
 * only ever looked up `cards`, so if the single MOST OVERDUE row happened
 * to be question-backed, the `cards` lookup found nothing (`.eq("id",
 * null)` matches no row in SQL) and the whole notification was skipped —
 * silently dropping a real due-question-only day, and even a mixed day
 * where the single most-overdue item happened to be a question. Found and
 * fixed 2026-09-14 (Opus Lead review, once questions became schedulable
 * via 179).
 *
 * Returns null only when `card_states` disagrees with the caller's own
 * `countDueCards() > 0` read (a data inconsistency, not "nothing due" —
 * callers already checked that before calling this) — in that case,
 * callers release their claim and skip rather than push a notification
 * with no real content to name.
 */
async function getOneDueItemPrompt(supabase: SupabaseClient, userId: string, now: Date): Promise<string | null> {
  const { data: state, error: stateError } = await supabase
    .from("card_states")
    .select("card_id, question_id")
    .eq("user_id", userId)
    .neq("state", "new")
    .lte("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (stateError) throw stateError;
  if (!state) return null;

  const row = state as { card_id: string | null; question_id: string | null };

  if (row.card_id) {
    const { data: card, error: cardError } = await supabase
      .from("cards")
      .select("prompt")
      .eq("id", row.card_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card) return null;
    return truncatePrompt((card as { prompt: string }).prompt);
  }

  if (row.question_id) {
    const { data: question, error: questionError } = await supabase
      .from("questions")
      .select("prompt")
      .eq("id", row.question_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (questionError) throw questionError;
    if (!question) return null;
    return truncatePrompt((question as { prompt: string }).prompt);
  }

  // card_states_item_xor (migration 111) guarantees exactly one of
  // card_id/question_id is set on every row -- unreachable in practice,
  // kept as an explicit, honest "nothing to name" rather than a silent
  // fallthrough returning undefined.
  return null;
}

export interface DueCardNotificationDispatchResult {
  /** Distinct users with at least one push subscription — the pool this tick considered, not just the ones it sent to. */
  usersChecked: number;
  dispatched: number;
}

export async function dispatchDueCardNotifications(supabase: SupabaseClient, now: Date): Promise<DueCardNotificationDispatchResult> {
  const { data: subsRows, error: subsError } = await supabase.from("push_subscriptions").select("user_id");
  if (subsError) throw subsError;
  const userIds = [...new Set((subsRows ?? []).map((r: { user_id: string }) => r.user_id))];
  if (userIds.length === 0) return { usersChecked: 0, dispatched: 0 };

  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, timezone, checkin_window_start")
    .in("user_id", userIds);
  if (profileError) throw profileError;
  const profileByUser = new Map(
    (profileRows ?? []).map((p: { user_id: string; timezone: string | null; checkin_window_start: string | null }) => [
      p.user_id,
      { timezone: p.timezone ?? "UTC", checkinWindowStart: p.checkin_window_start },
    ])
  );

  let dispatched = 0;
  for (const userId of userIds) {
    const profile = profileByUser.get(userId) ?? { timezone: "UTC", checkinWindowStart: null };
    // "Daily" means the USER's local day (AGENTS.md's calendar-date rule),
    // never the server's UTC day — the same reason this repo never derives
    // a calendar date from a raw Date.
    const sentDate = localDateString(now, profile.timezone);

    if (!isWithinSendWindow(now, profile.timezone, sentDate, profile.checkinWindowStart)) continue;

    const dueCount = await countDueCards(supabase as Parameters<typeof countDueCards>[0], userId, now);
    if (dueCount === 0) continue;

    // THE LOCK: claim this user's day before doing anything else that could
    // race. A false return means someone else already holds it (a real
    // prior send today, or a concurrent tick that won the race) — skip
    // without ever calling sendPushToUser.
    if (!(await claimSendSlot(supabase, userId, sentDate))) continue;

    const prompt = await getOneDueItemPrompt(supabase, userId, now);
    if (prompt === null) {
      await releaseSendSlot(supabase, userId, sentDate);
      continue;
    }

    const title = dueCount === 1 ? "1 card is due" : `${dueCount} cards are due`;
    const result = await sendPushToUser(supabase, userId, title, prompt, "/");
    if (result.delivered > 0) {
      dispatched++;
    } else {
      await releaseSendSlot(supabase, userId, sentDate);
    }
  }

  return { usersChecked: userIds.length, dispatched };
}
