import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const hasAnyPushSubscriptionMock = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/lib/notifications/send-push", () => ({
  hasAnyPushSubscription: (...args: unknown[]) => hasAnyPushSubscriptionMock(...args),
}));

const { listScheduledActionsCore, createScheduledActionCore, cancelScheduledActionCore, pauseScheduledActionCore } = await import("../scheduler-core");

function makeClient(opts: { listData?: unknown[]; insertData?: unknown; insertError?: unknown; updateData?: unknown } = {}) {
  const insertCalls: Record<string, unknown>[] = [];
  const updateCalls: { row: Record<string, unknown>; eq: unknown[][] }[] = [];

  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((...args: unknown[]) => {
      if (updateCalls.length > 0) updateCalls[updateCalls.length - 1].eq.push(args);
      return chain;
    });
    chain.order = vi.fn(() => Promise.resolve({ data: opts.listData ?? [], error: null }));
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      insertCalls.push(row);
      return chain;
    });
    chain.update = vi.fn((row: Record<string, unknown>) => {
      updateCalls.push({ row, eq: [] });
      return chain;
    });
    chain.single = vi.fn(async () => ({ data: opts.insertData ?? { id: "sched-1", next_run_at: "2026-09-10T12:00:00.000Z" }, error: opts.insertError ?? null }));
    chain.maybeSingle = vi.fn(async () => ({ data: opts.updateData !== undefined ? opts.updateData : { id: "sched-1" }, error: null }));
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, insertCalls, updateCalls };
}

const now = new Date("2026-09-08T20:00:00.000Z"); // 15:00 CDT

describe("listScheduledActionsCore", () => {
  it("derives domain/entity/action from the stored args, and passes through the schedule/outcome columns", async () => {
    const { client } = makeClient({
      listData: [
        {
          id: "s1",
          tool_name: "write",
          args: { domain: "checkins", entity: "allocation", action: "save", patch: { allocations: { deen: 30 } } },
          cron_expression: "0 20 * * *",
          run_at: null,
          next_run_at: "2026-09-09T01:00:00.000Z",
          last_run_at: null,
          last_outcome: null,
          last_error: null,
          attempt_count: 0,
          status: "active",
          updated_at: "2026-09-08T20:00:00.000Z",
        },
      ],
    });
    const items = await listScheduledActionsCore(client, "user-1");
    expect(items).toEqual([
      {
        id: "s1",
        tool_name: "write",
        domain: "checkins",
        entity: "allocation",
        action: "save",
        write_id: null,
        write_patch: { allocations: { deen: 30 } },
        title: null,
        body: null,
        cron_expression: "0 20 * * *",
        run_at: null,
        next_run_at: "2026-09-09T01:00:00.000Z",
        last_run_at: null,
        last_outcome: null,
        last_error: null,
        attempt_count: 0,
        status: "active",
        updated_at: "2026-09-08T20:00:00.000Z",
      },
    ]);
  });

  it("surfaces write_id when the underlying write targets an existing row, so the caller can see WHICH row without a second lookup", async () => {
    const { client } = makeClient({
      listData: [
        {
          id: "s2",
          tool_name: "write",
          args: { domain: "work", entity: "target", action: "edit", id: "target-1", patch: { title: "New title" } },
          cron_expression: null,
          run_at: "2026-09-09T16:00:00.000Z",
          next_run_at: "2026-09-09T16:00:00.000Z",
          last_run_at: null,
          last_outcome: null,
          last_error: null,
          attempt_count: 0,
          status: "active",
          updated_at: "2026-09-08T20:00:00.000Z",
        },
      ],
    });
    const items = await listScheduledActionsCore(client, "user-1");
    expect(items[0]).toMatchObject({ write_id: "target-1", write_patch: { title: "New title" } });
  });

  it("a notify row surfaces title/body instead of domain/entity/action/write_patch", async () => {
    const { client } = makeClient({
      listData: [
        {
          id: "s3",
          tool_name: "notify",
          args: { title: "Kill list review", body: "4pm — go review it" },
          cron_expression: null,
          run_at: "2026-09-09T21:00:00.000Z",
          next_run_at: "2026-09-09T21:00:00.000Z",
          last_run_at: null,
          last_outcome: null,
          last_error: null,
          attempt_count: 0,
          status: "active",
          updated_at: "2026-09-08T20:00:00.000Z",
        },
      ],
    });
    const items = await listScheduledActionsCore(client, "user-1");
    expect(items[0]).toMatchObject({ tool_name: "notify", domain: "", entity: "", action: "", write_id: null, write_patch: null, title: "Kill list review", body: "4pm — go review it" });
  });
});

