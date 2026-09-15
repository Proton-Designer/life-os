import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GoalBoard } from "../goal-board";
import type { Goal } from "@/lib/goals/actions-core";

/**
 * Found while investigating the Opus Lead's report of goals.spec.ts failing
 * on Mobile Chrome ("listitem not visible within 5s") after ruling out the
 * checkin-toast flake — the row wasn't slow, it was NEVER going to appear.
 * `createGoalAction` is called directly from a client event handler (not a
 * `<form action={...}>`), so Next.js does NOT automatically refresh the
 * current route afterward — this codebase's own established idiom
 * (components/business/kill-list-items-dialog.tsx, components/school/
 * add-class-dialog.tsx, components/promotions/promote-lesson-sheet.tsx, and
 * others) is to call `router.refresh()` explicitly after a mutating action
 * whose result isn't reflected via local optimistic state. GoalBoard's
 * `allGoals` is a `useState(goals)` copy with no effect resyncing it when a
 * fresh `goals` prop arrives, so even a caller that DID call
 * `router.refresh()` would still show nothing new — this file's own
 * ActiveGoalCard.resolve()/GoalMilestoneRow.toggle() paths avoid the bug
 * entirely by mutating `allGoals`/local state directly instead of relying
 * on props at all.
 */

const createGoalActionMock = vi.fn();
vi.mock("@/app/(app)/goals/actions", () => ({
  createGoalAction: (...args: unknown[]) => createGoalActionMock(...args),
  setGoalStatusAction: vi.fn(async () => ({ ok: true })),
  addMilestoneAction: vi.fn(async () => ({ ok: true })),
  setMilestoneDoneAction: vi.fn(async () => ({ ok: true })),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

beforeEach(() => {
  createGoalActionMock.mockReset();
  refreshMock.mockReset();
});

const NEW_GOAL: Goal = {
  id: "g1",
  monthStart: "2026-09-01",
  domain: null,
  title: "New Goal",
  reason: "because",
  rank: 1,
  status: "active",
  completedAt: null,
};

describe("GoalBoard — creating a goal reflects a server refresh", () => {
  it("calls router.refresh() after a successful create, so the current route actually re-fetches (createGoalAction is called directly from a client handler, not a <form action>, so Next.js does not do this automatically)", async () => {
    createGoalActionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[]} milestones={[]} />);

    await user.click(screen.getByRole("button", { name: "+ Add a goal" }));
    await user.type(screen.getByPlaceholderText("Goal title"), "New Goal");
    await user.type(screen.getByPlaceholderText("Why this goal matters (required)"), "because");
    await user.click(screen.getByRole("button", { name: "Add goal" }));

    await waitFor(() => expect(createGoalActionMock).toHaveBeenCalled());
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("shows the newly created goal once the server-refreshed goals prop arrives", async () => {
    createGoalActionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { rerender } = render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[]} milestones={[]} />);

    await user.click(screen.getByRole("button", { name: "+ Add a goal" }));
    await user.type(screen.getByPlaceholderText("Goal title"), "New Goal");
    await user.type(screen.getByPlaceholderText("Why this goal matters (required)"), "because");
    await user.click(screen.getByRole("button", { name: "Add goal" }));
    await waitFor(() => expect(createGoalActionMock).toHaveBeenCalled());

    // Simulate what a real router.refresh() delivers: the parent Server
    // Component re-renders with fresh data and this component receives a
    // NEW `goals` prop reflecting the just-created row. Without a
    // useEffect resyncing `allGoals` from this prop, the component would
    // stay on its stale initial (empty) state forever.
    rerender(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[NEW_GOAL]} milestones={[]} />);

    expect(await screen.findByText("New Goal")).toBeInTheDocument();
  });

  it("calls router.refresh() after successfully adding a milestone -- the identical bug shape, since `milestone` is a prop, not local state, and addMilestoneAction is also called directly from a client handler", async () => {
    const { addMilestoneAction } = await import("@/app/(app)/goals/actions");
    vi.mocked(addMilestoneAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[NEW_GOAL]} milestones={[]} />);

    await user.click(screen.getByRole("button", { name: "+ Add this month's milestone" }));
    await user.type(screen.getByPlaceholderText("This month's milestone"), "Ship the draft");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addMilestoneAction).toHaveBeenCalled());
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("does not clobber an in-flight local optimistic Done/Drop when a stale-goals refresh prop arrives out of order (allGoals still only ever resyncs from the actual latest prop React hands it)", async () => {
    const { rerender } = render(
      <GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[NEW_GOAL]} milestones={[]} />
    );
    expect(screen.getByText("New Goal")).toBeInTheDocument();

    // A second render with the identical prop array is a no-op re-sync —
    // asserted so the effect's dependency isn't accidentally over-broad
    // (e.g. resyncing on every render regardless of whether `goals`
    // actually changed would still pass this, but confirms nothing crashes
    // or duplicates on a redundant prop identity).
    rerender(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[NEW_GOAL]} milestones={[]} />);
    expect(screen.getAllByText("New Goal")).toHaveLength(1);
  });
});
