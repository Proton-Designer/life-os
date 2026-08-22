import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
}));
vi.mock("@/lib/checkins/session-hour-status", () => ({
  resolveSessionHours: () => [],
  pendingSessionHour: () => null,
}));

import { LockInPanel } from "../lock-in-panel";

describe("LockInPanel", () => {
  it("shows the Lock In button when idle", () => {
    render(<LockInPanel initialSession={null} todayFocusMinutes={0} timezone="UTC" />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("shows today's focus total when idle — the idle-state design fix, not just a bare button in empty space", () => {
    render(<LockInPanel initialSession={null} todayFocusMinutes={85} timezone="UTC" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
  });

  it("shows a real 0m today total rather than omitting it when nothing's logged yet", () => {
    render(<LockInPanel initialSession={null} todayFocusMinutes={0} timezone="UTC" />);
    expect(screen.getByText("0m")).toBeInTheDocument();
  });

  it("defaults to showing the today total when showTodayTotal is omitted", () => {
    render(<LockInPanel initialSession={null} todayFocusMinutes={85} timezone="UTC" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("hides the today total when a caller already shows it elsewhere (showTodayTotal=false)", () => {
    render(<LockInPanel initialSession={null} todayFocusMinutes={85} timezone="UTC" showTodayTotal={false} />);
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByText("1h 25m")).not.toBeInTheDocument();
  });

  it("still shows the Lock In button when the today total is hidden", () => {
    render(<LockInPanel initialSession={null} todayFocusMinutes={85} timezone="UTC" showTodayTotal={false} />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("renders the active session view instead of the idle button once a session is active", () => {
    render(
      <LockInPanel
        initialSession={{ id: "s1", startedAtIso: "2026-08-15T14:00:00Z", storedHours: [] }}
        todayFocusMinutes={0}
        timezone="UTC"
      />
    );
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });
});
