import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { MAX_ROUTINE_ITEMS } from "./constants";
import { lastSevenCounts, lastSevenStart } from "@/lib/rhythm/launch";
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";
import { castHabitVoteCore, retractHabitVoteCore } from "@/lib/habits/actions-core";
export { MAX_ROUTINE_ITEMS };

type TypedClient = SupabaseClient<Database>;

export type MorningRoutineItem = {
  id: string;
  label: string;
  createdAt: string;
  /** IA-P4a Launch-sequence step fields (migration 253); null for a plain step. */
  ifCue: string | null;
  fallbackText: string | null;
  /** The identity habit this step counts as a vote for, if linked. */
  habitId: string | null;
};

export type MorningRoutineChecklistItem = MorningRoutineItem & {
  checkedToday: boolean;
  /** Distinct local days this step was ticked in the 7 days ending today (0..7). Never a streak. */
  doneLast7: number;
};

type ItemRow = { id: string; label: string; created_at: string; if_cue?: string | null; fallback_text?: string | null; habit_id?: string | null };
const ITEM_COLUMNS = "id, label, created_at, if_cue, fallback_text, habit_id";

function toItem(row: ItemRow): MorningRoutineItem {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    ifCue: row.if_cue ?? null,
    fallbackText: row.fallback_text ?? null,
    habitId: row.habit_id ?? null,
  };
}

export type LaunchStepOptions = { ifCue?: string | null; fallbackText?: string | null; habitId?: string | null };

function cleanOptional(v: string | null | undefined, field: string): string | null {
  const t = v?.trim();
  if (!t) return null;
  if (t.length > 80) throw new Error(`${field} can be at most 80 characters.`);
  return t;
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
export async function createMorningRoutineItemCore(supabase: TypedClient, userId: string, label: string, options: LaunchStepOptions = {}): Promise<MorningRoutineItem> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("A morning routine item needs a label.");
  }
  if (trimmed.length > 120) throw new Error("A step can be at most 120 characters.");
  const ifCue = cleanOptional(options.ifCue, "The cue");
  const fallbackText = cleanOptional(options.fallbackText, "The 2-minute version");
  const habitId = options.habitId ?? null;

  const { count, error: countError } = await supabase
    .from("morning_routine_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_ROUTINE_ITEMS) {
    throw new Error(`You already have ${MAX_ROUTINE_ITEMS} morning routine items — archive one before adding another.`);
  }

  if (habitId) {
    // Clean error instead of a raw FK violation; the composite FK still proves ownership.
    const { data: habit, error: habitError } = await supabase.from("identity_habits").select("id").eq("id", habitId).eq("user_id", userId).eq("status", "active").maybeSingle();
    if (habitError) throw habitError;
    if (!habit) throw new Error("That habit isn't active, so a step can't count toward it.");
  }

  const { data, error } = await supabase
    .from("morning_routine_items")
    .insert({ user_id: userId, label: trimmed, if_cue: ifCue, fallback_text: fallbackText, habit_id: habitId })
    .select(ITEM_COLUMNS)
    .single();
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
    .select(ITEM_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  const today = localDateString(now, timezone);
  // One range read serves both "checked today" and "x of the last 7" (IA-P4a).
  const { data: checks, error: checksError } = await supabase
    .from("morning_routine_checks")
    .select("item_id, checked_date")
    .eq("user_id", userId)
    .gte("checked_date", lastSevenStart(today))
    .lte("checked_date", today);
  if (checksError) throw checksError;

  const rows = (checks ?? []).map((c) => ({ itemId: c.item_id as string, checkedDate: c.checked_date as string }));
  const checkedItemIds = new Set(rows.filter((c) => c.checkedDate === today).map((c) => c.itemId));
  const counts = lastSevenCounts(rows, today);
  return (items as ItemRow[]).map((row) => ({ ...toItem(row), checkedToday: checkedItemIds.has(row.id), doneLast7: counts.get(row.id) ?? 0 }));
}

/**
 * IA-P4a — ONE absolute setter for a Launch-sequence tick: `done` true = checked today, false =
 * unchecked, never a toggle. A step linked to an identity habit ALSO casts / retracts that habit's
 * vote for the same local day (one tap = tick + vote). The tick is written first; if the linked
 * vote is then refused (e.g. the habit was paused) the tick is put back and the error thrown, so
 * the two never disagree. Both writes are idempotent sets, so a double tap is a no-op.
 */
export async function setLaunchStepDoneCore(
  supabase: TypedClient,
  userId: string,
  itemId: string,
  done: boolean,
  requestedDate: string,
  now: Date,
  timezone: string
): Promise<void> {
  assertRequestedDateIsToday(requestedDate, now, timezone);
  const { data: item, error: itemError } = await supabase
    .from("morning_routine_items")
    .select("id, habit_id")
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) throw new ToolNotFoundError(`No morning routine item found with id "${itemId}".`);
  const habitId = (item as { habit_id: string | null }).habit_id;

  const write = (on: boolean) =>
    on ? checkMorningRoutineItemCore(supabase, userId, itemId, requestedDate, now, timezone) : uncheckMorningRoutineItemCore(supabase, userId, itemId, requestedDate, now, timezone);
  await write(done);
  if (!habitId) return;
  try {
    if (done) await castHabitVoteCore(supabase, userId, habitId, requestedDate, now, timezone);
    else await retractHabitVoteCore(supabase, userId, habitId, requestedDate, now, timezone);
  } catch (err) {
    await write(!done).catch(() => undefined);
    throw err;
  }
}
