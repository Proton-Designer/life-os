import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async (): Promise<{ data: { claims: { sub: string } } | null; error: null }> => ({
  data: { claims: { sub: "user-1" } },
  error: null,
}));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));

describe("getUserDomains", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("returns legacy mode for an unauthenticated caller, without throwing", async () => {
    getClaimsMock.mockResolvedValueOnce({ data: null, error: null });
    const { getUserDomains } = await import("../get-user-domains");

    await expect(getUserDomains()).resolves.toEqual({ mode: "legacy" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns legacy mode for an onboarded account with zero active domains — Ayman's real account and SEED's actual current state", async () => {
    const tables: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { onboarding_completed: true }, error: null }),
      user_domains: makeChain({ data: [], error: null }),
    };
    fromImpl = (table) => tables[table];
    const { getUserDomains } = await import("../get-user-domains");

    const state = await getUserDomains();

    expect(state).toEqual({ mode: "legacy" });
  });

  it("does NOT return legacy mode for a mid-onboarding account (onboarding_completed=false, zero domains yet) — that combination is real and expected, not the predates-Phase-1 case", async () => {
    const tables: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { onboarding_completed: false }, error: null }),
      user_domains: makeChain({ data: [], error: null }),
    };
    fromImpl = (table) => tables[table];
    const { getUserDomains } = await import("../get-user-domains");

    const state = await getUserDomains();

    expect(state).toEqual({ mode: "domains", domains: [], subdomains: [] });
  });

  it("returns domains mode, shaped for the shell, when active domains exist", async () => {
    const tables: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { onboarding_completed: true }, error: null }),
      user_domains: makeChain({
        data: [
          { id: "domain-pg", key: "personal_growth", position: 0, weight: "essential" },
          { id: "domain-work", key: "work", position: 1, weight: "background" },
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
        ],
        error: null,
      }),
    };
    fromImpl = (table) => tables[table];
    const { getUserDomains } = await import("../get-user-domains");

    const state = await getUserDomains();

    expect(state).toEqual({
      mode: "domains",
      domains: [
        { key: "personal_growth", position: 0, weight: "essential" },
        { key: "work", position: 1, weight: "background" },
      ],
      subdomains: [
        {
          domainKey: "personal_growth",
          key: "faith",
          label: "Faith",
          kind: null,
          widgets: ["prayer_tracker"],
          config: { prayer_calc_method: "ISNA" },
          position: 0,
        },
      ],
    });
    // Never queries user_subdomains when there are zero domains -- covered
    // implicitly by the legacy/empty tests above never registering a
    // user_subdomains table in `tables`, which would throw on a stray call.
    expect(tables.user_domains.is).toHaveBeenCalledWith("archived_at", null);
    expect(tables.user_subdomains.is).toHaveBeenCalledWith("archived_at", null);
    // weight (migration 110) -- the arbiter's weight-tier signal (R18/R19).
    expect(tables.user_domains.select).toHaveBeenCalledWith("id, key, position, weight");
  });
});
