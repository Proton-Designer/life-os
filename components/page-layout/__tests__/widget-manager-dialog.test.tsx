import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WidgetManagerDialog } from "../widget-manager-dialog";
import type { LayoutItem, SavePageLayoutResult } from "@/app/(app)/page-layout-actions";

const getPageLayoutMock = vi.fn(async (..._args: unknown[]): Promise<LayoutItem[]> => []);
const savePageLayoutMock = vi.fn(async (..._args: unknown[]): Promise<SavePageLayoutResult> => ({ ok: true }));
vi.mock("@/app/(app)/page-layout-actions", () => ({
  getPageLayout: (...args: unknown[]) => getPageLayoutMock(...args),
  savePageLayout: (...args: unknown[]) => savePageLayoutMock(...args),
}));

const LAYOUT: LayoutItem[] = [
  { widgetKey: "a", label: "Widget A", description: "First widget", position: 0, hidden: false },
  { widgetKey: "b", label: "Widget B", description: "Second widget", position: 1, hidden: false },
  { widgetKey: "c", label: "Widget C", description: "Third widget", position: 2, hidden: true },
];

describe("WidgetManagerDialog (WIDGET-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPageLayoutMock.mockResolvedValue(LAYOUT.map((i) => ({ ...i })));
    savePageLayoutMock.mockResolvedValue({ ok: true });
  });

  it("fetches the layout on open and shows the FULL list, including hidden widgets", async () => {
    render(<WidgetManagerDialog domainKey="school" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(getPageLayoutMock).toHaveBeenCalledWith("school"));
    expect(await screen.findByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText("Widget B")).toBeInTheDocument();
    expect(screen.getByText("Widget C")).toBeInTheDocument(); // hidden, but still listed
    expect(screen.getByText("First widget")).toBeInTheDocument(); // description shown
  });

  it("a hidden widget's visibility switch is unchecked, a visible one's is checked", async () => {
    render(<WidgetManagerDialog domainKey="school" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Widget A");
    expect(screen.getByRole("switch", { name: "Hide Widget A" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Show Widget C" })).not.toBeChecked();
  });

  it("Move up/down: the first item's Up is disabled, the last item's Down is disabled, reorder buttons work without a pointer/drag", async () => {
    const user = userEvent.setup();
    render(<WidgetManagerDialog domainKey="school" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Widget A");
    expect(screen.getByRole("button", { name: "Move Widget A up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Widget C down" })).toBeDisabled();

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("Widget A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move Widget A down" }));
    const afterMove = screen.getAllByRole("listitem");
    expect(within(afterMove[0]!).getByText("Widget B")).toBeInTheDocument();
    expect(within(afterMove[1]!).getByText("Widget A")).toBeInTheDocument();
  });

  it("toggling a switch flips hidden in the draft, and Save submits the FULL list with fresh positions and the flipped hidden flag", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<WidgetManagerDialog domainKey="school" open onOpenChange={onOpenChange} onSaved={onSaved} />);
    await screen.findByText("Widget A");

    await user.click(screen.getByRole("switch", { name: "Hide Widget A" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(savePageLayoutMock).toHaveBeenCalledWith("school", [
        { widgetKey: "a", position: 0, hidden: true },
        { widgetKey: "b", position: 1, hidden: false },
        { widgetKey: "c", position: 2, hidden: true },
      ])
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Cancel discards the draft without ever calling savePageLayout", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<WidgetManagerDialog domainKey="school" open onOpenChange={onOpenChange} onSaved={vi.fn()} />);
    await screen.findByText("Widget A");

    await user.click(screen.getByRole("switch", { name: "Hide Widget A" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(savePageLayoutMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("re-opening after Cancel re-fetches a clean layout rather than reusing the discarded draft", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WidgetManagerDialog domainKey="school" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Widget A");
    await user.click(screen.getByRole("switch", { name: "Hide Widget A" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    rerender(<WidgetManagerDialog domainKey="school" open={false} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    rerender(<WidgetManagerDialog domainKey="school" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Widget A");

    expect(getPageLayoutMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("switch", { name: "Hide Widget A" })).toBeChecked(); // back to visible, not the discarded hidden draft
  });

  it("a save failure shows the server's own message and does not close the dialog", async () => {
    savePageLayoutMock.mockResolvedValue({ ok: false, message: "Unknown widget for this domain." });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<WidgetManagerDialog domainKey="school" open onOpenChange={onOpenChange} onSaved={vi.fn()} />);
    await screen.findByText("Widget A");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Unknown widget for this domain.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
