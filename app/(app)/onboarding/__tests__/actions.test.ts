import { beforeEach, describe, expect, it, vi } from "vitest";

// Per-table configurable chain, extending the pattern in
// app/(app)/business/__tests__/actions.test.ts to multiple tables in one
// test (saveSubdomains/completeOnboarding each touch two). `delete` is
// deliberately included and asserted un-called in the archival tests below
// — "removal is archival, never deletion" is a property this suite proves,
// not just documents.
function makeChain(resolvedValue: { data: unknown; error: null; count?: number } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async (): Promise<{ data: { claims: { sub: string } } | null; error: null }> => ({
  data: { claims: { sub: "user-1" } },
  error: null,
}));
const rpcMock = vi.fn(async () => ({ data: null, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock, rpc: rpcMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: vi.fn(async () => undefined) }));
const seedMeditationsDeckForUserMock = vi.fn(async () => ({ seeded: true, alreadySeeded: false, bookId: "book-1", lessonCount: 12, cardCount: 47 }));
vi.mock("@/lib/self-mastery/seed-meditations-deck", () => ({
  seedMeditationsDeckForUser: () => seedMeditationsDeckForUserMock(),
}));

describe("Onboarding actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    rpcMock.mockClear();
    seedMeditationsDeckForUserMock.mockClear();
  });

  describe("saveDomainSelection", () => {
    it("rejects an empty selection without touching the database", async () => {
      const { saveDomainSelection } = await import("../actions");
      await expect(saveDomainSelection([])).rejects.toThrow("at least one domain is required");
      expect(fromMock).not.toHaveBeenCalled();
    });

    // Ruling (c)/R10: saveDomainSelection is idempotent/reconciling — called
    // again on wizard back-nav or a future add/remove-domains action. A
    // single upsert can't set `weight` only for genuinely NEW rows: Postgres
    // materializes `excluded.<col>` from the attempted row INCLUDING column
    // defaults for any key the JS payload omitted, so a batch upsert with
    // `weight` present in even one row's object generates one uniform
    // `ON CONFLICT DO UPDATE SET weight = excluded.weight` that would
    // silently reset every conflicting (already-existing) row's weight back
    // to the default — exactly the "reordering silently re-weights" bug R10
    // exists to prevent, just moved from `position` to a repeat call. So the
    // insert and update paths are genuinely separate calls now: only the
    // insert path's payload includes `weight`, and it's never present
    // anywhere in the update path at all.
    it("brand-new keys go through insert() with weight computed — first (position 0) essential, rest important", async () => {
      const selectChain = makeChain({ data: [], error: null }); // no existing rows for either key
      const insertChain = makeChain();
      fromImpl = (table) => {
        if (table !== "user_domains") throw new Error(`unexpected table ${table}`);
        return insertChain;
      };
      // select() is called first to find existing keys; route it to its own resolved chain.
      insertChain.select = vi.fn(() => selectChain);
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["school", "personal_growth"]);

      expect(insertChain.insert).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: "user-1", key: "school", position: 0, weight: "essential", archived_at: null }),
        expect.objectContaining({ user_id: "user-1", key: "personal_growth", position: 1, weight: "important", archived_at: null }),
      ]);
      expect(insertChain.upsert).not.toHaveBeenCalled();
    });

    it("a key that already has a row (active or archived) goes through update(), and the payload never includes weight at all", async () => {
      const selectChain = makeChain({ data: [{ key: "work" }], error: null }); // "work" already exists
      const chain = makeChain();
      chain.select = vi.fn(() => selectChain);
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["work"]);

      expect(chain.insert).not.toHaveBeenCalled();
      const updateCall = chain.update.mock.calls.find((c) => "archived_at" in (c[0] as object) && (c[0] as { archived_at: unknown }).archived_at === null);
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).not.toHaveProperty("weight");
      expect(updateCall![0]).toEqual(expect.objectContaining({ position: 0, archived_at: null }));
    });

    it("a mixed selection (one new key, one existing) inserts the new one with weight and updates the existing one without touching weight", async () => {
      const selectChain = makeChain({ data: [{ key: "work" }], error: null }); // only "work" pre-exists
      const chain = makeChain();
      chain.select = vi.fn(() => selectChain);
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["work", "school"]);

      expect(chain.insert).toHaveBeenCalledWith([
        expect.objectContaining({ key: "school", position: 1, weight: "important" }),
      ]);
      const updateCall = chain.update.mock.calls.find((c) => "archived_at" in (c[0] as object) && (c[0] as { archived_at: unknown }).archived_at === null);
      expect(updateCall![0]).not.toHaveProperty("weight");
    });

    it("archives domains dropped from the selection — via update, never delete", async () => {
      const selectChain = makeChain({ data: [], error: null });
      const chain = makeChain();
      chain.select = vi.fn(() => selectChain);
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["personal_growth"]);

      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ archived_at: expect.any(String) })
      );
      expect(chain.in).toHaveBeenCalledWith("key", expect.arrayContaining(["work", "school"]));
      expect(chain.delete).not.toHaveBeenCalled();
    });

    it("selecting all three domains issues no archive call at all", async () => {
      const selectChain = makeChain({ data: [], error: null });
      const chain = makeChain();
      chain.select = vi.fn(() => selectChain);
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["personal_growth", "work", "school"]);

      const archiveCall = chain.update.mock.calls.find((c) => "archived_at" in (c[0] as object) && (c[0] as { archived_at: unknown }).archived_at !== null);
      expect(archiveCall).toBeUndefined();
    });
  });

  describe("saveSubdomains", () => {
    it("rejects zero subdomains for personal_growth before any query — server is the authority, not just the UI", async () => {
      const { saveSubdomains } = await import("../actions");
      await expect(saveSubdomains("personal_growth", [])).rejects.toThrow(
        "Personal Growth requires at least one subdomain"
      );
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("throws if the parent domain hasn't been selected yet", async () => {
      const chain = makeChain({ data: null, error: null }); // domain lookup finds nothing
      fromImpl = () => chain;
      const { saveSubdomains } = await import("../actions");

      await expect(
        saveSubdomains("work", [{ key: "acme-consulting", label: "Acme Consulting", kind: "business" }])
      ).rejects.toThrow('domain "work" has not been selected yet');
    });

    it("archives subdomains dropped from the set and upserts the kept/new ones — idempotent on double-submit, never a delete", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: { id: "domain-1" }, error: null }),
        user_subdomains: makeChain({
          data: [
            { id: "sub-1", key: "faith" },
            { id: "sub-2", key: "fitness" },
          ],
          error: null,
        }),
      };
      fromImpl = (table) => tables[table];
      const { saveSubdomains } = await import("../actions");

      const submission = [
        { key: "faith", label: "Faith", widgets: ["prayer_tracker"] },
        { key: "self_mastery", label: "Self-Mastery" },
      ];
      await saveSubdomains("personal_growth", submission);
      await saveSubdomains("personal_growth", submission); // double-submit

      // "fitness" was active but absent from both submissions -> archived,
      // never deleted. Called once per submission (2x), each idempotent.
      expect(tables.user_subdomains.update).toHaveBeenCalledWith(
        expect.objectContaining({ archived_at: expect.any(String) })
      );
      expect(tables.user_subdomains.delete).not.toHaveBeenCalled();

      for (const call of tables.user_subdomains.upsert.mock.calls) {
        const [rows, opts] = call;
        expect(opts.onConflict).toBe("user_id,domain_id,key");
        expect(rows.map((r: { key: string }) => r.key)).toEqual(["faith", "self_mastery"]);
        expect(rows.every((r: { archived_at: null }) => r.archived_at === null)).toBe(true);
      }
    });

    it("assigns position by submission order", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: { id: "domain-work" }, error: null }),
        user_subdomains: makeChain({ data: [], error: null }),
      };
      fromImpl = (table) => tables[table];
      const { saveSubdomains } = await import("../actions");

      await saveSubdomains("work", [
        { key: "consulting-gig", label: "Consulting Gig", kind: "job" },
        { key: "side-biz", label: "Side Business", kind: "business" },
      ]);

      const [rows] = tables.user_subdomains.upsert.mock.calls[0];
      expect(rows[0]).toEqual(expect.objectContaining({ key: "consulting-gig", position: 0 }));
      expect(rows[1]).toEqual(expect.objectContaining({ key: "side-biz", position: 1 }));
    });
  });

  describe("saveSubdomainConfig", () => {
    it("throws when the parent domain hasn't been selected yet, before ever querying subdomains", async () => {
      const chain = makeChain({ data: null, error: null }); // domain lookup finds nothing
      fromImpl = () => chain;
      const { saveSubdomainConfig } = await import("../actions");

      await expect(
        saveSubdomainConfig("personal_growth", "faith", { timezone: "America/Chicago" })
      ).rejects.toThrow('domain "personal_growth" has not been selected yet');
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("throws when no active subdomain matches the key under that domain", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: { id: "domain-1" }, error: null }),
        user_subdomains: makeChain({ data: null, error: null }),
      };
      fromImpl = (table) => tables[table];
      const { saveSubdomainConfig } = await import("../actions");

      await expect(
        saveSubdomainConfig("personal_growth", "faith", { timezone: "America/Chicago" })
      ).rejects.toThrow('no active subdomain with key "faith" under domain "personal_growth"');
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("scopes the subdomain lookup by (domain_id, key) — the actual fix for the collision the Lead ruled on: a Work subdomain named/slugged \"faith\" must never be targeted when the caller means Personal Growth's Faith", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: { id: "domain-personal-growth" }, error: null }),
        user_subdomains: makeChain({ data: { id: "sub-faith-under-pg" }, error: null }),
      };
      fromImpl = (table) => tables[table];
      const { saveSubdomainConfig } = await import("../actions");

      await saveSubdomainConfig("personal_growth", "faith", { prayer_calc_method: "ISNA" });

      expect(tables.user_domains.eq).toHaveBeenCalledWith("key", "personal_growth");
      expect(tables.user_subdomains.eq).toHaveBeenCalledWith("domain_id", "domain-personal-growth");
      expect(tables.user_subdomains.eq).toHaveBeenCalledWith("key", "faith");
      expect(rpcMock).toHaveBeenCalledWith("merge_subdomain_config", {
        p_subdomain_id: "sub-faith-under-pg",
        p_patch: { prayer_calc_method: "ISNA" },
      });
    });
  });

  describe("getOnboardingState", () => {
    it("returns empty state rather than throwing when unauthenticated — a render-path read must degrade, not kill the page (live-browser regression: /onboarding's page and AuthedShell's redirect race, and this used to throw mid-render)", async () => {
      getClaimsMock.mockResolvedValueOnce({ data: null, error: null });
      const { getOnboardingState } = await import("../actions");

      await expect(getOnboardingState()).resolves.toEqual({ domains: [], subdomains: [] });
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("returns empty arrays for a brand-new user, never throws", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: [], error: null }),
      };
      fromImpl = (table) => tables[table];
      const { getOnboardingState } = await import("../actions");

      const state = await getOnboardingState();

      expect(state).toEqual({ domains: [], subdomains: [] });
      // No subdomain query at all when there are zero active domains — no
      // domain_id to scope it by.
      expect(fromMock).not.toHaveBeenCalledWith("user_subdomains");
    });

    it("shapes active rows for direct wizard hydration — domainKey resolved onto each subdomain, ordered by position", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({
          data: [
            { id: "domain-pg", key: "personal_growth", position: 0 },
            { id: "domain-work", key: "work", position: 1 },
          ],
          error: null,
        }),
        user_subdomains: makeChain({
          data: [
            {
              domain_id: "domain-pg",
              key: "faith",
              label: "Faith",
              kind: null,
              widgets: ["prayer_tracker"],
              config: { prayer_calc_method: "ISNA" },
              position: 0,
            },
            {
              domain_id: "domain-work",
              key: "acme-consulting",
              label: "Acme Consulting",
              kind: "business",
              widgets: [],
              config: {},
              position: 0,
            },
          ],
          error: null,
        }),
      };
      fromImpl = (table) => tables[table];
      const { getOnboardingState } = await import("../actions");

      const state = await getOnboardingState();

      expect(state.domains).toEqual([
        { key: "personal_growth", position: 0 },
        { key: "work", position: 1 },
      ]);
      expect(state.subdomains).toEqual([
        expect.objectContaining({ domainKey: "personal_growth", key: "faith", label: "Faith" }),
        expect.objectContaining({ domainKey: "work", key: "acme-consulting", kind: "business" }),
      ]);
      // Archived rows must never surface to the wizard.
      expect(tables.user_domains.is).toHaveBeenCalledWith("archived_at", null);
      expect(tables.user_subdomains.is).toHaveBeenCalledWith("archived_at", null);
    });
  });

  describe("completeOnboarding", () => {
    it("refuses to complete when zero active domains exist — the abandon-halfway guard", async () => {
      const chain = makeChain({ data: null, error: null, count: 0 });
      fromImpl = () => chain;
      const { completeOnboarding } = await import("../actions");
      const { updateProfile } = await import("@/app/(app)/settings/actions");

      await expect(completeOnboarding({})).rejects.toThrow(
        "at least one domain must be selected before onboarding can complete"
      );
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it("writes profile fields, flips onboarding_completed, and redirects once at least one domain is active", async () => {
      const chain = makeChain({ data: null, error: null, count: 1 });
      fromImpl = () => chain;
      const { completeOnboarding } = await import("../actions");
      const { updateProfile } = await import("@/app/(app)/settings/actions");

      await expect(completeOnboarding({ timezone: "America/Chicago" })).rejects.toThrow("REDIRECT");

      expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ timezone: "America/Chicago", onboarding_completed: true })
      );
    });

    it("calls seedMeditationsDeckForUser unconditionally -- the RPC itself gates on whether the user kept Self-Mastery, not this function", async () => {
      const chain = makeChain({ data: null, error: null, count: 1 });
      fromImpl = () => chain;
      const { completeOnboarding } = await import("../actions");

      await expect(completeOnboarding({})).rejects.toThrow("REDIRECT");

      expect(seedMeditationsDeckForUserMock).toHaveBeenCalled();
    });

    it("a seeding failure never blocks the redirect -- reaching the app for the first time must not depend on Self-Mastery's seed succeeding", async () => {
      const chain = makeChain({ data: null, error: null, count: 1 });
      fromImpl = () => chain;
      seedMeditationsDeckForUserMock.mockRejectedValueOnce(new Error("seed RPC exploded"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { completeOnboarding } = await import("../actions");

      // Still redirects (the mock throws "REDIRECT") despite the seed
      // failure -- not a generic unhandled rejection from the seed error.
      await expect(completeOnboarding({})).rejects.toThrow("REDIRECT");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("seedMeditationsDeckForUser failed"),
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
