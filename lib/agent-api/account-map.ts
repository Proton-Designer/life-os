import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REGISTRY } from "@/lib/mcp/registry";
import { WRITE_REGISTRY } from "@/lib/mcp/write-registry";
import { localDateString } from "@/lib/date-utils";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getUserDomainsForUser } from "@/lib/domains/user-domains-core";
import { hasArea, type Area } from "@/lib/domains/area-vocabulary";
import type { UserDomainsState } from "@/lib/domains/get-user-domains";
import type { AccountArea, AccountMap, AccountMapDomain } from "./account-map-wire";

/**
 * The wire codec (types, `toAccountMapWire`, `fromAccountMapWire`) lives in
 * account-map-wire.ts, NOT here, and is re-exported below for every existing
 * consumer of this module. That split exists so a plain script with no
 * bundler alias for `"server-only"` can import the real decoder directly
 * (P4-37) instead of hand-indexing the wire format itself, which is exactly
 * what produced P4-37's bug in the first place.
 */
export * from "./account-map-wire";

/**
 * THE account map (P4-03): one generator for everything an external agent
 * needs on connect — list_capabilities() today, P4-20's agent.md next. Any
 * new consumer calls this; none re-derives mode, today or the capability sets.
 *
 * A pure function of (the rows `client` returns for this user, `userId`,
 * `now`): no wall clock, no cookies, no module state. `today` comes from
 * localDateString(now, profile timezone) — never the raw Date (CLAUDE.md).
 *
 * Mode reuses getUserDomains' own decision through its cookie-free core, and
 * area presence reuses hasArea (the migration-115 bridge), so the map can't
 * disagree with the nav. `active_for_account` ANNOTATES only — read/write
 * never gate on it (OPEN_QUESTIONS [P4-03]).
 *
 * Budget: ≤ACCOUNT_MAP_WIRE_TOKEN_BUDGET (measured in account-map.test.ts).
 * Names only here; list_capabilities(domain) carries fields, patch shapes
 * and descriptions.
 */

/**
 * P4-31 -- the wire-format token ceiling, deliberately raised from the
 * original 800 (P4-03's own guess, never revisited against real growth).
 * That number had already forced two real compromises in one night before
 * this: P3-01 renamed day.routine_item -> day.item and shortened day's own
 * one-liner just to fit (both restored by this same task), and
 * CANVAS-LITE-02 trimmed three DOMAIN_ONE_LINERS strings after
 * school.canvas_import pushed the map to 805. Both times the budget won
 * and the clarity an agent actually reads lost -- backwards, since this
 * map is the first thing an external agent sees on connect.
 *
 * Measured at the moment of this change (account-map.test.ts's own
 * legacy/domains fixtures, with every trimmed string restored): ~815-820
 * tokens for 16 domains, all currently READ-only or write-only, none with
 * BOTH. P4-05..09 are about to add real READ coverage to roughly 8-10 of
 * those domains at once (business.session_objective, day.day_start,
 * deen.weekly_goal, fitness.custom_habit/habit_log, goals.goal/milestone,
 * habits.identity_habit/vote, review.sleep_intent,
 * school.grade_category/staging_batch/staged_deliverable/
 * canvas_connection/canvas_course_mapping/lecture_recording/
 * lecture_transcript, settings.ai_preference/rescuetime_connection,
 * work.schedule_event/schedule_event_override/
 * schedule_event_cancellation/rescuetime_daily_summary -- the exact list
 * lib/mcp/__tests__/registry-coverage.test.ts already names as pending) --
 * roughly 20+ new entity names landing in `read` arrays that are empty or
 * short today. 1400 leaves ~580-585 tokens of headroom over today's
 * measured usage: enough for that whole wave without forcing another
 * reflexive trim, without being an arbitrary/unbounded number either.
 *
 * If a future domain's own read/write growth threatens THIS ceiling, the
 * two-tier design this task's own AC offered as an alternative (a compact
 * default + a detail call) is the right next move -- not shaving copy
 * again. Nothing here should be shortened just to fit; raise this
 * constant deliberately instead, with the same reasoning discipline.
 */
export const ACCOUNT_MAP_WIRE_TOKEN_BUDGET = 1400;

/** Which MCP domains each user-facing area covers. Registry domains not listed here are always on. */
export const AREA_VOCABULARY: Record<AccountArea, string[]> = {
  faith: ["deen"],
  body: ["fitness"],
  learning: ["self_mastery"],
  // Matches computeDomainVisibility: "Work" gates both the co-op tables and
  // the business tables until the subdomain rebuild.
  work: ["work", "business"],
  business: ["business"],
  school: ["school"],
};

const AREA_ORDER: AccountArea[] = ["faith", "body", "learning", "work", "business", "school"];