describe("createScheduledActionCore — patch.tool_name dispatch", () => {
  it("REFUSES a missing/unknown tool_name before validating anything else", async () => {
    const { client } = makeClient();
    await expect(createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { run_at: "2026-09-09T12:00:00.000Z" })).rejects.toThrow(/patch\.tool_name must be "write" or "notify"/i);
    await expect(createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "read", run_at: "2026-09-09T12:00:00.000Z" })).rejects.toThrow(
      /patch\.tool_name must be "write" or "notify"/i,
    );
  });
});

describe("createScheduledActionCore — write branch, the idempotency gate", () => {
  it("REFUSES an action not marked idempotent:true, before ever touching the DB", async () => {
    const { client, insertCalls } = makeClient();
    // distractions.trigger.capture is a REAL registered action, marked idempotent:false.
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
        tool_name: "write",
        domain: "distractions",
        entity: "trigger",
        action: "capture",
        run_at: "2026-09-09T12:00:00.000Z",
      }),
    ).rejects.toThrow(/isn't verified safe to schedule/i);
    expect(insertCalls).toHaveLength(0);
  });

  it("REFUSES an unknown domain/entity/action with a clear message naming what to check", async () => {
    const { client } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "write", domain: "nope", entity: "x", action: "y", run_at: "2026-09-09T12:00:00.000Z" }),
    ).rejects.toThrow(/unknown write action/i);
  });

  it("ACCEPTS a verified-idempotent action (settings.profile.update) with a one-off run_at", async () => {
    const { client, insertCalls } = makeClient({ insertData: { id: "sched-1", next_run_at: "2026-09-09T12:00:00.000Z" } });
    const result = await createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
      tool_name: "write",
      domain: "settings",
      entity: "profile",
      action: "update",
      write_patch: { theme_preset: "ocean" },
      run_at: "2026-09-09T12:00:00.000Z",
    });
    expect(result).toEqual({ id: "sched-1", next_run_at: "2026-09-09T12:00:00.000Z" });
    expect(insertCalls[0]).toMatchObject({
      user_id: "user-1",
      token_id: "tok-1",
      tool_name: "write",
      args: { domain: "settings", entity: "profile", action: "update", patch: { theme_preset: "ocean" } },
      cron_expression: null,
      run_at: "2026-09-09T12:00:00.000Z",
    });
  });

  it("ACCEPTS a recurring cron_expression, computing next_run_at from it (not from run_at, which is absent)", async () => {
    const { client, insertCalls } = makeClient();
    await createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
      tool_name: "write",
      domain: "settings",
      entity: "user_setting",
      action: "clear_weekday_baselines",
      cron_expression: "0 7 * * *",
    });
    expect(insertCalls[0]).toMatchObject({ cron_expression: "0 7 * * *", run_at: null });
    // 07:00 CDT the next day, since `now` (15:00 CDT) is already past 07:00 today.
    expect(insertCalls[0].next_run_at).toBe("2026-09-09T12:00:00.000Z");
  });

  it("rejects run_at in the past", async () => {
    const { client } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
        tool_name: "write",
        domain: "settings",
        entity: "profile",
        action: "update",
        run_at: "2020-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/must be in the future/i);
  });

  it("rejects giving both run_at and cron_expression", async () => {
    const { client } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
        tool_name: "write",
        domain: "settings",
        entity: "profile",
        action: "update",
        run_at: "2026-09-09T12:00:00.000Z",
        cron_expression: "0 7 * * *",
      }),
    ).rejects.toThrow(/exactly one of/i);
  });

  it("rejects giving neither", async () => {
    const { client } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "write", domain: "settings", entity: "profile", action: "update" }),
    ).rejects.toThrow(/exactly one of/i);
  });

  it("rejects a malformed cron_expression with a clear message, not the parser's own throw", async () => {
    const { client } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
        tool_name: "write",
        domain: "settings",
        entity: "profile",
        action: "update",
        cron_expression: "*/15 9-17 * * 1-5",
      }),
    ).rejects.toThrow(/must be "MM HH \* \* \*"/);
  });

  it("REFUSES to schedule with no token id -- cannot happen through a real MCP call (runMcpTool already verified auth), but must fail loudly rather than silently record a null owner", async () => {
    const { client } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", null, "America/Chicago", now, { tool_name: "write", domain: "settings", entity: "profile", action: "update", run_at: "2026-09-09T12:00:00.000Z" }),
    ).rejects.toThrow(/no token id available/i);
  });
});

