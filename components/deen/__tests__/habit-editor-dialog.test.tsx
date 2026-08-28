import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitEditorDialog } from "../habit-editor-dialog";
import type { DeenHabitData } from "../habit-builder";

const {
  updateDeenHabitMock,
  archiveDeenHabitMock,
  setDeenHabitStageOverrideMock,
  setDeenHabitCommittedDateMock,
  setDeenHabitLogStatusMock,
  getDeenHabitLogRangeMock,
} = vi.hoisted(() => ({
  updateDeenHabitMock: vi.fn(async () => {}),
  archiveDeenHabitMock: vi.fn(async () => {}),
  setDeenHabitStageOverrideMock: vi.fn(async () => {}),
  setDeenHabitCommittedDateMock: vi.fn(async () => {}),
  setDeenHabitLogStatusMock: vi.fn(async () => {}),
  getDeenHabitLogRangeMock: vi.fn(async (_habitId: string, _start: string, _end: string) => [] as { date: string; completed: boolean }[]),
}));

vi.mock("@/app/(app)/deen/actions", () => ({
  updateDeenHabit: updateDeenHabitMock,
  archiveDeenHabit: archiveDeenHabitMock,
  setDeenHabitStageOverride: setDeenHabitStageOverrideMock,
  setDeenHabitCommittedDate: setDeenHabitCommittedDateMock,
  setDeenHabitLogStatus: setDeenHabitLogStatusMock,
  getDeenHabitLogRange: getDeenHabitLogRangeMock,
}));

const TODAY = "2026-08-26";

function habit(overrides: Partial<DeenHabitData> = {}): DeenHabitData {
  return {
    id: "h1",
    name: "Fajr on time",
    committedDate: "2026-08-01", // 25 days in — Stabilized
    anchorCue: null,
    streak: 3,
    rollingRate: { done: 10, total: 15 },
    completedToday: false,
    stageOverride: null,
    ...overrides,
  };
}

function renderDialog(habits: DeenHabitData[], onHabitsChange = vi.fn()) {
  const onOpenChange = vi.fn();
  const utils = render(
    <HabitEditorDialog open habits={habits} todayStr={TODAY} onOpenChange={onOpenChange} onHabitsChange={onHabitsChange} />
  );
  return { ...utils, onOpenChange, onHabitsChange };
}

