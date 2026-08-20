import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionHourList, type ResolvedSessionHour } from "../session-hour-list";

const HOURS: ResolvedSessionHour[] = [
  { hourStartIso: "2026-08-19T13:00:00.000Z", state: "confirmed_business" },
  { hourStartIso: "2026-08-19T14:00:00.000Z", state: "confirmed_wasted" },
  { hourStartIso: "2026-08-19T15:00:00.000Z", state: "missed_wasted" },
];

describe("SessionHourList", () => {
  it("renders one row per hour, in order", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("never renders a pending row — that's SessionHourConfirm's job, not this list's", () => {
    render(
      <SessionHourList
        hours={[...HOURS, { hourStartIso: "2026-08-19T16:00:00.000Z", state: "pending" }]}
        onEdit={vi.fn()}
        timezone="UTC"
      />
    );
    // Still exactly 3 real rows; the pending one must be silently skipped, not rendered as a 4th.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows 'Not confirmed' only for a missed/derived hour — not an accusation, per spec", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    expect(screen.getAllByText("Not confirmed")).toHaveLength(1);
  });

  it("never renders the word 'Missed' — spec explicitly rejects that framing", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    expect(screen.queryByText(/missed/i)).not.toBeInTheDocument();
  });

  it("marks the confirmed choice as pressed and leaves the other outline, per row", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    const businessRow = screen.getByTestId("session-hour-row-2026-08-19T13:00:00.000Z");
    expect(businessRow.querySelector('button[aria-label="Still on it"]')).toHaveAttribute("aria-pressed", "true");
    expect(businessRow.querySelector('button[aria-label="Not really"]')).toHaveAttribute("aria-pressed", "false");

    const wastedRow = screen.getByTestId("session-hour-row-2026-08-19T14:00:00.000Z");
    expect(wastedRow.querySelector('button[aria-label="Still on it"]')).toHaveAttribute("aria-pressed", "false");
    expect(wastedRow.querySelector('button[aria-label="Not really"]')).toHaveAttribute("aria-pressed", "true");
  });

  it("a missed/derived hour has neither button marked pressed — nothing was actually confirmed", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    const missedRow = screen.getByTestId("session-hour-row-2026-08-19T15:00:00.000Z");
    expect(missedRow.querySelector('button[aria-label="Still on it"]')).toHaveAttribute("aria-pressed", "false");
    expect(missedRow.querySelector('button[aria-label="Not really"]')).toHaveAttribute("aria-pressed", "false");
  });

  it("tapping 'Still on it' edits that hour to business", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<SessionHourList hours={HOURS} onEdit={onEdit} timezone="UTC" />);
    const missedRow = screen.getByTestId("session-hour-row-2026-08-19T15:00:00.000Z");
    await user.click(missedRow.querySelector('button[aria-label="Still on it"]')!);
    expect(onEdit).toHaveBeenCalledWith("2026-08-19T15:00:00.000Z", "business");
  });

  it("tapping 'Not really' edits that hour to wasted, even for an already-business hour", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<SessionHourList hours={HOURS} onEdit={onEdit} timezone="UTC" />);
    const businessRow = screen.getByTestId("session-hour-row-2026-08-19T13:00:00.000Z");
    await user.click(businessRow.querySelector('button[aria-label="Not really"]')!);
    expect(onEdit).toHaveBeenCalledWith("2026-08-19T13:00:00.000Z", "wasted");
  });

  it("the edit affordance is always visible, never hidden behind hover or long-press", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeVisible();
    }
  });

  it("meets the 44px minimum tap target on every toggle button", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/min-h-11/);
    }
  });

  it("disables every button when disabled is passed, e.g. while an edit is in flight", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" disabled />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("renders nothing (no list) when hours is empty", () => {
    render(<SessionHourList hours={[]} onEdit={vi.fn()} timezone="UTC" />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("never uses a destructive/red treatment for a wasted hour, confirmed or missed", () => {
    render(<SessionHourList hours={HOURS} onEdit={vi.fn()} timezone="UTC" />);
    expect(document.body.innerHTML).not.toMatch(/destructive/i);
  });

  // Regression (Opus Lead audit, 2026-08-20): this was rendering in
  // whatever timezone the RUNTIME happened to be in, not the user's
  // profile timezone — invisible while they agree, but wrong for a
  // traveling user or any account (SEED is Europe/London) whose profile
  // differs from the host clock. hourStartIso is a real moment in time
  // (unlike Fitness's plain calendar-date bug), so the fix is threading
  // the profile timezone through, not pinning UTC.
  it("formats each hour's time against the passed timezone, not the runtime's local zone", () => {
    render(
      <SessionHourList
        hours={[{ hourStartIso: "2026-08-19T23:00:00.000Z", state: "confirmed_business" }]}
        onEdit={vi.fn()}
        timezone="Asia/Tokyo"
      />
    );
    // 23:00 UTC is 08:00 the next day in Tokyo (UTC+9) — if this instead
    // read the runtime's local zone, it would show some other hour.
    expect(screen.getByText("8:00 AM")).toBeInTheDocument();
  });
});
