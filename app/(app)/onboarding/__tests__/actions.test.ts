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

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
const rpcMock = vi.fn(async () => ({ data: null, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock, rpc: rpcMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: vi.fn(async () => undefined) }));

describe("Onboarding actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    rpcMock.mockClear();
  });

  describe("saveDomainSelection", () => {
    it("rejects an empty selection without touching the database", async () => {
      const { saveDomainSelection } = await import("../actions");
      await expect(saveDomainSelection([])).rejects.toThrow("at least one domain is required");
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("upserts in selection order, position = array index — the order-preserved contract M3 depends on", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["school", "personal_growth"]);

      expect(fromMock).toHaveBeenCalledWith("user_domains");
      expect(chain.upsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({ user_id: "user-1", key: "school", position: 0, archived_at: null }),
          expect.objectContaining({ user_id: "user-1", key: "personal_growth", position: 1, archived_at: null }),
        ],
        expect.objectContaining({ onConflict: "user_id,key" })
      );
    });

    it("re-selecting an archived domain resets archived_at to null via the upsert row rather than inserting a new row — the behaviour the (user_id,key) unique index is betting on", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["work"]);

      const [rows, opts] = chain.upsert.mock.calls[0];
      expect(rows[0]).toEqual(expect.objectContaining({ key: "work", archived_at: null }));
      expect(opts.onConflict).toBe("user_id,key");
      // Same call shape whether "work" is brand new or was previously
      // archived — the upsert is what makes both cases identical from the
      // action's point of view; only the DB-side conflict target decides
      // insert vs. update.
    });

    it("archives domains dropped from the selection — via update, never delete", async () => {
      const chain = makeChain();
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
      const chain = makeChain();
      fromImpl = () => chain;
      const { saveDomainSelection } = await import("../actions");

      await saveDomainSelection(["personal_growth", "work", "school"]);

      expect(chain.update).not.toHaveBeenCalled();
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
    it("throws when no active subdomain matches the key", async () => {
      const chain = makeChain({ data: null, error: null });
      fromImpl = () => chain;
      const { saveSubdomainConfig } = await import("../actions");

      await expect(saveSubdomainConfig("faith", { timezone: "America/Chicago" })).rejects.toThrow(
        'no active subdomain with key "faith"'
      );
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("merges via the merge_subdomain_config RPC rather than a read-then-write from the action", async () => {
      const chain = makeChain({ data: { id: "sub-1" }, error: null });
      fromImpl = () => chain;
      const { saveSubdomainConfig } = await import("../actions");

      await saveSubdomainConfig("faith", { prayer_calc_method: "ISNA" });

      expect(rpcMock).toHaveBeenCalledWith("merge_subdomain_config", {
        p_subdomain_id: "sub-1",
        p_patch: { prayer_calc_method: "ISNA" },
      });
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
  });
});
