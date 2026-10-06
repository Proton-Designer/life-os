import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
}));

vi.mock("@/app/(app)/distractions/actions", () => ({
  updateTrigger: vi.fn(),
  saveActionPlan: vi.fn(),
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { href, prefetch, children, ...rest }: React.ComponentPropsWithoutRef<"a"> & { prefetch?: unknown },
      ref: React.Ref<HTMLAnchorElement>
    ) {
      return (
        <a ref={ref} href={href} data-prefetch={String(prefetch)} {...rest}>
          {children}
        </a>
      );
    }),
  };
});

import { startWorkSession, endWorkSession } from "@/app/(app)/business/actions";
import { FocusModule } from "../focus-module";
import { renderWithLockIn } from "@/components/business/__tests__/lock-in-overlay-test-utils";
import type { TriggerSummary } from "@/lib/distractions/types";
import type { ActiveWorkSession } from "@/components/business/lock-in-overlay-context";

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "t1",
    domain: "deen",
    name: "Phone in bed",
    description: null,
    totalCount: 3,
    todayCount: 1,
    lastOccurredAtIso: "2026-08-17T20:00:00Z",
    createdDate: "2026-08-10",
    currentPlan: { id: "p1", body: "Charge phone outside the room", version: 1, createdAtIso: "2026-08-10T00:00:00Z", followedCount: 0, skippedCount: 0, mustRewrite: false },
    ...overrides,
  };
}

const IDLE_PROPS = {
  deepWorkMinutes: 0,
  deepWorkSessions: 0,
  deepStudyMinutes: 0,
  deepStudySessions: 0,
  distractionsToday: 0,
  triggers: [] as TriggerSummary[],
};

function renderFocus(props: Partial<React.ComponentProps<typeof FocusModule>> = {}, initialSession: ActiveWorkSession | null = null) {
  return renderWithLockIn(<FocusModule {...IDLE_PROPS} {...props} />, initialSession);
}

describe("FocusModule", () => {
  it("shows both Deep Work and Deep Study rows with today's totals when idle", () => {
    renderFocus({ deepWorkMinutes: 85, deepWorkSessions: 2, deepStudyMinutes: 40, deepStudySessions: 1 });
    expect(screen.getByText("Deep Work")).toBeInTheDocument();
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
    expect(screen.getByText("Deep Study")).toBeInTheDocument();
    expect(screen.getByText("40m")).toBeInTheDocument();
  });

  it("shows a real 0m total rather than omitting it when nothing's logged yet", () => {
    renderFocus();
    expect(screen.getAllByText("0m")).toHaveLength(2);
  });

  it("shows a no-sessions caption per row when idle with zero sessions today", () => {
    renderFocus();
    expect(screen.getAllByText("No sessions yet today")).toHaveLength(2);
  });

  it("shows a pluralized session-count caption when idle with sessions today", () => {
    renderFocus({ deepWorkMinutes: 45, deepWorkSessions: 2 });
    expect(screen.getByText("2 sessions today")).toBeInTheDocument();
  });

  it("shows ONE Lock In button, with the two stats side by side", () => {
    renderFocus();
    expect(screen.getAllByRole("button", { name: "Lock In" })).toHaveLength(1);
    const work = screen.getByTestId("focus-stat-deep_work");
    const study = screen.getByTestId("focus-stat-deep_study");
    expect(work.parentElement).toBe(study.parentElement);
    expect(work.parentElement).toHaveClass("grid-cols-2");
  });

  // 146/Phase 3: Lock In never starts a session on tap. It asks Deep Work or Deep Study (the Day bar's Focus
  // popup), then opens the setup dialog; startWorkSession only fires once that dialog's Start is pressed.
  it("Lock In asks which kind (the same popup as the Day bar's Focus button) and starts nothing yet", async () => {
    const user = userEvent.setup();
    renderFocus();
    await user.click(screen.getByRole("button", { name: "Lock In" }));
    const popup = screen.getByTestId("day-bar-focus-picker");
    expect(popup).toHaveTextContent("Start focusing");
    expect(popup).toHaveTextContent("Deep Work");
    expect(popup).toHaveTextContent("Deep Study");
    expect(startWorkSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/locked in/)).not.toBeInTheDocument();
  });

  it("renders the active view directly when an active deep_work session is passed in, with an Open session link", () => {
    renderFocus({}, { id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work", goalMinutes: null, objectives: [] });
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("href", "/business");
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("renders the active view directly when an active deep_study session is passed in, with no Open session link", () => {
    renderFocus({}, { id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_study", goalMinutes: null, objectives: [] });
    expect(screen.queryByRole("link", { name: "Open session →" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("prefetches the Open session link (navigation-prefetch-fix, Part A)", () => {
    renderFocus({}, { id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work", goalMinutes: null, objectives: [] });
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("data-prefetch", "true");
  });

  it("ends the active session via an End session button, right in the Home module — no navigation required", async () => {
    vi.mocked(endWorkSession).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderFocus({}, { id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_study", goalMinutes: null, objectives: [] });

    await user.click(screen.getByRole("button", { name: "End session" }));

    // A manual End Session tap passes no endedAtIso override (that's only
    // for the two auto-end paths) — endSessionAt still forwards it
    // positionally as `undefined`, so the real call carries two arguments.
    expect(endWorkSession).toHaveBeenCalledWith("s1", undefined);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
    });
  });

  it("has an Expand button in the active view (returns to the full-screen overlay)", () => {
    renderFocus({}, { id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work", goalMinutes: null, objectives: [] });
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });

  // Same reasoning as the two "opens the setup dialog" tests above: this
  // race can no longer be triggered by a bare click on this button now that
  // startWorkSession only fires from inside the setup dialog's Start
  // handler. Covered at the provider level instead.

  it("shows today's distraction count beneath the Focus content", () => {
    renderFocus({ distractionsToday: 3 });
    expect(screen.getByText("Distractions")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the distraction count beneath the Focus content even in the active-session view", () => {
    renderFocus({ distractionsToday: 2 }, { id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work", goalMinutes: null, objectives: [] });
    expect(screen.getByText("Distractions")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  // IA-P1b: the dialog hosts the SAME review component as the evening close. Today's triggers
  // (todayCount > 0) appear as review cards; plan-less ones ask for a first plan right here.
  it("opens the Action Plan dialog showing today's triggers as review cards", async () => {
    const user = userEvent.setup();
    renderFocus({ distractionsToday: 1, triggers: [trigger()] });
    await user.click(screen.getByRole("button", { name: "Action Plan" }));
    expect(screen.getByTestId("distraction-plan-review")).toBeInTheDocument();
    expect(screen.getByTestId("review-item-card")).toHaveTextContent("Phone in bed");
    expect(screen.getByRole("button", { name: /didn't follow it/i })).toBeInTheDocument();
  });

  it("a plan-less trigger from today asks for its first plan in the dialog (no follow/skip question)", async () => {
    const user = userEvent.setup();
    renderFocus({ distractionsToday: 1, triggers: [trigger({ id: "t2", name: "Doomscrolling", currentPlan: null })] });
    await user.click(screen.getByRole("button", { name: "Action Plan" }));
    const card = screen.getByTestId("review-item-card");
    expect(card).toHaveTextContent("Doomscrolling");
    expect(screen.getByPlaceholderText("Plan of action")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /didn't follow it/i })).not.toBeInTheDocument();
    // ...and it is NOT in "All plans" (that list is plans only).
    expect(screen.queryByTestId("all-plans")).not.toBeInTheDocument();
  });
});
