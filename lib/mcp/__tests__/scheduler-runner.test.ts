import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { WriteArgs } from "../tools/write";

/**
 * MOCKS DEPENDENCIES, NOT `runMcpTool` ITSELF, for two different reasons:
 *
 * `getLiveTokenById`/`isUserActive`/`writeAuditRow` are mocked because the
 * DENIAL paths (revoked token, inactive user) are this file's most
 * important coverage — the lead's own explicit test ask ("schedule,
 * revoke, fire, assert denied-and-audited") — and they run BEFORE
 * `runMcpTool` is ever reached, so there's nothing to gain by driving a
 * real token/user lookup through a fake DB chain for them.
 *
 * `runMcpTool` itself IS mocked (unlike lib/mcp/__tests__/tool-wrapper.test.ts,
 * which correctly tests the REAL one) because exercising it for real here
 * would mean also exercising whichever real write-registry handler a given
 * test's `args` names, against a fake user-scoped client with no actual
 * table support — testing THIS FILE's own bookkeeping (attempt_count,
 * next_run_at advancement, one-off cancellation, pause-after-N) doesn't
 * need that; it needs to know `runMcpTool` was called with the RIGHT
 * arguments (proving requirement #1's wiring) and to control its return
 * value directly. `runMcpTool`'s own internal correctness is
 * tool-wrapper.test.ts's job, already covered there.
 */
const getLiveTokenByIdMock = vi.fn<(supabase: unknown, tokenId: string) => Promise<{ userId: string; scopes: ("read" | "write")[] } | null>>();
vi.mock("../tokens", () => ({
  getLiveTokenById: (supabase: unknown, tokenId: string) => getLiveTokenByIdMock(supabase, tokenId),
}));

const isUserActiveMock = vi.fn<(supabase: unknown, userId: string) => Promise<boolean>>();
vi.mock("../active-user", () => ({
  isUserActive: (supabase: unknown, userId: string) => isUserActiveMock(supabase, userId),
}));

const writeAuditRowMock = vi.fn<(supabase: unknown, entry: Record<string, unknown>) => Promise<void>>(async () => {});
vi.mock("../audit", () => ({
  writeAuditRow: (supabase: unknown, entry: Record<string, unknown>) => writeAuditRowMock(supabase, entry),
}));

const runMcpToolMock = vi.fn<(...args: unknown[]) => Promise<CallToolResult>>();
vi.mock("../tool-wrapper", () => ({
  runMcpTool: (...args: unknown[]) => runMcpToolMock(...args),
}));

const { claimDueActions, processOneScheduledAction, processScheduledActions, MAX_CONSECUTIVE_FAILURES } = await import("../scheduler-runner");

beforeEach(() => {
  getLiveTokenByIdMock.mockReset();
  isUserActiveMock.mockReset();
  writeAuditRowMock.mockClear();
  runMcpToolMock.mockReset();
});

function okResult(): CallToolResult {
  return { content: [{ type: "text", text: "{}" }] };
}
function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const now = new Date("2026-09-08T20:00:00.000Z"); // 15:00 CDT

function makeRow(overrides: Partial<{ id: string; user_id: string; token_id: string; args: WriteArgs; cron_expression: string | null; run_at: string | null; attempt_count: number }> = {}) {
  return {
    id: "sched-1",
    user_id: "user-1",
    token_id: "tok-1",
    args: { domain: "settings", entity: "profile", action: "update", patch: { theme_preset: "ocean" } },
    cron_expression: null,
    run_at: "2026-09-08T20:00:00.000Z",
    attempt_count: 0,
    ...overrides,
  };
}

