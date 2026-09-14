"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import { assignRanks } from "@/lib/evening-close/rank-assignment";
import type { TablesInsert } from "@/lib/supabase/database.types";

/**
 * The plan stage's writes — the only part of the evening close that persists
 * anything.
 *
 * TWO TARGET DAYS NOW, NOT ONE (item #29). The ceremony's usual target is
 * the user's local TOMORROW — `addDaysToDateString(localDateString(now, tz),
 * 1)` — same as always. But `/close/replan` (see that route) exists to fix a
 * real bug: `/open`'s "Re-plan" link claimed to route back into this stage,
 * but this file hardcoded `+1` unconditionally, so a 7am tap silently
 * planned TOMORROW while today's stale plan sat untouched. `mode` threads
 * through every write here so the SAME stage/actions serve both entry
 * points; the close is still the only writer of `mit_rank` — it is merely
 * told which day, never a second writer for the plan itself.
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

export type PlanMode = "tonight" | "today";

async function planningDateFor(mode: PlanMode = "tonight"): Promise<{ userId: string; plannedDate: string } | null> {
  const user = await getAuthedUser();
  if (!user) return null;
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);
  // "tonight" (the ordinary evening close) plans the user's LOCAL tomorrow,
  // unchanged from before this file was parameterised. "today" (only
  // /close/replan) targets the user's local today — no `+1` — which is the
  // one-line fix for the #29 bug: this used to be unconditional.
  return { userId: user.id, plannedDate: mode === "today" ? today : addDaysToDateString(today, 1) };
}

/** Persist one dumped line. Returns its id so the surface can star it. */
export async function dumpLine(title: string, mode: PlanMode = "tonight"): Promise<{ id: string } | { error: string }> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return { error: "Nothing to add" };

  const ctx = await planningDateFor(mode);
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
  revalidatePath(mode === "today" ? "/close/replan" : "/close");
  return { id: data.id };
}

export type SeedSource = "worry" | "goal_milestone";
export type SeedLine = { id: string; title: string; source: SeedSource };
/** Maps a seed's ORIGINAL id (a worry's own tasks.id, or a goal_milestones.id) to the real tasks.id it now lives at. Identity for worries — see claimSeedLines. */
export type ClaimedSeed = { seedId: string; taskId: string };

/**
 * Turns a still-unclaimed seed line (item #28/#45 — a worry or unfinished
 * goal milestone shown in tonight's dump but not yet a `tasks` row FOR THIS
 * `plannedDate`) into a real dumped line, at commit time only. Nothing is
 * written merely by a seed being SHOWN — see `lib/night-plan/night-plan.ts`'s
 * `composeDump()`, which is pure and writes nothing either; only this action
 * does.
 *
 * WORRY: the seed IS already a `tasks` row (written by
 * `captureDump({source:"worry"})`), just dated on whatever day it was
 * captured. Claiming it re-dates it to `plannedDate` — same id, so no
 * remapping needed. Scoped to `dump_source='worry' AND completed=false`: a
 * worry someone marked Handled in the meantime (from `/worries`, mid-
 * ceremony, in another tab) is not silently resurrected into tonight's plan.
 *
 * GOAL MILESTONE: there is no existing `tasks` row — a milestone lives in
 * `goal_milestones`, a different table entirely (see `lib/goals/queries.ts`).
 * Claiming it INSERTS a new dumped `tasks` row (`dump_source='milestone'`).
 * That row's id is NEW, different from the milestone's own id, so the
 * caller must remap `starred`/`crowned` through the returned `claimed` list
 * before calling `savePlanRanks`.
 *
 * NOT ATOMIC ACROSS SEEDS: each is its own statement. A mid-loop failure
 * here is recoverable (the ceremony has not committed ranks yet; the user
 * can retry Finish) — a different failure mode than `savePlanRanks`'s, which
 * IS scoped to be a single statement because a half-*ranked* plan is the
 * failure the architect called out by name.
 */
