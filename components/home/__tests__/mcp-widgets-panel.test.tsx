import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RenderedWidget } from "@/lib/widgets/render";

const removeWidgetMock = vi.fn(async (_id: string) => {});
vi.mock("@/app/(app)/widgets/actions", () => ({
  removeWidget: (id: string) => removeWidgetMock(id),
}));

import { McpWidgetsPanel } from "../mcp-widgets-panel";

describe("McpWidgetsPanel", () => {
  it("renders nothing when there are no widgets -- no empty-state clutter for a feature nobody's used yet", () => {
    const { container } = render(<McpWidgetsPanel widgets={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a metric_card's formatted value", () => {
    const widgets: RenderedWidget[] = [{ id: "w1", kind: "metric_card", title: "Tasks due", value: "3+" }];
    render(<McpWidgetsPanel widgets={widgets} />);
    expect(screen.getByText("Tasks due")).toBeInTheDocument();
    expect(screen.getByText("3+")).toBeInTheDocument();
  });

  it("renders a list widget's items with title/subtitle, and an empty-state line when the list itself is empty", () => {
    const widgets: RenderedWidget[] = [
      { id: "w1", kind: "list", title: "Upcoming", items: [{ title: "Midterm 2", subtitle: "2026-10-15" }] },
      { id: "w2", kind: "list", title: "Nothing here", items: [] },
    ];
    render(<McpWidgetsPanel widgets={widgets} />);
    expect(screen.getByText("Midterm 2")).toBeInTheDocument();
    expect(screen.getByText("2026-10-15")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("renders a progress_against_goal widget's current/goal/percent, honestly suffixed with '+' when hasMore", () => {
    const widgets: RenderedWidget[] = [
      { id: "w1", kind: "progress_against_goal", title: "Pages read", current: 25, hasMore: false, goal: 50, percent: 50 },
      { id: "w2", kind: "progress_against_goal", title: "Tasks done", current: 20, hasMore: true, goal: 100, percent: 20 },
    ];
    render(<McpWidgetsPanel widgets={widgets} />);
    expect(screen.getByText("Pages read")).toBeInTheDocument();
    expect(screen.getByText("25 / 50 (50%)")).toBeInTheDocument();
    expect(screen.getByText("Tasks done")).toBeInTheDocument();
    expect(screen.getByText("20+ / 100 (20%+)")).toBeInTheDocument();
  });

  it("renders a sparkline's latest value, honestly flagging hasMore, and a non-crashing SVG for an empty/flat series", () => {
    const widgets: RenderedWidget[] = [
      { id: "w1", kind: "sparkline", title: "Pages read trend", points: [{ date: "2026-09-08", value: 5 }, { date: "2026-09-09", value: 12 }], hasMore: false },
      { id: "w2", kind: "sparkline", title: "Empty trend", points: [{ date: "2026-09-09", value: 0 }], hasMore: true },
    ];
    render(<McpWidgetsPanel widgets={widgets} />);
    expect(screen.getByText("Pages read trend")).toBeInTheDocument();
    expect(screen.getByText("12 today")).toBeInTheDocument();
    expect(screen.getByText("Empty trend")).toBeInTheDocument();
    expect(screen.getByText("0 today · earlier days may be a floor")).toBeInTheDocument();
  });

  it("renders a widget's OWN error message rather than crashing the panel", () => {
    const widgets: RenderedWidget[] = [{ id: "w-broken", kind: "metric_card", title: "Broken", error: "Unknown entity \"task\"" }];
    render(<McpWidgetsPanel widgets={widgets} />);
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(screen.getByText('Unknown entity "task"')).toBeInTheDocument();
  });

  it("renders one remove button per widget, bound to that widget's own id", async () => {
    const widgets: RenderedWidget[] = [
      { id: "w1", kind: "metric_card", title: "A", value: "1" },
      { id: "w2", kind: "metric_card", title: "B", value: "2" },
    ];
    render(<McpWidgetsPanel widgets={widgets} />);
    const buttons = screen.getAllByRole("button", { name: /remove widget/i });
    expect(buttons).toHaveLength(2);

    buttons[1].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(removeWidgetMock).toHaveBeenCalledWith("w2");
  });
});
