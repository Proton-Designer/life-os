import { beforeEach, describe, expect, it, vi } from "vitest";

// Same pattern as onboarding/__tests__/actions.test.ts: redirect() throws in
// real Next (it works via a thrown NEXT_REDIRECT signal), so a mock that
// throws is the only way to assert what ran BEFORE it without actually
// leaving the test process. `.rejects.toThrow("REDIRECT")` proves the
// function reached this call; anything asserted to have ALSO run must have
// run strictly before it, since nothing after a throw executes.
const redirectMock = vi.fn((_href: string) => {
  throw new Error("REDIRECT");
});
vi.mock("next/navigation", () => ({ redirect: (h: string) => redirectMock(h) }));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const getAuthedUserMock = vi.fn(async (): Promise<{ id: string; email: string } | null> => ({
  id: "user-1",
  email: "u@example.com",
}));
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago" }));
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: () => getAuthedUserMock(),
  getProfile: () => getProfileMock(),
}));

const markDayStartedMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/day-structure/day-start", () => ({
  markDayStarted: (...args: unknown[]) => markDayStartedMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

describe("startDayAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedUserMock.mockResolvedValue({ id: "user-1", email: "u@example.com" });
  });

  it("writes the wake mark, revalidates Home and does NOT redirect (IA-P2: the Today strip appears in place)", async () => {
    const { startDayAction } = await import("../actions");

    await expect(startDayAction()).resolves.toBeUndefined();

    expect(markDayStartedMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login without writing or revalidating anything when unauthenticated", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    const { startDayAction } = await import("../actions");

    await expect(startDayAction()).rejects.toThrow("REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(markDayStartedMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