export async function claimSeedLines(
  seeds: SeedLine[],
  mode: PlanMode = "tonight"
): Promise<{ claimed: ClaimedSeed[] } | { error: string }> {
  if (seeds.length === 0) return { claimed: [] };
  const ctx = await planningDateFor(mode);
  if (ctx === null) return { error: "Not signed in" };

  const supabase = await createClient();
  const claimed: ClaimedSeed[] = [];

  for (const seed of seeds) {
    if (seed.source === "worry") {
      const { data, error } = await supabase
        .from("tasks")
        .update({ planned_date: ctx.plannedDate })
        .eq("id", seed.id)
        .eq("user_id", ctx.userId)
        .eq("dump_source", "worry")
        .eq("completed", false)
        .select("id");
      if (error) return { error: error.message };
      // 0 rows: someone else already handled/claimed it since the page
      // loaded. Drop it rather than error — the client filters it out of
      // starred/crowned before ranking.
      if (data && data.length > 0) claimed.push({ seedId: seed.id, taskId: seed.id });
    } else {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: ctx.userId,
          title: seed.title,
          domain: null,
          dump_source: "milestone",
          planned_date: ctx.plannedDate,
          mit_rank: null,
          completed: false,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      claimed.push({ seedId: seed.id, taskId: data.id });
    }
  }

  revalidatePath(mode === "today" ? "/close/replan" : "/close");
  return { claimed };
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
 *
 * THE SECOND STEP IS ONE STATEMENT, NOT A LOOP. The architect flagged the
 * previous version by name: "a non-transactional loop of individual UPDATEs
 * after a separate clear — a mid-loop failure leaves a half-plan with no
 * error surfaced." A `.upsert()` over all ranked ids in one call is a single
 * INSERT ... ON CONFLICT(id) DO UPDATE statement — one round trip, and
 * Postgres executes it as one atomic operation: every row's rank lands or
 * none does. (`onConflict: "id"` always resolves to the UPDATE branch here
 * because every id in `ranks` names a real existing task; if one doesn't —
 * a bug upstream — the INSERT branch is attempted instead and fails loudly
 * on `title`'s NOT NULL, which is the correct outcome: a clear error, not a
 * silently-invented row.)
 *
 * THE ONE REMAINING GAP, NAMED RATHER THAN HIDDEN: the clear and the upsert
 * are still two separate network calls, so a crash BETWEEN them leaves today
 * cleared with no ranks yet reassigned. That window is far smaller than the
 * old N+1-statement loop, and the error path below says so explicitly rather
 * than returning a bare Postgres message, so a user who hits it knows to
 * retry rather than assuming their old plan is intact.
 */
export async function savePlanRanks(
  starred: string[],
  crowned: string | null,
  mode: PlanMode = "tonight"
): Promise<{ ok: true } | { error: string }> {
  const ctx = await planningDateFor(mode);
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

  // Only id/user_id/mit_rank are set. The generated Insert type requires
  // every NOT NULL column (title included) because it can't know this
  // always resolves to the UPDATE branch of ON CONFLICT(id) -- every id
  // here already names a real, existing task. Cast past that rather than
  // fetching each task's title just to satisfy a type for a branch this
  // call never actually takes; if it ever did (a bad id, a real bug), the
  // real Postgres NOT NULL constraint fails the insert loudly regardless of
  // what TypeScript believed here.
  const upsertRows = ranks.map(({ id, mitRank }) => ({ id, user_id: ctx.userId, mit_rank: mitRank })) as unknown as TablesInsert<"tasks">[];
  const { error: upsertError } = await supabase.from("tasks").upsert(upsertRows, { onConflict: "id" });
  if (upsertError) {
    return {
      error: `Today's old ranks were cleared but the new plan didn't fully save (${upsertError.message}). Try Finish again.`,
    };
  }

  // #29: this used to revalidate only /close and / — a same-day replan
  // launched from /open (via /close/replan) returned to a stale cached
  // /open. Both target routes plus /open, every time.
  revalidatePath("/close");
  revalidatePath("/close/replan");
  revalidatePath("/open");
  revalidatePath("/");
  return { ok: true };
}
