import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const startWorkSessionMock = vi.fn(async (_input: unknown) => ({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z" }));
const endWorkSessionMock = vi.fn(async (_id: string, _endedAtIso?: string) => {});
const toggleSessionObjectiveMock = vi.fn(async (_id: string) => {});
const getActiveSessionDetailMock = vi.fn(async () => null as null | {
  id: string;
  startedAt: string;
  kind: "deep_work" | "deep_study";
  goalMinutes: number | null;
  objectives: { id: string; kind: "kill_list_item" | "task" | "custom"; label: string; completed: boolean; refId: string | null }[];
});
vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: (input: unknown) => startWorkSessionMock(input),
  endWorkSession: (id: string, endedAtIso?: string) => endWorkSessionMock(id, endedAtIso),
  toggleSessionObjective: (id: string) => toggleSessionObjectiveMock(id),
  getActiveSessionDetail: () => getActiveSessionDetailMock(),
}));

import { LockInOverlayProvider, useLockInOverlay, type ActiveWorkSession } from "../lock-in-overlay-context";

function Harness() {
  const { session, setupOpen, pendingKind, isPending, error, startSession, confirmSessionStart, endSession, toggleObjective } =
    useLockInOverlay();
  return (
    <div>
      <div data-testid="session">{session ? JSON.stringify(session) : "null"}</div>
      <div data-testid="setupOpen">{String(setupOpen)}</div>
      <div data-testid="pendingKind">{pendingKind ?? "null"}</div>
      <div data-testid="isPending">{String(isPending)}</div>
      <div data-testid="error">{error ?? "null"}</div>
      <button onClick={() => startSession("deep_work")}>open-deep-work</button>
      <button
        onClick={() =>
          confirmSessionStart({ goalMinutes: 30, classId: null, objectives: [] }).catch((e) => {
            document.title = `confirm-error: ${e instanceof Error ? e.message : String(e)}`;
          })
        }
      >
        confirm
      </button>
      <button onClick={() => void endSession()}>end</button>
      <button onClick={() => toggleObjective("obj-1")}>toggle-obj-1</button>
    </div>
  );
}

function renderHarness(initialSession: ActiveWorkSession | null = null) {
  render(
    <LockInOverlayProvider initialSession={initialSession}>
      <Harness />
    </LockInOverlayProvider>
  );
}

function objective(overrides: Partial<{ id: string; kind: "kill_list_item" | "task" | "custom"; label: string; completed: boolean; refId: string | null }> = {}) {
  return { id: "obj-1", kind: "custom" as const, label: "Finish it", completed: false, refId: null, ...overrides };
}

