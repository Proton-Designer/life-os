import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; args: unknown[] };
function makeChain(resolvedValue: { data: unknown; error: unknown }, calls: Call[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock() }));

let calls: Call[] = [];
let findResult: { data: unknown; error: unknown } = { data: { id: "worry-1" }, error: null };
let updateResult: { data: unknown; error: unknown } = { data: null, error: null };
let chainIndex = 0;

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  chainIndex = 0;
  findResult = { data: { id: "worry-1" }, error: null };
  updateResult = { data: null, error: null };
  const fromMock = vi.fn(() => {
    chainIndex += 1;
    // findWorry's own .maybeSingle() call is the first from(); the update
    // that follows is the second.
    return makeChain(chainIndex === 1 ? findResult : updateResult, calls);
  });
  requireUserMock.mockResolvedValue({ supabase: { from: fromMock }, userId: "user-1" });
});

describe("worry actions — item #42's Handled state", () => {
  it("markWorryHandled sets completed=true and completed_at, scoped to dump_source=worry", async () => {
    const { markWorryHandled } = await import("../actions");
    const res = await markWorryHandled("worry-1");
    expect(res).toEqual({ ok: true });

    const updateCall = calls.find((c) => c.method === "update");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.args[0] as { completed: boolean; completed_at: string };
    expect(payload.completed).toBe(true);
    expect(typeof payload.completed_at).toBe("string");

    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["dump_source", "worry"]);
  });

  it("reopenWorry sets completed=false, clears completed_at, and clears any recorded worry_outcome", async () => {
    const { reopenWorry } = await import("../actions");
    const res = await reopenWorry("worry-1");
    expect(res).toEqual({ ok: true });
    const updateCall = calls.find((c) => c.method === "update");
    expect(updateCall!.args[0]).toEqual({ completed: false, completed_at: null, worry_outcome: null });
  });

  it("recordWorryOutcome (P2-12) sets completed=true, completed_at, and the given outcome", async () => {
    const { recordWorryOutcome } = await import("../actions");
    const res = await recordWorryOutcome("worry-1", "took_action");
    expect(res).toEqual({ ok: true });

    const updateCall = calls.find((c) => c.method === "update");
    const payload = updateCall!.args[0] as { completed: boolean; completed_at: string; worry_outcome: string };
    expect(payload.completed).toBe(true);
    expect(typeof payload.completed_at).toBe("string");
    expect(payload.worry_outcome).toBe("took_action");

    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["dump_source", "worry"]);
  });

  it("recordWorryOutcome rejects an unknown outcome before ever querying the row", async () => {
    const { recordWorryOutcome } = await import("../actions");
    // @ts-expect-error deliberately invalid, proving the guard runs at the boundary
    const res = await recordWorryOutcome("worry-1", "shrug");
    expect(res).toEqual({ error: "Unknown outcome." });
    expect(calls.length).toBe(0);
  });

  it("refuses to record an outcome for an id that isn't a worry row belonging to this user — no update is attempted", async () => {
    findResult = { data: null, error: null };
    const { recordWorryOutcome } = await import("../actions");
    const res = await recordWorryOutcome("someone-elses-task", "resolved");
    expect(res).toEqual({ error: "That worry could not be found." });
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("refuses to handle an id that isn't a worry row belonging to this user — no update is attempted", async () => {
    findResult = { data: null, error: null };
    const { markWorryHandled } = await import("../actions");
    const res = await markWorryHandled("someone-elses-task");
    expect(res).toEqual({ error: "That worry could not be found." });
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("revalidates /worries, /close, /open and / on a successful handle", async () => {
    const { markWorryHandled } = await import("../actions");
    await markWorryHandled("worry-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/worries");
    expect(revalidatePathMock).toHaveBeenCalledWith("/close");
    expect(revalidatePathMock).toHaveBeenCalledWith("/open");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });
});
