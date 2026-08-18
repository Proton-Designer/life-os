import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const logMock = vi.fn();
const decrementMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  logReflectionEntry: (...args: unknown[]) => logMock(...args),
  decrementReflectionEntry: (...args: unknown[]) => decrementMock(...args),
}));

import { ReflectionTracker } from "../reflection-tracker";

describe("ReflectionTracker", () => {
  beforeEach(() => {
    logMock.mockReset();
    decrementMock.mockReset();
  });

  it("names the three weights legibly — no abstract glyphs", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Heavy")).toBeInTheDocument();
  });

  it("moves the count immediately on tap, before the server action resolves — the lag bug this redesign fixes", async () => {
    logMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Light/i }));

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(logMock).toHaveBeenCalledWith(1);
  });

  it("hides undo when a tier's count is zero", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
  });

  it("shows a persistent, labeled undo the moment a tier's count is above zero — not a hidden minus sign", async () => {
    logMock.mockImplementation(() => new Promise(() => {}));
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Light/i }));

    const undoButtons = screen.getAllByRole("button", { name: /undo/i });
    expect(undoButtons.length).toBeGreaterThan(0);
  });

  it("undo removes optimistically, before the server action resolves", async () => {
    decrementMock.mockImplementation(() => new Promise(() => {}));
    render(
      <ReflectionTracker
        entries={[{ date: "2026-08-15", tier: 1, createdAt: "2026-08-15T12:00:00Z" }]}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: /undo/i })[0]);

    expect(decrementMock).toHaveBeenCalledWith(1);
    expect(screen.queryAllByRole("button", { name: /undo/i })).toHaveLength(0);
  });

  it("states its own reset and retention behavior in one line", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/midnight/i)).toBeInTheDocument();
    expect(screen.getByText(/never deleted/i)).toBeInTheDocument();
  });

  it("composes the 30-day intensity strip, not the old sparklines", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/of the last 30 days clear/)).toBeInTheDocument();
  });

  it("composes the time-of-day view", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/not enough/i)).toBeInTheDocument();
  });

  it("never mentions sin or severity anywhere in visible text or aria-labels — privacy is a hard constraint", () => {
    const { container } = render(
      <ReflectionTracker
        entries={[{ date: "2026-08-15", tier: 3, createdAt: "2026-08-15T12:00:00Z" }]}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
    const text = container.textContent?.toLowerCase() ?? "";
    const ariaLabels = Array.from(container.querySelectorAll("[aria-label]")).map((el) =>
      (el.getAttribute("aria-label") ?? "").toLowerCase()
    );
    for (const banned of ["sin", "severity", "severe"]) {
      expect(text).not.toContain(banned);
      for (const label of ariaLabels) expect(label).not.toContain(banned);
    }
  });

  it("gives every tap target a real minimum size (44px) — the whole tile, not a small inner glyph", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" timezone="UTC" />);
    const lightButton = screen.getByRole("button", { name: /Light/i });
    expect(lightButton.className).toMatch(/min-h-11/);
  });
});
