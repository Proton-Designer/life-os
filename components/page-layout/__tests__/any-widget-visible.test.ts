import { describe, expect, it } from "vitest";
import { anyWidgetVisible } from "../layout-slot";

const item = (widgetKey: string, hidden: boolean) => ({ widgetKey, label: widgetKey, description: "", position: 0, hidden });

describe("anyWidgetVisible", () => {
  it("true only when one of the keys is switched on", () => {
    const layout = [item("pipeline", true), item("targets", true), item("kill_list", false)];
    expect(anyWidgetVisible(layout, ["pipeline", "targets", "work_schedule"])).toBe(false);
    expect(anyWidgetVisible([...layout, item("targets", false)], ["pipeline", "targets", "work_schedule"])).toBe(true);
    expect(anyWidgetVisible(layout, ["kill_list"])).toBe(true);
    expect(anyWidgetVisible([], ["pipeline"])).toBe(false);
  });
});
