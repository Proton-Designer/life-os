import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REGISTRY } from "@/lib/mcp/registry";
import { WRITE_REGISTRY } from "@/lib/mcp/write-registry";
import { localDateString } from "@/lib/date-utils";
import { getUserDomainsForUser } from "@/lib/domains/user-domains-core";
import { hasArea, type Area } from "@/lib/domains/area-vocabulary";
import type { UserDomainsState } from "@/lib/domains/get-user-domains";

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
 * Budget: ≤800 tokens (measured in account-map.test.ts). Names only here;
 * list_capabilities(domain) carries fields, patch shapes and descriptions.
 */

export type AccountArea = "faith" | "body" | "learning" | "work" | "business" | "school";

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
  school: "Classes, schedule, grades", // trimmed for the wire budget when canvas_import landed (CANVAS-LITE-02)
  fitness: "Workouts, plans, metrics",
  self_mastery: "Books, lessons, reviews",
  settings: "Profile, prefs, areas",
  checkins: "Check-ins, time allocation",
  distractions: "Triggers, plans, outcomes",
  calendar: "Aggregate; read owning domains",
  review: "Night Plan items",
  home: "Aggregate; read owning domains",
  widgets: "Home widgets (widget_manage)",
  // P4-07: write-only domains (no REGISTRY/read entry at all yet -- P4-05's
  // future territory). No `d.description` to fall back to for these (that
  // field only exists on a read DomainDef), so they need an explicit line.
  day: "Start + routine", // P3-01 added day.item; kept short for the wire budget
  goals: "Monthly goals + milestones",
  habits: "Identity habits + daily votes",
};

export interface AccountMapDomain {
  one_line: string;
  active_for_account: boolean;
  read: string[];
  /** Entities with at least one write action; the actions and patch shapes are in list_capabilities(domain). */
  write: string[];
  /** Computed decide-views (P4-27). Empty until built. */
  views: string[];
}

export interface AccountMap {
  today: { local_date: string; timezone: string; local_time: string; timezone_note?: string };
  mode: "legacy" | "domains";
  /** Areas this account tracks, in area order. Legacy accounts see everything, so all are listed. */
  active_areas: AccountArea[];
  vocabulary_map: Record<AccountArea, string[]>;
  /** Keyed by MCP domain name (the name read/write/list_capabilities take). */
  domains: Record<string, AccountMapDomain>;
  next: string;
}

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
  const { data: profile, error } = await client.from("profiles").select("timezone, onboarding_completed").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const row = profile as { timezone?: string | null; onboarding_completed?: boolean } | null;

  const state = await getUserDomainsForUser(client, userId, { onboardingCompleted: row?.onboarding_completed ?? false });
  const areas = activeAreas(state);
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

  return {
    today,
    mode: state.mode,
    active_areas: areas,
    vocabulary_map: AREA_VOCABULARY,
    domains,
    next: 'list_capabilities("<domain>") for fields and write patches',
  };
}

export const ACCOUNT_MAP_DOMAIN_FIELDS = ["one_line", "active_for_account", "read", "write", "views"] as const;

export type AccountMapWire = Omit<AccountMap, "domains"> & {
  domain_fields: typeof ACCOUNT_MAP_DOMAIN_FIELDS;
  domains: Record<string, [string, boolean, string[], string[], string[]]>;
};

/**
 * The map as an agent receives it over the wire: identical content, but each
 * domain is a row in `domain_fields` order instead of an object repeating the
 * five key names. That repetition was ~30% of the payload (13 domains × ~70
 * chars) and grows with every domain, which would push the map past its
 * 800-token budget as read/write coverage lands (P4-05..09). Code consumers
 * (and P4-20's agent.md) use the named `AccountMap`; only the serialization
 * is compact. A test round-trips one into the other.
 */
export function toAccountMapWire(map: AccountMap): AccountMapWire {
  const domains: AccountMapWire["domains"] = {};
  for (const [name, d] of Object.entries(map.domains)) {
    domains[name] = [d.one_line, d.active_for_account, d.read, d.write, d.views];
  }
  const { domains: _named, ...rest } = map;
  return { ...rest, domain_fields: ACCOUNT_MAP_DOMAIN_FIELDS, domains };
}
