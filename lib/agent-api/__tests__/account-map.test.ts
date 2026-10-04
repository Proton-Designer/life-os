import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REGISTRY } from "@/lib/mcp/registry";
import { WRITE_REGISTRY } from "@/lib/mcp/write-registry";
import { ACCOUNT_MAP_WIRE_TOKEN_BUDGET } from "../account-map";

/**
 * P4-03 — the account map is ONE pure-of-its-inputs generator. Red first:
 * written before lib/agent-api/account-map.ts existed.
 *
 * `now` is 03:30 UTC on 2026-09-15 = 22:30 on 2026-09-14 in Chicago — the
 * UTC-vs-local evening rollover CLAUDE.md's hard constraint is about. A map
 * that derived `today` from the raw Date would say 2026-09-15.
 */
const NOW = new Date("2026-09-15T03:30:00.000Z");

interface Fixture {
  profile: { timezone: string | null; onboarding_completed: boolean; deen_mode?: boolean | null } | null;
  domains: { id: string; key: string; position: number; weight: string }[];
  subdomains?: { domain_id: string; key: string; label: string; kind: string | null; widgets: unknown; config: unknown; position: number }[];
}

function makeClient(f: Fixture): SupabaseClient {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order"]) chain[m] = vi.fn(() => chain);
    const rows = table === "user_domains" ? f.domains : table === "user_subdomains" ? (f.subdomains ?? []) : [];
    chain.maybeSingle = vi.fn(async () => ({ data: table === "profiles" ? (f.profile && { deen_mode: true, ...f.profile }) : null, error: null }));
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

const LEGACY: Fixture = { profile: { timezone: "America/Chicago", onboarding_completed: true }, domains: [] };
const FAITH_SCHOOL: Fixture = {
  profile: { timezone: "America/Chicago", onboarding_completed: true },
  domains: [
    { id: "d1", key: "faith", position: 0, weight: "essential" },
    { id: "d2", key: "school", position: 1, weight: "important" },
  ],
};

function byDomain(map: { domains: Record<string, { active_for_account: boolean }> }) {
  return Object.fromEntries(Object.entries(map.domains).map(([name, d]) => [name, d.active_for_account]));
}

describe("buildAccountMap — today", () => {
  it("is the account's LOCAL date/time from `now` + profile timezone, never the UTC date", async () => {
    const { buildAccountMap } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    expect(map.today).toEqual({ local_date: "2026-09-14", timezone: "America/Chicago", local_time: "22:30" });
  });

  it("an account with no profile row gets UTC, and says so", async () => {
    const { buildAccountMap } = await import("../account-map");
    const map = await buildAccountMap(makeClient({ profile: null, domains: [] }), "user-1", NOW);
    expect(map.today).toEqual({ local_date: "2026-09-15", timezone: "UTC", local_time: "03:30", timezone_note: "No timezone on this account's profile; UTC assumed." });
  });
});

describe("buildAccountMap — mode and active areas", () => {
  it("LEGACY account (onboarded, zero user_domains): mode legacy, every domain annotated active", async () => {
    const { buildAccountMap } = await import("../account-map");
    const map = await buildAccountMap(makeClient(LEGACY), "user-1", NOW);
    expect(map.mode).toBe("legacy");
    expect(Object.values(byDomain(map)).every(Boolean)).toBe(true);
  });

  it("DOMAINS account with faith+school: deen and school active; fitness, self_mastery, work, business inactive; always-on domains active", async () => {
    const { buildAccountMap } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    expect(map.mode).toBe("domains");
    expect(map.active_areas).toEqual(["faith", "school"]);
    const active = byDomain(map);
    expect(active).toMatchObject({ deen: true, school: true, fitness: false, self_mastery: false, work: false, business: false });
    for (const alwaysOn of ["settings", "checkins", "distractions", "review", "home", "calendar", "widgets"]) {
      expect(active[alwaysOn]).toBe(true);
    }
  });

  it("pre-115 vocabulary (personal_growth group + fitness subdomain) still resolves through the area bridge", async () => {
    const { buildAccountMap } = await import("../account-map");
    const map = await buildAccountMap(
      makeClient({
        profile: { timezone: "UTC", onboarding_completed: true },
        domains: [{ id: "g1", key: "personal_growth", position: 0, weight: "essential" }, { id: "w1", key: "work", position: 1, weight: "important" }],
        subdomains: [{ domain_id: "g1", key: "fitness", label: "Fitness", kind: null, widgets: [], config: {}, position: 0 }],
      }),
      "user-1",
      NOW,
    );
    expect(map.active_areas).toEqual(["body", "work"]);
    expect(byDomain(map)).toMatchObject({ fitness: true, deen: false, work: true, business: true });
  });

  it("names the area → MCP domain vocabulary", async () => {
    const { buildAccountMap } = await import("../account-map");
    const map = await buildAccountMap(makeClient(LEGACY), "user-1", NOW);
    expect(map.vocabulary_map).toMatchObject({ faith: ["deen"], body: ["fitness"], learning: ["self_mastery"], work: ["work", "business"], school: ["school"] });
  });
});

describe("buildAccountMap — capability sets", () => {
  it("lists every registry domain once, with its real read entities, its writable entities, and empty views", async () => {
    const { buildAccountMap, DOMAIN_ONE_LINERS } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    // P4-07: map.domains is now a SUPERSET of REGISTRY's own keys (it also
    // carries WRITE_REGISTRY-only domains like day/goals/habits -- see the
    // dedicated test below for those). Every REGISTRY domain must still be
    // present, one-to-one, which is what this loop actually checks.
    expect(Object.keys(REGISTRY).every((name) => name in map.domains)).toBe(true);
    for (const [name, d] of Object.entries(map.domains)) {
      if (!(name in REGISTRY)) continue; // covered by the write-only-domain test below

      expect(DOMAIN_ONE_LINERS[name], `registry domain "${name}" needs a one-liner`).toBeTruthy();
      expect(d.one_line).toBe(DOMAIN_ONE_LINERS[name]);
      expect(d.read).toEqual(Object.keys(REGISTRY[name].entities));
      const expectedWritable = Object.values(WRITE_REGISTRY[name]?.entities ?? {}).filter((e) => Object.keys(e.actions).length > 0).map((e) => e.entity);
      expect(d.write).toEqual(expectedWritable);
      expect(d.views).toEqual([]);
    }
  });

  it("P4-07: ALSO lists every WRITE_REGISTRY-only domain (no REGISTRY entry at all) with read:[] and its real writable entities -- so the account map (the first thing an agent sees) doesn't hide a write surface REGISTRY has never heard of", async () => {
    const { buildAccountMap, DOMAIN_ONE_LINERS } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    const writeOnlyDomains = Object.keys(WRITE_REGISTRY).filter((name) => !REGISTRY[name]);
    expect(writeOnlyDomains.length).toBeGreaterThan(0); // day/goals/habits today -- a positive control so this test isn't vacuous
    for (const name of writeOnlyDomains) {
      expect(map.domains[name], `write-only domain "${name}" missing from the account map`).toBeTruthy();
      expect(DOMAIN_ONE_LINERS[name], `write-only domain "${name}" needs a one-liner`).toBeTruthy();
      expect(map.domains[name].one_line).toBe(DOMAIN_ONE_LINERS[name]);
      expect(map.domains[name].read).toEqual([]);
      const expectedWritable = Object.values(WRITE_REGISTRY[name].entities).filter((e) => Object.keys(e.actions).length > 0).map((e) => e.entity);
      expect(map.domains[name].write).toEqual(expectedWritable);
      expect(map.domains[name].write.length).toBeGreaterThan(0);
      expect(map.domains[name].views).toEqual([]);
    }
    // The overall domain count now exceeds REGISTRY's own -- the two loops are additive, not overlapping.
    expect(Object.keys(map.domains).length).toBe(Object.keys(REGISTRY).length + writeOnlyDomains.length);
  });

  it("is a pure function of (fixture, userId, now): same inputs → deep-equal output, regardless of the wall clock", async () => {
    const { buildAccountMap } = await import("../account-map");
    const a = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
    try {
      const b = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
      expect(b).toEqual(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the wire form carries exactly the same content: each domain row round-trips to the named object", async () => {
    const { buildAccountMap, toAccountMapWire } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    const wire = toAccountMapWire(map);
    expect(wire.domain_fields).toEqual(["one_line", "active_for_account", "read", "write", "views"]);
    const { domains: _w, domain_fields: _f, ...wireRest } = wire;
    const { domains: _m, ...mapRest } = map;
    expect(wireRest).toEqual(mapRest);
  });

  it("P4-37: fromAccountMapWire is the real inverse of toAccountMapWire -- no consumer should ever hand-index a row again", async () => {
    const { buildAccountMap, toAccountMapWire, fromAccountMapWire } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    const wire = toAccountMapWire(map);
    expect(fromAccountMapWire(wire)).toEqual(map);
  });

  it("P4-37: the decoder is genuinely wired to ACCOUNT_MAP_DOMAIN_FIELDS, not a hardcoded index -- perturbing the field order changes the decode", async () => {
    // The exact shape of the bug this exists to prevent: a decoder with
    // `row[2]` in it would decode identically no matter what domain_fields
    // says, which is indistinguishable from not deriving from it at all.
    const { buildAccountMap, toAccountMapWire, fromAccountMapWire } = await import("../account-map");
    const map = await buildAccountMap(makeClient(FAITH_SCHOOL), "user-1", NOW);
    const wire = toAccountMapWire(map);
    const perturbed = { ...wire, domain_fields: ["one_line", "read", "active_for_account", "write", "views"] as unknown as typeof wire.domain_fields };
    expect(fromAccountMapWire(perturbed)).not.toEqual(map);
  });

  it.each([
    ["legacy", LEGACY],
    ["domains", FAITH_SCHOOL],
  ])(`%s map, as sent on the wire, stays within the ${ACCOUNT_MAP_WIRE_TOKEN_BUDGET}-token budget (P4-31; estimate: ceil(chars / 3.5) of the minified JSON; no tokenizer is installed)`, async (label, fixture) => {
    const { buildAccountMap, toAccountMapWire } = await import("../account-map");
    const wire = toAccountMapWire(await buildAccountMap(makeClient(fixture), "user-1", NOW));
    const chars = JSON.stringify(wire).length;
    const estimate = Math.ceil(chars / 3.5);
    expect(estimate, `${label}: ${chars} chars ≈ ${estimate} tokens`).toBeLessThanOrEqual(ACCOUNT_MAP_WIRE_TOKEN_BUDGET);
  });
});
