"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import { getAllTriggers, getTodayDistractionCount } from "@/lib/distractions/queries";
import { closeBlockers, type CloseBlocker } from "@/lib/evening-close/evening-close";
import type { ReviewItem } from "@/lib/distractions/types";
import { getHoursTodayMinutes } from "@/lib/evening-close/hours-today";
import { getTodayDayStart } from "@/lib/day-structure/day-start";
import { computeDeltaMinutes } from "@/lib/day-structure/delta-clock";
import { composeDump, type DumpItem } from "@/lib/night-plan/night-plan";
import { getOpenWorries, worriesToDumpItems } from "@/lib/night-plan/worries";
import { getUnfinishedMilestonesForMonth, monthStartFor } from "@/lib/goals/queries";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlannedItem = { id: string; title: string; mitRank: number; completed: boolean };

export type EveningCloseData = {
  /** Local date the close is for, computed in the USER'S timezone. */
  dateLabel: string;
  blockers: CloseBlocker[];
  /**
   * The blocking triggers as full ReviewItems, so the rewrite UI can be mounted
   * INLINE in the account stage (R61 corrected). Without these the stage could
   * only link out to /review — and once /review redirects here that link is a
   * loop with no way to rewrite, which makes the close permanently
   * uncompletable for anyone with a three-strike plan.
   */
  blockingItems: ReviewItem[];
  unplannedTodayCount: number;
  /**
   * What last night's close crowned and starred FOR today — read back so the
   * reflect stage can ask whether it happened. Empty is a real answer ("no
   * plan was made"), not a loading state and not an error.
   */
  todaysThree: PlannedItem[];
  /**
   * Minutes of today's deep-work-class sessions (R58). Baseline and Day Won
   * are deliberately ABSENT until migration 122 gives them a value — an unset
   * baseline is not a zero baseline, and rendering "0 / 0" would read as a
   * failed day rather than an unanswered question.
   *
   * Computed via lib/evening-close/hours-today.ts (extracted, not
   * reimplemented, so Day Structure's efficiency metric (#35) reads from the
   * exact same day-bounded, counts_toward_hours-filtered query rather than a
   * second copy that can drift from this one).
   */
  hoursTodayMinutes: number;
  /** `user_settings.weekday_baselines` (122). Null = never set: the comparison is ABSENT, not failed. */
  weekdayBaselines: number[] | null;
  /** The USER'S weekday, 0 = Sunday. Computed in their timezone, never the server's. */
  weekdayIndex: number;
  /** Lines already dumped for TOMORROW, so re-entering the ceremony resumes rather than restarts. */
  tomorrowLines: { id: string; title: string }[];
  /**
   * #28/#45 — seeded-but-not-yet-claimed lines for tomorrow's dump: parked
   * worries and unfinished goal milestones, filtered to exclude anything
   * already among `tomorrowLines`. Nothing is written for these merely by
   * being read — see `app/(app)/close/plan-actions.ts`'s `claimSeedLines`.
   */
  planSeeds: DumpItem[];
  /**
   * Minutes since today's Start Day tap (#33/#34, Day Structure) — null when
   * Start Day hasn't been tapped today, not zero. A zero here would read as
   * "just woke up a moment ago" for someone who never marked waking at all,
   * the same absent-is-not-a-value trap `weekdayBaselines`/Day Won already
   * guards against. The close only READS today's wake mark to report Delta
   * alongside Hours; it never writes one — that write path is #33's Start
   * Day tap (app/(app)/open/actions.ts) only.
   */
  deltaMinutes: number | null;
};

/**
 * #28/#45's seeding set, shared by the evening close (targets tomorrow) and
 * `/close/replan` (targets today) — see `getReplanData` below.
 *
 * `composeDump()` (`lib/night-plan/night-plan.ts`) is the engine's own
 * pure seed-merge function — it had ZERO live callers before this. Called
 * here with `dismissedIds: []` always: there is no persisted "declined this
 * seed" state (see `lib/night-plan/worries.ts`'s header and
 * `plan-actions.ts`'s `claimSeedLines` doc for why — reusing `completed` for
 * worries covers the durable case; an un-acted-on seed simply reappears next
 * time, which is the correct behavior for a still-unresolved worry or
 * milestone, not a bug this needs to paper over).
 */
async function computePlanSeeds(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  excludeIds: ReadonlySet<string>
): Promise<DumpItem[]> {
  const openWorries = await getOpenWorries(supabase, userId);
  const worrySeeds = worriesToDumpItems(openWorries).filter((w) => !excludeIds.has(w.id));

  // Goal milestones (#45) depend on migration 157 (goals/goal_milestones),
  // which is written and proved but NOT yet applied to production (R5/R32 —
  // numbers and applies are the lead's). Until it lands, this query fails
  // with "relation does not exist"; treated as "no milestone seeds" rather
  // than failing the whole close, the same defensive shape every other
  // Promise.all branch in this file already gets from Supabase returning
  // {data:null,error} instead of throwing.
  let milestoneSeeds: DumpItem[] = [];
  try {
    const monthStart = monthStartFor(localDateString(now, timezone));
    const unfinished = await getUnfinishedMilestonesForMonth(supabase, userId, monthStart);
    milestoneSeeds = unfinished
      .filter((m) => !excludeIds.has(m.id))
      .map((m) => ({ id: m.id, title: m.title, source: "goal_milestone" as const }));
  } catch {
    milestoneSeeds = [];
  }

  const composed = composeDump([...worrySeeds, ...milestoneSeeds], []);
  return composed.items;
}

