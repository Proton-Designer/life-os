import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const listTriggersForDomainMock = vi.fn();
vi.mock("@/app/(app)/distractions/actions", () => ({
  listTriggersForDomain: (...args: unknown[]) => listTriggersForDomainMock(...args),
  logDistraction: vi.fn(async () => {}),
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

function renderDialog(session: ActiveWorkSession | null = null) {
  return render(
    <LockInOverlayProvider initialSession={session}>
      <DistractionCaptureDialog />
    </LockInOverlayProvider>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Distractions" }));
  return user;
}

describe("DistractionCaptureDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTriggersForDomainMock.mockResolvedValue([]);
    localStorage.clear();
  });

  // The Opus Lead's own framing: this is the regression risk that matters
  // most. Standalone use (topbar, the review dialog) must be untouched.
  describe("no active session — unchanged from before", () => {
    it("still opens on the domain picker, not a skipped step", async () => {
      renderDialog(null);
      await openDialog();
      expect(screen.getByText("What's the domain?")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Deen" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Business" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "School" })).toBeInTheDocument();
    });

    it("still requires tapping a domain to reach the triggers step", async () => {
      renderDialog(null);
      const user = await openDialog();
      await user.click(screen.getByRole("button", { name: "Business" }));
      expect(await screen.findByRole("heading", { name: "Business" })).toBeInTheDocument();
      expect(screen.queryByText(/Inferred from/)).not.toBeInTheDocument();
    });

    it("closing and reopening with no session still lands on the domain picker", async () => {
      renderDialog(null);
      const user = await openDialog();
      await user.click(screen.getByRole("button", { name: "Business" }));
      await screen.findByRole("heading", { name: "Business" });
      await user.keyboard("{Escape}");
      await openDialog();
      expect(screen.getByText("What's the domain?")).toBeInTheDocument();
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
});
