import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DailyChecks } from "../daily-checks";

describe("DailyChecks", () => {
  it("renders exactly two checks: protein and steps", () => {
    render(<DailyChecks proteinDone={false} stepsDone={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Hit protein target")).toBeInTheDocument();
    expect(screen.getByText("8,000+ steps")).toBeInTheDocument();
  });

  it("shows the gram number once, as a plain caption — never inside a progress bar or 'X of Y g' phrasing", () => {
    render(<DailyChecks proteinDone={false} stepsDone={false} onToggle={vi.fn()} />);
    expect(screen.getByText("~130–150g")).toBeInTheDocument();
    expect(screen.queryByText(/of.*130.*g/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("the steps checkbox copy does not imply a synced pedometer reading", () => {
    render(<DailyChecks proteinDone={false} stepsDone={false} onToggle={vi.fn()} />);
    expect(screen.queryByText(/synced|tracked automatically|from your phone/i)).not.toBeInTheDocument();
  });

  it("tapping a check calls onToggle with its kind", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<DailyChecks proteinDone={false} stepsDone={false} onToggle={onToggle} />);
    await user.click(screen.getByText("Hit protein target"));
    expect(onToggle).toHaveBeenCalledWith("protein");
    await user.click(screen.getByText("8,000+ steps"));
    expect(onToggle).toHaveBeenCalledWith("steps");
  });

  it("reflects checked state via aria-checked", () => {
    render(<DailyChecks proteinDone={true} stepsDone={false} onToggle={vi.fn()} />);
    const rows = screen.getAllByRole("checkbox");
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    expect(rows[1]).toHaveAttribute("aria-checked", "false");
  });

  it("nothing anywhere sums or logs grams — no numeric gram total appears besides the one static caption", () => {
    render(<DailyChecks proteinDone={true} stepsDone={false} onToggle={vi.fn()} />);
    const gramMentions = screen.getAllByText(/g\b/).filter((el) => /\d/.test(el.textContent ?? ""));
    expect(gramMentions).toHaveLength(1);
  });
});
