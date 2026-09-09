import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const fetchTimezoneMock = vi.fn(async (..._args: unknown[]) => "America/Chicago");
vi.mock("@/lib/deen/actions-core", () => ({ fetchTimezone: (...args: unknown[]) => fetchTimezoneMock(...args) }));

const listMock = vi.fn(async (..._args: unknown[]) => [{ id: "s1", domain: "settings", entity: "profile", action: "update", status: "active" }]);
const createMock = vi.fn(async (..._args: unknown[]) => ({ id: "s-new", next_run_at: "2026-09-09T12:00:00.000Z" }));
const cancelMock = vi.fn(async (..._args: unknown[]) => {});
const pauseMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/scheduling/scheduler-core", () => ({
  listScheduledActionsCore: (...args: unknown[]) => listMock(...args),
  createScheduledActionCore: (...args: unknown[]) => createMock(...args),
  cancelScheduledActionCore: (...args: unknown[]) => cancelMock(...args),
  pauseScheduledActionCore: (...args: unknown[]) => pauseMock(...args),
}));

const { schedulerManageTool, resolveSchedulerManageOperation, resolveSchedulerManageScope } = await import("../scheduler-manage");

const client = {} as SupabaseClient;

function textOf(outcome: Awaited<ReturnType<typeof schedulerManageTool>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

describe("resolveSchedulerManageScope", () => {
  it("list needs only read; create/cancel/pause need write", () => {
    expect(resolveSchedulerManageScope("list")).toBe("read");
    expect(resolveSchedulerManageScope("create")).toBe("write");
    expect(resolveSchedulerManageScope("cancel")).toBe("write");
    expect(resolveSchedulerManageScope("pause")).toBe("write");
  });
});

describe("resolveSchedulerManageOperation", () => {
  it("is scheduler_manage.<action>", () => {
    expect(resolveSchedulerManageOperation({ action: "create" })).toBe("scheduler_manage.create");
  });
});

describe("schedulerManageTool — dispatch", () => {
  it("list calls listScheduledActionsCore and returns items", async () => {
    const outcome = await schedulerManageTool(client, "user-1", "tok-1", { action: "list" });
    expect(listMock).toHaveBeenCalledWith(client, "user-1");
    expect(textOf(outcome).items).toHaveLength(1);
  });

  it("create fetches timezone and passes tokenId through to createScheduledActionCore", async () => {
    const patch = { domain: "settings", entity: "profile", action: "update", run_at: "2026-09-09T12:00:00.000Z" };
    const outcome = await schedulerManageTool(client, "user-1", "tok-1", { action: "create", patch });
    expect(fetchTimezoneMock).toHaveBeenCalledWith(client, "user-1");
    expect(createMock).toHaveBeenCalledWith(client, "user-1", "tok-1", "America/Chicago", expect.any(Date), patch);
    expect(textOf(outcome)).toEqual({ id: "s-new", next_run_at: "2026-09-09T12:00:00.000Z" });
  });

  it("create with no tokenId (shouldn't happen live, but must not silently substitute one) still passes null through", async () => {
    await schedulerManageTool(client, "user-1", null, { action: "create", patch: {} });
    expect(createMock).toHaveBeenCalledWith(client, "user-1", null, "America/Chicago", expect.any(Date), {});
  });

  it("cancel requires the top-level id", async () => {
    await expect(schedulerManageTool(client, "user-1", "tok-1", { action: "cancel" })).rejects.toThrow(/requires the top-level `id`/);
  });

  it("cancel calls cancelScheduledActionCore with the given id", async () => {
    const outcome = await schedulerManageTool(client, "user-1", "tok-1", { action: "cancel", id: "s1" });
    expect(cancelMock).toHaveBeenCalledWith(client, "user-1", "s1");
    expect(textOf(outcome)).toEqual({ id: "s1" });
  });

  it("pause requires the top-level id and calls pauseScheduledActionCore", async () => {
    await expect(schedulerManageTool(client, "user-1", "tok-1", { action: "pause" })).rejects.toThrow(/requires the top-level `id`/);
    await schedulerManageTool(client, "user-1", "tok-1", { action: "pause", id: "s1" });
    expect(pauseMock).toHaveBeenCalledWith(client, "user-1", "s1");
  });
});
