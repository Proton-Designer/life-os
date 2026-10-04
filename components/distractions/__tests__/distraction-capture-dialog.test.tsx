import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const listTriggersForDomainMock = vi.fn();
const listTopTriggersForQuickLogMock = vi.fn();
const logDistractionMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/distractions/actions", () => ({
  listTriggersForDomain: (...args: unknown[]) => listTriggersForDomainMock(...args),
  listTopTriggersForQuickLog: (...args: unknown[]) => listTopTriggersForQuickLogMock(...args),
  logDistraction: (...args: unknown[]) => logDistractionMock(...args),
  createTriggerAndLog: vi.fn(async () => {}),
}));

// DistractionCaptureDialog now reads useLockInOverlay() to infer the domain
// from an active session, so it needs a real provider ancestor — same
// pattern as CheckinToast (components/checkin/__tests__/checkin-toast.test.tsx).
// Importing lock-in-overlay-context.tsx pulls this module in regardless of
// whether a given test exercises a session.
vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
  toggleSessionObjective: vi.fn(),
  getActiveSessionDetail: vi.fn(async () => null),
}));

import { DistractionCaptureDialog } from "../distraction-capture-dialog";
import { LockInOverlayProvider, type ActiveWorkSession } from "@/components/business/lock-in-overlay-context";

function deepWorkSession(overrides: Partial<ActiveWorkSession> = {}): ActiveWorkSession {
  return {
    id: "session-1",
    startedAtIso: "2026-09-10T12:00:00.000Z",
    kind: "deep_work",
    goalMinutes: null,
    objectives: [],
    ...overrides,
  };
}

