import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClosePlanStage } from "../close-plan-stage";
import type { DumpItem } from "@/lib/night-plan/night-plan";
import type { ClaimedSeed } from "@/app/(app)/close/plan-actions";

/**
 * #28 production bug (found live 2026-09-15, Opus Lead): computePlanSeeds computed and
 * passed a school_risk seed as a prop, and this component's own isSeedable filter
 * silently dropped it before render — "Plan tomorrow" showed the empty state with a
 * real deliverable due tomorrow sitting unseeded. The prior #28 tests (app/(app)/close/
 * __tests__/actions.test.ts) only ever exercised computePlanSeeds, never this component,
 * which is exactly why nothing caught it. This file is the render-layer test that was
 * missing.
 */

const dumpLineMock = vi.fn(async (..._args: unknown[]) => ({ id: "new-id" }));
const refreshCloseViewsMock = vi.fn(async () => {});
const savePlanRanksMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const claimSeedLinesMock = vi.fn(async (..._args: unknown[]): Promise<{ claimed: ClaimedSeed[] }> => ({ claimed: [] }));
vi.mock("@/app/(app)/close/plan-actions", () => ({
  dumpLine: (...args: unknown[]) => dumpLineMock(...args),
  refreshCloseViews: () => refreshCloseViewsMock(),
  savePlanRanks: (...args: unknown[]) => savePlanRanksMock(...args),
  claimSeedLines: (...args: unknown[]) => claimSeedLinesMock(...args),
}));
const markWorryHandledMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/worries/actions", () => ({
  markWorryHandled: (...args: unknown[]) => markWorryHandledMock(...args),
}));

function schoolSeed(overrides: Partial<DumpItem> = {}): DumpItem {
  return { id: "assessment-1", title: "VERIFY-101 · Problem Set 3 · due Tue", source: "school_risk", ...overrides };
}

describe("ClosePlanStage — #28 school_risk seed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a school_risk seed in the dump, not the empty state", () => {
    render(<ClosePlanStage initialLines={[]} seeds={[schoolSeed()]} />);
    expect(screen.getByText("VERIFY-101 · Problem Set 3 · due Tue")).toBeInTheDocument();
    expect(screen.queryByText(/everything on your mind/i)).not.toBeInTheDocument();
  });

  it("labels a school_risk seed distinctly from a worry or goal seed", () => {
    render(<ClosePlanStage initialLines={[]} seeds={[schoolSeed()]} />);
    expect(screen.getByText("school")).toBeInTheDocument();
  });

  it("a school_risk seed can be starred and crowned exactly like a typed line", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} seeds={[schoolSeed()]} />);
    await user.click(screen.getByRole("button", { name: /star verify-101/i }));
    await user.click(screen.getByRole("button", { name: /crown verify-101/i }));
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it('offers "Not tonight" to dismiss a school_risk seed, purely locally — no server call', async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} seeds={[schoolSeed()]} />);
    await user.click(screen.getByRole("button", { name: "Not tonight" }));
    expect(screen.queryByText("VERIFY-101 · Problem Set 3 · due Tue")).not.toBeInTheDocument();
    expect(markWorryHandledMock).not.toHaveBeenCalled();
  });

  // The full path past render: claiming a school_risk seed at Finish must insert a real
  // dumped row (plan-actions.ts's own job), not just render — a render fix alone would
  // repeat the "built but never fully invoked" disease one step later.
  it("claims a school_risk seed via claimSeedLines at Finish, remapping its id before saving ranks", async () => {
    claimSeedLinesMock.mockResolvedValueOnce({ claimed: [{ seedId: "assessment-1", taskId: "new-task-1" }] });
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} seeds={[schoolSeed()]} />);

    await user.click(screen.getByRole("button", { name: /star verify-101/i }));
    await user.click(screen.getByRole("button", { name: /crown verify-101/i }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(claimSeedLinesMock).toHaveBeenCalledWith(
      [{ id: "assessment-1", title: "VERIFY-101 · Problem Set 3 · due Tue", source: "school_risk" }],
      "tonight"
    );
    expect(savePlanRanksMock).toHaveBeenCalledWith(["new-task-1"], "new-task-1", "tonight");
  });

  it("still renders worry and goal_milestone seeds unchanged alongside a school_risk one", () => {
    const seeds: DumpItem[] = [
      { id: "w1", title: "Call the landlord", source: "worry" },
      { id: "m1", title: "Ship the thing", source: "goal_milestone" },
      schoolSeed(),
    ];
    render(<ClosePlanStage initialLines={[]} seeds={seeds} />);
    expect(screen.getByText("Call the landlord")).toBeInTheDocument();
    expect(screen.getByText("Ship the thing")).toBeInTheDocument();
    expect(screen.getByText("VERIFY-101 · Problem Set 3 · due Tue")).toBeInTheDocument();
  });
});

// PERF-4: Add is tap-rate -- the draft clears at once, the line lands with its real id,
// a failed write restores the text, and ONE deferred refresh follows a burst.
describe("ClosePlanStage — Add (PERF-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dumpLineMock.mockResolvedValue({ id: "new-id" });
  });

  it("clears the draft immediately (while the write is in flight), then shows the line", async () => {
    let finish!: () => void;
    dumpLineMock.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({ id: "line-1" }))));
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} />);
    const input = screen.getByLabelText("Dump a line");
    await user.type(input, "Call the bank{Enter}");
    expect(input).toHaveValue("");
    expect(screen.queryByText("Call the bank")).not.toBeInTheDocument();
    finish();
    expect(await screen.findByText("Call the bank")).toBeInTheDocument();
  });

  it("a failed write puts the text back with the error", async () => {
    dumpLineMock.mockResolvedValueOnce({ error: "Could not save" } as never);
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} />);
    await user.type(screen.getByLabelText("Dump a line"), "Call the bank{Enter}");
    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.getByLabelText("Dump a line")).toHaveValue("Call the bank");
  });

  it("three quick lines run in order and schedule ONE deferred refresh", async () => {
    dumpLineMock.mockImplementation(async (title) => ({ id: `id-${title}` }));
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} />);
    const input = screen.getByLabelText("Dump a line");
    await user.type(input, "one{Enter}two{Enter}three{Enter}");
    await waitFor(() => expect(dumpLineMock).toHaveBeenCalledTimes(3));
    expect(dumpLineMock.mock.calls.map((c) => c[0])).toEqual(["one", "two", "three"]);
    await waitFor(() => expect(refreshCloseViewsMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });
});
