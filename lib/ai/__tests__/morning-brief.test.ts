import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const gatewayChatMock = vi.fn();
vi.mock("../gateway", () => ({
  gatewayChat: (...args: unknown[]) => gatewayChatMock(...args),
}));

const { normalizeBriefText, computeNightlyBriefInputs, generateMorningBrief, dispatchNightlyMorningBriefs, getMorningBriefForToday } = await import(
  "../morning-brief"
);

beforeEach(() => {
  gatewayChatMock.mockReset();
});

describe("normalizeBriefText()", () => {
  it("keeps up to 3 non-empty trimmed lines", () => {
    expect(normalizeBriefText("Line one.\nLine two.\nLine three.")).toBe("Line one.\nLine two.\nLine three.");
  });

  it("drops blank lines and trims whitespace", () => {
    expect(normalizeBriefText("  Line one.  \n\n  Line two.\n")).toBe("Line one.\nLine two.");
  });

  it("truncates to at most 3 lines even if the model returns more", () => {
    expect(normalizeBriefText("one\ntwo\nthree\nfour\nfive")).toBe("one\ntwo\nthree");
  });

  it("returns empty string for all-blank input, never throws", () => {
    expect(normalizeBriefText("\n\n  \n")).toBe("");
  });
});

describe("computeNightlyBriefInputs()", () => {
  function makeClient(opts: { completedYesterday?: number; dueToday?: number } = {}) {
    const calls: { eq: Record<string, unknown>; gte?: string; lt?: string }[] = [];
    const from = vi.fn(() => {
      const eqArgs: Record<string, unknown> = {};
      let gteArg: string | undefined;
      let ltArg: string | undefined;
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((col: string, val: unknown) => {
        eqArgs[col] = val;
        return chain;
      });
      chain.gte = vi.fn((_col: string, val: string) => {
        gteArg = val;
        return chain;
      });
      chain.lt = vi.fn((_col: string, val: string) => {
        ltArg = val;
        return chain;
      });
      chain.then = (resolve: (v: { count: number; error: null }) => void) => {
        calls.push({ eq: { ...eqArgs }, gte: gteArg, lt: ltArg });
        const isCompletedQuery = eqArgs.completed === true;
        const count = isCompletedQuery ? (opts.completedYesterday ?? 0) : (opts.dueToday ?? 0);
        resolve({ count, error: null });
      };
      return chain;
    });
    return { client: { from } as unknown as SupabaseClient, calls };
  }

  it("counts tasks completed within [yesterday-local-start, today-local-start) and tasks due today, per the user's own timezone", async () => {
    const { client, calls } = makeClient({ completedYesterday: 3, dueToday: 2 });
    const result = await computeNightlyBriefInputs(client, "user-1", new Date("2026-09-15T13:00:00.000Z"), "America/Chicago");
    expect(result).toEqual({ tasksCompletedYesterday: 3, tasksDueToday: 2 });

    const completedCall = calls.find((c) => c.eq.completed === true)!;
    expect(completedCall.gte).toBe("2026-09-14T05:00:00.000Z"); // yesterday 00:00 CDT
    expect(completedCall.lt).toBe("2026-09-15T05:00:00.000Z"); // today 00:00 CDT

    const dueCall = calls.find((c) => c.eq.completed === false)!;
    expect(dueCall.eq.due_date).toBe("2026-09-15");
  });

  it("both counts are scoped to the given user_id", async () => {
    const { client, calls } = makeClient();
    await computeNightlyBriefInputs(client, "user-42", new Date("2026-09-15T13:00:00.000Z"), "UTC");
    expect(calls.every((c) => c.eq.user_id === "user-42")).toBe(true);
  });

  it("a null count (Supabase's own shape for a count query with no matching rows) degrades to 0, never null/undefined", async () => {
    const { client } = makeClient({}); // undefined opts -> the fake resolves { count: undefined, error: null } -> ?? 0
    const result = await computeNightlyBriefInputs(client, "user-1", new Date("2026-09-15T13:00:00.000Z"), "UTC");
    expect(result).toEqual({ tasksCompletedYesterday: 0, tasksDueToday: 0 });
  });
});

