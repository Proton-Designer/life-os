import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LockInSession } from "../lock-in-session";

// LockInSession renders EndOfHourReflection (P3-05), which derives its own visibility from getEndOfHourEntryState() --
// mocked flag-OFF by default (the flag's own real default) so it renders nothing here.
// end-of-hour-reflection.test.tsx covers that component's own behavior directly.
vi.mock("@/app/(app)/personal/reflection-cards-actions", () => ({
  getEndOfHourEntryState: vi.fn(async () => ({ enabled: false, hasCards: false })),
  startEndOfHourRitual: vi.fn(),
  submitEndOfHourReflection: vi.fn(),
}));

// Ending is centralized in the Lock-In overlay provider (batch 3) — LockInSession delegates to whatever onEndSession
// the caller passes in.
const onEndSessionMock = vi.fn();

function renderSession(overrides: Partial<React.ComponentProps<typeof LockInSession>> = {}) {
  return render(
    <LockInSession startedAtIso="2026-08-15T12:00:00.000Z" onEndSession={onEndSessionMock} onExpand={() => {}} {...overrides} />
  );
}

describe("LockInSession", () => {
  beforeEach(() => {
    onEndSessionMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders the elapsed time in the mono numeral scale", () => {
    renderSession();
    expect(screen.getByTestId("lock-in-elapsed").className).toContain("font-mono");
  });

  it("gives the session card a featured gradient wash and a business icon chip", () => {
    renderSession();
    const card = screen.getByTestId("lock-in-session");
    expect(card.style.backgroundImage).toContain("--accent-business");
    expect(card.style.backgroundColor).toBe("var(--card)");
    expect(card.querySelector("svg")).toBeInTheDocument();
  });

  // Deep sessions account for themselves: nothing is asked mid-session, and no hour can turn into Wasted.
  it("never asks anything mid-session: no hourly confirm, no per-session ratio, no unconfirmed count", () => {
    renderSession();
    expect(screen.queryByTestId("session-hour-confirm")).not.toBeInTheDocument();
    expect(screen.queryByText("Still on it?")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lock-in-session-ratio")).not.toBeInTheDocument();
    expect(screen.queryByText(/unconfirmed/)).not.toBeInTheDocument();
  });

  it("delegates ending the session to onEndSession rather than calling endWorkSession itself", async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(onEndSessionMock).toHaveBeenCalledTimes(1);
  });

  it("calls onExpand when the Expand button is pressed", async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    renderSession({ onExpand });
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  describe("Hour-completion banner (Phase 2 #P2-04)", () => {
    it("shows once the session has run 60+ minutes (the default fixture's startedAtIso is long past that)", () => {
      renderSession();
      expect(screen.getByTestId("hour-complete-banner")).toBeInTheDocument();
    });

    it("does not show for a freshly started session", () => {
      renderSession({ startedAtIso: new Date().toISOString() });
      expect(screen.queryByTestId("hour-complete-banner")).not.toBeInTheDocument();
    });
  });
});
