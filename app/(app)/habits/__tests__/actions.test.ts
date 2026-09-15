import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock() }));

const createIdentityHabitCoreMock = vi.fn();
const archiveIdentityHabitCoreMock = vi.fn();
const killIdentityHabitCoreMock = vi.fn();
const castHabitVoteCoreMock = vi.fn();
const retractHabitVoteCoreMock = vi.fn();
vi.mock("@/lib/habits/actions-core", () => ({
  createIdentityHabitCore: (...args: unknown[]) => createIdentityHabitCoreMock(...args),
  archiveIdentityHabitCore: (...args: unknown[]) => archiveIdentityHabitCoreMock(...args),
  killIdentityHabitCore: (...args: unknown[]) => killIdentityHabitCoreMock(...args),
  castHabitVoteCore: (...args: unknown[]) => castHabitVoteCoreMock(...args),
  retractHabitVoteCore: (...args: unknown[]) => retractHabitVoteCoreMock(...args),
}));

const fakeSupabase = {
  fake: true,
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: "America/Chicago" } }),
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ supabase: fakeSupabase, userId: "user-1" });
});

describe("habit actions (#39/#40) — 'use server' wrappers over lib/habits/actions-core", () => {
  it("createIdentityHabitAction passes through and revalidates /habits", async () => {
    createIdentityHabitCoreMock.mockResolvedValue({ id: "h1", identityStatement: "the athlete", rank: 1, createdAt: "2026-09-14T00:00:00Z" });
    const { createIdentityHabitAction } = await import("../actions");
    const res = await createIdentityHabitAction("the athlete");
    expect(res).toEqual({ ok: true, habit: { id: "h1", identityStatement: "the athlete", rank: 1, createdAt: "2026-09-14T00:00:00Z" } });
    expect(createIdentityHabitCoreMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "the athlete");
    expect(revalidatePathMock).toHaveBeenCalledWith("/habits");
  });

  it("createIdentityHabitAction maps a 7-cap unique-violation (23505) to an honest message, not a raw Postgres string", async () => {
    createIdentityHabitCoreMock.mockRejectedValue({ code: "23505", message: "duplicate key value violates unique constraint" });
    const { createIdentityHabitAction } = await import("../actions");
    const res = await createIdentityHabitAction("the athlete");
    expect(res).toEqual({ error: "That slot was just taken — try again." });
  });

  it("createIdentityHabitAction surfaces a plain Error's own message (e.g. the 7-cap pre-check)", async () => {
    createIdentityHabitCoreMock.mockRejectedValue(new Error("You already have 7 active habits — archive one before adding another."));
    const { createIdentityHabitAction } = await import("../actions");
    const res = await createIdentityHabitAction("the athlete");
    expect(res).toEqual({ error: "You already have 7 active habits — archive one before adding another." });
  });

  it("archiveIdentityHabitAction calls through and revalidates", async () => {
    archiveIdentityHabitCoreMock.mockResolvedValue(undefined);
    const { archiveIdentityHabitAction } = await import("../actions");
    const res = await archiveIdentityHabitAction("h1");
    expect(res).toEqual({ ok: true });
    expect(archiveIdentityHabitCoreMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "h1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/habits");
  });

  it("killIdentityHabitAction (P2-11) calls through with the optional reason and revalidates on success", async () => {
    killIdentityHabitCoreMock.mockResolvedValue({ ok: true });
    const { killIdentityHabitAction } = await import("../actions");
    const res = await killIdentityHabitAction("h1", "no longer relevant");
    expect(res).toEqual({ ok: true });
    expect(killIdentityHabitCoreMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "h1", "no longer relevant");
    expect(revalidatePathMock).toHaveBeenCalledWith("/habits");
  });

  it("killIdentityHabitAction passes reason through as undefined when omitted", async () => {
    killIdentityHabitCoreMock.mockResolvedValue({ ok: true });
    const { killIdentityHabitAction } = await import("../actions");
    await killIdentityHabitAction("h1");
    expect(killIdentityHabitCoreMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "h1", undefined);
  });

  it("killIdentityHabitAction passes a requires_reason refusal straight through, without revalidating", async () => {
    killIdentityHabitCoreMock.mockResolvedValue({ ok: false, reason: "requires_reason" });
    const { killIdentityHabitAction } = await import("../actions");
    const res = await killIdentityHabitAction("h1");
    expect(res).toEqual({ ok: false, reason: "requires_reason" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("killIdentityHabitAction maps a thrown database error to an honest message, same as the other actions", async () => {
    killIdentityHabitCoreMock.mockRejectedValue(new Error("connection reset"));
    const { killIdentityHabitAction } = await import("../actions");
    const res = await killIdentityHabitAction("h1", "a reason");
    expect(res).toEqual({ error: "connection reset" });
  });

  it("castHabitVoteAction resolves the caller's timezone and passes it to the core, along with a real Date", async () => {
    castHabitVoteCoreMock.mockResolvedValue(undefined);
    const { castHabitVoteAction } = await import("../actions");
    const res = await castHabitVoteAction("h1", "2026-09-14");
    expect(res).toEqual({ ok: true });
    expect(castHabitVoteCoreMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "h1", "2026-09-14", expect.any(Date), "America/Chicago");
    expect(revalidatePathMock).toHaveBeenCalledWith("/habits");
  });

  it("castHabitVoteAction surfaces the core's rejection of a non-today date verbatim, rather than swallowing it", async () => {
    castHabitVoteCoreMock.mockRejectedValue(new Error("Votes can only be cast or retracted for today."));
    const { castHabitVoteAction } = await import("../actions");
    const res = await castHabitVoteAction("h1", "2026-09-13");
    expect(res).toEqual({ error: "Votes can only be cast or retracted for today." });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("retractHabitVoteAction calls through with the resolved timezone", async () => {
    retractHabitVoteCoreMock.mockResolvedValue(undefined);
    const { retractHabitVoteAction } = await import("../actions");
    const res = await retractHabitVoteAction("h1", "2026-09-14");
    expect(res).toEqual({ ok: true });
    expect(retractHabitVoteCoreMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "h1", "2026-09-14", expect.any(Date), "America/Chicago");
  });
});
