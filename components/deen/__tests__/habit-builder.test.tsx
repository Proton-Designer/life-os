import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitBuilder, type DeenHabitData } from "../habit-builder";

vi.mock("@/app/(app)/deen/actions", () => ({
  toggleDeenHabitLog: vi.fn(),
  setWeeklyFocus: vi.fn(),
  createDeenHabit: vi.fn(),
  updateDeenHabit: vi.fn(),
  archiveDeenHabit: vi.fn(),
  setDeenHabitStageOverride: vi.fn(),
  setDeenHabitCommittedDate: vi.fn(),
  setDeenHabitLogStatus: vi.fn(),
  getDeenHabitLogRange: vi.fn(async () => []),
}));

function habit(overrides: Partial<DeenHabitData> = {}): DeenHabitData {
  return {
    id: "h1",
    name: "Fajr on time",
    committedDate: "2026-08-15",
    anchorCue: null,
    streak: 3,
    rollingRate: { done: 10, total: 15 },
    completedToday: false,
    stageOverride: null,
    ...overrides,
  };
}

describe("HabitBuilder", () => {
  it("renders stage column titles as Badge pills with the semantic stage mapping", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ id: "a" }), habit({ id: "b", committedDate: "2026-07-01" }), habit({ id: "c", committedDate: "2026-06-01" })]}
        currentFocusHabitId="a"
        habitConsistencyRows={[]}
      />
    );
    expect(screen.getByText("Active Build")).toHaveClass("text-accent-info");
    expect(screen.getByText("Stabilized")).toHaveClass("text-accent-business");
    expect(screen.getByText("Locked")).toHaveClass("text-muted-foreground");
  });

  it("renders a habit row's streak in the mono numeral scale, as a secondary line under the rolling rate", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ streak: 5, rollingRate: { done: 10, total: 15 } })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.getByText("10/15").className).toContain("font-mono");
    expect(screen.getByText("5d streak").className).toContain("font-mono");
  });

  it("omits the streak line entirely when there's no current run", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ streak: 0 })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
  });

  it("collapses the three redundant 'None yet.' stage columns into one shared EmptyState when there are no habits at all", () => {
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[]} currentFocusHabitId={null} habitConsistencyRows={[]} />
    );
    expect(screen.getByText("No habits started yet")).toBeInTheDocument();
    expect(screen.queryAllByText("None yet.").length).toBe(0);
    expect(screen.queryByText("Active Build")).not.toBeInTheDocument();
  });

  it("keeps a real per-stage 'None yet.' once at least one habit exists somewhere — that's a legitimate empty stage, not noise", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ committedDate: "2026-08-15" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.queryByText("No habits started yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("None yet.").length).toBeGreaterThan(0);
  });

  it("gives the current focus card a gradient wash and an icon chip", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        habitConsistencyRows={[]}
      />
    );
    const card = screen.getByTestId("habit-focus-card");
    expect(card.style.backgroundImage).toContain("--accent-deen");
    expect(card.style.backgroundColor).toBe("var(--card)");
    expect(card.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the day-range for each stage, not just its name", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ id: "a" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.getByText("Days 0–13")).toBeInTheDocument();
    expect(screen.getByText("Days 14–29")).toBeInTheDocument();
    expect(screen.getByText("Day 30+")).toBeInTheDocument();
  });

  it("offers a real, clearly-labeled Add a habit button when a focus is already set", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        habitConsistencyRows={[]}
      />
    );
    const addButton = screen.getByRole("button", { name: /add a habit/i });
    expect(addButton.tagName).toBe("BUTTON");
  });

  // 2026-08-26 (item 6, Ayman): "there is no option to edit/remove habits,
  // add this by creating an 'Edit' button next to the Create new Habit
  // button" — a real button opening the habit editor dialog, present
  // whenever there's at least one habit, in both the focus-set and
  // no-focus-set layouts (the "Create New Habit" button only renders in
  // the latter).
  it("offers an Edit button that opens the habit editor dialog", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        habitConsistencyRows={[]}
      />
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByRole("dialog", { name: "Edit habits" })).toBeInTheDocument();
  });

  it("offers a Create New Habit button when habits exist but no focus is set this week", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.getByRole("button", { name: /create new habit/i })).toBeInTheDocument();
    expect(screen.queryByText(/pick this week/i)).not.toBeInTheDocument();
  });

  it("opens the habit picker from the Create New Habit button", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[habit()]} currentFocusHabitId={null} habitConsistencyRows={[]} />
    );
    await user.click(screen.getByRole("button", { name: /create new habit/i }));
    expect(screen.getByPlaceholderText("Describe the habit — e.g. Read one page of Qur'an")).toBeInTheDocument();
  });

  it("lets you cancel out of the habit picker without picking anything, restoring the previous view", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        habitConsistencyRows={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: /add a habit/i }));
    expect(screen.getByPlaceholderText("Describe the habit — e.g. Read one page of Qur'an")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByPlaceholderText("Describe the habit — e.g. Read one page of Qur'an")).not.toBeInTheDocument();
    expect(screen.getByTestId("habit-focus-card")).toBeInTheDocument();
  });

  it("cancel from the picker doesn't create or select anything", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[]} currentFocusHabitId={null} habitConsistencyRows={[]} />
    );

    await user.click(screen.getByRole("button", { name: /add a habit/i }));
    await user.type(screen.getByPlaceholderText("Describe the habit — e.g. Read one page of Qur'an"), "Should not be created");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByText("No habits started yet")).toBeInTheDocument();
    expect(screen.queryByText("Should not be created")).not.toBeInTheDocument();
  });

  it("shows the anchor cue as a standalone tag above the habit name, not fused into a sentence", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ anchorCue: "After Fajr", name: "Gym" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    // No prefilled "After " — the preposition, if any, is the user's own
    // typed text now, since a cue can just as well be "Before sleeping".
    expect(screen.getByText("After Fajr")).toBeInTheDocument();
    expect(screen.getByText("Gym")).toBeInTheDocument();
    // Never fused — "After Fajr, I will Gym" or similar would read oddly.
    expect(screen.queryByText(/After Fajr.*Gym/)).not.toBeInTheDocument();
  });

  it("renders no cue tag at all when anchorCue is null — degrades to the bare name, not a sentence with a hole in it", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ anchorCue: null, name: "Read Qur'an daily" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.getByText("Read Qur'an daily")).toBeInTheDocument();
    expect(screen.queryByText(/^After/)).not.toBeInTheDocument();
  });

  it("renders a bare stored cue (no leading preposition) as-is, not prefixed with 'After'", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ anchorCue: "Fajr", name: "Gym" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[]}
      />
    );
    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.queryByText("After Fajr")).not.toBeInTheDocument();
  });

  it("the create-habit form has separate name and cue fields, not one sentence-shaped input", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[]} currentFocusHabitId={null} habitConsistencyRows={[]} />
    );
    await user.click(screen.getByRole("button", { name: /add a habit/i }));
    expect(screen.getByPlaceholderText("Describe the habit — e.g. Read one page of Qur'an")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/cue \(optional\)/i)).toBeInTheDocument();
  });

  it("creating a habit with a cue passes it through to createDeenHabit", async () => {
    const { createDeenHabit, setWeeklyFocus } = await import("@/app/(app)/deen/actions");
    vi.mocked(createDeenHabit).mockResolvedValue({ id: "new-habit" });
    const user = userEvent.setup();
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[]} currentFocusHabitId={null} habitConsistencyRows={[]} />
    );

    await user.click(screen.getByRole("button", { name: /add a habit/i }));
    await user.type(screen.getByPlaceholderText("Describe the habit — e.g. Read one page of Qur'an"), "Read Qur'an");
    await user.type(screen.getByPlaceholderText(/cue \(optional\)/i), "Fajr");
    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(createDeenHabit).toHaveBeenCalledWith("Read Qur'an", "Fajr");
    expect(setWeeklyFocus).toHaveBeenCalledWith("new-habit");
    // A brand-new habit, not yet done today, must show 0/0 — not 0/1. The
    // day isn't over, so it shouldn't be counted against a habit that's
    // seconds old; this is the same bug the today-in-progress fix targets,
    // just in the optimistic client-side placeholder rather than the
    // server calculation.
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("renders one shared grid with a row per habit, not one grid per habit", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ id: "a", name: "Unrelated A" }), habit({ id: "b", name: "Unrelated B" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={[
          { label: "Grid habit A", cells: [{ date: "2026-08-15", status: "done" }] },
          { label: "Grid habit B", cells: [{ date: "2026-08-15", status: "missed" }] },
        ]}
      />
    );
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
    // Both row labels present in the single grid section — one grid, not two.
    const grid = screen.getByText("Last 30 days").parentElement;
    expect(grid).toHaveTextContent("Grid habit A");
    expect(grid).toHaveTextContent("Grid habit B");
  });

  it("caps visible habit rows at 5 with a show-more toggle, since habits (unlike prayers) have no fixed count", async () => {
    const user = userEvent.setup();
    // Grid rows use distinct labels from the (unrelated) stage-column habit,
    // so assertions can't accidentally match the wrong rendered list.
    const rows = Array.from({ length: 7 }, (_, i) => ({
      label: `Grid habit ${i + 1}`,
      cells: [{ date: "2026-08-15", status: "done" }],
    }));
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ id: "dummy", name: "Unrelated stage-column habit" })]}
        currentFocusHabitId={null}
        habitConsistencyRows={rows}
      />
    );

    expect(screen.getByText("Grid habit 5")).toBeInTheDocument();
    expect(screen.queryByText("Grid habit 6")).not.toBeInTheDocument();
    expect(screen.getByText("Show 2 more")).toBeInTheDocument();

    await user.click(screen.getByText("Show 2 more"));

    expect(screen.getByText("Grid habit 6")).toBeInTheDocument();
    expect(screen.getByText("Grid habit 7")).toBeInTheDocument();
  });
});
