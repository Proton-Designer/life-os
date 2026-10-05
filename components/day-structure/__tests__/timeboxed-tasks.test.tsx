import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeboxedTasks } from "../timeboxed-tasks";
import type { TimeboxedTask } from "@/lib/day-structure/timebox";
import { pickTime12, readTime12 } from "@/components/ui/__tests__/time-field-helper";

const setTaskPlannedStartTimeMock = vi.fn();
const clearTaskPlannedStartTimeMock = vi.fn();
vi.mock("@/app/(app)/open/today/timebox-actions", () => ({
  setTaskPlannedStartTime: (...args: unknown[]) => setTaskPlannedStartTimeMock(...args),
  clearTaskPlannedStartTime: (...args: unknown[]) => clearTaskPlannedStartTimeMock(...args),
}));

function task(overrides: Partial<TimeboxedTask> = {}): TimeboxedTask {
  return { id: "t1", title: "Write the report", mitRank: 1, plannedStartTime: null, completed: false, ...overrides };
}

beforeEach(() => {
  setTaskPlannedStartTimeMock.mockReset().mockResolvedValue({ ok: true, message: "Saved." });
  clearTaskPlannedStartTimeMock.mockReset().mockResolvedValue({ ok: true, message: "Cleared." });
});

describe("TimeboxedTasks (Phase 2 #P2-06)", () => {
  it("renders nothing when there are no timeboxable tasks today", () => {
    const { container } = render(<TimeboxedTasks tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per task, in the order given (the reader already sorted it)", () => {
    render(<TimeboxedTasks tasks={[task({ id: "a", title: "First" }), task({ id: "b", title: "Second" })]} />);
    expect(screen.getByTestId("timebox-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("timebox-row-b")).toBeInTheDocument();
  });

  it("shows a completed task's title struck through", () => {
    render(<TimeboxedTasks tasks={[task({ completed: true })]} />);
    expect(screen.getByText("Write the report").className).toContain("line-through");
  });

  it("has no Clear button when no start time is set", () => {
    render(<TimeboxedTasks tasks={[task({ plannedStartTime: null })]} />);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("has a Clear button when a start time is already set", () => {
    render(<TimeboxedTasks tasks={[task({ plannedStartTime: "09:30" })]} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("has no duration/estimate input anywhere in the row -- only the 12-hour time control (hour / minute / AM-PM), Save, and (conditionally) Clear", () => {
    render(<TimeboxedTasks tasks={[task()]} />);
    const row = screen.getByTestId("timebox-row-t1");
    expect(row.querySelectorAll("input")).toHaveLength(0); // no free-text/number field at all
    expect(row.querySelectorAll("select")).toHaveLength(3); // hour, minute, AM/PM
    expect(row.querySelector('input[type="time"]')).not.toBeInTheDocument(); // the locale-dependent native control is gone
  });

  it("saving calls the Server Action with this task's id and the typed time", async () => {
    const user = userEvent.setup();
    render(<TimeboxedTasks tasks={[task({ plannedStartTime: null })]} />);
    await pickTime12(user, "Planned start time for Write the report", "9:30 AM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(setTaskPlannedStartTimeMock).toHaveBeenCalledWith("t1", "09:30"); // stored 24-hour, shown 12-hour
  });

  it("an afternoon pick is stored as 24-hour (4:15 PM -> 16:15)", async () => {
    const user = userEvent.setup();
    render(<TimeboxedTasks tasks={[task({ plannedStartTime: null })]} />);
    await pickTime12(user, "Planned start time for Write the report", "4:15 PM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(setTaskPlannedStartTimeMock).toHaveBeenLastCalledWith("t1", "16:15");
  });

  it("clearing calls the Server Action with this task's id", async () => {
    const user = userEvent.setup();
    render(<TimeboxedTasks tasks={[task({ plannedStartTime: "09:30" })]} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearTaskPlannedStartTimeMock).toHaveBeenCalledWith("t1");
  });

  it("a save error shows the message and does not clear the typed input", async () => {
    setTaskPlannedStartTimeMock.mockResolvedValueOnce({ ok: false, message: "Couldn't save that start time. Try again." });
    const user = userEvent.setup();
    render(<TimeboxedTasks tasks={[task({ plannedStartTime: null })]} />);
    await pickTime12(user, "Planned start time for Write the report", "9:30 AM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn't save that start time. Try again.")).toBeInTheDocument();
    expect(readTime12("Planned start time for Write the report")).toBe("9:30 AM");
  });
});
