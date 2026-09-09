import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions } from "../write-registry";

function textOf(outcome: Awaited<ReturnType<NonNullable<ReturnType<typeof getWriteAction>>["handler"]>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

const now = new Date("2026-09-08T20:00:00.000Z");

describe("write-registry — settings dispatch shape", () => {
  it("has exactly profile/user_setting -- api_key is READ-ONLY, permanently, never writable", () => {
    expect(listWriteEntities("settings").sort()).toEqual(["profile", "user_setting"]);
    expect(listWriteActions("settings", "api_key")).toEqual([]);
  });

  it("profile has exactly 'update' — no separate action per field", () => {
    expect(listWriteActions("settings", "profile")).toEqual(["update"]);
  });

  it("user_setting has exactly set_weekday_baselines/clear_weekday_baselines -- daily_new_limit/notification_*/desired_retention/ai_grading_enabled/session_target_minutes are NOT writable (no app write path exists for them at all, see actions-core.ts's own header)", () => {
    expect(listWriteActions("settings", "user_setting").sort()).toEqual(["clear_weekday_baselines", "set_weekday_baselines"]);
  });
});

describe("settings.profile.update — dispatch", () => {
  function makeClient() {
    const upsertCalls: Record<string, unknown>[] = [];
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.upsert = vi.fn((row: Record<string, unknown>) => {
        upsertCalls.push(row);
        return Promise.resolve({ error: null });
      });
      return chain;
    });
    return { client: { from } as unknown as SupabaseClient, upsertCalls };
  }

  it("updates theme_preset and returns id/updated_at like every other write action", async () => {
    const action = getWriteAction("settings", "profile", "update")!;
    const { client, upsertCalls } = makeClient();
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { theme_preset: "sunset" });

    expect(textOf(outcome)).toEqual({ theme_preset: "sunset" });
    expect(upsertCalls[0]).toEqual({ user_id: "user-1", theme_preset: "sunset" });
    const structured = outcome.result.structuredContent as Record<string, unknown>;
    expect(structured.id).toBe("user-1");
    expect(structured.updated_at).toBe(now.toISOString());
    expect(outcome.summary).toMatch(/theme: sunset/);
  });

  it("refuses hiding 'home' BEFORE ever touching Supabase, with the deliberate-not-a-bug message", async () => {
    const action = getWriteAction("settings", "profile", "update")!;
    const { client, upsertCalls } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { hidden_features: ["home"] })).rejects.toThrow(/self-inflicted lockout/i);
    expect(upsertCalls).toHaveLength(0);
  });
});

describe("settings.user_setting.set_weekday_baselines / clear_weekday_baselines — dispatch", () => {
  function makeClient() {
    const updateCalls: Record<string, unknown>[] = [];
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.update = vi.fn((row: Record<string, unknown>) => {
        updateCalls.push(row);
        const c2: Record<string, unknown> = {};
        c2.eq = vi.fn(() => Promise.resolve({ error: null }));
        return c2;
      });
      return chain;
    });
    return { client: { from } as unknown as SupabaseClient, updateCalls };
  }

  it("set_weekday_baselines writes the array and reports it in the summary", async () => {
    const action = getWriteAction("settings", "user_setting", "set_weekday_baselines")!;
    const { client, updateCalls } = makeClient();
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { values: [2, 2, 2, 2, 2, 0, 0] });

    expect(updateCalls[0]).toEqual({ weekday_baselines: [2, 2, 2, 2, 2, 0, 0] });
    expect(outcome.summary).toContain("[2, 2, 2, 2, 2, 0, 0]");
  });

  it("clear_weekday_baselines writes NULL and takes no patch", async () => {
    const action = getWriteAction("settings", "user_setting", "clear_weekday_baselines")!;
    const { client, updateCalls } = makeClient();
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {});

    expect(updateCalls[0]).toEqual({ weekday_baselines: null });
    expect(textOf(outcome)).toEqual({ cleared: true });
  });
});
