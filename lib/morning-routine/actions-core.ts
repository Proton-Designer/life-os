import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { MAX_ROUTINE_ITEMS } from "./constants";
export { MAX_ROUTINE_ITEMS };

type TypedClient = SupabaseClient<Database>;

export type MorningRoutineItem = {
  id: string;
  label: string;
  createdAt: string;
};

export type MorningRoutineChecklistItem = MorningRoutineItem & {
  checkedToday: boolean;
};

type ItemRow = { id: string; label: string; created_at: string };

function toItem(row: ItemRow): MorningRoutineItem {
  return { id: row.id, label: row.label, createdAt: row.created_at };
}

/**
 * P3-01 -- creates a morning routine checklist item, refusing a blank label
 * and refusing past MAX_ROUTINE_ITEMS active items. THE CEILING HERE IS A
 * PRE-CHECK ONLY, not a DB-enforced scarcity index (unlike
 * identity_habits_rank_per_user_idx) -- a genuine race between two tabs can
 * still create an (MAX+1)th item; there is no rank/slot for a unique index
 * to refuse the way a 7th active habit is refused. Acceptable here: an
 * off-by-one on a soft UI ceiling has none of the "silently overwrote
 * someone's data" stakes a rank collision would.
 */
export async function createMorningRoutineItemCore(supabase: TypedClient, userId: string, label: string): Promise<MorningRoutineItem> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("A morning routine item needs a label.");
  }

  const { count, error: countError } = await supabase
    .from("morning_routine_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_ROUTINE_ITEMS) {
    throw new Error(`You already have ${MAX_ROUTINE_ITEMS} morning routine items — archive one before adding another.`);
  }

  const { data, error } = await supabase.from("morning_routine_items").insert({ user_id: userId, label: trimmed }).select("id, label, created_at").single();
  if (error) throw error;
  return toItem(data as ItemRow);
}

/**
 * P3-01 -- archives an item. NEVER A HARD DELETE (Opus Lead's explicit
 * ruling, overnight run-20260915-0011): morning_routine_checks rows for
 * this item must survive, and the composite FK to this table is ON DELETE
 * CASCADE, so an application-issued DELETE against morning_routine_items
 * would destroy that history. Scoped `.is("archived_at", null)` on the
 * write itself, same "no pre-existence check, a stale/foreign/already-
 * archived id simply matches zero rows" convention as
 * archiveIdentityHabitCore (lib/habits/actions-core.ts).
 */
export async function archiveMorningRoutineItemCore(supabase: TypedClient, userId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from("morning_routine_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("archived_at", null);
  if (error) throw error;
}

/**
 * "Checks/votes can only be cast or retracted for local today, no
 * backfilling" -- same ruling and same reasoning
 * lib/habits/actions-core.ts's own `assertRequestedDateIsToday` states: a
 * retroactive check would turn a checklist into something editable to make
 * the number look good after the fact, the recording-not-deciding pattern
 * this product rejects everywhere else. `requestedDate` is compared
 * against `localDateString(now, tz)`, never derived from a raw `Date`
 * (CLAUDE.md's hard rule) -- the caller supplies both `now` and `timezone`
 * so this function never has to guess either.
 */
function assertRequestedDateIsToday(requestedDate: string, now: Date, timezone: string): void {
  const today = localDateString(now, timezone);
  if (requestedDate !== today) {
    throw new Error("Items can only be checked or unchecked for today.");
  }
}

/**
 * P3-01 -- checks off `itemId` for the caller's local today. SET, NOT
 * READ-THEN-BRANCH (same doctrine as habit_votes' castHabitVoteCore): an
 * `upsert(..., { ignoreDuplicates: true })` against
 * `morning_routine_checks_user_item_date_key` (migration 188's one-check-
 * per-item-per-day unique constraint) asserts "checked today" outright, so
 * two overlapping calls (a genuine double-tap) can never race into two
 * rows or a spurious 23505 -- the second call is a true no-op at the
 * database level. Does NOT verify the item is still active (not archived)
 * before checking -- same convention castHabitVoteCore itself takes for
 * a paused/archived habit: the composite FK proves ownership+existence,
 * and the UI simply never offers an archived item to check in the first
 * place, so this stays a pure write op with no extra read.
 */
export async function checkMorningRoutineItemCore(supabase: TypedClient, userId: string, itemId: string, requestedDate: string, now: Date, timezone: string): Promise<void> {
  assertRequestedDateIsToday(requestedDate, now, timezone);
  const today = localDateString(now, timezone);
  const { error } = await supabase
    .from("morning_routine_checks")
    .upsert({ user_id: userId, item_id: itemId, checked_date: today }, { onConflict: "user_id,item_id,checked_date", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * P3-01 -- unchecks `itemId` for the caller's local today, if a check row
 * exists. A DELETE that matches zero rows (nothing to uncheck, or already
 * retracted by an overlapping call) is not an error -- same SET-not-toggle
 * reasoning as `checkMorningRoutineItemCore` above, and explicitly ruled
 * "undo-shaped, allowed" by Opus Lead (distinct from the no-hard-delete
 * rule on morning_routine_items itself -- this deletes today's own check
 * row, not the item).
 */
export async function uncheckMorningRoutineItemCore(supabase: TypedClient, userId: string, itemId: string, requestedDate: string, now: Date, timezone: string): Promise<void> {
  assertRequestedDateIsToday(requestedDate, now, timezone);
  const today = localDateString(now, timezone);
  const { error } = await supabase.from("morning_routine_checks").delete().eq("user_id", userId).eq("item_id", itemId).eq("checked_date", today);
  if (error) throw error;
}

/**
 * P3-01 -- reads the ACTIVE checklist (archived items never shown) in
 * `created_at` order, with each item's "checked today" flag. TWO QUERIES,
 * NOT A JOIN: Supabase-js has no arbitrary-shape join across two
 * independently-queried tables without a view/RPC, and this is exactly the
 * "fetch all items, fetch today's checks, merge in application code" shape
 * lib/self-mastery's due-summary and lib/weekly-review's habit-summary
 * already use for the same reason. `checkedItemIds` is a Set for O(1)
 * membership rather than an array `.includes()` scan per item.
 */
export async function getMorningRoutineChecklistCore(supabase: TypedClient, userId: string, now: Date, timezone: string): Promise<MorningRoutineChecklistItem[]> {
  const { data: items, error: itemsError } = await supabase
    .from("morning_routine_items")
    .select("id, label, created_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  const today = localDateString(now, timezone);
  const { data: checks, error: checksError } = await supabase
    .from("morning_routine_checks")
    .select("item_id")
    .eq("user_id", userId)
    .eq("checked_date", today);
  if (checksError) throw checksError;

  const checkedItemIds = new Set((checks ?? []).map((c) => c.item_id as string));
  return (items as ItemRow[]).map((row) => ({ ...toItem(row), checkedToday: checkedItemIds.has(row.id) }));
}
