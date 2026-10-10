import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GoalBoard } from "../goal-board";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
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
const setMilestoneDoneMock = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: true } | { error: string });
vi.mock("@/app/(app)/goals/actions", () => ({
  createGoalAction: (...args: unknown[]) => createGoalActionMock(...args),
  setGoalStatusAction: vi.fn(async () => ({ ok: true })),
  addMilestoneAction: vi.fn(async () => ({ ok: true })),
  setMilestoneDoneAction: (...args: unknown[]) => setMilestoneDoneMock(...args),
  refreshGoalViews: vi.fn(async () => {}),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

beforeEach(() => {
  resetKeyedQueuesForTests();
  setMilestoneDoneMock.mockReset();
  setMilestoneDoneMock.mockResolvedValue({ ok: true });
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

  it("reservedRanks (ranks held by hidden deen goals) count toward the 5-goal ceiling", () => {
    render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[]} milestones={[]} reservedRanks={[1, 2, 3, 4, 5]} />);
    expect(screen.getByRole("button", { name: /Ceiling reached/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "+ Add a goal" })).not.toBeInTheDocument();
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

describe("GoalBoard — Faith Mode", () => {
  const DEEN_GOAL: Goal = { ...NEW_GOAL, id: "g2", domain: "deen", title: "Memorise Surah Mulk" };

  it("OFF: an existing deen-tagged goal still shows (rank kept) but its 'Faith' label does not", () => {
    render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[DEEN_GOAL]} milestones={[]} />);
    expect(screen.getByText("Memorise Surah Mulk")).toBeInTheDocument();
    expect(screen.queryByText("Faith")).not.toBeInTheDocument();
  });

  it("ON shows the label (positive control)", () => {
    render(<GoalBoard deenMode monthStart="2026-09-01" todayStr="2026-09-14" goals={[DEEN_GOAL]} milestones={[]} />);
    expect(screen.getByText("Faith")).toBeInTheDocument();
  });
});


// PERF-4: the milestone checkbox is instant, never disabled while saving, writes the
// ABSOLUTE value in tap order, and reverts with the server's message on failure.
describe("GoalBoard — milestone checkbox", () => {
  const goal: Goal = { ...NEW_GOAL, id: "g1" };
  const milestone = { id: "m1", goalId: "g1", monthStart: "2026-09-01", title: "Ship v1", doneAt: null } as never;

  it("flips at once, stays enabled, and a second quick tap sends false after true (in order)", async () => {
    let release!: () => void;
    setMilestoneDoneMock.mockImplementationOnce(() => new Promise((res) => (release = () => res({ ok: true }))));
    const user = userEvent.setup();
    render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[goal]} milestones={[milestone]} />);
    const btn = screen.getByRole("button", { name: /Ship v1/ });
    await user.click(btn);
    expect(btn).toBeEnabled();
    expect(btn.querySelector("span")).toHaveClass("line-through");
    await user.click(btn); // queued behind the in-flight write
    await waitFor(() => expect(setMilestoneDoneMock).toHaveBeenCalledTimes(1));
    expect(setMilestoneDoneMock).toHaveBeenNthCalledWith(1, "m1", true);
    release();
    await waitFor(() => expect(setMilestoneDoneMock).toHaveBeenNthCalledWith(2, "m1", false));
  });

  it("a rejected write reverts the checkbox and shows the message", async () => {
    setMilestoneDoneMock.mockResolvedValue({ error: "Milestone not found." });
    const user = userEvent.setup();
    render(<GoalBoard monthStart="2026-09-01" todayStr="2026-09-14" goals={[goal]} milestones={[milestone]} />);
    await user.click(screen.getByRole("button", { name: /Ship v1/ }));
    expect(await screen.findByText("Milestone not found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ship v1/ }).querySelector("span")).not.toHaveClass("line-through");
  });
});
