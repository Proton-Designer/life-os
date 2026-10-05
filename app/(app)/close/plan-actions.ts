"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { effectiveDayString } from "@/lib/date-utils";
import { recordEveningCloseCore } from "@/lib/day-structure/closed-day";
import {
  planningDateForCore,
  dumpLineCore,
  claimSeedLinesCore,
  savePlanRanksCore,
  type PlanMode,
  type SeedLine,
  type SeedSource,
  type ClaimedSeed,
} from "@/lib/night-plan/plan-actions-core";
import { triageInboxCore, type InboxTriage } from "@/lib/inbox/inbox-core";
import { mirrorToKillListCore } from "@/lib/night-plan/kill-list-mirror";

export type { PlanMode, SeedLine, SeedSource, ClaimedSeed };

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

async function planningDateFor(mode: PlanMode = "tonight"): Promise<{ userId: string; plannedDate: string; timezone: string } | null> {
  const user = await getAuthedUser();
  if (!user) return null;
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  return { userId: user.id, plannedDate: planningDateForCore(mode, new Date(), timezone), timezone };
}

/** THIN WRAPPER over dumpLineCore (lib/night-plan/plan-actions-core.ts, P4-07) — the MCP write tool calls the same core. */
export async function dumpLine(title: string, mode: PlanMode = "tonight"): Promise<{ id: string } | { error: string }> {
  const ctx = await planningDateFor(mode);
  if (ctx === null) return { error: "Not signed in" };

  const supabase = await createClient();
  // Tap-rate (Add, Enter, Add...): no inline revalidatePath -- it made every Add wait for a
  // full /close render. The component schedules ONE refreshCloseViews() per burst (PERF-4).
  return dumpLineCore(supabase, ctx.userId, ctx.plannedDate, title);
}

/**
 * One-tap Inbox triage in the evening close (IA-P1a). Lean like dumpLine: no inline
 * revalidatePath — the stage schedules one refreshCloseViews() per burst. "plan" targets the
 * ceremony's own planning day (tonight → tomorrow, replan → today) so the planned date is
 * server-derived, never taken from the client.
 */
export async function triageInboxItem(
  id: string,
  action: "plan" | "school" | "co_op" | "worry" | "done",
  mode: PlanMode = "tonight"
): Promise<{ ok: true } | { error: string }> {
  const ctx = await planningDateFor(mode);
  if (ctx === null) return { error: "Not signed in" };
  const triage: InboxTriage =
    action === "plan"
      ? { kind: "plan", plannedDate: ctx.plannedDate }
      : action === "school" || action === "co_op"
        ? { kind: "task", area: action }
        : { kind: action };
  const supabase = await createClient();
  const res = await triageInboxCore(supabase, ctx.userId, id, triage);
  return res.ok ? { ok: true } : { error: res.error };
}

