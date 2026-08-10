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

const getUserMock = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("updateProfile", () => {
  beforeEach(() => {
    getUserMock.mockClear();
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
});