function renderDialog(session: ActiveWorkSession | null = null, deenMode = true) {
  return render(
    <LockInOverlayProvider initialSession={session}>
      <DistractionCaptureDialog deenMode={deenMode} />
    </LockInOverlayProvider>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  // The visible label is "+1" (the spec's own entry gesture), but
  // aria-label="Log a distraction" is what testing-library's accessible-
  // name computation actually returns for getByRole, since an aria-label
  // overrides a button's own text content.
  await user.click(screen.getByRole("button", { name: "Log a distraction" }));
  return user;
}

function trigger(overrides: Partial<{ id: string; domain: "deen" | "business" | "school" | "fitness" | "co_op"; name: string; totalCount: number }> = {}) {
  return {
    id: "t1",
    domain: "business" as const,
    name: "Phone",
    description: null,
    totalCount: 5,
    todayCount: 0,
    lastOccurredAtIso: null,
    createdDate: "2026-09-01",
    currentPlan: null,
    ...overrides,
  };
}

describe("DistractionCaptureDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTriggersForDomainMock.mockResolvedValue([]);
    listTopTriggersForQuickLogMock.mockResolvedValue([]);
    localStorage.clear();
  });

  // P3-02 (docs/audits/2026-09-13-three-app-feature-audit.md #35): the
  // reshaped "+1 -> 6 chips -> back" flow. This REPLACES the old
  // "no session -> domain picker first" default -- that behavior is
  // intentionally changed by this task, not a regression.
  describe("no active session — the new quick-chip step", () => {
    // E2E-01b: on an account with no triggers the chip list resolves empty, and its auto-advance to the domain
    // picker used to fire even when the user had already tapped through to a domain's trigger step, dragging
    // them back and removing "New trigger" from under their finger (the e2e hung for 88 s on that button).
    it("an empty chip list resolving LATE does not pull a user already in a domain's trigger step back to the picker", async () => {
      let resolveQuick!: (v: never[]) => void;
      listTopTriggersForQuickLogMock.mockReturnValue(new Promise<never[]>((r) => (resolveQuick = r)));
      renderDialog(null);
      const user = await openDialog();
      await user.click(await screen.findByRole("button", { name: "More options" }));
      await user.click(await screen.findByRole("button", { name: "School" }));
      expect(await screen.findByRole("button", { name: /new trigger/i })).toBeInTheDocument();

      await act(async () => resolveQuick([])); // the slow chip list finally comes back empty

      expect(screen.getByRole("button", { name: /new trigger/i })).toBeInTheDocument();
      expect(screen.queryByText("What's the domain?")).not.toBeInTheDocument();
    });

    it("an empty chip list resolving while the user is still on the chip step lands on the domain picker (unchanged)", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([]);
      renderDialog(null);
      await openDialog();
      expect(await screen.findByText("What's the domain?")).toBeInTheDocument();
    });

    it("with existing triggers: opens on the chip step, not the domain picker", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([trigger({ id: "t1", name: "Phone" })]);
      renderDialog(null);
      await openDialog();
      expect(await screen.findByText("What happened?")).toBeInTheDocument();
      expect(screen.queryByText("What's the domain?")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Phone" })).toBeInTheDocument();
    });

    it("shows at most 6 chips, ranked the same way the domain-scoped step ranks (totalCount desc)", async () => {
      const many = Array.from({ length: 8 }, (_, i) => trigger({ id: `t${i}`, name: `Trigger ${i}`, totalCount: 8 - i }));
      listTopTriggersForQuickLogMock.mockResolvedValue(many);
      renderDialog(null);
      await openDialog();
      await screen.findByText("What happened?");
      expect(screen.getByRole("button", { name: "Trigger 0" })).toBeInTheDocument(); // highest totalCount
      expect(screen.queryByRole("button", { name: "Trigger 7" })).not.toBeInTheDocument(); // 8th-ranked, cut
    });

    it("tapping a chip logs against that trigger and closes -- 2 taps total (open + chip)", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([trigger({ id: "t1", name: "Phone" })]);
      renderDialog(null);
      const user = await openDialog();
      await user.click(await screen.findByRole("button", { name: "Phone" }));
      expect(logDistractionMock).toHaveBeenCalledWith("t1", undefined, null);
    });

    // PERF-4 review: the dialog closes before the write, so a failure must be visible, not an
    // uncaught async-transition error.
    it("a failed log after the dialog closed shows an alert instead of throwing", async () => {
      logDistractionMock.mockRejectedValueOnce(new Error("offline"));
      listTopTriggersForQuickLogMock.mockResolvedValue([trigger({ id: "t1", name: "Phone" })]);
      renderDialog(null);
      const user = await openDialog();
      await user.click(await screen.findByRole("button", { name: "Phone" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't log/i);
    });

    it("'More options' falls back to the full domain->trigger flow, unchanged", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([trigger()]);
      renderDialog(null);
      const user = await openDialog();
      await screen.findByText("What happened?");
      await user.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getByText("What's the domain?")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Deen" })).toBeInTheDocument();
    });

    it("Deen Mode OFF: the domain picker has no Deen option (and the default is fail-closed with no prop); ON has it", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([]);
      const off = renderDialog(null, false);
      await openDialog();
      await screen.findByText("What's the domain?");
      expect(screen.queryByRole("button", { name: "Deen" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Business" })).toBeInTheDocument();
      off.unmount();
      render(
        <LockInOverlayProvider initialSession={null}>
          <DistractionCaptureDialog />
        </LockInOverlayProvider>
      );
      await openDialog();
      await screen.findByText("What's the domain?");
      expect(screen.queryByRole("button", { name: "Deen" })).not.toBeInTheDocument();
    });

    it("a first-time user with ZERO triggers skips the empty chip screen and lands on the domain picker directly", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([]);
      renderDialog(null);
      await openDialog();
      expect(await screen.findByText("What's the domain?")).toBeInTheDocument();
      expect(screen.queryByText("What happened?")).not.toBeInTheDocument();
    });

    it("closing and reopening with no session lands back on the quick-chip step, not a stale domain picker", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([trigger()]);
      renderDialog(null);
      let user = await openDialog();
      await screen.findByText("What happened?");
      await user.click(screen.getByRole("button", { name: "More options" }));
      await screen.findByText("What's the domain?");
      await user.keyboard("{Escape}");
      user = await openDialog();
      expect(await screen.findByText("What happened?")).toBeInTheDocument();
    });
  });

  describe("a Deep Work session is active", () => {
    it("skips the domain step entirely and goes straight to triggers for Business", async () => {
      renderDialog(deepWorkSession());
      await openDialog();
      expect(screen.queryByText("What's the domain?")).not.toBeInTheDocument();
      expect(await screen.findByRole("heading", { name: "Business" })).toBeInTheDocument();
      expect(listTriggersForDomainMock).toHaveBeenCalledWith("business");
    });

    it("shows an unobtrusive label naming what was inferred", async () => {
      renderDialog(deepWorkSession());
      await openDialog();
      expect(await screen.findByText("Inferred from your Deep Work session")).toBeInTheDocument();
    });
  });

  describe("a Deep Study session is active", () => {
    it("skips the domain step entirely and goes straight to triggers for School", async () => {
      renderDialog(deepWorkSession({ kind: "deep_study" }));
      await openDialog();
      expect(screen.queryByText("What's the domain?")).not.toBeInTheDocument();
      expect(await screen.findByRole("heading", { name: "School" })).toBeInTheDocument();
      expect(listTriggersForDomainMock).toHaveBeenCalledWith("school");
    });

    it("shows an unobtrusive label naming what was inferred", async () => {
      renderDialog(deepWorkSession({ kind: "deep_study" }));
      await openDialog();
      expect(await screen.findByText("Inferred from your Deep Study session")).toBeInTheDocument();
    });
  });

  // The mirror of the bug the Opus Lead's other engineer caught on the
  // session-setup dialog: the domain-step skip must be keyed to `open`
  // becoming true, not baked into the close handler's reset() — otherwise
  // a close inside an active session leaves `reset()`'s plain "domain" step
  // sitting there until the effect re-fires, or a stale close-time decision
  // survives into the next open.
  describe("reopening while a session stays active", () => {
    it("re-skips the domain step on every fresh open, not just the first", async () => {
      renderDialog(deepWorkSession());
      const user = await openDialog();
      await screen.findByRole("heading", { name: "Business" });
      await user.keyboard("{Escape}");
      await openDialog();
      expect(screen.queryByText("What's the domain?")).not.toBeInTheDocument();
      expect(await screen.findByRole("heading", { name: "Business" })).toBeInTheDocument();
    });
  });

  // IA-P1a: the "+" capture sheet drives THIS component (one logger) with controlled open state.
  describe("controlled by the capture sheet", () => {
    it("opens from the open prop with no '+1' trigger of its own, and logs through the same action", async () => {
      listTopTriggersForQuickLogMock.mockResolvedValue([trigger({ id: "t9", name: "Phone" })]);
      const onOpenChange = vi.fn();
      render(
        <LockInOverlayProvider initialSession={null}>
          <DistractionCaptureDialog deenMode open onOpenChange={onOpenChange} hideTrigger />
        </LockInOverlayProvider>
      );
      expect(screen.queryByRole("button", { name: "Log a distraction" })).toBeNull();
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Phone" }));
      expect(logDistractionMock).toHaveBeenCalledWith("t9", undefined, null);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("stays closed while open is false", () => {
      render(
        <LockInOverlayProvider initialSession={null}>
          <DistractionCaptureDialog open={false} hideTrigger />
        </LockInOverlayProvider>
      );
      expect(screen.queryByText("What happened?")).toBeNull();
    });
  });
});
