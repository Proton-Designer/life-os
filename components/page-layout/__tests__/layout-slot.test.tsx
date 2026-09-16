import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "../layout-slot";
import type { LayoutItem } from "@/app/(app)/page-layout-actions";

const LAYOUT: LayoutItem[] = [
  { widgetKey: "a", label: "A", description: "", position: 2, hidden: false },
  { widgetKey: "b", label: "B", description: "", position: 0, hidden: true },
];

describe("buildLayoutMap / allWidgetsHidden (WIDGET-02)", () => {
  it("maps each widgetKey to its LayoutItem", () => {
    const map = buildLayoutMap(LAYOUT);
    expect(map.get("a")?.position).toBe(2);
    expect(map.get("b")?.hidden).toBe(true);
  });

  it("an empty domain (no registered widgets) is not 'all hidden'", () => {
    expect(allWidgetsHidden([])).toBe(false);
  });

  it("is false when at least one widget is visible", () => {
    expect(allWidgetsHidden(LAYOUT)).toBe(false);
  });

  it("is true only when every registered widget is hidden", () => {
    expect(allWidgetsHidden(LAYOUT.map((i) => ({ ...i, hidden: true })))).toBe(true);
  });
});

describe("LayoutSlot (WIDGET-02)", () => {
  it("renders its children with the resolved position as CSS order when visible", () => {
    const map = buildLayoutMap(LAYOUT);
    render(
      <LayoutSlot layout={map} widgetKey="a">
        <p>Widget A content</p>
      </LayoutSlot>
    );
    const node = screen.getByText("Widget A content").parentElement;
    expect(node).toHaveStyle({ order: "2" });
  });

  it("renders nothing at all when the widget is hidden -- not display:none, genuinely absent", () => {
    const map = buildLayoutMap(LAYOUT);
    render(
      <LayoutSlot layout={map} widgetKey="b">
        <p>Widget B content</p>
      </LayoutSlot>
    );
    expect(screen.queryByText("Widget B content")).not.toBeInTheDocument();
  });

  it("a widgetKey with no entry in the map still renders (fails open, not hidden)", () => {
    const map = buildLayoutMap(LAYOUT);
    render(
      <LayoutSlot layout={map} widgetKey="unregistered">
        <p>Unregistered content</p>
      </LayoutSlot>
    );
    expect(screen.getByText("Unregistered content")).toBeInTheDocument();
  });
});
