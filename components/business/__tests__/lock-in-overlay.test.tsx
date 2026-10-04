import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// NAV-02: the shell polls are fetches (lib/client/shell-fetch.ts), not Server Actions; route them to the same fakes.
vi.mock("@/lib/client/shell-fetch", () => ({
  shellFetch: async (path: string) => {
    if (path.startsWith("/api/shell/allocation-queue")) return getAllocationQueueForNowMock();
    if (path.startsWith("/api/shell/notifications")) return [];
    if (path.startsWith("/api/shell/distraction-count")) return 0;
    throw new Error(`unmocked shell fetch: ${path}`);
  },
}));

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(async () => {}),
  setSessionObjectiveCompleted: vi.fn(async () => {}),
  refreshBusinessViews: vi.fn(async () => {}),
  getActiveSessionDetail: vi.fn(async () => null),
}));
// LockInOverlay now renders LockInCheckin (Phase 5), which reads
// useAllocationQueue() — needs a real provider ancestor and this module
// mocked, same as every direct test of that context already does.
const getAllocationQueueForNowMock = vi.fn();
const saveAllocationCheckinMock = vi.fn();
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  saveAllocationCheckin: (...args: unknown[]) => saveAllocationCheckinMock(...args),
}));
// LockInOverlay now renders EndOfHourReflection (P3-05), which derives its
// own visibility from getEndOfHourEntryState() -- mocked flag-OFF by
// default (the flag's own real default) so it renders nothing here and
// every existing assertion below is unaffected. GAP-06: this mock now has
// to say WHICH empty state it is, because flag-off renders nothing while
// flag-on-with-zero-cards renders a nudge.
// end-of-hour-reflection.test.tsx covers its own behavior.
vi.mock("@/app/(app)/personal/reflection-cards-actions", () => ({
  getEndOfHourEntryState: vi.fn(async () => ({ enabled: false, hasCards: false })),
  startEndOfHourRitual: vi.fn(),
  submitEndOfHourReflection: vi.fn(),
}));

import { LockInOverlay } from "../lock-in-overlay";
import { LockInOverlayProvider, type ActiveWorkSession } from "../lock-in-overlay-context";
import { setSessionObjectiveCompleted } from "@/app/(app)/business/actions";
import { writeLockInMinimized } from "@/lib/business/lock-in-storage";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";

const EMPTY_KILL_LIST: [{ id: string | null; text: string; completed: boolean }, { id: string | null; text: string; completed: boolean }, { id: string | null; text: string; completed: boolean }] = [
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
];
const FILLED_KILL_LIST: typeof EMPTY_KILL_LIST = [
  { id: "k1", text: "Full kill list item", completed: false },
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
];

// The provider defaults an active session to MINIMIZED unless a stored
// preference for that exact session id says otherwise (lock-in-storage.ts's
// own doc comment: "a fresh page load... can default to minimized rather
// than ambushing the user"). Real behaviour, not a test artefact to work
// around quietly — every test here explicitly seeds "not minimized" so it's
// exercising the overlay's actual render logic instead of silently
// asserting against an overlay that never mounted (which would make an
// absence assertion trivially, meaninglessly true).
function renderOverlay(session: ActiveWorkSession, killListSlots = EMPTY_KILL_LIST) {
  writeLockInMinimized(session.id, false);
  return render(
    <LockInOverlayProvider initialSession={session}>
      <AllocationQueueProvider>
        <LockInOverlay timezone="America/Chicago" killListSlots={killListSlots} />
      </AllocationQueueProvider>
    </LockInOverlayProvider>
  );
}

function objective(overrides: Partial<{ id: string; kind: "kill_list_item" | "task" | "custom"; label: string; completed: boolean; refId: string | null }> = {}) {
  return { id: "obj-1", kind: "custom" as const, label: "Finish it", completed: false, refId: null, ...overrides };
}

