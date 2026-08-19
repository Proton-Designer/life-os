import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LockInSession } from "../lock-in-session";

const computeSessionCheckinSlotsMock = vi.fn(
  (..._args: unknown[]) => ({ dueSlot: null as Date | null, missedSlots: [] as Date[] })
);
vi.mock("@/lib/checkins/compute-session-checkin-slots", () => ({
  computeSessionCheckinSlots: (...args: unknown[]) => computeSessionCheckinSlotsMock(...args),
}));

const confirmSessionHourMock = vi.fn();
vi.mock("@/app/(app)/checkin/session-hour-actions", () => ({
  confirmSessionHour: (...args: unknown[]) => confirmSessionHourMock(...args),
}));

const endWorkSessionMock = vi.fn();
vi.mock("@/app/(app)/business/actions", () => ({
  endWorkSession: (...args: unknown[]) => endWorkSessionMock(...args),
}));

describe("LockInSession", () => {
  beforeEach(() => {
    computeSessionCheckinSlotsMock.mockReset().mockReturnValue({ dueSlot: null, missedSlots: [] });
    confirmSessionHourMock.mockReset().mockResolvedValue(undefined);
    endWorkSessionMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders the elapsed time and session ratio in the mono numeral scale", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    expect(screen.getByTestId("lock-in-elapsed").className).toContain("font-mono");
    expect(screen.getByTestId("lock-in-session-ratio").className).toContain("font-mono");
  });

  it("gives the session card a featured gradient wash and a business icon chip", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    const card = screen.getByTestId("lock-in-session");
    expect(card.style.backgroundImage).toContain("--accent-business");
    expect(card.style.backgroundColor).toBe("var(--card)");
    expect(card.querySelector("svg")).toBeInTheDocument();
  });

  it("shows a positive badge for a confirmed 'Still on it' hour and a warning badge for 'Not really'", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[
          { hourStartIso: "2026-08-15T13:00:00.000Z", stillOnIt: true },
          { hourStartIso: "2026-08-15T14:00:00.000Z", stillOnIt: false },
        ]}
        sessionSignalMinutes={60}
        sessionNoiseMinutes={60}
        onEnded={() => {}}
      />
    );
    expect(screen.getByText("Still on it")).toHaveClass("text-accent-business");
    expect(screen.getByText("Not really")).toHaveClass("text-accent-warning");
  });

  // 2026-08-19: the ratio must come from real allocation minutes written by
  // confirmSessionHour, not re-derived client-side from the activity log.
  it("computes the session ratio from sessionSignalMinutes/sessionNoiseMinutes props directly", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[{ hourStartIso: "2026-08-15T13:00:00.000Z", stillOnIt: true }]}
        sessionSignalMinutes={90}
        sessionNoiseMinutes={30}
        onEnded={() => {}}
      />
    );
    expect(screen.getByTestId("lock-in-session-ratio")).toHaveTextContent("3.0 : 1");
  });

  it("shows 'No data' when nothing has been confirmed yet", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    expect(screen.getByTestId("lock-in-session-ratio")).toHaveTextContent("No data");
  });

  it("shows the one-tap hourly confirm — 'Still on it?' with Yes/No, not a heavier picker — when an hour is due", () => {
    computeSessionCheckinSlotsMock.mockReturnValue({ dueSlot: new Date("2026-08-15T13:00:00.000Z"), missedSlots: [] });
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    expect(screen.getByTestId("session-hour-confirm")).toBeInTheDocument();
    expect(screen.getByText("Still on it?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not really" })).toBeInTheDocument();
  });

  it("writes the confirmed hour via confirmSessionHour on 'Yes', not the legacy point-sample action", async () => {
    computeSessionCheckinSlotsMock.mockReturnValue({ dueSlot: new Date("2026-08-15T13:00:00.000Z"), missedSlots: [] });
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(confirmSessionHourMock).toHaveBeenCalledWith("s1", "2026-08-15T13:00:00.000Z", true);
    expect(screen.getByText("Still on it")).toBeInTheDocument(); // now in the activity log
    expect(screen.queryByTestId("session-hour-confirm")).not.toBeInTheDocument(); // dismissed after answering
  });

  it("offers to end the session after 'Not really', without forcing it", async () => {
    computeSessionCheckinSlotsMock.mockReturnValue({ dueSlot: new Date("2026-08-15T13:00:00.000Z"), missedSlots: [] });
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Not really" }));

    expect(confirmSessionHourMock).toHaveBeenCalledWith("s1", "2026-08-15T13:00:00.000Z", false);
    expect(screen.getByText("End the session?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep going" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.queryByText("End the session?")).not.toBeInTheDocument();
  });

  it("shows a missed-hour count without writing anything for it", () => {
    computeSessionCheckinSlotsMock.mockReturnValue({
      dueSlot: null,
      missedSlots: [new Date("2026-08-15T13:00:00.000Z")],
    });
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialConfirmedHours={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    expect(screen.getByText("1 unconfirmed")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toHaveClass("text-muted-foreground");
    expect(confirmSessionHourMock).not.toHaveBeenCalled();
  });
});
