import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// HABITS-01: a Home render needs ~25 mocks, so the Deen gate is pinned in the source (the week step has a real render test).
const page = readFileSync(join(__dirname, "../page.tsx"), "utf8");

describe("Home Faith practices wiring", () => {
  it("reads the practices only when Deen mode is on (skipped, not fetched-then-hidden)", () => {
    expect(page).toMatch(/deenMode \? getFaithPractices\(supabase, userId, dateStr\)/);
    expect(page).toContain("faithPractices={faithPractices}");
  });
  it("control: the pin fails on an ungated read", () => {
    const ungated = page.replace("deenMode ? getFaithPractices", "true ? getFaithPractices");
    expect(ungated).not.toMatch(/deenMode \? getFaithPractices\(supabase, userId, dateStr\)/);
  });
});
