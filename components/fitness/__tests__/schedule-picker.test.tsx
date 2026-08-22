import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SchedulePicker } from "../workouts/schedule-picker";

describe("SchedulePicker", () => {
  it("pre-selects the matching preset button for an existing weekdays schedule", () => {
    render(<SchedulePicker value={[1, 2, 3, 4, 5]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Weekdays" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to Custom when the days don't match any preset", () => {
    render(<SchedulePicker value={[0, 2, 4]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
  });

  it("emits the preset's day array when a preset is selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SchedulePicker value={[1, 2, 3, 4, 5]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Weekends" }));
    expect(onChange).toHaveBeenCalledWith([0, 6]);
  });

  it("reveals per-day toggles when Custom is selected, and toggling emits a sorted day array", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SchedulePicker value={[1, 2, 3, 4, 5]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Sun" }));
    expect(onChange).toHaveBeenCalledWith([0, 1, 2, 3, 4, 5]);
  });

  it("removes a day on a second toggle", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SchedulePicker value={[0, 1, 2, 3, 4, 5]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Sun" }));
    expect(onChange).toHaveBeenCalledWith([1, 2, 3, 4, 5]);
  });
});
