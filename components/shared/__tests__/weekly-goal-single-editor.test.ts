import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// IA-P1b: ONE weekly-goal editor. GoalCard (the form) may be rendered only by WeeklyGoalSlot, and the
// Home header + the Business widget must both render the slot. A second editor would be a second save path.
const root = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (e === "__tests__" || e === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, "components")), ...walk(path.join(root, "app"))];
const importing = (needle: string) => files.filter((f) => readFileSync(f, "utf8").includes(needle)).map((f) => path.relative(root, f));

describe("one weekly-goal editor", () => {
  it("only WeeklyGoalSlot imports GoalCard", () => {
    expect(importing("@/components/shared/goal-card")).toEqual(["components/shared/weekly-goal-slot.tsx"]);
  });
  it("Home/calendar header and the Business widget both render the slot, and none calls saveBusinessWeeklyGoal from UI", () => {
    const users = importing("weekly-goal-slot");
    expect(users).toEqual(expect.arrayContaining(["components/shared/weekly-goals-header.tsx", "components/business/business-page-content.tsx"]));
    expect(importing("saveBusinessWeeklyGoal")).toEqual([]);
  });
  it("positive control: the scan can see a real import (the slot itself imports GoalCard)", () => {
    expect(importing("GoalCard").length).toBeGreaterThan(0);
  });
});