describe("LockInOverlay", () => {
  beforeEach(() => {
    vi.mocked(setSessionObjectiveCompleted).mockClear();
    getAllocationQueueForNowMock.mockClear();
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    saveAllocationCheckinMock.mockClear();
    localStorage.clear();
  });

  describe("legacy session (goalMinutes: null) — must render exactly as before 146", () => {
    const LEGACY: ActiveWorkSession = {
      id: "s1",
      startedAtIso: new Date().toISOString(),
      kind: "deep_work",
      goalMinutes: null,
      objectives: [],
    };

    it("shows a bare elapsed counter with no goal annotation", () => {
      renderOverlay(LEGACY);
      expect(screen.getByText("min")).toBeInTheDocument();
      expect(screen.queryByText(/^\/ /)).not.toBeInTheDocument();
    });

    it("shows no progress bar", () => {
      renderOverlay(LEGACY);
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("still shows the old full kill list for a Deep Work session", () => {
      renderOverlay(LEGACY, FILLED_KILL_LIST);
      expect(screen.getAllByText("Full kill list item").length).toBeGreaterThan(0);
    });

    it("never auto-ends and never renders an objectives checklist", () => {
      renderOverlay(LEGACY);
      expect(screen.queryByRole("button", { name: /Mark ".*" (in)?complete/ })).not.toBeInTheDocument();
    });
  });

  describe("goal-based session", () => {
    const WITH_OBJECTIVES: ActiveWorkSession = {
      id: "s1",
      startedAtIso: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
      kind: "deep_work",
      goalMinutes: 30,
      objectives: [
        objective({ id: "custom-1", kind: "custom", label: "Ship the draft" }),
        objective({ id: "kill-1", kind: "kill_list_item", label: "Clear inbox", completed: false }),
        objective({ id: "task-1", kind: "task", label: "Lab report", completed: true }),
      ],
    };

    it("shows the goal annotation next to the elapsed counter", () => {
      renderOverlay(WITH_OBJECTIVES);
      expect(screen.getByText("/ 30")).toBeInTheDocument();
    });

    it("shows a progress bar reflecting elapsed/goal", () => {
      renderOverlay(WITH_OBJECTIVES);
      const bar = screen.getByRole("progressbar");
      // 5 of 30 minutes elapsed ~ 17%, allow a small tolerance for the
      // exact-real-clock second this test happened to run in.
      expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(15);
      expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(20);
    });

    it("renders the custom objective as a headline above the kind label, not inside the checklist", () => {
      renderOverlay(WITH_OBJECTIVES);
      const headline = screen.getByRole("button", { name: /Mark "Ship the draft" complete/ });
      const kindLabel = screen.getByText("Deep Work");
      // DOM order: the headline's position in the document must precede
      // the kind label's — asserted via compareDocumentPosition rather than
      // just "both exist", which wouldn't catch a misplaced headline.
      expect(headline.compareDocumentPosition(kindLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Exactly once — unlike the kill-list/objectives checklist rows,
      // which genuinely occupy different POSITIONS on desktop vs mobile
      // (a top row vs a bottom column) and so render twice with one hidden
      // per breakpoint, the headline is a single centered element that
      // reflows naturally; a second copy here would mean it leaked into
      // the checklist pills too.
      expect(screen.getAllByText("Ship the draft")).toHaveLength(1);
    });

    it("shows only the chosen objectives (task + kill-list, not the custom one) in the checklist, never the raw kill list", () => {
      renderOverlay(WITH_OBJECTIVES, FILLED_KILL_LIST);
      expect(screen.getAllByText("Clear inbox").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Lab report").length).toBeGreaterThan(0);
      // The kill list slot's own text was never selected as an objective —
      // it must not leak into this session's overlay just because it's on
      // today's kill list.
      expect(screen.queryByText("Full kill list item")).not.toBeInTheDocument();
    });

    it("every objective kind gets a checkmark button, reflecting its completed state", () => {
      renderOverlay(WITH_OBJECTIVES);
      expect(screen.getAllByRole("button", { name: /Mark "Clear inbox" complete/ }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: /Mark "Lab report" incomplete/ }).length).toBeGreaterThan(0); // already completed
    });

    it("toggling a checklist objective calls the context's setSessionObjectiveCompleted with that objective's id", async () => {
      renderOverlay(WITH_OBJECTIVES);
      const user = userEvent.setup();
      const [killListButton] = screen.getAllByRole("button", { name: /Mark "Clear inbox" complete/ });
      await user.click(killListButton!);
      expect(setSessionObjectiveCompleted).toHaveBeenCalledWith("kill-1", true);
    });

    it("toggling the custom headline calls setSessionObjectiveCompleted with its own id", async () => {
      renderOverlay(WITH_OBJECTIVES);
      const user = userEvent.setup();
      const [headline] = screen.getAllByRole("button", { name: /Mark "Ship the draft" complete/ });
      await user.click(headline!);
      expect(setSessionObjectiveCompleted).toHaveBeenCalledWith("custom-1", true);
    });

    it("shows no checklist UI at all for a goal-based session with zero objectives — not even the old full kill list", () => {
      const NO_OBJECTIVES: ActiveWorkSession = { ...WITH_OBJECTIVES, objectives: [] };
      renderOverlay(NO_OBJECTIVES, FILLED_KILL_LIST);
      expect(screen.queryByText("Full kill list item")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Mark "/ })).not.toBeInTheDocument();
      // The goal display itself is still present — this is a goal-based
      // session, just one that happens to have no objectives.
      expect(screen.getByText("/ 30")).toBeInTheDocument();
    });
  });

  it("End Session is present and enabled regardless of goal/objectives state", () => {
    renderOverlay({
      id: "s1",
      startedAtIso: new Date().toISOString(),
      kind: "deep_study",
      goalMinutes: 45,
      objectives: [objective({ id: "o1", kind: "custom", label: "Read ch. 4" })],
    });
    expect(screen.getByRole("button", { name: "End Session" })).toBeEnabled();
  });

  it("renders nothing when there is no active session", () => {
    const { container } = render(
      <LockInOverlayProvider initialSession={null}>
        <AllocationQueueProvider>
          <LockInOverlay timezone="UTC" killListSlots={EMPTY_KILL_LIST} />
        </AllocationQueueProvider>
      </LockInOverlayProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe("pending allocation check-in", () => {
    const SESSION: ActiveWorkSession = {
      id: "s1",
      startedAtIso: new Date().toISOString(),
      kind: "deep_work",
      goalMinutes: null,
      objectives: [],
    };
    const WINDOW_A = {
      windowStartIso: "2026-09-10T13:00:00.000Z",
      windowEndIso: "2026-09-10T15:00:00.000Z",
      prefill: { deen: 15, business: 0, school: 0, fitness: 0, co_op: 0 },
    };

    it("shows the check-in form inside the expanded overlay when one is pending — visible in the expanded view, per Ayman's report", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
      renderOverlay(SESSION);
      expect(await screen.findByTestId("allocation-bar")).toBeInTheDocument();
    });

    it("shows nothing check-in-related when the queue is empty", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
      renderOverlay(SESSION);
      await screen.findByText("Deep Work"); // wait for the overlay itself to settle
      expect(screen.queryByTestId("allocation-bar")).not.toBeInTheDocument();
    });

    it("answering it from inside the overlay goes through the same saveAllocationCheckin action the sheet uses", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
      renderOverlay(SESSION);
      await screen.findByTestId("allocation-bar");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Done" }));

      expect(saveAllocationCheckinMock).toHaveBeenCalledWith(WINDOW_A.windowStartIso, WINDOW_A.windowEndIso, expect.any(Object));
    });

    it("does not fight the timer/objectives block — both remain present with a check-in showing", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
      renderOverlay({ ...SESSION, goalMinutes: 30 });
      await screen.findByTestId("allocation-bar");
      expect(screen.getByText("/ 30")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "End Session" })).toBeInTheDocument();
    });
  });

  describe("Hour-completion banner (Phase 2 #P2-04)", () => {
    it("does not show for a freshly started session", () => {
      renderOverlay({
        id: "s-fresh",
        startedAtIso: new Date().toISOString(),
        kind: "deep_work",
        goalMinutes: null,
        objectives: [],
      });
      expect(screen.queryByTestId("hour-complete-banner")).not.toBeInTheDocument();
    });

    it("shows once the session has run 60+ minutes", () => {
      renderOverlay({
        id: "s-long",
        startedAtIso: new Date(Date.now() - 65 * 60_000).toISOString(),
        kind: "deep_study",
        goalMinutes: null,
        objectives: [],
      });
      expect(screen.getByTestId("hour-complete-banner")).toBeInTheDocument();
    });
  });
});
