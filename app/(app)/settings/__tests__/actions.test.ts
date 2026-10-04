import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

describe("updateProfile", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("upserts plain fields, always including user_id (so a first-time user with no row yet gets one created)", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateProfile } = await import("../actions");

    await updateProfile({ prayer_calc_method: "ISNA", traveling_mode: true });

    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", prayer_calc_method: "ISNA", traveling_mode: true }),
      expect.objectContaining({ onConflict: "user_id" })
    );
  });

  it("accepts deen_mode true/false and writes ONLY that column (plus user_id) -- no other table is touched", async () => {
    for (const value of [true, false]) {
      fromMock.mockClear();
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ deen_mode: value });

      expect(fromMock.mock.calls.map((c) => c[0])).toEqual(["profiles"]);
      expect(chain.upsert).toHaveBeenCalledWith({ user_id: "user-1", deen_mode: value }, expect.anything());
    }
  });

  it("rejects a non-boolean deen_mode without writing", async () => {
    for (const bad of ["yes", 1, null]) {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");
      await expect(updateProfile({ deen_mode: bad } as never)).rejects.toThrow(/deen_mode must be a boolean/);
      expect(chain.upsert).not.toHaveBeenCalled();
    }
  });

  it("revalidates the shared layout when deen_mode changes (nav must update)", async () => {
    fromImpl = () => makeChain();
    const { updateProfile } = await import("../actions");
    revalidatePathMock.mockClear();
    await updateProfile({ deen_mode: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it("hashes a raw `pin` field with bcrypt before writing pin_hash, never storing it raw", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateProfile } = await import("../actions");

    await updateProfile({ pin: "1234" });

    const upsertArg = chain.upsert.mock.calls[0][0];
    expect(upsertArg.pin).toBeUndefined();
    expect(upsertArg.pin_hash).toBeDefined();
    expect(upsertArg.pin_hash).not.toBe("1234");
    expect(upsertArg.pin_hash.length).toBeGreaterThan(20);
  });

  it("rejects a direct pin_hash write that looks like a raw PIN, not a bcrypt hash", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateProfile } = await import("../actions");

    await expect(updateProfile({ pin_hash: "1234" } as never)).rejects.toThrow();
    expect(chain.upsert).not.toHaveBeenCalled();
  });

  it("accepts a direct pin_hash write that is already a real bcrypt hash", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateProfile } = await import("../actions");
    const realHash = await bcrypt.hash("1234", 10);

    await expect(updateProfile({ pin_hash: realHash } as never)).resolves.not.toThrow();
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ pin_hash: realHash }),
      expect.anything()
    );
  });

  it("marks onboarding_completed via the same generic fields object", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateProfile } = await import("../actions");

    await updateProfile({ onboarding_completed: true, location_label: "Chicago, IL" });

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_completed: true, location_label: "Chicago, IL" }),
      expect.anything()
    );
  });

  // L10 (docs/ai-connector/PROGRAM-PLAN.md).
  describe("theme_preset / hidden_features (L10)", () => {
    it("accepts a real preset id and writes it through", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ theme_preset: "ocean" });

      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ theme_preset: "ocean" }), expect.anything());
    });

    it("rejects an unknown theme_preset before ever calling upsert", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await expect(updateProfile({ theme_preset: "not-a-real-preset" } as never)).rejects.toThrow(/theme_preset/);
      expect(chain.upsert).not.toHaveBeenCalled();
    });

    it("accepts a real hidden_features list and writes it through", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ hidden_features: ["deen", "work"] });

      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ hidden_features: ["deen", "work"] }), expect.anything());
    });

    it("rejects hidden_features containing an unknown id before ever calling upsert", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await expect(updateProfile({ hidden_features: ["deen", "not-real"] } as never)).rejects.toThrow(/hidden_features/);
      expect(chain.upsert).not.toHaveBeenCalled();
    });

    it("rejects hidden_features containing 'home' or 'settings' — the lockout guard, enforced here too, not just in the type", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await expect(updateProfile({ hidden_features: ["home"] } as never)).rejects.toThrow();
      await expect(updateProfile({ hidden_features: ["settings"] } as never)).rejects.toThrow();
      expect(chain.upsert).not.toHaveBeenCalled();
    });
  });

  // P3-05/P3-11 (migration 250) -- mirror of hidden_features above, opposite direction.
  describe("enabled_features (P3-05, migration 250)", () => {
    it("accepts a real enabled_features list and writes it through", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ enabled_features: ["cards_library"] });

      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ enabled_features: ["cards_library"] }), expect.anything());
    });

    it("rejects enabled_features containing an unknown id before ever calling upsert", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await expect(updateProfile({ enabled_features: ["cards_library", "not-real"] } as never)).rejects.toThrow(/enabled_features/);
      expect(chain.upsert).not.toHaveBeenCalled();
    });
  });

  describe("ai_monthly_spend_cap_usd (P2-01, migration 181)", () => {
    it("accepts a positive cap and writes it through", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ ai_monthly_spend_cap_usd: 25 });

      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ ai_monthly_spend_cap_usd: 25 }), expect.anything());
    });

    it("accepts null (revert to the system default) and writes it through", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ ai_monthly_spend_cap_usd: null });

      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ ai_monthly_spend_cap_usd: null }), expect.anything());
    });

    it("rejects a zero or negative cap before ever calling upsert", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await expect(updateProfile({ ai_monthly_spend_cap_usd: 0 })).rejects.toThrow(/ai_monthly_spend_cap_usd/);
      await expect(updateProfile({ ai_monthly_spend_cap_usd: -5 })).rejects.toThrow(/ai_monthly_spend_cap_usd/);
      expect(chain.upsert).not.toHaveBeenCalled();
    });
  });

  describe("sleep_reminder_enabled (P2-05, migration 183)", () => {
    it("writes the toggle through", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ sleep_reminder_enabled: true });

      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ sleep_reminder_enabled: true }), expect.anything());
    });
  });

  // First-use trust bug follow-up (2026-09-18): profile data is read by far
  // more surfaces than /settings and /onboarding -- timezone alone is read
  // on nearly every page (AGENTS.md's calendar-date rule), theme_preset/
  // hidden_features/display_name render in the nav shell itself
  // (components/shell/app-shell.tsx), enabled_features reaches
  // /self-mastery, and prayer_calc_method/asr_madhab/location_* reach both
  // Home and /deen. A write touching any of those must revalidate the
  // shared app/(app)/layout.tsx layout -- not just /settings -- or a
  // page visited earlier in the session keeps rendering the old value.
  // pin/pin_hash/pin_lock_enabled/ai_monthly_spend_cap_usd/
  // sleep_reminder_enabled are the verified exception: nothing outside
  // /settings (or, for the latter two, a background job that reads fresh
  // from the DB every run) ever reads them, so revalidating the whole
  // layout for THOSE would be the reflexive over-revalidation this is
  // deliberately avoiding.
  describe("layout revalidation scope", () => {
    it("revalidates the shared layout when timezone changes -- read almost everywhere", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ timezone: "America/Chicago" });

      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("revalidates the shared layout when theme_preset changes -- rendered in the nav shell", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ theme_preset: "ocean" });

      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("revalidates the shared layout when hidden_features changes -- filters the nav shell's own items", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ hidden_features: ["deen"] });

      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("revalidates the shared layout when enabled_features changes -- reaches /self-mastery", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ enabled_features: ["cards_library"] });

      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("revalidates the shared layout when prayer/location fields change -- read by Home and /deen", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ prayer_calc_method: "ISNA", asr_madhab: "hanafi", location_lat: 41.8, location_lng: -87.6 });

      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("does NOT revalidate the shared layout for a PIN-only change -- nothing outside /settings reads it", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ pin: "1234" });

      expect(revalidatePathMock).not.toHaveBeenCalledWith("/", "layout");
      expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    });

    it("does NOT revalidate the shared layout for pin_lock_enabled alone", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ pin_lock_enabled: true });

      expect(revalidatePathMock).not.toHaveBeenCalledWith("/", "layout");
    });

    it("does NOT revalidate the shared layout for ai_monthly_spend_cap_usd alone -- checked at AI-call time, never rendered", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ ai_monthly_spend_cap_usd: 25 });

      expect(revalidatePathMock).not.toHaveBeenCalledWith("/", "layout");
    });

    it("does NOT revalidate the shared layout for sleep_reminder_enabled alone -- read only by a cron job, never a cached page", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ sleep_reminder_enabled: true });

      expect(revalidatePathMock).not.toHaveBeenCalledWith("/", "layout");
    });

    it("DOES revalidate the shared layout when a broad field rides along with a settings-only one in the same call", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ pin_lock_enabled: true, timezone: "America/Chicago" });

      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("always revalidates /settings and /onboarding regardless of which fields changed", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { updateProfile } = await import("../actions");

      await updateProfile({ pin_lock_enabled: true });

      expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
      expect(revalidatePathMock).toHaveBeenCalledWith("/onboarding");
    });
  });
});
