import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
}));
vi.mock("@/lib/checkins/session-hour-status", () => ({
  resolveSessionHours: () => [],
  pendingSessionHour: () => null,
}));

import { startWorkSession } from "@/app/(app)/business/actions";
import { LockInPanel } from "../lock-in-panel";
import { renderWithLockIn } from "./lock-in-overlay-test-utils";

describe("LockInPanel", () => {
  it("shows the Lock In button when idle", () => {
    renderWithLockIn(<LockInPanel initialSessionId={null} initialStoredHours={[]} todayFocusMinutes={0} timezone="UTC" />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("shows today's focus total when idle — the idle-state design fix, not just a bare button in empty space", () => {
    renderWithLockIn(
      <LockInPanel initialSessionId={null} initialStoredHours={[]} todayFocusMinutes={85} timezone="UTC" />
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
  });

  it("shows a real 0m today total rather than omitting it when nothing's logged yet", () => {
    renderWithLockIn(<LockInPanel initialSessionId={null} initialStoredHours={[]} todayFocusMinutes={0} timezone="UTC" />);
    expect(screen.getByText("0m")).toBeInTheDocument();
  });

  it("defaults to showing the today total when showTodayTotal is omitted", () => {
    renderWithLockIn(
      <LockInPanel initialSessionId={null} initialStoredHours={[]} todayFocusMinutes={85} timezone="UTC" />
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("hides the today total when a caller already shows it elsewhere (showTodayTotal=false)", () => {
    renderWithLockIn(
      <LockInPanel
        initialSessionId={null}
        initialStoredHours={[]}
        todayFocusMinutes={85}
        timezone="UTC"
        showTodayTotal={false}
      />
    );
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByText("1h 25m")).not.toBeInTheDocument();
  });

  it("still shows the Lock In button when the today total is hidden", () => {
    renderWithLockIn(
      <LockInPanel
        initialSessionId={null}
        initialStoredHours={[]}
        todayFocusMinutes={85}
        timezone="UTC"
        showTodayTotal={false}
      />
    );
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("renders the active session view instead of the idle button once a deep_work session is active", () => {
    renderWithLockIn(
      <LockInPanel initialSessionId="s1" initialStoredHours={[]} todayFocusMinutes={0} timezone="UTC" />,
      { id: "s1", startedAtIso: "2026-08-15T14:00:00Z", kind: "deep_work" }
    );
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("disables Lock In and explains why when a Deep Study session is running elsewhere (2026-08-24 fix — the guard blocks either kind)", () => {
    renderWithLockIn(
      <LockInPanel initialSessionId={null} initialStoredHours={[]} todayFocusMinutes={0} timezone="UTC" />,
      { id: "s1", startedAtIso: "2026-08-15T14:00:00Z", kind: "deep_study" }
    );
    expect(screen.getByText(/Deep Study in progress/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock In" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "finish it on Home" })).toHaveAttribute("href", "/");
  });

  it("shows a legible message instead of crashing when startWorkSession still throws (a race the guard lost)", async () => {
    vi.mocked(startWorkSession).mockRejectedValue(new Error("A work session is already active"));
    const user = userEvent.setup();
    renderWithLockIn(<LockInPanel initialSessionId={null} initialStoredHours={[]} todayFocusMinutes={0} timezone="UTC" />);

    await user.click(screen.getByRole("button", { name: "Lock In" }));

    await waitFor(() => {
      expect(screen.getByText(/already running/)).toBeInTheDocument();
    });
  });
});