/** Data-free cache revalidation scheduled by the plan stage after a burst of dumped lines. Touches no data. */
export async function refreshCloseViews(): Promise<void> {
  const user = await getAuthedUser();
  if (!user) return;
  revalidatePath("/close");
  revalidatePath("/close/replan");
}

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
 * SCHOOL_RISK (#28, fixed 2026-09-14 — the engine computed this seed source
 * and `getSchoolTodayFeed` fed it to `composeDump` since #28 first landed,
 * but `isSeedable` in `ClosePlanStage` filtered every one of them out before
 * render, and this function never had a branch for one — the seed was
 * COMPUTED and PASSED AS PROPS and then silently dropped, one layer past
 * where the original #28 tests looked). Same shape as GOAL MILESTONE: the
 * seed's id is a `class_assessments` id, not a `tasks` row, so claiming it
 * INSERTS a new dumped row (`dump_source='school'`, per this file's own
 * mapping table above) and the caller remaps through `claimed` exactly like
 * a milestone.
 *
 * NOT ATOMIC ACROSS SEEDS: each is its own statement. A mid-loop failure
 * here is recoverable (the ceremony has not committed ranks yet; the user
 * can retry Finish) — a different failure mode than `savePlanRanks`'s, which
 * IS scoped to be a single statement because a half-*ranked* plan is the
 * failure the architect called out by name.
 *
 * THIN WRAPPER over claimSeedLinesCore (lib/night-plan/plan-actions-core.ts,
 * P4-07) — the MCP write tool calls the same core.
 */
export async function claimSeedLines(
  seeds: SeedLine[],
  mode: PlanMode = "tonight"
): Promise<{ claimed: ClaimedSeed[] } | { error: string }> {
  if (seeds.length === 0) return { claimed: [] };
  const ctx = await planningDateFor(mode);
  if (ctx === null) return { error: "Not signed in" };

  const supabase = await createClient();
  const result = await claimSeedLinesCore(supabase, ctx.userId, ctx.plannedDate, seeds);
  if ("claimed" in result) revalidatePath(mode === "today" ? "/close/replan" : "/close");
  return result;
}

/**
 * Write the ranks. Called when a crown exists — `assignRanks` returns nothing
 * without one, because crowning is a separate act and promoting the first
 * starred item for the user is the collapse the SPEC forbids.
 *
 * CLEARS STALE RANKS FIRST, for this planned_date only. SPEC: CollegeOS's
 * `submitCheckin` clears rather than accumulates, "or a task starred on Monday
 * still carries rank 2 on Thursday". Clearing first also keeps
 * `tasks_mit_rank_per_day_idx` satisfiable — re-crowning without clearing
 * would collide on rank 1 against the previous crown.
 *
 * ONE UPDATE PER RANKED ID, NOT A SINGLE MULTI-ROW UPSERT (fixed after P4-07
 * 04 live verification found the previous design failing in production on
 * every real "Finish Plan" call). Full reasoning is on
 * `savePlanRanksCore` (lib/night-plan/plan-actions-core.ts) — the short
 * version: a partial-row `.upsert(..., {onConflict:"id"})` trips Postgres's
 * NOT NULL check on the candidate row before conflict resolution runs,
 * regardless of RLS. A per-id UPDATE only ever sets the column it names, so
 * it never risks that, and stays collision-safe against
 * `tasks_mit_rank_per_day_idx` because the clear above already freed every
 * rank on this `plannedDate` first.
 *
 * THE REMAINING GAP, NAMED RATHER THAN HIDDEN: the clear and the per-id
 * updates are still separate network calls, so a crash mid-sequence leaves
 * today cleared with only some ranks reassigned. The error path below says
 * so explicitly rather than returning a bare Postgres message, so a user who
 * hits it knows to retry rather than assuming their old plan is intact.
 *
 * THIN WRAPPER over savePlanRanksCore (lib/night-plan/plan-actions-core.ts,
 * P4-07) — the MCP write tool calls the same core.
 */
export async function savePlanRanks(
  starred: string[],
  crowned: string | null,
  mode: PlanMode = "tonight",
  /** Starred lines marked "Business": mirrored into that day's Kill List (lib/night-plan/kill-list-mirror.ts). Anything not starred is ignored. */
  killListIds: string[] = []
): Promise<{ ok: true; killListOverflow?: string[] } | { error: string }> {
  const ctx = await planningDateFor(mode);
  if (ctx === null) return { error: "Not signed in" };

  const supabase = await createClient();
  const result = await savePlanRanksCore(supabase, ctx.userId, ctx.plannedDate, starred, crowned);
  if (!("ok" in result)) return result;

  // ONE TOP THREE: the plan is saved first (it is the source of truth); the Kill List mirror is best-effort on
  // top of it and reports what did not fit rather than failing a plan that already saved.
  let killListOverflow: string[] = [];
  let killListError: string | null = null;
  const wanted = killListIds.filter((id) => starred.includes(id));
  if (wanted.length > 0) {
    const { data: rows } = await supabase.from("tasks").select("id, title").eq("user_id", ctx.userId).eq("planned_date", ctx.plannedDate).in("id", wanted);
    const titleById = new Map((rows ?? []).map((r) => [r.id as string, r.title as string]));
    const mirrored = await mirrorToKillListCore(supabase, ctx.userId, ctx.plannedDate, wanted.map((id) => titleById.get(id) ?? "").filter(Boolean));
    if ("error" in mirrored) killListError = `Your plan saved, but the Kill List didn't update (${mirrored.error}). Add it on the Business page.`;
    else killListOverflow = mirrored.overflow;
    revalidatePath("/business");
  }

  // P3-09: this is the one place the evening-close ritual's plan stage
  // ALWAYS commits (commit(), close-plan-stage.tsx, calls this on Finish
  // unconditionally, even with zero starred/crowned items) -- the honest
  // anchor for "closed day." Only for the real evening-close flow
  // (mode: "tonight"), never "replan" (a next-morning fixup of yesterday's
  // plan must not retroactively mark today closed), and keyed to TODAY's
  // own local date, not `ctx.plannedDate` (which is tomorrow for "tonight").
  if (mode === "tonight") {
    const now = new Date();
    await recordEveningCloseCore(supabase, ctx.userId, effectiveDayString(now, ctx.timezone), now);
  }

  // #29: this used to revalidate only /close and / — a same-day replan
  // launched from /open (via /close/replan) returned to a stale cached
  // /open. Both target routes plus /open, every time.
  revalidatePath("/close");
  revalidatePath("/close/replan");
  revalidatePath("/open");
  revalidatePath("/");
  // Returned only after the close is recorded above: a Kill List hiccup must not leave the day un-closed.
  if (killListError) return { error: killListError };
  return killListOverflow.length > 0 ? { ok: true, killListOverflow } : { ok: true };
}
