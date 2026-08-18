import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
}));
vi.mock("@/lib/checkins/compute-session-checkin-slots", () => ({
  computeSessionCheckinSlots: () => ({ dueSlot: null, missedSlots: [] }),
}));
vi.mock("@/app/(app)/checkin/actions", () => ({
  recordMissedCheckin: vi.fn(),
  getCheckinOptionsForNow: vi.fn(async () => []),
}));

import { LockInPanel } from "../lock-in-panel";

describe("LockInPanel", () => {
  it("shows the last session's summary when idle and one exists", () => {
    render(
      <LockInPanel
        initialSession={null}
        lastSession={{ startedAtIso: "2026-08-15T14:00:00Z", endedAtIso: "2026-08-15T15:30:00Z" }}
        todayFocusMinutes={0}
      />
    );
    expect(screen.getByText(/Last session: 1h 30m/)).toBeInTheDocument();
  });

  it("shows no last-session line when there isn't one (first-ever session)", () => {
    render(<LockInPanel initialSession={null} lastSession={null} todayFocusMinutes={0} />);
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });

  it("still renders the Lock In button when idle", () => {
    render(<LockInPanel initialSession={null} lastSession={null} todayFocusMinutes={0} />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("does not show the last-session summary once a session is active", () => {
    render(
      <LockInPanel
        initialSession={{ id: "s1", startedAtIso: "2026-08-15T14:00:00Z", checkins: [] }}
        lastSession={{ startedAtIso: "2026-08-14T14:00:00Z", endedAtIso: "2026-08-14T15:00:00Z" }}
        todayFocusMinutes={0}
      />
    );
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });

  it("shows today's focus total when idle — the idle-state design fix, not just a bare button in empty space", () => {
    render(<LockInPanel initialSession={null} lastSession={null} todayFocusMinutes={85} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
  });

  it("shows a real 0m today total rather than omitting it when nothing's logged yet", () => {
    render(<LockInPanel initialSession={null} lastSession={null} todayFocusMinutes={0} />);
    expect(screen.getByText("0m")).toBeInTheDocument();
  });

  it("defaults to showing the today total when showTodayTotal is omitted", () => {
    render(<LockInPanel initialSession={null} lastSession={null} todayFocusMinutes={85} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("hides the today total when a caller already shows it elsewhere (showTodayTotal=false)", () => {
    render(<LockInPanel initialSession={null} lastSession={null} todayFocusMinutes={85} showTodayTotal={false} />);
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByText("1h 25m")).not.toBeInTheDocument();
  });

  it("still shows the Lock In button and last-session line when the today total is hidden", () => {
    render(
      <LockInPanel
        initialSession={null}
        lastSession={{ startedAtIso: "2026-08-15T14:00:00Z", endedAtIso: "2026-08-15T15:30:00Z" }}
        todayFocusMinutes={85}
        showTodayTotal={false}
      />
    );
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
    expect(screen.getByText(/Last session: 1h 30m/)).toBeInTheDocument();
  });
});