/** One line per registry domain, for the map. A test fails if a registry domain has none. */
export const DOMAIN_ONE_LINERS: Record<string, string> = {
  deen: "Prayer, adhkar, Qur'an, habits",
  work: "Targets, tasks, deep work",
  business: "Kill list, weekly goals",
  school: "Classes, schedule, tasks, grades",
  fitness: "Workouts, plans, body metrics",
  self_mastery: "Books, lessons, cards, reviews",
  settings: "Profile, prefs, areas",
  checkins: "Check-ins, time allocation",
  distractions: "Triggers, plans, outcomes",
  calendar: "Aggregate; read owning domains",
  review: "Night Plan items",
  home: "Aggregate; read owning domains",
  agent: "Queued work for your agent (no AI key)",
  widgets: "Home widgets (widget_manage)",
  // P4-07: write-only domains (no REGISTRY/read entry at all yet -- P4-05's
  // future territory). No `d.description` to fall back to for these (that
  // field only exists on a read DomainDef), so they need an explicit line.
  day: "Morning day-start mark + routine checklist",
  goals: "Monthly goals + milestones",
  habits: "Identity habits + daily votes",
};

function activeAreas(state: UserDomainsState): AccountArea[] {
  if (state.mode === "legacy") return [...AREA_ORDER];
  const keys = new Set<string>(state.domains.map((d) => d.key));
  return AREA_ORDER.filter((area) => {
    if (area === "faith" || area === "body" || area === "learning") return hasArea(state, area as Area);
    return keys.has(area);
  });
}

/** HH:MM (24h) in the account's timezone — the time-of-day twin of localDateString. */
function localTimeString(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export async function buildAccountMap(client: SupabaseClient, userId: string, now: Date): Promise<AccountMap> {
  const { data: profile, error } = await client.from("profiles").select("timezone, onboarding_completed, deen_mode").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const row = profile as { timezone?: string | null; onboarding_completed?: boolean; deen_mode?: boolean | null } | null;
  // Deen Mode OFF: the deen domain and the faith area are invisible to agents (user decision A2).
  const deenOn = isDeenModeOn(row);

  const state = await getUserDomainsForUser(client, userId, { onboardingCompleted: row?.onboarding_completed ?? false });
  const areas = activeAreas(state).filter((a) => deenOn || a !== "faith");
  const gatedActive = new Set(areas.flatMap((a) => AREA_VOCABULARY[a]));
  const gated = new Set(Object.values(AREA_VOCABULARY).flat());

  const timezone = row?.timezone || "UTC";
  const today: AccountMap["today"] = { local_date: localDateString(now, timezone), timezone, local_time: localTimeString(now, timezone) };
  if (!row?.timezone) today.timezone_note = "No timezone on this account's profile; UTC assumed.";

  const domains: Record<string, AccountMapDomain> = {};
  for (const d of Object.values(REGISTRY)) {
    domains[d.domain] = {
      one_line: DOMAIN_ONE_LINERS[d.domain] ?? d.description.split(/[.—]/)[0].slice(0, 60),
      active_for_account: state.mode === "legacy" || !gated.has(d.domain) || gatedActive.has(d.domain),
      read: Object.keys(d.entities),
      write: Object.values(WRITE_REGISTRY[d.domain]?.entities ?? {})
        .filter((e) => Object.keys(e.actions).length > 0)
        .map((e) => e.entity),
      views: [],
    };
  }

  // P4-07: domains that exist ONLY in WRITE_REGISTRY (no REGISTRY entry at
  // all) -- day/goals/habits today. Without this, an agent reading the
  // account map (the very first thing it sees on connect) would have no
  // way to learn these write surfaces exist, even though
  // list_capabilities(domain) already serves them (P4-07's
  // write-only-domain fix in list-capabilities.ts). Kept in sync
  // automatically the same way REGISTRY's own loop above is -- no
  // hardcoded domain names beyond the one-liner fallback.
  for (const wd of Object.values(WRITE_REGISTRY)) {
    if (domains[wd.domain]) continue; // already covered above -- has real read coverage
    domains[wd.domain] = {
      one_line: DOMAIN_ONE_LINERS[wd.domain] ?? "Write-only -- see list_capabilities().",
      active_for_account: state.mode === "legacy" || !gated.has(wd.domain) || gatedActive.has(wd.domain),
      read: [],
      write: Object.values(wd.entities)
        .filter((e) => Object.keys(e.actions).length > 0)
        .map((e) => e.entity),
      views: [],
    };
  }

  if (!deenOn) delete domains.deen;
  const vocabularyMap = (deenOn ? AREA_VOCABULARY : Object.fromEntries(Object.entries(AREA_VOCABULARY).filter(([k]) => k !== "faith"))) as AccountMap["vocabulary_map"];

  return {
    today,
    mode: state.mode,
    active_areas: areas,
    vocabulary_map: vocabularyMap,
    domains,
    next: 'list_capabilities("<domain>") for fields and write patches',
  };
}

