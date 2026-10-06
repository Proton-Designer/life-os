import type { SupabaseClient } from "@supabase/supabase-js";
import { setKillListItemCore } from "@/lib/business/actions-core";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

/**
 * ONE TOP THREE. The night plan (star up to 3, crown 1, across everything) is the source of truth for the
 * day; the Kill List is Business's 3-slot VIEW of the same decisions. A starred plan line marked "Business" is
 * mirrored into that day's Kill List instead of being typed a second time on the Business page.
 *
 * Business has no task home (tasks.domain is school/co_op only), so there is no Business *task* to star: the
 * mark lives on the plan line at Finish and the Kill List row is the record. Re-finishing is idempotent (a row
 * whose text already sits on that day's list is left alone); unmarking a line later does not delete a Kill List
 * row, because nothing links the two and a row the person may have edited or completed is never removed silently.
 */

export const KILL_LIST_SLOTS = 3;

/** Whether this account has a Business Kill List to mirror into (legacy accounts always do; domains accounts need a Business Work tab). */
export function hasBusinessKillList(navMode: "legacy" | "domains", nav: NavDomainState | null): boolean {
  if (navMode === "legacy" || nav === null) return true;
  return nav.workSubdomains.some((s) => s.kind === "business");
}

const norm = (s: string) => s.trim().toLowerCase();

/** Which positions each title goes to: a title already on the list is skipped, a blank/missing slot is free, the rest overflow. Pure. */
export function planKillListFill(
  existing: ReadonlyArray<{ position: number; text: string }>,
  titles: readonly string[],
): { place: Array<{ position: 0 | 1 | 2; text: string }>; alreadyThere: string[]; overflow: string[] } {
  const taken = new Set(existing.filter((r) => r.text.trim() !== "").map((r) => r.position));
  const present = new Set(existing.map((r) => norm(r.text)).filter((t) => t !== ""));
  const free = ([0, 1, 2] as const).filter((p) => !taken.has(p));
  const place: Array<{ position: 0 | 1 | 2; text: string }> = [];
  const alreadyThere: string[] = [];
  const overflow: string[] = [];
  const seen = new Set<string>();
  for (const raw of titles) {
    const text = raw.trim();
    if (text === "" || seen.has(norm(text))) continue;
    seen.add(norm(text));
    if (present.has(norm(text))) alreadyThere.push(text);
    else if (free.length > 0) place.push({ position: free.shift()!, text });
    else overflow.push(text);
  }
  return { place, alreadyThere, overflow };
}

/**
 * Writes the plan's Business lines into `date`'s Kill List. Returns the titles that did not fit (list already full)
 * and, for the ones that are on the list afterwards (just placed, or already there), their row ids -- keyed by
 * normalised title -- so a plan line can be paired with its Kill List row.
 */
export async function mirrorToKillListCore(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  titles: readonly string[],
): Promise<{ placed: number; overflow: string[]; idsByTitle: Map<string, string> } | { error: string }> {
  const idsByTitle = new Map<string, string>();
  if (titles.length === 0) return { placed: 0, overflow: [], idsByTitle };
  const { data, error } = await supabase.from("kill_list_items").select("position, text").eq("user_id", userId).eq("date", date);
  if (error) return { error: error.message };
  const { place, overflow } = planKillListFill(data ?? [], titles);
  try {
    for (const p of place) await setKillListItemCore(supabase, userId, date, p.position, p.text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't write the Kill List" };
  }
  const { data: after, error: afterError } = await supabase.from("kill_list_items").select("id, text").eq("user_id", userId).eq("date", date);
  if (afterError) return { error: afterError.message };
  for (const row of after ?? []) idsByTitle.set(norm(row.text as string), row.id as string);
  return { placed: place.length, overflow, idsByTitle };
}

export { norm as normalizeKillListTitle };