describe("createScheduledActionCore — notify branch (the reminder case)", () => {
  it("REFUSES to schedule when the user has NO push subscription at all -- at SCHEDULE time, not fire time (the lead's requirement #4)", async () => {
    hasAnyPushSubscriptionMock.mockResolvedValueOnce(false);
    const { client, insertCalls } = makeClient();
    await expect(
      createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "notify", title: "Kill list", body: "Go review it", run_at: "2026-09-09T21:00:00.000Z" }),
    ).rejects.toThrow(/no push notifications are enabled/i);
    expect(insertCalls).toHaveLength(0);
  });

  it("ACCEPTS a notify with a one-off run_at when a subscription exists", async () => {
    hasAnyPushSubscriptionMock.mockResolvedValueOnce(true);
    const { client, insertCalls } = makeClient({ insertData: { id: "sched-2", next_run_at: "2026-09-09T21:00:00.000Z" } });
    const result = await createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, {
      tool_name: "notify",
      title: "Kill list",
      body: "Go review it",
      run_at: "2026-09-09T21:00:00.000Z",
    });
    expect(result).toEqual({ id: "sched-2", next_run_at: "2026-09-09T21:00:00.000Z" });
    expect(insertCalls[0]).toMatchObject({
      user_id: "user-1",
      token_id: "tok-1",
      tool_name: "notify",
      operation: "notify.send",
      args: { title: "Kill list", body: "Go review it" },
      run_at: "2026-09-09T21:00:00.000Z",
      cron_expression: null,
    });
  });

  it("ACCEPTS a recurring notify (cron_expression) the same as a write's schedule resolution", async () => {
    hasAnyPushSubscriptionMock.mockResolvedValueOnce(true);
    const { client, insertCalls } = makeClient();
    await createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "notify", title: "Morning check-in", body: "How's it going?", cron_expression: "0 7 * * *" });
    expect(insertCalls[0]).toMatchObject({ tool_name: "notify", cron_expression: "0 7 * * *", run_at: null, next_run_at: "2026-09-09T12:00:00.000Z" });
  });

  it("requires title and body as non-empty strings", async () => {
    hasAnyPushSubscriptionMock.mockResolvedValue(true);
    const { client } = makeClient();
    await expect(createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "notify", body: "x", run_at: "2026-09-09T21:00:00.000Z" })).rejects.toThrow(
      /patch\.title is required/i,
    );
    await expect(createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "notify", title: "x", run_at: "2026-09-09T21:00:00.000Z" })).rejects.toThrow(
      /patch\.body is required/i,
    );
  });

  it("still enforces exactly-one-of run_at/cron_expression for a notify", async () => {
    hasAnyPushSubscriptionMock.mockResolvedValue(true);
    const { client } = makeClient();
    await expect(createScheduledActionCore(client, "user-1", "tok-1", "America/Chicago", now, { tool_name: "notify", title: "x", body: "y" })).rejects.toThrow(/exactly one of/i);
  });
});

describe("cancelScheduledActionCore / pauseScheduledActionCore", () => {
  it("cancel sets status to 'cancelled', never a hard delete", async () => {
    const { client, updateCalls } = makeClient();
    await cancelScheduledActionCore(client, "user-1", "sched-1");
    expect(updateCalls[0].row).toEqual({ status: "cancelled" });
  });

  it("pause sets status to 'paused'", async () => {
    const { client, updateCalls } = makeClient();
    await pauseScheduledActionCore(client, "user-1", "sched-1");
    expect(updateCalls[0].row).toEqual({ status: "paused" });
  });

  it("cancel on a not-found/not-yours id throws a clear 'not found' error", async () => {
    const { client } = makeClient({ updateData: null });
    await expect(cancelScheduledActionCore(client, "user-1", "not-mine")).rejects.toThrow(/no scheduled action found/i);
  });
});