describe("LockInOverlayProvider", () => {
  beforeEach(() => {
    startWorkSessionMock.mockClear();
    endWorkSessionMock.mockClear();
    toggleSessionObjectiveMock.mockClear();
    getActiveSessionDetailMock.mockClear();
    startWorkSessionMock.mockResolvedValue({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z" });
    endWorkSessionMock.mockResolvedValue(undefined);
    toggleSessionObjectiveMock.mockResolvedValue(undefined);
  });

  describe("startSession opens the setup dialog rather than starting immediately", () => {
    it("sets pendingKind and setupOpen without calling startWorkSession", async () => {
      renderHarness();
      const user = userEvent.setup();
      await user.click(screen.getByText("open-deep-work"));
      expect(screen.getByTestId("setupOpen")).toHaveTextContent("true");
      expect(screen.getByTestId("pendingKind")).toHaveTextContent("deep_work");
      expect(startWorkSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("confirmSessionStart", () => {
    it("starts the session with the mapped objectives, then loads the full detail", async () => {
      // Fake timers, pinned 5 minutes into a 30-minute goal: this test is
      // about the start/detail-load flow, not auto-end — without pinning
      // the clock, `startedAt` (a fixed past instant) racing the REAL
      // wall-clock would let the goal-reached effect fire immediately and
      // null the session right back out from under this assertion.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-09-10T18:05:00.000Z"));
      getActiveSessionDetailMock.mockResolvedValue({
        id: "s1",
        startedAt: "2026-09-10T18:00:00.000Z",
        kind: "deep_work",
        goalMinutes: 30,
        objectives: [objective()],
      });
      renderHarness();
      const user = userEvent.setup();
      await user.click(screen.getByText("open-deep-work"));
      await user.click(screen.getByText("confirm"));

      await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("s1"));
      expect(startWorkSessionMock).toHaveBeenCalledWith({ kind: "deep_work", goalMinutes: 30, classId: null, objectives: [] });
      expect(getActiveSessionDetailMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("session")).toHaveTextContent("goalMinutes\":30");
      vi.useRealTimers();
    });

    it("maps each ObjectiveSelection kind to the core's StartSessionObjectiveInput shape", async () => {
      getActiveSessionDetailMock.mockResolvedValue({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z", kind: "deep_study", goalMinutes: 45, objectives: [] });

      function MappingHarness() {
        const { startSession, confirmSessionStart } = useLockInOverlay();
        return (
          <>
            <button onClick={() => startSession("deep_study")}>open</button>
            <button
              onClick={() =>
                confirmSessionStart({
                  goalMinutes: 45,
                  classId: "c1",
                  objectives: [
                    { kind: "kill_list_item", id: "k1" },
                    { kind: "task", id: "t1" },
                    { kind: "custom", text: "Draft the outline" },
                  ],
                })
              }
            >
              confirm-mapped
            </button>
          </>
        );
      }
      render(
        <LockInOverlayProvider initialSession={null}>
          <MappingHarness />
        </LockInOverlayProvider>
      );
      const user = userEvent.setup();
      await user.click(screen.getByText("open"));
      await user.click(screen.getByText("confirm-mapped"));

      await waitFor(() => expect(startWorkSessionMock).toHaveBeenCalledTimes(1));
      expect(startWorkSessionMock).toHaveBeenCalledWith({
        kind: "deep_study",
        goalMinutes: 45,
        classId: "c1",
        objectives: [
          { kind: "kill_list_item", killListItemId: "k1" },
          { kind: "task", taskId: "t1" },
          { kind: "custom", customText: "Draft the outline" },
        ],
      });
    });

    it("propagates a startWorkSession failure to the caller AND sets the context error", async () => {
      startWorkSessionMock.mockRejectedValue(new Error("A work session is already active"));
      renderHarness();
      const user = userEvent.setup();
      await user.click(screen.getByText("open-deep-work"));
      await user.click(screen.getByText("confirm"));

      await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("already active"));
      expect(screen.getByTestId("session")).toHaveTextContent("null");
    });

    it("throws (rather than silently no-opping) when confirmed with no pending kind", async () => {
      function DirectHarness() {
        const { confirmSessionStart } = useLockInOverlay();
        return <button onClick={() => confirmSessionStart({ goalMinutes: 10, classId: null, objectives: [] }).catch((e) => {
          document.title = e instanceof Error ? e.message : "unknown";
        })}>go</button>;
      }
      render(
        <LockInOverlayProvider initialSession={null}>
          <DirectHarness />
        </LockInOverlayProvider>
      );
      const user = userEvent.setup();
      await user.click(screen.getByText("go"));
      await waitFor(() => expect(document.title).toBe("No session kind selected"));
    });
  });

  describe("toggleObjective — optimistic, write-through, revert on failure", () => {
    it("optimistically flips completed immediately, before the server call resolves", async () => {
      // Two objectives, only one toggled — isolates the optimistic-flip
      // behaviour from the all-complete auto-end (its own describe block
      // below), which would otherwise fire here too (a single-objective
      // session toggled complete IS a transition to all-complete) and null
      // the session out from under this assertion for an unrelated reason.
      renderHarness({
        id: "s1",
        startedAtIso: "2026-09-10T18:00:00.000Z",
        kind: "deep_work",
        goalMinutes: null,
        objectives: [objective({ id: "obj-1", completed: false }), objective({ id: "obj-2", completed: false })],
      });
      let resolveToggle!: () => void;
      toggleSessionObjectiveMock.mockImplementation(() => new Promise((resolve) => (resolveToggle = () => resolve(undefined))));

      const user = userEvent.setup();
      await user.click(screen.getByText("toggle-obj-1"));
      expect(screen.getByTestId("session")).toHaveTextContent("\"completed\":true");

      resolveToggle();
      await waitFor(() => expect(toggleSessionObjectiveMock).toHaveBeenCalledWith("obj-1"));
    });

    it("reverts the optimistic flip if the server call fails", async () => {
      toggleSessionObjectiveMock.mockRejectedValue(new Error("boom"));
      renderHarness({
        id: "s1",
        startedAtIso: "2026-09-10T18:00:00.000Z",
        kind: "deep_work",
        goalMinutes: null,
        objectives: [objective({ id: "obj-1", completed: false }), objective({ id: "obj-2", completed: false })],
      });

      // Not asserting the intermediate optimistic state here — with an
      // immediately-rejecting mock there's no reliable window to observe it
      // before the revert lands (the previous test uses a manually-held
      // promise specifically so that window is deterministic). This test's
      // job is only the end state: a failed write-through must not leave
      // the UI showing a completion that never actually persisted.
      const user = userEvent.setup();
      await user.click(screen.getByText("toggle-obj-1"));

      await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(/"id":"obj-1"[^}]*"completed":false/));
    });

    it("auto-ends the session on the TRANSITION to all-complete, at now() (not the goal timestamp rule)", async () => {
      renderHarness({
        id: "s1",
        startedAtIso: "2026-09-10T18:00:00.000Z",
        kind: "deep_work",
        goalMinutes: null,
        objectives: [objective({ id: "obj-1", completed: false })],
      });
      const user = userEvent.setup();
      await user.click(screen.getByText("toggle-obj-1")); // the only objective -> transitions to all-complete

      await waitFor(() => expect(endWorkSessionMock).toHaveBeenCalledTimes(1));
      const [sessionIdArg, endedAtArg] = endWorkSessionMock.mock.calls[0]!;
      expect(sessionIdArg).toBe("s1");
      expect(endedAtArg).toBeDefined(); // now()-based — just needs to be a real timestamp, not the goal rule
    });

    it("does NOT auto-end when a session already loaded with all objectives complete (initial state, not a transition)", async () => {
      renderHarness({
        id: "s1",
        startedAtIso: "2026-09-10T18:00:00.000Z",
        kind: "deep_work",
        goalMinutes: null,
        objectives: [objective({ id: "obj-1", completed: true })],
      });
      // No toggle — just let effects settle.
      await new Promise((r) => setTimeout(r, 10));
      expect(endWorkSessionMock).not.toHaveBeenCalled();
    });

    it("does NOT auto-end a zero-objective session", async () => {
      renderHarness({ id: "s1", startedAtIso: "2026-09-10T18:00:00.000Z", kind: "deep_work", goalMinutes: null, objectives: [] });
      await new Promise((r) => setTimeout(r, 10));
      expect(endWorkSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("goal-reached auto-end", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("does nothing for a legacy/goal-less session (goalMinutes: null) — no ticking, no auto-end, ever", async () => {
      renderHarness({ id: "s1", startedAtIso: "2026-09-10T18:00:00.000Z", kind: "deep_work", goalMinutes: null, objectives: [] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(endWorkSessionMock).not.toHaveBeenCalled();
    });

    it("auto-ends at started_at + goal_minutes once the goal is reached, not the wall-clock check time", async () => {
      vi.setSystemTime(new Date("2026-09-10T18:00:00.000Z"));
      renderHarness({ id: "s1", startedAtIso: "2026-09-10T18:00:00.000Z", kind: "deep_work", goalMinutes: 30, objectives: [] });

      // Jump well past the goal (14 hours) — same reopened-tab shape
      // session-goal.test.ts already proves at the pure-function level; this
      // proves the provider actually wires goalEndsAtIso in, not now().
      vi.setSystemTime(new Date("2026-09-11T08:00:00.000Z"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      await vi.waitFor(() => expect(endWorkSessionMock).toHaveBeenCalledTimes(1));
      const [, endedAtArg] = endWorkSessionMock.mock.calls[0]!;
      expect(endedAtArg).toBe("2026-09-10T18:30:00.000Z"); // started_at + 30min, NOT the 08:00 check time
    });

    it("checks immediately on mount/reopen, not only after the first interval tick (the reopened-tab case)", async () => {
      vi.setSystemTime(new Date("2026-09-11T08:00:00.000Z")); // already 14h past a 30-min goal at mount
      renderHarness({ id: "s1", startedAtIso: "2026-09-10T18:00:00.000Z", kind: "deep_work", goalMinutes: 30, objectives: [] });

      await vi.waitFor(() => expect(endWorkSessionMock).toHaveBeenCalledTimes(1));
    });
  });
});
