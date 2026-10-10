import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const goals = [
  { id: "g1", domain: "deen", rank: 1, status: "active", title: "Memorise Mulk" },
  { id: "g2", domain: "business", rank: 2, status: "active", title: "Ship v1" },
];
const milestones = [
  { id: "m1", goalId: "g1", title: "Verse 1-10" },
  { id: "m2", goalId: "g2", title: "Landing page" },
];
vi.mock("@/lib/goals/actions-core", () => ({ listGoalsForMonth: async () => goals }));
vi.mock("@/lib/goals/queries", () => ({
  getMilestonesForMonth: async () => milestones,
  monthStartFor: (d: string) => `${d.slice(0, 7)}-01`,
}));

import { loadGoalBoardData } from "../board-data";

const client = {} as SupabaseClient;
const NOW = new Date("2026-10-05T17:00:00Z");

describe("loadGoalBoardData (shared by /week step 2 and Home's Goals sheet)", () => {
  it("Faith Mode OFF hides deen goals AND their milestones, but keeps the rank reserved", async () => {
    const d = await loadGoalBoardData(client, "u1", { timezone: "America/Chicago", deen_mode: false }, NOW);
    expect(d.goals.map((g) => g.id)).toEqual(["g2"]);
    expect(d.milestones.map((m) => m.id)).toEqual(["m2"]);
    expect(d.reservedRanks).toEqual([1]);
    expect(d.deenMode).toBe(false);
  });

  it("positive control: Faith Mode ON shows everything and reserves nothing", async () => {
    const d = await loadGoalBoardData(client, "u1", { timezone: "America/Chicago", deen_mode: true }, NOW);
    expect(d.goals).toHaveLength(2);
    expect(d.milestones).toHaveLength(2);
    expect(d.reservedRanks).toEqual([]);
  });

  it("a missing profile fails closed (Faith OFF) and uses the user's local month", async () => {
    const d = await loadGoalBoardData(client, "u1", null, NOW);
    expect(d.deenMode).toBe(false);
    expect(d.monthStart).toBe("2026-10-01");
    expect(d.todayStr).toBe("2026-10-05");
  });
});
