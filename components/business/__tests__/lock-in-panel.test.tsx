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
      />
    );
    expect(screen.getByText(/Last session: 1h 30m/)).toBeInTheDocument();
  });

  it("shows no last-session line when there isn't one (first-ever session)", () => {
    render(<LockInPanel initialSession={null} lastSession={null} />);
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });

  it("still renders the Lock In button when idle", () => {
    render(<LockInPanel initialSession={null} lastSession={null} />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("does not show the last-session summary once a session is active", () => {
    render(
      <LockInPanel
        initialSession={{ id: "s1", startedAtIso: "2026-08-15T14:00:00Z", checkins: [] }}
        lastSession={{ startedAtIso: "2026-08-14T14:00:00Z", endedAtIso: "2026-08-14T15:00:00Z" }}
      />
    );
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });
});