describe("generateMorningBrief()", () => {
  it("calls gatewayChat with provider/tier OMITTED (resolves the user's own saved preference), feature 'morning_brief'", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "Line one.\nLine two.\nLine three.", keySource: "user" });
    const fakeClient = {} as unknown as SupabaseClient;
    const result = await generateMorningBrief(fakeClient, "user-1", { tasksCompletedYesterday: 2, tasksDueToday: 1 });

    expect(result).toEqual({ ok: true, briefText: "Line one.\nLine two.\nLine three.", provider: "user", model: "" });
    const call = gatewayChatMock.mock.calls[0];
    expect(call[0]).toBe(fakeClient);
    expect(call[1]).toBe("user-1");
    expect(call[2]).toBe("morning_brief");
    expect(call[4]).not.toHaveProperty("provider");
    expect(call[4]).not.toHaveProperty("tier");
  });

  it("gatewayChat ok:false (no key, cap hit, provider failure) surfaces as ok:false with its own message -- never throws", async () => {
    gatewayChatMock.mockResolvedValue({ ok: false, message: "AI features aren't enabled for this account." });
    const result = await generateMorningBrief({} as unknown as SupabaseClient, "user-1", { tasksCompletedYesterday: 0, tasksDueToday: 0 });
    expect(result).toEqual({ ok: false, reason: "AI features aren't enabled for this account." });
  });

  it("empty/unusable content after normalization is treated as a failure, not a blank brief", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "\n\n  \n" });
    const result = await generateMorningBrief({} as unknown as SupabaseClient, "user-1", { tasksCompletedYesterday: 0, tasksDueToday: 0 });
    expect(result.ok).toBe(false);
  });
});

