import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// HOME-02: the revert switch is wired once, in the page. A page render needs ~25 mocks, so this pins the
// wiring in the source (positive controls below show the patterns really match what they claim to).
const page = readFileSync(join(__dirname, "../page.tsx"), "utf8");

describe("Home day view wiring", () => {
  it("the separate day's-shape panel renders only in 'classic', and the rhythm card gets the same switch", () => {
    const slot = page.slice(page.indexOf('widgetKey="day_shape"'));
    expect(slot.slice(0, 220)).toContain('HOME_DAY_VIEW === "classic"');
    expect(slot).toContain('<Panel title="The day\'s shape">'); // the classic panel is kept, not deleted
    expect(page).toContain("dayView={HOME_DAY_VIEW}");
    expect(page).toContain('import { HOME_DAY_VIEW } from "@/lib/home/day-view"');
  });
  it("positive control: the pattern would not match a page that rendered the panel unconditionally", () => {
    const unconditional = '<LayoutSlot widgetKey="day_shape"><Panel title="The day\'s shape">';
    expect(unconditional.slice(0, 220)).not.toContain('HOME_DAY_VIEW === "classic"');
  });
});
