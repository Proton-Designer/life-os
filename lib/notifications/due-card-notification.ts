import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import { sendPushToUser } from "./send-push";
import { countDueCards } from "@/lib/self-mastery/session/build-session";

/**
 * #10: a daily push naming a real due card — "a spaced-repetition product
 * with no return trigger dies quietly" (the build plan's own words). At
 * most one per user per local day (`due_card_notification_log`, migration
 * 170's DB uniqueness, not in-process memory), only for a user with a push
 * subscription AND at least one real due card, copy naming that card's
 * actual front (truncated), deep-linking to `/` — where the due-card entry
 * point (`components/self-mastery/session/session-entry-card.tsx`) lives;
 * there is no separate `/review` route, the retrieval session is a client
 * overlay opened from Home.
 *
 * TRIGGER: polled by the SAME 15-minute pg_cron heartbeat as
 * `supabase/functions/dispatch-notifications` (jobid 1's schedule) via
 * `app/api/cron/daily-due-card/route.ts` — NOT a second parallel cron
 * schedule (Opus Lead's explicit instruction). That Edge Function itself
 * is left untouched (prayer-specific, Deno-only, "leave it alone" per
 * `send-push.ts`'s own header) — this is reached by a SEPARATE HTTP call
 * the SAME cron job also makes, which is an operator-state change to the
 * `cron.job` row (not a migration; see migration 166's own comment on why
 * `cron.schedule()` registration lives outside `supabase/migrations/`), so
 * it is the lead's to apply, not a file this track edits.
 *
 * REUSES `countDueCards` (lib/self-mastery/session/build-session.ts)
 * rather than re-deriving "how many cards are due" a second way — the
 * Phase 1 build plan's own rule for #24 ("don't build a second scheduler")
 * applies here too: one definition of "due," not two that could disagree.
 *
 * CHECK-THEN-SEND-THEN-RECORD, the SAME order and reasoning
 * `lib/notifications/notify-core.ts`'s `sendScheduledNotificationCore`
 * already established: the dispatch-log row is written ONLY after
 * `sendPushToUser` reports `delivered > 0` (a real send succeeded to at
 * least one device). A transient push failure (every device rejects,
 * VAPID hiccup) writes nothing, so the NEXT 15-minute tick — still today,
 * still this same local day — genuinely retries, rather than a failed
 * attempt permanently burning the day's one notification.
 */

const PROMPT_TRUNCATE_LENGTH = 80;

/** Collapses whitespace/newlines to single spaces (a card's prompt can be multi-line) and truncates to a push-notification-appropriate length with an ellipsis — never mid-surrogate-pair since this is plain truncation on a already-collapsed string, same posture as every other user-content truncation in this codebase. */
function truncatePrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PROMPT_TRUNCATE_LENGTH) return collapsed;
  return `${collapsed.slice(0, PROMPT_TRUNCATE_LENGTH - 1).trimEnd()}…`;
}

async function alreadyNotifiedToday(supabase: SupabaseClient, userId: string, sentDate: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("due_card_notification_log")
    .select("id")
    .eq("user_id", userId)
    .eq("sent_date", sentDate)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function markNotified(supabase: SupabaseClient, userId: string, sentDate: string): Promise<void> {
  const { error } = await supabase.from("due_card_notification_log").insert({ user_id: userId, sent_date: sentDate });
  // 23505 means a genuinely concurrent tick already recorded today for this
  // user (the same residual gap notify-core.ts's own header names) — the
  // push already happened either way, nothing more to record.
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

/**
 * The actual front (prompt) of ONE due card, truncated — picks the MOST
 * OVERDUE card (earliest `due_at`) so the copy names a specific, real
 * piece of content rather than an arbitrary one. Returns null only when
 * `card_states`/`cards` disagree with the caller's own `countDueCards() >
 * 0` read (a data inconsistency, not "nothing due" — callers already
 * checked that before calling this) — in that case, callers skip sending
 * rather than push a notification with no real content to name.
 */
async function getOneDueCardPrompt(supabase: SupabaseClient, userId: string, now: Date): Promise<string | null> {
  const { data: state, error: stateError } = await supabase
    .from("card_states")
    .select("card_id")
    .eq("user_id", userId)
    .neq("state", "new")
    .lte("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (stateError) throw stateError;
  if (!state) return null;

  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("prompt")
    .eq("id", (state as { card_id: string }).card_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (cardError) throw cardError;
  if (!card) return null;

  return truncatePrompt((card as { prompt: string }).prompt);
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

  const { data: profileRows, error: profileError } = await supabase.from("profiles").select("user_id, timezone").in("user_id", userIds);
  if (profileError) throw profileError;
  const timezoneByUser = new Map(
    (profileRows ?? []).map((p: { user_id: string; timezone: string | null }) => [p.user_id, p.timezone ?? "UTC"])
  );

  let dispatched = 0;
  for (const userId of userIds) {
    const timezone = timezoneByUser.get(userId) ?? "UTC";
    // "Daily" means the USER's local day (AGENTS.md's calendar-date rule),
    // never the server's UTC day — the same reason this repo never derives
    // a calendar date from a raw Date.
    const sentDate = localDateString(now, timezone);

    if (await alreadyNotifiedToday(supabase, userId, sentDate)) continue;

    const dueCount = await countDueCards(supabase as Parameters<typeof countDueCards>[0], userId, now);
    if (dueCount === 0) continue;

    const prompt = await getOneDueCardPrompt(supabase, userId, now);
    if (prompt === null) continue;

    const title = dueCount === 1 ? "1 card is due" : `${dueCount} cards are due`;
    const result = await sendPushToUser(supabase, userId, title, prompt, "/");
    if (result.delivered > 0) {
      await markNotified(supabase, userId, sentDate);
      dispatched++;
    }
  }

  return { usersChecked: userIds.length, dispatched };
}