/** Fake service client covering exactly `mcp_scheduled_actions`/`profiles` queries this file makes — records every update so a test can assert the final row state. */
function makeServiceClient(opts: { claimData?: unknown[]; profileTimezone?: string } = {}) {
  const updateCalls: { table: string; row: Record<string, unknown> }[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.lte = vi.fn(() => chain);
    chain.update = vi.fn((row: Record<string, unknown>) => {
      updateCalls.push({ table, row });
      const resolved = { data: opts.claimData ?? [], error: null };
      const c2: Record<string, unknown> = {};
      c2.eq = vi.fn(() => c2);
      c2.lte = vi.fn(() => c2);
      c2.select = vi.fn(() => Promise.resolve(resolved));
      c2.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
      return c2;
    });
    chain.maybeSingle = vi.fn(async () => ({ data: { timezone: opts.profileTimezone ?? "America/Chicago" }, error: null }));
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: [], error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, updateCalls };
}

describe("claimDueActions", () => {
  it("bumps next_run_at forward as the claim, atomically, and returns the claimed rows", async () => {
    const rows = [makeRow()];
    const { client, updateCalls } = makeServiceClient({ claimData: rows });
    const result = await claimDueActions(client, now);
    expect(result).toEqual(rows);
    expect(updateCalls[0].table).toBe("mcp_scheduled_actions");
    const bumped = new Date(updateCalls[0].row.next_run_at as string);
    expect(bumped.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("processOneScheduledAction — denial paths (the lead's own explicit test ask: schedule, revoke, fire, assert denied-and-audited)", () => {
  it("a REVOKED token is denied, audited with outcome:'denied', and the row is paused IMMEDIATELY (not held for MAX_CONSECUTIVE_FAILURES retries)", async () => {
    getLiveTokenByIdMock.mockResolvedValue(null); // revoked or gone
    const { client, updateCalls } = makeServiceClient();
    const row = makeRow({ attempt_count: 0 });

    const outcome = await processOneScheduledAction(client, row, now);

    expect(outcome).toBe("denied");
    expect(runMcpToolMock).not.toHaveBeenCalled(); // never reached -- no live auth to hand it
    expect(writeAuditRowMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ userId: "user-1", tokenId: "tok-1", toolName: "write", outcome: "denied", operation: "settings.profile.update" }),
    );
    const finalUpdate = updateCalls.find((c) => c.row.status !== undefined);
    expect(finalUpdate?.row).toMatchObject({ status: "paused", last_outcome: "denied" });
  });

  it("an INACTIVE (banned/deleted) user is denied and audited the same way, even with a live, non-revoked token", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(false);
    const { client, updateCalls } = makeServiceClient();
    const row = makeRow();

    const outcome = await processOneScheduledAction(client, row, now);

    expect(outcome).toBe("denied");
    expect(runMcpToolMock).not.toHaveBeenCalled();
    expect(writeAuditRowMock).toHaveBeenCalledWith(client, expect.objectContaining({ outcome: "denied" }));
    expect(updateCalls.find((c) => c.row.status !== undefined)?.row).toMatchObject({ status: "paused" });
  });
});

describe("processOneScheduledAction — dispatch through the REAL runMcpTool/writeTool path (requirement #1)", () => {
  it("passes the token's FRESHLY-LOOKED-UP scopes as AuthInfo, never anything cached from schedule time", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(okResult());
    const { client } = makeServiceClient();
    const row = makeRow();

    await processOneScheduledAction(client, row, now);

    expect(runMcpToolMock).toHaveBeenCalledWith(
      client,
      { scopes: ["write"], extra: { userId: "user-1", tokenId: "tok-1" } },
      "write",
      "settings.profile.update",
      "write",
      row.args,
      expect.any(Function),
    );
  });

  it("a one-off (run_at set) is CANCELLED on success — a completed one-off will never fire again", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(okResult());
    const { client, updateCalls } = makeServiceClient();

    const outcome = await processOneScheduledAction(client, makeRow({ run_at: "2026-09-08T20:00:00.000Z", cron_expression: null }), now);

    expect(outcome).toBe("ok");
    const final = updateCalls.find((c) => c.row.status !== undefined)!.row;
    expect(final).toMatchObject({ status: "cancelled", last_outcome: "ok", attempt_count: 0 });
  });

  it("a FAILED one-off ('remind me at 4pm' style — the primary use case for run_at, not a secondary one beside cron) is NOT cancelled -- it stays active and retries, same bounded policy a recurring action gets, until MAX_CONSECUTIVE_FAILURES", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(errorResult("transient failure"));
    const { client, updateCalls } = makeServiceClient();

    const outcome = await processOneScheduledAction(client, makeRow({ run_at: "2026-09-08T20:00:00.000Z", cron_expression: null, attempt_count: 0 }), now);

    expect(outcome).toBe("error");
    const final = updateCalls.find((c) => c.row.status !== undefined)!.row;
    // NOT "cancelled" -- a one-off is only ever cancelled on a real success
    // (or an explicit user cancel/pause). A transient failure must still
    // get its retry budget, the same as any recurring action would.
    expect(final).toMatchObject({ status: "active", last_outcome: "error", attempt_count: 1 });
    expect(new Date(final.next_run_at as string).getTime()).toBeGreaterThan(now.getTime());
  });

  it("a recurring action (cron_expression set) advances next_run_at and stays active on success, resetting attempt_count to 0", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(okResult());
    const { client, updateCalls } = makeServiceClient({ profileTimezone: "America/Chicago" });

    await processOneScheduledAction(client, makeRow({ run_at: null, cron_expression: "0 7 * * *", attempt_count: 3 }), now);

    const final = updateCalls.find((c) => c.row.status !== undefined)!.row;
    expect(final.status).toBe("active");
    expect(final.attempt_count).toBe(0); // a success resets the failure streak
    expect(final.next_run_at).toBe("2026-09-09T12:00:00.000Z"); // 07:00 CDT next day, since 15:00 CDT is already past it today
  });

  it("a FAILURE (isError) below MAX_CONSECUTIVE_FAILURES stays active and retries soon, incrementing attempt_count", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(errorResult("db exploded"));
    const { client, updateCalls } = makeServiceClient();

    const outcome = await processOneScheduledAction(client, makeRow({ attempt_count: 1 }), now);

    expect(outcome).toBe("error");
    const final = updateCalls.find((c) => c.row.status !== undefined)!.row;
    expect(final).toMatchObject({ status: "active", last_outcome: "error", attempt_count: 2 });
    expect(new Date(final.next_run_at as string).getTime()).toBeGreaterThan(now.getTime());
  });

  it("a CONSECUTIVE failure streak reaching MAX_CONSECUTIVE_FAILURES PAUSES the row — no infinite retry against a write surface", async () => {
    getLiveTokenByIdMock.mockResolvedValue({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(errorResult("still exploding"));
    const { client, updateCalls } = makeServiceClient();

    const outcome = await processOneScheduledAction(client, makeRow({ attempt_count: MAX_CONSECUTIVE_FAILURES - 1 }), now);

    expect(outcome).toBe("error");
    const final = updateCalls.find((c) => c.row.status !== undefined)!.row;
    expect(final).toMatchObject({ status: "paused", attempt_count: MAX_CONSECUTIVE_FAILURES });
  });
});

describe("processScheduledActions — batch resilience", () => {
  it("one row throwing an unexpected exception does not stop the rest of the batch", async () => {
    getLiveTokenByIdMock
      .mockRejectedValueOnce(new Error("transient DB blip"))
      .mockResolvedValueOnce({ userId: "user-1", scopes: ["write"] });
    isUserActiveMock.mockResolvedValue(true);
    runMcpToolMock.mockResolvedValue(okResult());
    const rows = [makeRow({ id: "sched-1" }), makeRow({ id: "sched-2" })];
    const { client } = makeServiceClient({ claimData: rows });

    const result = await processScheduledActions(client, now);

    expect(result.processed).toBe(2);
    expect(result.ok).toBe(1);
    expect(result.error).toBe(1);
  });
});
