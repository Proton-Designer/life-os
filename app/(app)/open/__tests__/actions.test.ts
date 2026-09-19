import { beforeEach, describe, expect, it, vi } from "vitest";

// Same pattern as onboarding/__tests__/actions.test.ts: redirect() throws in
// real Next (it works via a thrown NEXT_REDIRECT signal), so a mock that
// throws is the only way to assert what ran BEFORE it without actually
// leaving the test process. `.rejects.toThrow("REDIRECT")` proves the
// function reached this call; anything asserted to have ALSO run must have
// run strictly before it, since nothing after a throw executes.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

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

  // THE BUG (Boss-reported, 2026-09-18): tap "Start day" on /open, get
  // redirected to /open/today, and the page can still show the "Start day
  // hasn't been tapped yet today" empty state -- a manual reload then shows
  // correct data. The write (markDayStarted) is fine and idempotent; nothing
  // here revalidated the client Router Cache before redirecting, so Next
  // served the stale RSC payload from an EARLIER visit to /open/today (a
  // realistic path -- that page is documented as reachable at any point in
  // the day, not only as a post-tap redirect target). Both /open and
  // /open/today read the wake mark, so both need revalidating.
  it("revalidates /open and /open/today before redirecting -- the first-use trust bug", async () => {
    const { startDayAction } = await import("../actions");

    await expect(startDayAction()).rejects.toThrow("REDIRECT");

    expect(revalidatePathMock).toHaveBeenCalledWith("/open");
    expect(revalidatePathMock).toHaveBeenCalledWith("/open/today");
  });

  it("writes the wake mark before redirecting", async () => {
    const { startDayAction } = await import("../actions");

    await expect(startDayAction()).rejects.toThrow("REDIRECT");

    expect(markDayStartedMock).toHaveBeenCalledTimes(1);
  });

  it("redirects to /login without writing or revalidating anything when unauthenticated", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    const { startDayAction } = await import("../actions");

    await expect(startDayAction()).rejects.toThrow("REDIRECT");

    expect(markDayStartedMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
