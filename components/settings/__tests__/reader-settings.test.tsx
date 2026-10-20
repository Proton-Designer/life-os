import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const update = vi.fn();
vi.mock("@/app/(app)/personal/reader-actions", () => ({ updateReaderSettings: (...a: unknown[]) => update(...a) }));

import { ReaderSettings, parseWholeNumber } from "../reader-settings";

const initial = { wpm: 300, dailyWordGoal: null, focalLines: true };

beforeEach(() => {
  update.mockReset();
  update.mockResolvedValue({ ok: true });
});

describe("parseWholeNumber", () => {
  it("accepts blank as unset, in-range ints, and rejects the rest", () => {
    expect(parseWholeNumber("  ", 1, 10)).toBeNull();
    expect(parseWholeNumber("5", 1, 10)).toBe(5);
    for (const bad of ["0", "11", "2.5", "-3", "1e3", "abc"]) expect(parseWholeNumber(bad, 1, 10), bad).toBe("invalid");
  });
});

describe("ReaderSettings", () => {
  it("links to the reading speed test", () => {
    render(<ReaderSettings initial={initial} />);
    expect(screen.getByTestId("settings-speed-test-link")).toHaveAttribute("href", "/read/speed-test");
  });

  it("saves the three values in one patch, blank goal as null", async () => {
    render(<ReaderSettings initial={initial} />);
    fireEvent.change(screen.getByLabelText("Reading speed in words per minute"), { target: { value: "450" } });
    fireEvent.click(screen.getByLabelText("Highlight the focal letter"));
    fireEvent.click(screen.getByText("Save reading settings"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved."));
    expect(update).toHaveBeenCalledWith({ wpm: 450, dailyWordGoal: null, focalLines: false });
  });

  it("sends a numeric goal", async () => {
    render(<ReaderSettings initial={initial} />);
    fireEvent.change(screen.getByLabelText("Daily reading goal in words"), { target: { value: "2000" } });
    fireEvent.click(screen.getByText("Save reading settings"));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toEqual({ wpm: 300, dailyWordGoal: 2000, focalLines: true });
  });

  it("rejects an out-of-range speed without calling the server", () => {
    render(<ReaderSettings initial={initial} />);
    fireEvent.change(screen.getByLabelText("Reading speed in words per minute"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save reading settings"));
    expect(screen.getByRole("status").textContent).toMatch(/100 to 1000/);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a decimal goal without calling the server", () => {
    render(<ReaderSettings initial={initial} />);
    fireEvent.change(screen.getByLabelText("Daily reading goal in words"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByText("Save reading settings"));
    expect(screen.getByRole("status").textContent).toMatch(/whole number/);
    expect(update).not.toHaveBeenCalled();
  });

  it("shows the server's message when the save is refused", async () => {
    update.mockResolvedValue({ ok: false, message: "Nope." });
    render(<ReaderSettings initial={initial} />);
    fireEvent.click(screen.getByText("Save reading settings"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Nope."));
  });
});
