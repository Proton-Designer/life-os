import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

let deenMode = true;
let rows: { domain: string; headline: string; milestones: string[]; quran_page_target: number | null }[] = [];
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: async () => ({ id: "u1" }),
  getProfile: async () => ({ timezone: "America/Chicago", deen_mode: deenMode }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
    chain.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: rows });
    return { from: () => chain };
  },
}));
vi.mock("@/lib/domains/get-user-domains", () => ({ getUserDomains: async () => ({ mode: "legacy", domains: [], subdomains: [] }) }));
vi.mock("@/app/(app)/actions", () => ({ saveWeeklyGoal: Object.assign(async () => {}, {}) }));
vi.mock("@/components/shared/weekly-goals-header", () => ({ WeeklyGoalsHeader: () => null }));

import { WeeklyGoalStep } from "../weekly-goal-step";

async function props() {
  const el = (await WeeklyGoalStep()) as ReactElement<Record<string, unknown>>;
  return el.props;
}

describe("WeeklyGoalStep (/week step 5)", () => {
  beforeEach(() => {
    deenMode = true;
    rows = [];
  });

  it("hands the stored Quran target to the editor so a save here can't null it", async () => {
    rows = [{ domain: "deen", headline: "Finish Juz 3", milestones: ["a"], quran_page_target: 20 }];
    const p = await props();
    expect(p.deen).toMatchObject({ headline: "Finish Juz 3", quranTarget: 20 });
    expect(p.showDeen).toBe(true);
  });

  it("Deen Mode OFF: the Deen slot is switched off (the editor renders nothing for it)", async () => {
    deenMode = false;
    rows = [{ domain: "deen", headline: "secret", milestones: [], quran_page_target: 5 }];
    const p = await props();
    expect(p.showDeen).toBe(false);
    expect(p.showBusiness).toBe(true);
  });

  it("no goal row yet = an empty slot (null), not a crash", async () => {
    const p = await props();
    expect(p.deen).toBeNull();
    expect(p.business).toBeNull();
  });
});
