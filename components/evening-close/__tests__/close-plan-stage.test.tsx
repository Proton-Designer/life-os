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
const triageInboxItemMock = vi.fn(async (..._args: unknown[]): Promise<{ ok: true } | { error: string }> => ({ ok: true }));
vi.mock("@/app/(app)/close/plan-actions", () => ({
  dumpLine: (...args: unknown[]) => dumpLineMock(...args),
  refreshCloseViews: () => refreshCloseViewsMock(),
  savePlanRanks: (...args: unknown[]) => savePlanRanksMock(...args),
  claimSeedLines: (...args: unknown[]) => claimSeedLinesMock(...args),
  triageInboxItem: (...args: unknown[]) => triageInboxItemMock(...args),
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


// IA-P1a: the Inbox step — parked items triaged in one tap each (optimistic, per-item queue).
describe("ClosePlanStage — Inbox triage", () => {
  const inbox = [
    { id: "n1", title: "Look into a standing desk" },
    { id: "n2", title: "Email the registrar" },
  ];
  const areas: { value: "school" | "co_op"; label: string }[] = [
    { value: "school", label: "School" },
    { value: "co_op", label: "Work" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    triageInboxItemMock.mockImplementation(async () => ({ ok: true }));
  });

  it("renders nothing when the Inbox is empty", () => {
    render(<ClosePlanStage initialLines={[]} inbox={[]} inboxAreas={areas} />);
    expect(screen.queryByTestId("close-inbox")).toBeNull();
  });

  it("lists every parked item with the four triage actions (one task button per area the account has)", () => {
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={areas} />);
    const group = screen.getByTestId("close-inbox");
    expect(group).toHaveTextContent("Inbox · 2");
    for (const label of ["Plan tonight", "Task in School", "Task in Work", "It's a worry", "Done"]) {
      expect(screen.getByRole("button", { name: `${label}: Look into a standing desk` })).toBeInTheDocument();
    }
  });

  it("a domains account without Work is never offered 'Task in Work'", () => {
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={[areas[0]!]} />);
    expect(screen.queryByRole("button", { name: /Task in Work/ })).toBeNull();
  });

  it("Plan tonight: the item leaves the Inbox at once, becomes a plan line you can star, and the action gets mode", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={areas} mode="tonight" />);
    await user.click(screen.getByRole("button", { name: "Plan tonight: Look into a standing desk" }));
    expect(screen.getByRole("button", { name: "Star Look into a standing desk" })).toBeInTheDocument();
    expect(screen.getByTestId("close-inbox")).toHaveTextContent("Inbox · 1");
    await waitFor(() => expect(triageInboxItemMock).toHaveBeenCalledWith("n1", "plan", "tonight"));
  });

  it.each([
    ["Task in School", "school"],
    ["Task in Work", "co_op"],
    ["It's a worry", "worry"],
    ["Done", "done"],
  ])("%s sends %s and removes the item without adding a plan line", async (label, action) => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={areas} />);
    await user.click(screen.getByRole("button", { name: `${label}: Email the registrar` }));
    expect(screen.queryByRole("button", { name: new RegExp(`${label}: Email the registrar`) })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Star / })).toBeNull();
    await waitFor(() => expect(triageInboxItemMock).toHaveBeenCalledWith("n2", action, "tonight"));
  });

  it("a failed triage puts the item back in the Inbox and shows the error", async () => {
    triageInboxItemMock.mockImplementationOnce(async () => ({ error: "That item was already sorted." }));
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={areas} />);
    await user.click(screen.getByRole("button", { name: "Done: Look into a standing desk" }));
    expect(await screen.findByText("That item was already sorted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done: Look into a standing desk" })).toBeInTheDocument();
  });

  it("a failed Plan tonight takes the line back out as well as restoring the Inbox item", async () => {
    triageInboxItemMock.mockImplementationOnce(async () => ({ error: "nope" }));
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={areas} />);
    await user.click(screen.getByRole("button", { name: "Plan tonight: Look into a standing desk" }));
    await screen.findByText("nope");
    expect(screen.queryByRole("button", { name: "Star Look into a standing desk" })).toBeNull();
    expect(screen.getByRole("button", { name: "Plan tonight: Look into a standing desk" })).toBeInTheDocument();
  });
});
