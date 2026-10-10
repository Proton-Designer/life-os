import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
}));

import { startWorkSession } from "@/app/(app)/business/actions";
import { LockInPanel } from "../lock-in-panel";
import { renderWithLockIn } from "./lock-in-overlay-test-utils";

describe("LockInPanel", () => {
  it("shows the Lock In button when idle", () => {
    renderWithLockIn(<LockInPanel todayFocusMinutes={0} />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("shows today's focus total when idle — the idle-state design fix, not just a bare button in empty space", () => {
    renderWithLockIn(<LockInPanel todayFocusMinutes={85} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
  });

  it("shows a real 0m today total rather than omitting it when nothing's logged yet", () => {
    renderWithLockIn(<LockInPanel todayFocusMinutes={0} />);
    expect(screen.getByText("0m")).toBeInTheDocument();
  });

  it("defaults to showing the today total when showTodayTotal is omitted", () => {
    renderWithLockIn(<LockInPanel todayFocusMinutes={85} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("hides the today total when a caller already shows it elsewhere (showTodayTotal=false)", () => {
    renderWithLockIn(
      <LockInPanel
       
        todayFocusMinutes={85}
        showTodayTotal={false}
      />
    );
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByText("1h 25m")).not.toBeInTheDocument();
  });

  it("still shows the Lock In button when the today total is hidden", () => {
    renderWithLockIn(
      <LockInPanel
       
        todayFocusMinutes={85}
        showTodayTotal={false}
      />
    );
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("renders the active session view instead of the idle button once a deep_work session is active", () => {
    renderWithLockIn(
      <LockInPanel todayFocusMinutes={0} />,
      { id: "s1", startedAtIso: "2026-08-15T14:00:00Z", kind: "deep_work", goalMinutes: null, objectives: [] }
    );
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("disables Lock In and explains why when a Deep Study session is running elsewhere (2026-08-24 fix — the guard blocks either kind)", () => {
    renderWithLockIn(
      <LockInPanel todayFocusMinutes={0} />,
      { id: "s1", startedAtIso: "2026-08-15T14:00:00Z", kind: "deep_study", goalMinutes: null, objectives: [] }
    );
    expect(screen.getByText(/Deep Study in progress/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock In" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "finish it on Home" })).toHaveAttribute("href", "/");
  });

  // 146/Phase 3: "Lock In" no longer starts a session on tap — it opens the
  // setup dialog (mounted centrally, SessionSetupDialogHost, not by this
  // panel), and startWorkSession only fires once that dialog's Start is
  // pressed. The race this test used to cover (startWorkSession throwing
  // "already active" and surfacing the message inline) can no longer be
  // triggered by a bare click here — it's exercised at the provider level
  // instead (lock-in-overlay-context.test.tsx's "propagates a
  // startWorkSession failure to the caller AND sets the context error").
  // What THIS test can still usefully assert: the click itself stays a pure,
  // synchronous local-state change — no network call, no crash, no stray
  // error rendered from a call that never happened.
  it("opens the setup dialog on tap rather than starting a session immediately — no startWorkSession call, no error", async () => {
    const user = userEvent.setup();
    renderWithLockIn(<LockInPanel todayFocusMinutes={0} />);

    await user.click(screen.getByRole("button", { name: "Lock In" }));

    expect(startWorkSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/already running/)).not.toBeInTheDocument();
  });
});
