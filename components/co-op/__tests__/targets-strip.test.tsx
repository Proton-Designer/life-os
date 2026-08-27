import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TargetsStrip } from "../targets-strip";
import type { CoopTargetRow, CompletedCoopTargetRow } from "@/lib/coop/targets";

vi.mock("@/app/(app)/work/targets-actions", () => ({
  addTarget: vi.fn(async () => {}),
  addStretchGoal: vi.fn(async () => {}),
  editTarget: vi.fn(async () => {}),
  removeTarget: vi.fn(async () => {}),
  completeTarget: vi.fn(async () => ({ promotedTargetId: null, promotedNeedsDeadline: false })),
  moveTarget: vi.fn(async () => {}),
}));

const ACTIVE_TARGET: CoopTargetRow = { id: "t1", title: "Finish resume", deadline: "2026-09-01", position: 1 };

function completed(overrides: Partial<CompletedCoopTargetRow> = {}): CompletedCoopTargetRow {
  return { id: "c1", title: "Apply to 10 companies", completedDateStr: "2026-08-20", ...overrides };
}

// Ayman (2026-08-26 evening, verbatim): "underneath stretch goals, add
// another collapsable for Completed goals, this should be collapsed at
// default but shoudl list all copmleted goals under it."
describe("TargetsStrip — Completed goals", () => {
  it("is collapsed by default and shows the count in its header", () => {
    render(<TargetsStrip rows={[ACTIVE_TARGET]} completedGoals={[completed(), completed({ id: "c2" })]} todayStr="2026-08-26" />);
    expect(screen.getByRole("button", { name: "Completed goals (2)" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Apply to 10 companies")).not.toBeInTheDocument();
  });

  it("lists every completed goal's title and formatted date when expanded", async () => {
    const user = userEvent.setup();
    render(
      <TargetsStrip
        rows={[ACTIVE_TARGET]}
        completedGoals={[completed({ id: "c1", title: "Apply to 10 companies", completedDateStr: "2026-08-20" })]}
        todayStr="2026-08-26"
      />
    );
    await user.click(screen.getByRole("button", { name: "Completed goals (1)" }));
    expect(screen.getByText("Apply to 10 companies")).toBeInTheDocument();
    expect(screen.getByText("Aug. 20th")).toBeInTheDocument();
  });

  // Opus Lead ruling: render even at zero so the section vanishing never
  // reads as broken, but the empty state stays quiet.
  it("renders with a count of 0 and a quiet empty message when there are no completed goals", async () => {
    const user = userEvent.setup();
    render(<TargetsStrip rows={[ACTIVE_TARGET]} completedGoals={[]} todayStr="2026-08-26" />);
    expect(screen.getByRole("button", { name: "Completed goals (0)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Completed goals (0)" }));
    expect(screen.getByText("No completed goals yet")).toBeInTheDocument();
  });

  // position is meaningless on a done row (lib/coop/targets.ts) — no rank
  // badge, no move/edit/remove controls, unlike an active TargetRow.
  it("renders completed goals as a flat read-only list — no rank badge or row actions", async () => {
    const user = userEvent.setup();
    render(<TargetsStrip rows={[ACTIVE_TARGET]} completedGoals={[completed()]} todayStr="2026-08-26" />);
    await user.click(screen.getByRole("button", { name: "Completed goals (1)" }));
    // The completed row's own container has no interactive elements at
    // all — unlike the active TargetRow above it, which does (and still
    // should).
    const completedRow = screen.getByText("Apply to 10 companies").closest("div")!;
    expect(completedRow.querySelectorAll("button")).toHaveLength(0);
  });

  // A collision with the accessible name "Completed" (School's own task
  // list control) shipped four times in one night last week — the header
  // must never collapse to that bare label.
  it("never uses the bare accessible name \"Completed\" — always \"Completed goals\"", () => {
    render(<TargetsStrip rows={[ACTIVE_TARGET]} completedGoals={[completed()]} todayStr="2026-08-26" />);
    expect(screen.queryByRole("button", { name: "Completed" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Completed goals/ })).toBeInTheDocument();
  });

  // Completing every active target/stretch goal empties `rows` entirely,
  // which normally collapses the whole strip to a "+ Set your first
  // target" CTA — history shouldn't disappear behind that prompt just
  // because nothing is currently in progress.
  it("still shows completed goals even with zero active targets (the whole queue finished)", async () => {
    const user = userEvent.setup();
    render(<TargetsStrip rows={[]} completedGoals={[completed({ title: "Shipped the MVP" })]} todayStr="2026-08-26" />);
    expect(screen.getByRole("button", { name: "+ Set your first target" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Completed goals (1)" }));
    expect(screen.getByText("Shipped the MVP")).toBeInTheDocument();
  });
});