/**
 * The evening close's account stage, server-side.
 *
 * THE DATE IS THE USER'S, NOT THE SERVER'S. `localDateString(now, timezone)` —
 * never `new Date()` alone and never Postgres `current_date`, which is UTC. The
 * close runs at night by definition, which is exactly when a UTC-derived date
 * is already tomorrow for anyone west of Greenwich; this codebase has shipped
 * that bug four separate times, and every one of them was in evening-adjacent
 * code.
 */
export async function getEveningCloseData(): Promise<EveningCloseData | null> {
  const user = await getAuthedUser();
  if (!user) return null;

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);

  const supabase = await createClient();
  const tomorrow = addDaysToDateString(today, 1);

  // The user's weekday, not the server's. `today` is already their local
  // calendar date; a noon UTC instant off that date cannot slip either way.
  const weekdayIndex = new Date(`${today}T12:00:00Z`).getUTCDay();

  const [triggers, unplannedTodayCount, planned, hoursTodayMinutes, tomorrowRows, settings, wakeMark] = await Promise.all([
    getAllTriggers(supabase, user.id, today),
    getTodayDistractionCount(supabase, user.id, today),
    // Migration 113's columns. Ranked rows only — a null mit_rank means
    // "dumped, not starred", which is a real state and deliberately not part
    // of today's three.
    supabase
      .from("tasks")
      .select("id, title, mit_rank, completed")
      .eq("user_id", user.id)
      .eq("planned_date", today)
      .not("mit_rank", "is", null)
      .order("mit_rank", { ascending: true }),
    getHoursTodayMinutes(supabase, user.id, today, timezone, new Date()),
    supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .eq("planned_date", tomorrow)
      .order("created_at", { ascending: true }),
    supabase.from("user_settings").select("weekday_baselines").eq("user_id", user.id).maybeSingle(),
    // #33/#34 (Day Structure), read-only.
    getTodayDayStart(supabase, user.id, timezone, new Date()),
  ]);

  const blockers = closeBlockers({ triggers, unplannedTodayCount });
  const blockingIds = new Set(blockers.map((b) => b.triggerId));

  const tomorrowLines = (tomorrowRows.data ?? []).map((t) => ({ id: t.id, title: t.title }));
  const planSeeds = await computePlanSeeds(
    supabase,
    user.id,
    timezone,
    new Date(),
    new Set(tomorrowLines.map((l) => l.id))
  );

  return {
    dateLabel: today,
    blockers,
    blockingItems: triggers
      .filter((t) => blockingIds.has(t.id))
      // isNew is false: a blocking trigger by definition HAS a plan — it has
      // one that has failed three times. Claiming otherwise would render the
      // "write your first plan" affordance instead of the rewrite.
      .map((t) => ({ trigger: t, todayCount: t.todayCount, isNew: false })),
    unplannedTodayCount,
    weekdayBaselines: (settings.data?.weekday_baselines ?? null) as number[] | null,
    weekdayIndex,
    hoursTodayMinutes,
    deltaMinutes: wakeMark ? computeDeltaMinutes(wakeMark.wokeAtIso, new Date()) : null,
    tomorrowLines,
    planSeeds,
    todaysThree: (planned.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      mitRank: t.mit_rank as number,
      completed: t.completed,
    })),
  };
}

export type ReplanData = {
  dateLabel: string;
  /** Today's already-dumped lines (typed or previously claimed seeds), same shape as tomorrowLines above but for TODAY. */
  todayLines: { id: string; title: string }[];
  planSeeds: DumpItem[];
};

/**
 * `/close/replan`'s data — the #29 fix's other half. Deliberately NOT
 * `getEveningCloseData` with a flag: that function's account/reflect data
 * (blockers, hours, wake mark, tomorrow's dump) has nothing to do with a
 * same-day re-plan, and reusing it would mean either fetching data this
 * route never renders or teaching the reflect/account stages about a "today"
 * mode they don't have. This is the plan stage's OWN minimal read, targeted
 * at today.
 */
export async function getReplanData(): Promise<ReplanData | null> {
  const user = await getAuthedUser();
  if (!user) return null;

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);
  const supabase = await createClient();

  const { data: todayRows } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("user_id", user.id)
    .eq("planned_date", today)
    .order("created_at", { ascending: true });

  const todayLines = (todayRows ?? []).map((t) => ({ id: t.id, title: t.title }));
  const planSeeds = await computePlanSeeds(supabase, user.id, timezone, new Date(), new Set(todayLines.map((l) => l.id)));

  return { dateLabel: today, todayLines, planSeeds };
}
