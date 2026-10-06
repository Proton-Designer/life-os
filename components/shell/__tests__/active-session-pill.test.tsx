import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const detailMock = vi.fn(async () => null as null | { id: string; startedAt: string; kind: string; goalMinutes: number | null; objectives: never[] });
const endMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: (...a: unknown[]) => endMock(...a),
  refreshBusinessViews: async () => {},
  getActiveSessionDetail: () => detailMock(),
  setSessionObjectiveCompleted: vi.fn(),
}));

import { ActiveSessionPill } from "../active-session-pill";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";

function Probe() {
  const { session, minimized } = useLockInOverlay();
  return <output data-testid="probe">{session ? `${session.id}:${minimized ? "min" : "open"}` : "none"}</output>;
}
import { renderWithLockIn } from "@/components/business/__tests__/lock-in-overlay-test-utils";

const SESSION = { id: "s1", startedAtIso: new Date(Date.now() - 6 * 60_000).toISOString(), kind: "deep_study" as const, goalMinutes: null, objectives: [] };

describe("ActiveSessionPill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows nothing when no session is running", () => {
    renderWithLockIn(<ActiveSessionPill />, null);
    expect(screen.queryByTestId("active-session-pill")).not.toBeInTheDocument();
  });

  it("says what is running and lets you open or end it, on any screen", async () => {
    const user = userEvent.setup();
    renderWithLockIn(<ActiveSessionPill />, SESSION);
    const pill = await screen.findByTestId("active-session-pill");
    expect(pill).toHaveTextContent("Deep Study");
    expect(pill).toHaveTextContent("in progress");
    await user.click(screen.getByRole("button", { name: "End" }));
    expect(endMock).toHaveBeenCalledWith("s1", undefined);
    await waitFor(() => expect(screen.queryByTestId("active-session-pill")).not.toBeInTheDocument());
  });

  it("finds a session the page didn't know about when the tab comes back, and shows it", async () => {
    renderWithLockIn(<><ActiveSessionPill /><Probe /></>, null);
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
    detailMock.mockResolvedValueOnce({ id: "s9", startedAt: SESSION.startedAtIso, kind: "deep_study", goalMinutes: null, objectives: [] });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    // A session discovered this way opens full screen (not minimized): it must not stay invisible.
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("s9:open"));
  });
});
