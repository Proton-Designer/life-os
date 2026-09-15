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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("updateProfile", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
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
});
