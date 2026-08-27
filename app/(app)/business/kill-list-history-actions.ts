"use server";

import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addMonthsToDateString } from "@/lib/date-utils";

export type KillListDaySummary = { date: string; completed: number; total: number };
export type KillListGroup = { label: "This week" | "This month" | "Past 3 months"; days: KillListDaySummary[] };
export type KillListItemRow = { id: string; text: string; completed: boolean };

function isRealItem(row: { text: string }): boolean {
  return row.text.trim().length > 0;
}

/**
 * Item B3-3 (verbatim spec): past kill-list items grouped This week / This
 * month / up to past 3 months, one entry per day that actually has data.
 * Strictly PAST days only (date < today) — today has its own live "Today's
 * kill list" module, this is history.
 *
 * Empty history is the launch state, not an edge case (Opus Lead, after
 * tonight's account wipe): a user with zero rows in a bucket's range gets
 * an empty group, not a crash or a wall of 0/0 days — no day is listed at
 * all unless it actually has at least one real (non-blank-text) item.
 */
export async function getKillListHistory(): Promise<KillListGroup[]> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  const weekStart = getWeekStartDate(todayStr);
  const monthStart = `${todayStr.slice(0, 7)}-01`;
  const threeMonthsFloor = addMonthsToDateString(monthStart, -3);

  const { data: rows, error } = await supabase
    .from("kill_list_items")
    .select("date, text, completed")
    .eq("user_id", userId)
    .gte("date", threeMonthsFloor)
    .lt("date", todayStr)
    .order("date", { ascending: false });
  if (error) throw error;

  const byDate = new Map<string, { completed: number; total: number }>();
  for (const row of rows ?? []) {
    if (!isRealItem(row)) continue;
    const entry = byDate.get(row.date) ?? { completed: 0, total: 0 };
    entry.total += 1;
    if (row.completed) entry.completed += 1;
    byDate.set(row.date, entry);
  }

  const thisWeek: KillListDaySummary[] = [];
  const thisMonth: KillListDaySummary[] = [];
  const pastThreeMonths: KillListDaySummary[] = [];
  // Map iteration follows insertion order, and rows arrived date-descending,
  // so each day's first insertion already fixes overall descending order —
  // no separate sort needed.
  for (const [date, { completed, total }] of byDate) {
    const summary: KillListDaySummary = { date, completed, total };
    if (date >= weekStart) thisWeek.push(summary);
    else if (date >= monthStart) thisMonth.push(summary);
    else pastThreeMonths.push(summary);
  }

  return [
    { label: "This week", days: thisWeek },
    { label: "This month", days: thisMonth },
    { label: "Past 3 months", days: pastThreeMonths },
  ];
}

export type IncompleteByDateGroup = { date: string; items: KillListItemRow[] };

/**
 * Item B3 (2026-08-26 night batch 3, verbatim): the "Incompleted Tasks"
 * module's "More" list — every incomplete, non-blank item from the past 3
 * months through today (inclusive), grouped by date, most recent first.
 * Same floor as getKillListHistory's `threeMonthsFloor` (Lead ruling: the
 * module's headline count and this list must cover the identical range, or
 * the count lies) — the one difference from that function is this includes
 * TODAY, since an item set today and still incomplete right now is exactly
 * as "incomplete" as one from yesterday.
 *
 * A date with zero incomplete items is omitted entirely (Ayman's explicit
 * instruction) rather than listed with an empty items array.
 */
export async function getIncompleteByDate(): Promise<IncompleteByDateGroup[]> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  const monthStart = `${todayStr.slice(0, 7)}-01`;
  const threeMonthsFloor = addMonthsToDateString(monthStart, -3);

  const { data: rows, error } = await supabase
    .from("kill_list_items")
    .select("id, position, text, completed, date")
    .eq("user_id", userId)
    .eq("completed", false)
    .gte("date", threeMonthsFloor)
    .lte("date", todayStr)
    .order("date", { ascending: false })
    .order("position", { ascending: true });
  if (error) throw error;

  const byDate = new Map<string, KillListItemRow[]>();
  for (const row of rows ?? []) {
    if (!isRealItem(row)) continue;
    const items = byDate.get(row.date) ?? [];
    items.push({ id: row.id, text: row.text, completed: row.completed });
    byDate.set(row.date, items);
  }

  // Rows arrived date-descending, so Map insertion order already matches —
  // no separate sort needed (same reasoning as getKillListHistory above).
  return Array.from(byDate.entries()).map(([date, items]) => ({ date, items }));
}

export async function getKillListDayDetail(date: string): Promise<KillListItemRow[]> {
  const { supabase, userId } = await requireUser();
  const { data: rows, error } = await supabase
    .from("kill_list_items")
    .select("id, text, completed")
    .eq("user_id", userId)
    .eq("date", date)
    .order("position", { ascending: true });
  if (error) throw error;
  return (rows ?? []).filter(isRealItem);
}
