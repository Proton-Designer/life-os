import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const getSettings = vi.fn();
vi.mock("@/lib/rhythm/wind-down-core", () => ({ getWindDownSettingsCore: (...a: unknown[]) => getSettings(...a) }));

import { loadHomeWindDown } from "../wind-down-home";

const client = {} as SupabaseClient;

describe("loadHomeWindDown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Sleep plan OFF: null, and nothing is read", async () => {
    expect(await loadHomeWindDown(client, "u1", false)).toBeNull();
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("ON with a plan: the evening wind-down start + bedtime", async () => {
    getSettings.mockResolvedValue({ wakeTime: "06:30", sleepNeedMinutes: 480, windDownMinutes: 45, plan: { bedtime: "22:30", windDownStart: "21:45", windDownMinutes: 45 } });
    const w = await loadHomeWindDown(client, "u1", true);
    expect(w).toMatchObject({ windDownStart: "21:45", bedtime: "22:30" });
  });

  it("ON without a plan: no start (callers use 21:00) and no bedtime; a non-evening start is ignored", async () => {
    getSettings.mockResolvedValue({ wakeTime: null, sleepNeedMinutes: null, windDownMinutes: null, plan: null });
    expect(await loadHomeWindDown(client, "u1", true)).toMatchObject({ windDownStart: undefined, bedtime: null });
    getSettings.mockResolvedValue({ wakeTime: "12:00", sleepNeedMinutes: 480, windDownMinutes: 45, plan: { bedtime: "04:00", windDownStart: "03:15", windDownMinutes: 45 } });
    expect((await loadHomeWindDown(client, "u1", true))!.windDownStart).toBeUndefined();
  });
});
