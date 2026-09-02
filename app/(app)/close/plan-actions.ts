"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import { assignRanks } from "@/lib/evening-close/rank-assignment";

/**
 * The plan stage's writes — the only part of the evening close that persists
 * anything.
 *
 * THE PLAN IS FOR TOMORROW. `planned_date` is the user's LOCAL tomorrow, via
 * `addDaysToDateString(localDateString(now, tz), 1)`. Never `new Date()` and
 * never Postgres `current_date`: the ceremony runs at night, which is exactly
 * when a UTC-derived date is already tomorrow for anyone west of Greenwich, and
 * the bug would be invisible — the rows would simply be planned for the wrong
 * day and the morning open would find nothing.
 *
 * DUMPED ROWS CARRY `domain: null` (migration 119) AND `dump_source: 'note'`
 * (migration 120). A dumped line genuinely has no domain yet; the SPEC is
 * explicit that a category picker on every line is the friction that ends a
 * nightly habit. What it does have is provenance, recorded at the write.
 *
 * THE TWO VOCABULARIES DO NOT ALIGN, and that is worth knowing before someone
 * "tidies" it. The engine's `DumpSource` is
 * `user | school_risk | goal_milestone | worry`; the column's CHECK admits
 * `school | milestone | worry | note | capture`. The mapping:
 *
 *     school_risk    -> 'school'
 *     goal_milestone -> 'milestone'
 *     worry          -> 'worry'
 *     user           -> 'note'      <- same concept, named twice
 *     (none)         <- 'capture'    a NOTE parked from the global capture sheet
 *
 * `dump_source` mixes kinds with surfaces, and R57's addendum settles which
 * wins: a parked WORRY writes 'worry' whichever surface parked it, because the
 * Night Plan's seeding and the Monday anti-worry hour have to find it by what
 * it IS. Only a Note writes 'capture'. A worry filed through the capture sheet
 * and tagged by its surface would be invisible to both.
 *
 * A line typed in the ceremony is the engine's `user`, which the column calls
 * `note`. They are one concept with two names, and the only reason this file
 * writes `'note'` rather than `'user'` is that the column's CHECK does not
 * admit the latter. Raised rather than silently bridged — a mapping nobody
 * wrote down becomes a mapping nobody can find.
 *
 * NO `estimated_minutes`, EVER. SPEC §3(a): duration calibration trains on
 * estimate-vs-actual pairs and the arbiter's `cost` signal reads it downstream.
 * A dump that injects estimates nobody made poisons both, and nothing reports
 * it — the numbers just drift.
 */

async function planningDateFor(): Promise<{ userId: string; plannedDate: string } | null> {
  const user = await getAuthedUser();
  if (!user) return null;
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);
  return { userId: user.id, plannedDate: addDaysToDateString(today, 1) };
}

/** Persist one dumped line. Returns its id so the surface can star it. */
export async function dumpLine(title: string): Promise<{ id: string } | { error: string }> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return { error: "Nothing to add" };

  const ctx = await planningDateFor();
  if (ctx === null) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: ctx.userId,
      title: trimmed,
      planned_date: ctx.plannedDate,
      domain: null,
      // The engine calls this source `user`; the column calls it `note`. See
      // the mapping in this file's header.
      dump_source: "note",
      // mit_rank stays null: "dumped, not starred" is a real state, and the
      // rank is only assigned when a crown exists.
      mit_rank: null,
      completed: false,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/close");
  return { id: data.id };
}

/**
 * Write the ranks. Called when a crown exists — `assignRanks` returns nothing
 * without one, because crowning is a separate act and promoting the first
 * starred item for the user is the collapse the SPEC forbids.
 *
 * CLEARS STALE RANKS FIRST, for this planned_date only. SPEC: CollegeOS's
 * `submitCheckin` clears rather than accumulates, "or a task starred on Monday
 * still carries rank 2 on Thursday". Doing it in one statement scoped to the
 * day also keeps `tasks_mit_rank_per_day_idx` satisfiable — re-crowning without
 * clearing would collide on rank 1 against the previous crown.
 */
export async function savePlanRanks(
  starred: string[],
  crowned: string | null
): Promise<{ ok: true } | { error: string }> {
  const ctx = await planningDateFor();
  if (ctx === null) return { error: "Not signed in" };

  let ranks;
  try {
    ranks = assignRanks({ starred, crowned });
  } catch (e) {
    // assignRanks refuses an unstarred crown or more than three stars. Surface
    // it rather than writing a partial plan.
    return { error: e instanceof Error ? e.message : "Invalid plan" };
  }
  if (ranks.length === 0) return { ok: true };

  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("tasks")
    .update({ mit_rank: null })
    .eq("user_id", ctx.userId)
    .eq("planned_date", ctx.plannedDate)
    .not("mit_rank", "is", null);
  if (clearError) return { error: clearError.message };

  for (const { id, mitRank } of ranks) {
    const { error } = await supabase
      .from("tasks")
      .update({ mit_rank: mitRank })
      .eq("id", id)
      .eq("user_id", ctx.userId);
    if (error) return { error: error.message };
  }

  revalidatePath("/close");
  revalidatePath("/");
  return { ok: true };
}
