import { describe, expect, it } from "vitest";
import { dropSeedsAlreadyPlanned } from "../night-plan";

const seed = (id: string, title: string, source: "worry" | "school_risk" | "goal_milestone") => ({ id, title, source });

describe("dropSeedsAlreadyPlanned", () => {
  it("drops a school seed already claimed into a line (different id, same title), so it is not offered twice", () => {
    const seeds = [seed("assess-1", "ECS-2390 · WK 8: Quiz · due Wed", "school_risk")];
    expect(dropSeedsAlreadyPlanned(seeds, [{ id: "task-9", title: "ecs-2390 · WK 8: Quiz ·  due Wed " }])).toEqual([]);
  });
  it("keeps unrelated seeds, and matches a worry by id only", () => {
    const seeds = [seed("a", "Other", "school_risk"), seed("w1", "Call mom", "worry"), seed("w2", "Same title", "worry")];
    const lines = [{ id: "w1", title: "Call mom" }, { id: "x", title: "Same title" }];
    expect(dropSeedsAlreadyPlanned(seeds, lines).map((s) => s.id)).toEqual(["a", "w2"]);
  });
});
