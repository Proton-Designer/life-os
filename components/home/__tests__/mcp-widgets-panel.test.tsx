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
