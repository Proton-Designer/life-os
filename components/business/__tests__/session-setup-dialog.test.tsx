import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionSetupDialog, type SessionStartPayload } from "../session-setup-dialog";

const getClassTasksDueSoonMock = vi.fn(async (_classId: string) => [] as { id: string; title: string; dueDate: string }[]);
vi.mock("@/app/(app)/business/actions", () => ({
  getClassTasksDueSoon: (classId: string) => getClassTasksDueSoonMock(classId),
}));

function renderDialog(overrides: Partial<Parameters<typeof SessionSetupDialog>[0]> = {}) {
  const onStart = overrides.onStart ?? vi.fn(async () => {});
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  render(
    <SessionSetupDialog
      open
      onOpenChange={onOpenChange}
      kind={overrides.kind ?? "deep_work"}
      killListItems={overrides.killListItems ?? []}
      classes={overrides.classes ?? []}
      onStart={onStart}
    />
  );
  return { onStart, onOpenChange };
}

describe("SessionSetupDialog", () => {
  beforeEach(() => {
    getClassTasksDueSoonMock.mockClear();
    getClassTasksDueSoonMock.mockResolvedValue([]);
  });

  describe("duration", () => {
    it("disables Start until a duration is chosen", () => {
      renderDialog();
      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    });

    it("enables Start once a duration is typed", async () => {
      renderDialog();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "45");
      expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    });

    it("moving the hours slider updates the text field to match", () => {
      renderDialog();
      const hoursSlider = screen.getByLabelText("Hours");
      fireRangeChange(hoursSlider, 2);
      expect(screen.getByLabelText("Duration in minutes")).toHaveValue("120");
    });

    it("rejects a total over the 8-hour cap typed in the text field, keeping Start disabled", async () => {
      renderDialog();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "481");
      expect(screen.getByText(/at most 8 hours/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    });

    it("clamps the minutes slider to 0 once hours reaches the 8-hour ceiling, so the sliders alone can never produce an invalid total", () => {
      renderDialog();
      const hoursSlider = screen.getByLabelText("Hours") as HTMLInputElement;
      fireRangeChange(hoursSlider, 8);
      const minutesSlider = screen.getByLabelText("Minutes") as HTMLInputElement;
      expect(minutesSlider.max).toBe("0");
      expect(screen.getByLabelText("Duration in minutes")).toHaveValue("480");
    });
  });

  describe("Deep Work objectives", () => {
    it("offers only incomplete kill list items", () => {
      renderDialog({
        killListItems: [
          { id: "k1", text: "Ship the thing", completed: false },
          { id: "k2", text: "Already done", completed: true },
        ],
      });
      expect(screen.getByText("Ship the thing")).toBeInTheDocument();
      expect(screen.queryByText("Already done")).not.toBeInTheDocument();
    });

    it("numbers items in the order they're selected, not list order", async () => {
      renderDialog({
        killListItems: [
          { id: "k1", text: "First in list", completed: false },
          { id: "k2", text: "Second in list", completed: false },
        ],
      });
      const user = userEvent.setup();
      // Select the second-listed item first.
      await user.click(screen.getByText("Second in list"));
      await user.click(screen.getByText("First in list"));

      const secondRow = screen.getByText("Second in list").closest("button")!;
      const firstRow = screen.getByText("First in list").closest("button")!;
      expect(secondRow).toHaveTextContent("1");
      expect(firstRow).toHaveTextContent("2");
    });

    it("deselecting an item removes its badge and renumbers nothing else incorrectly", async () => {
      renderDialog({
        killListItems: [
          { id: "k1", text: "A", completed: false },
          { id: "k2", text: "B", completed: false },
        ],
      });
      const user = userEvent.setup();
      await user.click(screen.getByText("A"));
      await user.click(screen.getByText("B"));
      await user.click(screen.getByText("A")); // deselect A
      expect(screen.getByText("A").closest("button")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByText("B").closest("button")).toHaveTextContent("1");
    });

    it("includes a selected kill list item and a custom objective in the Start payload", async () => {
      const onStart = vi.fn(async (_payload: SessionStartPayload) => {});
      const { } = renderDialog({
        killListItems: [{ id: "k1", text: "Ship it", completed: false }],
        onStart,
      });
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "30");
      await user.click(screen.getByText("Ship it"));
      await user.type(screen.getByLabelText("Custom objective"), "Finish the draft");
      await user.click(screen.getByRole("button", { name: "Start" }));

      await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
      expect(onStart).toHaveBeenCalledWith({
        goalMinutes: 30,
        classId: null,
        objectives: [
          { kind: "kill_list_item", id: "k1" },
          { kind: "custom", text: "Finish the draft" },
        ],
      });
    });

    it("does not include an empty custom objective in the payload", async () => {
      const onStart = vi.fn(async (_payload: SessionStartPayload) => {});
      renderDialog({ onStart });
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "30");
      await user.click(screen.getByRole("button", { name: "Start" }));
      await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
      expect(onStart).toHaveBeenCalledWith({ goalMinutes: 30, classId: null, objectives: [] });
    });

    it("does not require any objective to enable Start", async () => {
      renderDialog();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "30");
      expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    });
  });

  describe("Deep Study", () => {
    const CLASSES = [{ id: "c1", label: "PHYS-2326" }];

    it("requires a class before Start is enabled, even with a duration set", async () => {
      renderDialog({ kind: "deep_study", classes: CLASSES });
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "60");
      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    });

    it("loads that class's due-soon tasks once picked", async () => {
      getClassTasksDueSoonMock.mockResolvedValue([{ id: "t1", title: "Lab report", dueDate: "2026-09-15" }]);
      renderDialog({ kind: "deep_study", classes: CLASSES });
      const user = userEvent.setup();
      await user.click(screen.getByText("PHYS-2326"));

      expect(getClassTasksDueSoonMock).toHaveBeenCalledWith("c1");
      expect(await screen.findByText("Lab report")).toBeInTheDocument();
    });

    it("enables Start once both a duration and a class are set", async () => {
      renderDialog({ kind: "deep_study", classes: CLASSES });
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Duration in minutes"), "60");
      await user.click(screen.getByText("PHYS-2326"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
    });

    it("hides the Study Material input until the toggle is pressed, and clears it when toggled off", async () => {
      renderDialog({ kind: "deep_study", classes: CLASSES });
      expect(screen.queryByLabelText("Study material")).not.toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Study Material" }));
      await user.type(screen.getByLabelText("Study material"), "Chapters 4-6");
      await user.click(screen.getByRole("button", { name: "Study Material" }));
      expect(screen.queryByLabelText("Study material")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Study Material" }));
      expect(screen.getByLabelText("Study material")).toHaveValue("");
    });

    it("switching classes clears the previous class's task selection", async () => {
      const CLASSES_2 = [
        { id: "c1", label: "PHYS-2326" },
        { id: "c2", label: "CHEM-1105" },
      ];
      getClassTasksDueSoonMock.mockImplementation(async (classId: string) =>
        classId === "c1" ? [{ id: "t1", title: "Lab report", dueDate: "2026-09-15" }] : [{ id: "t2", title: "Problem set", dueDate: "2026-09-16" }]
      );
      renderDialog({ kind: "deep_study", classes: CLASSES_2 });
      const user = userEvent.setup();
      await user.click(screen.getByText("PHYS-2326"));
      await screen.findByText("Lab report");
      await user.click(screen.getByText("Lab report"));

      await user.click(screen.getByText("CHEM-1105"));
      await screen.findByText("Problem set");
      expect(screen.queryByText("Lab report")).not.toBeInTheDocument();
      expect(screen.getByText("Problem set").closest("button")).toHaveAttribute("aria-pressed", "false");
    });
  });

  // The reset is keyed on the transition TO open (see the component's own
  // comment) specifically so it covers a parent that closes the dialog for
  // its own reason, not only a close this component itself initiated —
  // exercised here as a bare `open` prop flip from the outside, the same
  // shape a parent's `onOpenChange` handler produces, never going through
  // this component's Start/cancel paths at all.
  it("resets all state on the transition to open, even when the caller closed it directly", async () => {
    const onOpenChange = vi.fn();
    const props = {
      onOpenChange,
      kind: "deep_work" as const,
      killListItems: [{ id: "k1", text: "A", completed: false }],
      classes: [],
      onStart: vi.fn(async () => {}),
    };
    const { rerender } = render(<SessionSetupDialog open {...props} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Duration in minutes"), "30");
    await user.click(screen.getByText("A"));
    expect(screen.getByLabelText("Duration in minutes")).toHaveValue("30");

    rerender(<SessionSetupDialog open={false} {...props} />);
    rerender(<SessionSetupDialog open {...props} />);

    expect(screen.getByLabelText("Duration in minutes")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByText("A").closest("button")).toHaveAttribute("aria-pressed", "false");
  });
});

// jsdom's <input type="range"> doesn't respond to userEvent's pointer/keyboard
// simulation the way a real browser's slider thumb does, so tests that move a
// slider use RTL's fireEvent.input directly (wraps the resulting state
// update in act(), unlike a raw element.dispatchEvent call) with a target
// value — the same escape hatch React Testing Library's own docs recommend
// for range inputs.
function fireRangeChange(element: HTMLElement, value: number) {
  fireEvent.input(element, { target: { value: String(value) } });
}
