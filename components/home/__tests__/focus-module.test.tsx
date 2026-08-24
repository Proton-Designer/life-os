import { render, screen, waitFor } from "@testing-library/react";
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
import type { TriggerSummary } from "@/lib/distractions/types";

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
  activeSession: null,
  distractionsToday: 0,
  triggers: [] as TriggerSummary[],
};

describe("FocusModule", () => {
  it("shows both Deep Work and Deep Study rows with today's totals when idle", () => {
    render(<FocusModule {...IDLE_PROPS} deepWorkMinutes={85} deepWorkSessions={2} deepStudyMinutes={40} deepStudySessions={1} />);
    expect(screen.getByText("Deep Work")).toBeInTheDocument();
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
    expect(screen.getByText("Deep Study")).toBeInTheDocument();
    expect(screen.getByText("40m")).toBeInTheDocument();
  });

  it("shows a real 0m total rather than omitting it when nothing's logged yet", () => {
    render(<FocusModule {...IDLE_PROPS} />);
    expect(screen.getAllByText("0m")).toHaveLength(2);
  });

  it("shows a no-sessions caption per row when idle with zero sessions today", () => {
    render(<FocusModule {...IDLE_PROPS} />);
    expect(screen.getAllByText("No sessions yet today")).toHaveLength(2);
  });

  it("shows a pluralized session-count caption when idle with sessions today", () => {
    render(<FocusModule {...IDLE_PROPS} deepWorkMinutes={45} deepWorkSessions={2} />);
    expect(screen.getByText("2 sessions today")).toBeInTheDocument();
  });

  it("shows a Lock In button for each kind when idle", () => {
    render(<FocusModule {...IDLE_PROPS} />);
    expect(screen.getAllByRole("button", { name: "Lock In" })).toHaveLength(2);
  });

  it("swaps to the active view after Deep Work Lock In resolves, without a page reload", async () => {
    vi.mocked(startWorkSession).mockResolvedValue({
      id: "s1",
      startedAt: "2026-08-17T22:00:00Z",
    });
    const user = userEvent.setup();
    render(<FocusModule {...IDLE_PROPS} />);

    const [deepWorkButton] = screen.getAllByRole("button", { name: "Lock In" });
    await user.click(deepWorkButton);

    expect(startWorkSession).toHaveBeenCalledWith("deep_work");
    await waitFor(() => {
      expect(screen.getByText(/Deep Work — locked in/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("swaps to the active view after Deep Study Lock In resolves", async () => {
    vi.mocked(startWorkSession).mockResolvedValue({
      id: "s1",
      startedAt: "2026-08-17T22:00:00Z",
    });
    const user = userEvent.setup();
    render(<FocusModule {...IDLE_PROPS} />);

    const [, deepStudyButton] = screen.getAllByRole("button", { name: "Lock In" });
    await user.click(deepStudyButton);

    expect(startWorkSession).toHaveBeenCalledWith("deep_study");
    await waitFor(() => {
      expect(screen.getByText(/Deep Study — locked in/)).toBeInTheDocument();
    });
    // Deep Study has no domain page of its own — no "Open session" link.
    expect(screen.queryByRole("link", { name: "Open session →" })).not.toBeInTheDocument();
  });

  it("renders the active view directly when an active deep_work session is passed in, with an Open session link", () => {
    render(
      <FocusModule
        {...IDLE_PROPS}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work" }}
      />
    );
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("href", "/business");
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("renders the active view directly when an active deep_study session is passed in, with no Open session link", () => {
    render(
      <FocusModule
        {...IDLE_PROPS}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_study" }}
      />
    );
    expect(screen.queryByRole("link", { name: "Open session →" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("prefetches the Open session link (navigation-prefetch-fix, Part A)", () => {
    render(
      <FocusModule
        {...IDLE_PROPS}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work" }}
      />
    );
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("data-prefetch", "true");
  });

  it("ends the active session via an End session button, right in the Home module — no navigation required", async () => {
    vi.mocked(endWorkSession).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <FocusModule
        {...IDLE_PROPS}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_study" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "End session" }));

    expect(endWorkSession).toHaveBeenCalledWith("s1");
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Lock In" })).toHaveLength(2);
    });
  });

  it("shows a legible message instead of crashing when startWorkSession still throws (a race the guard lost)", async () => {
    vi.mocked(startWorkSession).mockRejectedValue(new Error("A work session is already active"));
    const user = userEvent.setup();
    render(<FocusModule {...IDLE_PROPS} />);

    const [deepWorkButton] = screen.getAllByRole("button", { name: "Lock In" });
    await user.click(deepWorkButton);

    await waitFor(() => {
      expect(screen.getByText(/already running/)).toBeInTheDocument();
    });
  });

  it("shows today's distraction count beneath the Focus content", () => {
    render(<FocusModule {...IDLE_PROPS} distractionsToday={3} />);
    expect(screen.getByText("Distractions")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the distraction count beneath the Focus content even in the active-session view", () => {
    render(
      <FocusModule
        {...IDLE_PROPS}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z", kind: "deep_work" }}
        distractionsToday={2}
      />
    );
    expect(screen.getByText("Distractions")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("opens the Action Plan dialog listing triggers that already have a plan", async () => {
    const user = userEvent.setup();
    render(<FocusModule {...IDLE_PROPS} distractionsToday={1} triggers={[trigger()]} />);
    await user.click(screen.getByRole("button", { name: "Action Plan" }));
    expect(screen.getByText("Phone in bed")).toBeInTheDocument();
    expect(screen.getByText("Charge phone outside the room")).toBeInTheDocument();
  });

  it("excludes triggers with no current plan from the Action Plan dialog — they're still waiting on the nightly review", async () => {
    const user = userEvent.setup();
    render(
      <FocusModule
        {...IDLE_PROPS}
        distractionsToday={1}
        triggers={[trigger({ id: "t2", name: "Doomscrolling", currentPlan: null })]}
      />
    );
    await user.click(screen.getByRole("button", { name: "Action Plan" }));
    expect(screen.queryByText("Doomscrolling")).not.toBeInTheDocument();
    expect(screen.getByText(/no triggers with a plan yet/i)).toBeInTheDocument();
  });
});