describe("HabitEditorDialog", () => {
  it("shows an explicit empty state with zero habits, not three empty stage columns with no message", () => {
    renderDialog([]);
    expect(screen.getByText(/no habits yet/i)).toBeInTheDocument();
  });

  it("shows a per-stage empty message ('None in this stage') for the two stages with nothing in them", () => {
    renderDialog([habit({ id: "a", committedDate: "2026-08-20" })]); // Active Build only
    const noneMessages = screen.getAllByText("None in this stage.");
    expect(noneMessages).toHaveLength(2); // Stabilized and Locked, not Active Build
  });

  // Every other test in this file uses a single-habit list — cheap to write,
  // but it means the main screen's grouping across all three stages
  // simultaneously, and the Advanced screen's multi-habit switcher (only
  // rendered when habits.length > 1), had never actually been exercised
  // (Opus Lead review, 2026-08-26). Both matter: three independent `.filter`
  // calls could silently drop a habit that matches none of them, or double
  // it if two matched, and the Select-driven habit switch has its own
  // effect-dependency logic (reloading logs, resetting committed_date) that
  // a single-habit render can't touch at all.
  it("renders all three stage groups populated at once, with no group empty and no habit duplicated or dropped", () => {
    renderDialog([
      habit({ id: "a", name: "Active habit", committedDate: "2026-08-20" }), // 6 days in
      habit({ id: "b", name: "Stabilized habit", committedDate: "2026-08-05" }), // 21 days in
      habit({ id: "c", name: "Locked habit", committedDate: "2026-07-01" }), // 56 days in
    ]);
    expect(screen.queryByText("None in this stage.")).not.toBeInTheDocument();
    expect(screen.getByText("Active habit")).toBeInTheDocument();
    expect(screen.getByText("Stabilized habit")).toBeInTheDocument();
    expect(screen.getByText("Locked habit")).toBeInTheDocument();
    expect(screen.getAllByText(/^(Active|Stabilized|Locked) habit$/)).toHaveLength(3);
  });

  it("Advanced screen: switching the habit selector reloads that habit's committed_date and day logs", async () => {
    getDeenHabitLogRangeMock.mockImplementation(async (habitId: string) =>
      habitId === "b" ? [{ date: TODAY, completed: true }] : []
    );
    const user = userEvent.setup();
    renderDialog([
      habit({ id: "a", name: "First habit", committedDate: "2026-08-01" }),
      habit({ id: "b", name: "Second habit", committedDate: "2026-08-10" }),
    ]);
    await user.click(screen.getAllByRole("button", { name: "Edit history" })[0]);

    // Opens pre-selected on the first habit's row.
    expect(await screen.findByLabelText("Started on")).toHaveValue("2026-08-01");
    expect(getDeenHabitLogRangeMock).toHaveBeenCalledWith("a", expect.any(String), TODAY);

    // Switch via the Select — only rendered because there's more than one habit.
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Second habit" }));

    expect(await screen.findByLabelText("Started on")).toHaveValue("2026-08-10");
    expect(getDeenHabitLogRangeMock).toHaveBeenCalledWith("b", expect.any(String), TODAY);
    const todayRow = (await screen.findByText(TODAY)).closest("li")!;
    expect(within(todayRow).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("groups a habit by its overridden stage, not the date-derived one", () => {
    renderDialog([habit({ id: "a", committedDate: "2026-08-20", stageOverride: "locked" })]);
    // Active Build and Stabilized are empty; Locked has the habit.
    expect(screen.getAllByText("None in this stage.")).toHaveLength(2);
    expect(screen.getByText("Fajr on time")).toBeInTheDocument();
    expect(screen.getByText(/manually set/)).toBeInTheDocument();
  });

  it("advances a habit to the next stage and updates the caller's habit list", async () => {
    const onHabitsChange = vi.fn();
    const user = userEvent.setup();
    renderDialog([habit({ id: "a", committedDate: "2026-08-20" })], onHabitsChange); // Active Build
    await user.click(screen.getByRole("button", { name: /advance to stabilized/i }));
    expect(setDeenHabitStageOverrideMock).toHaveBeenCalledWith("a", "stabilized");
    expect(onHabitsChange).toHaveBeenCalled();
  });

  it("degrades a habit to an earlier stage", async () => {
    const onHabitsChange = vi.fn();
    const user = userEvent.setup();
    renderDialog([habit({ id: "a", committedDate: "2026-07-01" })], onHabitsChange); // Locked
    await user.click(screen.getByRole("button", { name: /move back to active build/i }));
    expect(setDeenHabitStageOverrideMock).toHaveBeenCalledWith("a", "active_build");
  });

  it("resets an overridden stage back to automatic", async () => {
    const user = userEvent.setup();
    renderDialog([habit({ id: "a", committedDate: "2026-08-20", stageOverride: "locked" })]);
    await user.click(screen.getByRole("button", { name: /reset to automatic/i }));
    expect(setDeenHabitStageOverrideMock).toHaveBeenCalledWith("a", null);
  });

  it("edits a habit's name and cue", async () => {
    const onHabitsChange = vi.fn();
    const user = userEvent.setup();
    renderDialog([habit({ id: "a" })], onHabitsChange);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByPlaceholderText("Habit name");
    await user.clear(nameInput);
    await user.type(nameInput, "Fajr in congregation");
    // Scoped to the row's own inline edit form — the main screen also has a
    // "Save" button (the dialog-level close), same label, different button.
    const row = nameInput.closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Save" }));
    expect(updateDeenHabitMock).toHaveBeenCalledWith("a", "Fajr in congregation", null);
  });

  it("removes a habit only after an explicit confirm step, not on the first click", async () => {
    const onHabitsChange = vi.fn();
    const user = userEvent.setup();
    renderDialog([habit({ id: "a" })], onHabitsChange);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(archiveDeenHabitMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(archiveDeenHabitMock).toHaveBeenCalledWith("a");
  });

  it("Advanced screen: never offers a future date for committed_date", async () => {
    const user = userEvent.setup();
    renderDialog([habit({ id: "a" })]);
    await user.click(screen.getByRole("button", { name: "Edit history" }));
    const dateInput = screen.getByLabelText("Started on");
    expect(dateInput).toHaveAttribute("max", TODAY);
  });

  it("Advanced screen: toggling a past day calls setDeenHabitLogStatus with the flipped value", async () => {
    getDeenHabitLogRangeMock.mockResolvedValueOnce([{ date: TODAY, completed: false }]);
    const user = userEvent.setup();
    renderDialog([habit({ id: "a" })]);
    await user.click(screen.getByRole("button", { name: "Edit history" }));
    const todayRow = (await screen.findByText(TODAY)).closest("li")!;
    await user.click(within(todayRow).getByRole("button", { name: "Not done" }));
    expect(setDeenHabitLogStatusMock).toHaveBeenCalledWith("a", TODAY, true);
  });

  it("back arrow returns from Advanced to the main screen", async () => {
    const user = userEvent.setup();
    renderDialog([habit({ id: "a" })]);
    await user.click(screen.getByRole("button", { name: "Edit history" }));
    expect(screen.getByRole("heading", { name: /advanced habit settings/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: /edit habits/i })).toBeInTheDocument();
  });

  it("Save on the main screen closes the dialog", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog([habit({ id: "a" })]);
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Save on the Advanced screen also closes the dialog", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog([habit({ id: "a" })]);
    await user.click(screen.getByRole("button", { name: "Edit history" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
