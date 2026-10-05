import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const getTodayDayStartMock = vi.fn(async (..._args: unknown[]) => null as unknown);
// resolveWakeInstant stays REAL (the future-time refusal is the behavior under test); only the writes/reads are mocked.
vi.mock("@/lib/day-structure/day-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/day-structure/day-start")>()),
  markDayStarted: (...args: unknown[]) => markDayStartedMock(...args),
  getTodayDayStart: (...args: unknown[]) => getTodayDayStartMock(...args),
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

describe("startDayAtAction — start with an earlier wake time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T14:30:00.000Z")); // 9:30 AM Chicago
    getAuthedUserMock.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    getTodayDayStartMock.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it("writes the first mark at the chosen time (not now), revalidates Home", async () => {
    const { startDayAtAction } = await import("../actions");
    const res = await startDayAtAction("07:00");
    expect(res).toEqual({ ok: true, alreadyStarted: false });
    const args = markDayStartedMock.mock.calls[0]!;
    expect(args[4]).toEqual(new Date("2026-10-05T12:00:00.000Z")); // 7:00 AM CDT
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("a day that was already started is reported as such (the write itself is insert-only and cannot move the mark)", async () => {
    getTodayDayStartMock.mockResolvedValue({ localDate: "2026-10-05", wokeAtIso: "2026-10-05T13:00:00.000Z" });
    const { startDayAtAction } = await import("../actions");
    expect(await startDayAtAction("07:00")).toEqual({ ok: true, alreadyStarted: true });
  });

  it("refuses a future time or a malformed one, with the reason RETURNED, and writes nothing", async () => {
    const { startDayAtAction } = await import("../actions");
    expect(await startDayAtAction("11:00")).toEqual({ ok: false, message: "That time hasn't happened yet today." });
    expect(await startDayAtAction("7am")).toEqual({ ok: false, message: "Enter a valid wake time." });
    expect(markDayStartedMock).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is redirected to /login and nothing is written", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    const { startDayAtAction } = await import("../actions");
    await expect(startDayAtAction("07:00")).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(markDayStartedMock).not.toHaveBeenCalled();
  });
});

