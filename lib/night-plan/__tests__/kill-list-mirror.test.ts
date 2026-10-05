import { describe, expect, it } from "vitest";
import { hasBusinessKillList, planKillListFill } from "../kill-list-mirror";

describe("planKillListFill", () => {
  it("fills the first free slots in order, skipping occupied positions", () => {
    const out = planKillListFill([{ position: 0, text: "Existing" }], ["A", "B"]);
    expect(out.place).toEqual([{ position: 1, text: "A" }, { position: 2, text: "B" }]);
    expect(out.overflow).toEqual([]);
  });

  it("a blank row counts as a free slot", () => {
    expect(planKillListFill([{ position: 0, text: "  " }, { position: 1, text: "X" }], ["A"]).place).toEqual([{ position: 0, text: "A" }]);
  });

  it("is idempotent: a title already on the list (any case) is not added again", () => {
    const out = planKillListFill([{ position: 0, text: "Send the invoices" }], ["send the invoices ", "New"]);
    expect(out.alreadyThere).toEqual(["send the invoices"]);
    expect(out.place).toEqual([{ position: 1, text: "New" }]);
  });

  it("reports what did not fit when the list is full, and ignores blanks and duplicates", () => {
    const full = [0, 1, 2].map((position) => ({ position, text: `T${position}` }));
    expect(planKillListFill(full, ["A", "A", " "]).overflow).toEqual(["A"]);
    expect(planKillListFill([], ["A", "B", "C", "D"]).overflow).toEqual(["D"]);
  });
});

describe("hasBusinessKillList", () => {
  const nav = (kinds: Array<"job" | "business" | null>) => ({ workSubdomains: kinds.map((kind, i) => ({ key: `k${i}`, kind })) }) as never;
  it("legacy accounts always have one; domains accounts need a Business Work tab", () => {
    expect(hasBusinessKillList("legacy", null)).toBe(true);
    expect(hasBusinessKillList("domains", nav(["job"]))).toBe(false);
    expect(hasBusinessKillList("domains", nav(["job", "business"]))).toBe(true);
  });
});
