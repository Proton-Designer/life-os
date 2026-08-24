import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
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

import { startWorkSession } from "@/app/(app)/business/actions";
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

describe("FocusModule", () => {
  it("shows today's focus total when idle", () => {
    render(<FocusModule focusMinutesToday={85} sessionCount={2} activeSession={null} distractionsToday={0} triggers={[]} />);
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
  });

  it("shows a real 0m total rather than omitting it when nothing's logged yet", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} distractionsToday={0} triggers={[]} />);
    expect(screen.getByText("0m")).toBeInTheDocument();
  });

  it("shows a no-sessions caption when idle with zero sessions today", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} distractionsToday={0} triggers={[]} />);
    expect(screen.getByText("No Lock-In sessions yet today")).toBeInTheDocument();
  });

  it("shows a pluralized session-count caption when idle with sessions today", () => {
    render(<FocusModule focusMinutesToday={45} sessionCount={2} activeSession={null} distractionsToday={0} triggers={[]} />);
    expect(screen.getByText("2 Lock-In sessions")).toBeInTheDocument();
  });

  it("shows the Lock In button when idle", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} distractionsToday={0} triggers={[]} />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("swaps to the active view after Lock In resolves, without a page reload", async () => {
    vi.mocked(startWorkSession).mockResolvedValue({
      id: "s1",
      startedAt: "2026-08-17T22:00:00Z",
    });
    const user = userEvent.setup();
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} distractionsToday={0} triggers={[]} />);

    await user.click(screen.getByRole("button", { name: "Lock In" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Open session →" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("renders the active view directly when an active session is passed in", () => {
    render(
      <FocusModule
        focusMinutesToday={30}
        sessionCount={1}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z" }}
        distractionsToday={0}
        triggers={[]}
      />
    );
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("href", "/business");
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("prefetches the Open session link (navigation-prefetch-fix, Part A)", () => {
    render(
      <FocusModule
        focusMinutesToday={30}
        sessionCount={1}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z" }}
        distractionsToday={0}
        triggers={[]}
      />
    );
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("data-prefetch", "true");
  });

  it("shows today's distraction count beneath the Focus content", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} distractionsToday={3} triggers={[]} />);
    expect(screen.getByText("Distractions")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the distraction count beneath the Focus content even in the active-session view", () => {
    render(
      <FocusModule
        focusMinutesToday={30}
        sessionCount={1}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z" }}
        distractionsToday={2}
        triggers={[]}
      />
    );
    expect(screen.getByText("Distractions")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("opens the Action Plan dialog listing triggers that already have a plan", async () => {
    const user = userEvent.setup();
    render(
      <FocusModule
        focusMinutesToday={0}
        sessionCount={0}
        activeSession={null}
        distractionsToday={1}
        triggers={[trigger()]}
      />
    );
    await user.click(screen.getByRole("button", { name: "Action Plan" }));
    expect(screen.getByText("Phone in bed")).toBeInTheDocument();
    expect(screen.getByText("Charge phone outside the room")).toBeInTheDocument();
  });

  it("excludes triggers with no current plan from the Action Plan dialog — they're still waiting on the nightly review", async () => {
    const user = userEvent.setup();
    render(
      <FocusModule
        focusMinutesToday={0}
        sessionCount={0}
        activeSession={null}
        distractionsToday={1}
        triggers={[trigger({ id: "t2", name: "Doomscrolling", currentPlan: null })]}
      />
    );
    await user.click(screen.getByRole("button", { name: "Action Plan" }));
    expect(screen.queryByText("Doomscrolling")).not.toBeInTheDocument();
    expect(screen.getByText(/no triggers with a plan yet/i)).toBeInTheDocument();
  });
});