describe("dispatchNightlyMorningBriefs()", () => {
  // America/Chicago is UTC-5 in September. Window is [04:00, 09:00) local.
  const AT_0400_LOCAL = new Date("2026-09-15T09:00:00.000Z");
  const AT_0359_LOCAL = new Date("2026-09-15T08:59:00.000Z");
  const AT_0859_LOCAL = new Date("2026-09-15T13:59:00.000Z");
  const AT_0900_LOCAL = new Date("2026-09-15T14:00:00.000Z");

  function makeClient(opts: { profiles?: { user_id: string; timezone: string | null }[]; claimedUsers?: Set<string> } = {}) {
    const insertCalls: Record<string, unknown>[] = [];
    const updateCalls: Record<string, unknown>[] = [];
    const deleteCalls: Record<string, unknown>[] = [];
    const claimed = new Set(opts.claimedUsers ?? []);

    const from = vi.fn((table: string) => {
      const eqArgs: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((col: string, val: unknown) => {
        eqArgs[col] = val;
        return chain;
      });
      chain.gte = vi.fn(() => chain);
      chain.lt = vi.fn(() => chain);
      chain.then = (resolve: (v: { data?: unknown; count?: number; error: null }) => void) => {
        if (table === "profiles") return resolve({ data: opts.profiles ?? [], error: null });
        if (table === "tasks") return resolve({ count: 0, error: null }); // no brief-content assertions in this describe block
        resolve({ error: null });
      };
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        insertCalls.push(row);
        const userId = row.user_id as string;
        if (claimed.has(userId)) return Promise.resolve({ error: { code: "23505" } });
        claimed.add(userId);
        return Promise.resolve({ error: null });
      });
      chain.update = vi.fn((values: Record<string, unknown>) => {
        updateCalls.push(values);
        return chain;
      });
      chain.delete = vi.fn(() => chain);
      // .update(...).eq().eq() and .delete().eq().eq() both terminate by awaiting the chain itself.
      const originalThen = chain.then;
      const updateMock = chain.update as ReturnType<typeof vi.fn>;
      const deleteMock = chain.delete as ReturnType<typeof vi.fn>;
      chain.then = (resolve: (v: { error: null }) => void) => {
        if (table === "ai_morning_briefs" && updateMock.mock.calls.length > 0) return resolve({ error: null });
        if (table === "ai_morning_briefs" && deleteMock.mock.calls.length > 0) {
          deleteCalls.push({ ...eqArgs });
          return resolve({ error: null });
        }
        return (originalThen as (r: (v: { data?: unknown; error: null }) => void) => void)(resolve as never);
      };
      return chain;
    });

    return { client: { from } as unknown as SupabaseClient, insertCalls, updateCalls, deleteCalls };
  }

  it("skips a user outside their own local generation window", async () => {
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchNightlyMorningBriefs(client, AT_0359_LOCAL);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
  });

  it("generates at exactly the window open (04:00 local)", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "a\nb\nc" });
    const { client, updateCalls } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchNightlyMorningBriefs(client, AT_0400_LOCAL);
    expect(result.generated).toBe(1);
    expect(updateCalls[0]).toMatchObject({ brief_text: "a\nb\nc" });
  });

  it("still generates near the end of the window (08:59 local)", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "a\nb\nc" });
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchNightlyMorningBriefs(client, AT_0859_LOCAL);
    expect(result.generated).toBe(1);
  });

  it("does not generate once the window has closed (09:00 local)", async () => {
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchNightlyMorningBriefs(client, AT_0900_LOCAL);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
  });

  it("a user in a different timezone at the SAME UTC instant gets a different answer", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "a\nb\nc" });
    const { client } = makeClient({
      profiles: [
        { user_id: "chicago-user", timezone: "America/Chicago" },
        { user_id: "tokyo-user", timezone: "Asia/Tokyo" },
      ],
    });
    const result = await dispatchNightlyMorningBriefs(client, AT_0400_LOCAL);
    expect(result.generated).toBe(1);
    expect(gatewayChatMock).toHaveBeenCalledTimes(1);
    expect(gatewayChatMock).toHaveBeenCalledWith(client, "chicago-user", "morning_brief", expect.any(Array), expect.anything());
  });

  it("claim-first: skips a user who already holds today's claim, never calls gatewayChat", async () => {
    const { client, insertCalls } = makeClient({
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      claimedUsers: new Set(["user-1"]),
    });
    const result = await dispatchNightlyMorningBriefs(client, AT_0400_LOCAL);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(1); // the claim attempt still happens -- that IS the check
  });

  it("TWO OVERLAPPING invocations for the same user: only one ever generates", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "a\nb\nc" });
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const [first, second] = await Promise.all([dispatchNightlyMorningBriefs(client, AT_0400_LOCAL), dispatchNightlyMorningBriefs(client, AT_0400_LOCAL)]);
    expect(first.generated + second.generated).toBe(1);
    expect(gatewayChatMock).toHaveBeenCalledTimes(1);
  });

  it("THE REGRESSION GUARD: releases the claim (deletes the row) on a gatewayChat failure, so a later tick can retry", async () => {
    gatewayChatMock.mockResolvedValue({ ok: false, message: "AI features aren't enabled for this account." });
    const { client, insertCalls, deleteCalls, updateCalls } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchNightlyMorningBriefs(client, AT_0400_LOCAL);
    expect(result.generated).toBe(0);
    expect(insertCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toMatchObject({ user_id: "user-1" });
    expect(updateCalls).toHaveLength(0);
  });

  it("does NOT delete/release the claim after a successful generation -- it stays claimed for the rest of the day", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "a\nb\nc" });
    const { client, deleteCalls } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchNightlyMorningBriefs(client, AT_0400_LOCAL);
    expect(result.generated).toBe(1);
    expect(deleteCalls).toHaveLength(0);
  });

  it("a profile with no timezone defaults to UTC rather than throwing", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "a\nb\nc" });
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: null }] });
    // 06:00Z is inside [04:00,09:00) UTC (the fallback timezone).
    await expect(dispatchNightlyMorningBriefs(client, new Date("2026-09-15T06:00:00.000Z"))).resolves.toEqual({ usersChecked: 1, generated: 1 });
  });

  it("processes each distinct user independently", async () => {
    gatewayChatMock.mockImplementation(async (..._args: unknown[]) => {
      const userId = _args[1] as string;
      return userId === "user-1" ? { ok: false, message: "no key" } : { ok: true, content: "a\nb\nc" };
    });
    const { client } = makeClient({
      profiles: [
        { user_id: "user-1", timezone: "America/Chicago" },
        { user_id: "user-2", timezone: "America/Chicago" },
      ],
    });
    const result = await dispatchNightlyMorningBriefs(client, AT_0400_LOCAL);
    expect(result).toEqual({ usersChecked: 2, generated: 1 });
  });
});

describe("getMorningBriefForToday()", () => {
  function makeClient(resolvedValue: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => chain);
    chain.returns = vi.fn(() => Promise.resolve(resolvedValue));
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  }

  it("returns the stored brief text for today", async () => {
    const client = makeClient({ data: { brief_text: "a\nb\nc" }, error: null });
    const result = await getMorningBriefForToday(client, "user-1", new Date("2026-09-15T13:00:00.000Z"), "America/Chicago");
    expect(result).toBe("a\nb\nc");
  });

  it("returns null when no row exists for today (not yet generated, no key, cap hit, or failure -- indistinguishable by design)", async () => {
    const client = makeClient({ data: null, error: null });
    const result = await getMorningBriefForToday(client, "user-1", new Date("2026-09-15T13:00:00.000Z"), "America/Chicago");
    expect(result).toBeNull();
  });

  it("a read error also returns null, never throws -- this is a display-only, best-effort read", async () => {
    const client = makeClient({ data: null, error: { message: "connection reset" } });
    const result = await getMorningBriefForToday(client, "user-1", new Date("2026-09-15T13:00:00.000Z"), "America/Chicago");
    expect(result).toBeNull();
  });
});
