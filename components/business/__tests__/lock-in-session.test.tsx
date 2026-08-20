import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LockInSession } from "../lock-in-session";

const resolveSessionHoursMock = vi.fn();
const pendingSessionHourMock = vi.fn();
vi.mock("@/lib/checkins/session-hour-status", () => ({
  resolveSessionHours: (...args: unknown[]) => resolveSessionHoursMock(...args),
  pendingSessionHour: (...args: unknown[]) => pendingSessionHourMock(...args),
}));

const setSessionHourStatusMock = vi.fn();
vi.mock("@/app/(app)/checkin/session-hour-actions", () => ({
  setSessionHourStatus: (...args: unknown[]) => setSessionHourStatusMock(...args),
}));

const endWorkSessionMock = vi.fn();
vi.mock("@/app/(app)/business/actions", () => ({
  endWorkSession: (...args: unknown[]) => endWorkSessionMock(...args),
}));

function renderSession(overrides: Partial<React.ComponentProps<typeof LockInSession>> = {}) {
  return render(
    <LockInSession
      sessionId="s1"
      startedAtIso="2026-08-15T12:00:00.000Z"
      initialStoredHours={[]}
      timezone="UTC"
      onEnded={() => {}}
      {...overrides}
    />
  );
}

describe("LockInSession", () => {
  beforeEach(() => {
    resolveSessionHoursMock.mockReset().mockReturnValue([]);
    pendingSessionHourMock.mockReset().mockReturnValue(null);
    setSessionHourStatusMock.mockReset().mockResolvedValue(undefined);
    endWorkSessionMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders the elapsed time and session ratio in the mono numeral scale", () => {
    renderSession();
    expect(screen.getByTestId("lock-in-elapsed").className).toContain("font-mono");
    expect(screen.getByTestId("lock-in-session-ratio").className).toContain("font-mono");
  });

  it("gives the session card a featured gradient wash and a business icon chip", () => {
    renderSession();
    const card = screen.getByTestId("lock-in-session");
    expect(card.style.backgroundImage).toContain("--accent-business");
    expect(card.style.backgroundColor).toBe("var(--card)");
    expect(card.querySelector("svg")).toBeInTheDocument();
  });

  it("shows 'No data' when nothing is resolved yet", () => {
    resolveSessionHoursMock.mockReturnValue([]);
    renderSession();
    expect(screen.getByTestId("lock-in-session-ratio")).toHaveTextContent("No data");
  });

  // 2026-08-19 ruling: the ratio is derived from resolved hour STATE, not
  // just explicit answers — a missed hour counts as noise the moment it's
  // superseded, which is the entire point of the reversal.
  it("computes the session ratio from resolved hours, counting a missed hour as noise", () => {
    resolveSessionHoursMock.mockReturnValue([
      { hourStartIso: "2026-08-15T13:00:00.000Z", state: "confirmed_business" },
      { hourStartIso: "2026-08-15T14:00:00.000Z", state: "confirmed_business" },
      { hourStartIso: "2026-08-15T15:00:00.000Z", state: "confirmed_business" },
      { hourStartIso: "2026-08-15T16:00:00.000Z", state: "missed_wasted" },
    ]);
    renderSession();
    // 3 business hours (180m signal) : 1 missed hour (60m noise) = 3.0 : 1
    expect(screen.getByTestId("lock-in-session-ratio")).toHaveTextContent("3.0 : 1");
  });

  it("shows the one-tap hourly confirm — 'Still on it?' with Yes/No — when an hour is due", () => {
    pendingSessionHourMock.mockReturnValue("2026-08-15T13:00:00.000Z");
    renderSession();
    expect(screen.getByTestId("session-hour-confirm")).toBeInTheDocument();
    expect(screen.getByText("Still on it?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not really" })).toBeInTheDocument();
  });

  it("writes the confirmed hour via setSessionHourStatus on 'Yes', dismissing the confirm once it's no longer due", async () => {
    // Real pendingSessionHour is reactive to storedHours — an hour that's
    // just been answered is no longer due. Mirror that instead of a static
    // mock, or this test can't actually see the dismiss-after-answer bug.
    pendingSessionHourMock.mockImplementation((_session, _interval, _now, storedHours) =>
      storedHours.some((h: { hourStartIso: string }) => h.hourStartIso === "2026-08-15T13:00:00.000Z")
        ? null
        : "2026-08-15T13:00:00.000Z"
    );
    renderSession();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(setSessionHourStatusMock).toHaveBeenCalledWith("s1", "2026-08-15T13:00:00.000Z", "business");
    expect(screen.queryByTestId("session-hour-confirm")).not.toBeInTheDocument(); // dismissed after answering
  });

  it("offers to end the session after 'Not really', without forcing it", async () => {
    pendingSessionHourMock.mockReturnValue("2026-08-15T13:00:00.000Z");
    renderSession();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Not really" }));

    expect(setSessionHourStatusMock).toHaveBeenCalledWith("s1", "2026-08-15T13:00:00.000Z", "wasted");
    expect(screen.getByText("End the session?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep going" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.queryByText("End the session?")).not.toBeInTheDocument();
  });

  it("shows an unconfirmed count sourced from missed_wasted hours, writing nothing for them", () => {
    resolveSessionHoursMock.mockReturnValue([
      { hourStartIso: "2026-08-15T13:00:00.000Z", state: "missed_wasted" },
    ]);
    renderSession();
    expect(screen.getByText("1 unconfirmed")).toBeInTheDocument();
    expect(setSessionHourStatusMock).not.toHaveBeenCalled();
  });

  it("renders the resolved hours through SessionHourList, editable via the same 'Still on it'/'Not really' vocabulary", async () => {
    resolveSessionHoursMock.mockReturnValue([
      { hourStartIso: "2026-08-15T13:00:00.000Z", state: "missed_wasted" },
    ]);
    renderSession();
    const user = userEvent.setup();
    const row = screen.getByTestId("session-hour-row-2026-08-15T13:00:00.000Z");
    await user.click(row.querySelector('button[aria-label="Still on it"]')!);
    expect(setSessionHourStatusMock).toHaveBeenCalledWith("s1", "2026-08-15T13:00:00.000Z", "business");
  });

  it("calls resolveSessionHours/pendingSessionHour with the session as still-open (endedAt: null)", () => {
    renderSession();
    expect(resolveSessionHoursMock).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: null }),
      60,
      expect.any(Date),
      []
    );
    expect(pendingSessionHourMock).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: null }),
      60,
      expect.any(Date),
      []
    );
  });
});
