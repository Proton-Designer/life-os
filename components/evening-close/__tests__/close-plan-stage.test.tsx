import { act, render, screen, waitFor } from "@testing-library/react";
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

// Edit Plan (today) has no Save button: the dialog asks the stage to save through the function it registers.
let flush: (() => Promise<boolean>) | null = null;
const registerFlush = (f: () => Promise<boolean>) => {
  flush = f;
};
const closeEditPlan = () => act(async () => ({ saved: await flush!() }).saved);

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

const dumpLineMock = vi.fn(async (..._args: unknown[]) => ({ id: "new-id" }));
const refreshCloseViewsMock = vi.fn(async () => {});
const commitPlanMock = vi.fn(async (..._args: unknown[]): Promise<{ ok: true; killListOverflow: string[]; notices: string[] } | { error: string }> => ({ ok: true, killListOverflow: [], notices: [] }));
const claimSeedLinesMock = vi.fn(async (..._args: unknown[]): Promise<{ claimed: ClaimedSeed[] }> => ({ claimed: [] }));
const carryOverMock = vi.fn(async (..._args: unknown[]): Promise<{ lines: unknown[] } | { error: string }> => ({ lines: [] }));
const triageInboxItemMock = vi.fn(async (..._args: unknown[]): Promise<{ ok: true } | { error: string }> => ({ ok: true }));
vi.mock("@/app/(app)/close/plan-actions", () => ({
  dumpLine: (...args: unknown[]) => dumpLineMock(...args),
  refreshCloseViews: () => refreshCloseViewsMock(),
  commitPlan: (...args: unknown[]) => commitPlanMock(...args),
  claimSeedLines: (...args: unknown[]) => claimSeedLinesMock(...args),
  triageInboxItem: (...args: unknown[]) => triageInboxItemMock(...args),
  carryOverUnfinished: (...args: unknown[]) => carryOverMock(...args),
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
    expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "tonight", starred: ["new-task-1"], crowned: "new-task-1" }));
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

  it("a new line goes on TOP of the list (its domain/time/timer are set next, so it must not sit below the fold), and is first in the saved order", async () => {
    dumpLineMock.mockResolvedValue({ id: "new-id" });
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[{ id: "a", title: "Old one" }, { id: "b", title: "Old two" }]} mode="today" registerFlush={registerFlush} />);
    await user.type(screen.getByLabelText("Dump a line"), "Fresh task{Enter}");
    await screen.findByText("Fresh task");
    const removeOrder = screen.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"));
    expect(removeOrder).toEqual(["Remove Fresh task", "Remove Old one", "Remove Old two"]);
    await closeEditPlan();
    const call = commitPlanMock.mock.calls[0]![0] as { lines: { id: string; order: number }[] };
    expect(call.lines.map((l) => [l.id, l.order])).toEqual([["new-id", 0], ["a", 1], ["b", 2]]);
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

// P1a review F1: "Plan tonight" is only on the plan day once its write lands; savePlanRanks clears old
// ranks FIRST and then ranks by planned_date, so Finish must wait for the in-flight triage write.
describe("ClosePlanStage — Plan tonight then Finish fast (P1a F1)", () => {
  const inbox = [{ id: "n1", title: "Look into a standing desk" }];
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function planStarFinish(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Plan tonight: Look into a standing desk" }));
    await user.click(screen.getByRole("button", { name: "Star Look into a standing desk" }));
    await user.click(screen.getByRole("button", { name: "Crown Look into a standing desk" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
  }

  it("does not save ranks until the triage write has landed", async () => {
    let release!: () => void;
    triageInboxItemMock.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: true }))));
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={[]} mode="tonight" />);
    await planStarFinish(user);
    await waitFor(() => expect(triageInboxItemMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(commitPlanMock).not.toHaveBeenCalled(); // still waiting on the write
    release();
    await waitFor(() => expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "tonight", starred: ["n1"], crowned: "n1" })));
  });

  it("if the triage write fails, ranks are NOT saved (nothing cleared) and the error shows", async () => {
    let fail!: () => void;
    triageInboxItemMock.mockImplementationOnce(() => new Promise((r) => (fail = () => r({ error: "That item was already sorted." }))));
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[]} inbox={inbox} inboxAreas={[]} mode="tonight" />);
    await planStarFinish(user); // Finish is pressed while the write is still in flight
    fail();
    expect(await screen.findByText("That item was already sorted.")).toBeInTheDocument();
    expect(commitPlanMock).not.toHaveBeenCalled();
  });
});

// PLAN DETAILS (2026-10-06): every line can carry a domain, a start time and a timer; Business offers "Add to Kill List"
// (preselected). All of it rides along on the ONE commitPlan call at Finish.
describe("ClosePlanStage — line details", () => {
  const lines = [{ id: "t1", title: "Send the invoices" }, { id: "t2", title: "Gym" }];

  async function openDetails(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(screen.getByRole("button", { name: new RegExp(`^details for ${title}`, "i") }));
  }
  async function starCrownFinish(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(screen.getByRole("button", { name: new RegExp(`star ${title}`, "i") }));
    await user.click(screen.getByRole("button", { name: new RegExp(`crown ${title}`, "i") }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
  }

  beforeEach(() => commitPlanMock.mockClear());

  it("choosing Business preselects 'Add to Kill List'; Finish sends it", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} killList areas={["business", "school", "work", "body"]} />);
    await openDetails(user, "Send the invoices");
    await user.click(screen.getByRole("button", { name: "Business" }));
    expect(screen.getByTestId("plan-add-to-kill-list")).toBeChecked();
    await starCrownFinish(user, "Send the invoices");
    expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.arrayContaining([expect.objectContaining({ id: "t1", area: "business", addToKillList: true })]) }));
  });

  it("unchecking it keeps the line a Business task that is not on the Kill List", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} killList areas={["business"]} />);
    await openDetails(user, "Send the invoices");
    await user.click(screen.getByRole("button", { name: "Business" }));
    await user.click(screen.getByTestId("plan-add-to-kill-list"));
    await starCrownFinish(user, "Send the invoices");
    expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.arrayContaining([expect.objectContaining({ id: "t1", area: "business", addToKillList: false })]) }));
  });

  it("no Kill List on the account: the checkbox is absent and nothing is sent for it", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} areas={["business"]} />);
    await openDetails(user, "Send the invoices");
    await user.click(screen.getByRole("button", { name: "Business" }));
    expect(screen.queryByTestId("plan-add-to-kill-list")).not.toBeInTheDocument();
    await starCrownFinish(user, "Send the invoices");
    expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.arrayContaining([expect.objectContaining({ id: "t1", addToKillList: false })]) }));
  });

  it("Work and School say where the line goes", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} areas={["school", "work"]} />);
    await openDetails(user, "Gym");
    await user.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByText(/added to your work backlog/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "School" }));
    expect(screen.getByText(/added to your school tasks/i)).toBeInTheDocument();
  });

  it("a timer and a start time work with no domain, and Finish sends them (24-hour storage)", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} areas={[]} />);
    await openDetails(user, "Gym");
    // Timer: the exact-minutes box (the slider steps by 15; the box takes any value).
    await user.type(screen.getByLabelText("Timer minutes"), "90");
    await user.tab();
    // Start time: the pill opens an alarm-style wheel on 9:00 AM; ArrowUp on the hour wheel steps back to 6.
    await user.click(screen.getByRole("button", { name: /set start time/i }));
    const hour = screen.getByRole("listbox", { name: "Start time hour" });
    hour.focus();
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    await starCrownFinish(user, "Gym");
    expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.arrayContaining([expect.objectContaining({ id: "t2", area: null, startTime: "06:00", durationMinutes: 90 })]) }));
  });

  it("reorders and removes lines; the order and the removal reach commitPlan", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={[...lines, { id: "t3", title: "Read" }]} />);
    await user.click(screen.getByRole("button", { name: "Move Gym up" }));
    await user.click(screen.getByRole("button", { name: "Remove Read" }));
    await starCrownFinish(user, "Gym");
    const call = commitPlanMock.mock.calls[0]![0] as { lines: { id: string; order: number }[]; removed: string[] };
    expect(call.removed).toEqual(["t3"]);
    expect(call.lines.map((l) => [l.id, l.order])).toEqual([["t2", 0], ["t1", 1]]);
  });

  it("reports the summed timers of every line, and drops a removed line's time (Edit Plan's total banner)", async () => {
    const user = userEvent.setup();
    const onTotal = vi.fn();
    render(
      <ClosePlanStage
        mode="today"
        onTotalMinutesChange={onTotal}
        initialLines={[
          { id: "t1", title: "Send the invoices", durationMinutes: 45 },
          { id: "t2", title: "Gym", durationMinutes: 60 },
          { id: "t3", title: "Untimed" },
        ]}
      />,
    );
    expect(onTotal).toHaveBeenLastCalledWith(105);
    await user.click(screen.getAllByRole("button", { name: /^remove/i })[1]);
    expect(onTotal).toHaveBeenLastCalledWith(45);
  });

  it("opens an existing plan with its stars, crown, domain and timing already set (Edit Plan)", async () => {
    const user = userEvent.setup();
    render(
      <ClosePlanStage
        mode="today"
        registerFlush={registerFlush}
        areas={["business"]}
        killList
        initialLines={[
          { id: "t1", title: "Send the invoices", starred: true, crowned: true, area: "business", addToKillList: true, startTime: "09:00", durationMinutes: 45, order: 0 },
          { id: "t2", title: "Gym" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Unstar Send the invoices" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove crown from Send the invoices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^details for send the invoices/i })).toHaveTextContent("Business · Kill List · 9:00 AM · 45m");
    await user.click(screen.getByRole("button", { name: "Move Gym up" })); // a change (and back), so there is something to save
    await user.click(screen.getByRole("button", { name: "Move Gym down" }));
    await closeEditPlan();
    expect(commitPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "today", starred: ["t1"], crowned: "t1", lines: [expect.objectContaining({ id: "t1", area: "business", addToKillList: true, startTime: "09:00", durationMinutes: 45, order: 0 }), expect.objectContaining({ id: "t2", area: null })] }),
    );
  });

  it("says so when the Kill List was full, and shows an error from the commit", async () => {
    commitPlanMock.mockResolvedValueOnce({ ok: true, killListOverflow: ["Send the invoices"], notices: [] });
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} killList areas={["business"]} />);
    await starCrownFinish(user, "Send the invoices");
    expect(await screen.findByTestId("plan-notice")).toHaveTextContent("Kill List is already full");
  });

  it("an error from the commit is shown and nothing claims 'Saved'", async () => {
    commitPlanMock.mockResolvedValueOnce({ error: "Your plan wasn't saved." });
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={lines} />);
    await starCrownFinish(user, "Gym");
    expect(await screen.findByText("Your plan wasn't saved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
  });
});

// PACKAGE A (2026-10-07): Edit Plan always has a Save; the lines expand and collapse independently.
describe("ClosePlanStage — Save and expand/collapse", () => {
  const two = [{ id: "t1", title: "Send the invoices" }, { id: "t2", title: "Gym" }];
  beforeEach(() => commitPlanMock.mockClear());

  it("Edit Plan (today) has no Save button; closing it saves what changed (an empty rank set when nothing is starred) and says so", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={two} mode="today" registerFlush={registerFlush} />);
    expect(screen.queryByRole("button", { name: /Save plan|^Saved$|Finish/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-autosave")).toHaveTextContent("Everything is saved.");
    await user.click(screen.getByRole("button", { name: "Move Gym up" }));
    expect(screen.getByTestId("plan-autosave")).toHaveTextContent("Changes save when you close this.");
    expect(await closeEditPlan()).toBe(true);
    expect(commitPlanMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "today", starred: [], crowned: null }));
    await waitFor(() => expect(screen.getByTestId("plan-autosave")).toHaveTextContent("Everything is saved."));
  });

  it("closing with no changes writes nothing (positive control for the dirty rule)", async () => {
    render(<ClosePlanStage initialLines={two} mode="today" registerFlush={registerFlush} />);
    expect(await closeEditPlan()).toBe(true);
    expect(commitPlanMock).not.toHaveBeenCalled();
  });

  it("a failed save keeps Edit Plan open (flush says false) with the error shown, and the changes are still unsaved", async () => {
    commitPlanMock.mockResolvedValueOnce({ error: "Your plan wasn't saved." });
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={two} mode="today" registerFlush={registerFlush} />);
    await user.click(screen.getByRole("button", { name: "Move Gym up" }));
    expect(await closeEditPlan()).toBe(false);
    expect(screen.getByText("Your plan wasn't saved.")).toBeInTheDocument();
    expect(screen.getByTestId("plan-autosave")).toHaveTextContent("Changes save when you close this.");
  });

  it("a save with a notice to read keeps it open too (so the message isn't lost)", async () => {
    commitPlanMock.mockResolvedValueOnce({ ok: true, killListOverflow: ["Gym"], notices: [] });
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={two} mode="today" registerFlush={registerFlush} />);
    await user.click(screen.getByRole("button", { name: "Move Gym up" }));
    expect(await closeEditPlan()).toBe(false);
    expect(screen.getByTestId("plan-notice")).toHaveTextContent("Kill List is already full");
    expect(await closeEditPlan()).toBe(true); // saved already: the next close goes through
  });

  it("tonight with nothing starred shows no Finish, and says what Finish saves", () => {
    render(<ClosePlanStage initialLines={two} mode="tonight" />);
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
    expect(screen.getByText("Domains, times and timers are saved when you Finish.")).toBeInTheDocument();
  });

  it("two lines can be open at once; Collapse all closes both; Expand all opens both", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={two} />);
    const chevron = (t: string, verb: string) => screen.getByRole("button", { name: `${verb} details for ${t}` });
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    await user.click(chevron("Send the invoices", "Show"));
    await user.click(chevron("Gym", "Show"));
    expect(chevron("Send the invoices", "Hide")).toHaveAttribute("aria-expanded", "true");
    expect(chevron("Gym", "Hide")).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(chevron("Send the invoices", "Show")).toHaveAttribute("aria-expanded", "false");
    expect(chevron("Gym", "Show")).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(chevron("Gym", "Hide")).toBeInTheDocument();
  });

  it("removing an open line drops it from the open set", async () => {
    const user = userEvent.setup();
    render(<ClosePlanStage initialLines={two} mode="today" />);
    await user.click(screen.getByRole("button", { name: "Show details for Gym" }));
    await user.click(screen.getByRole("button", { name: "Remove Gym" }));
    expect(screen.queryByText("Gym")).not.toBeInTheDocument();
    // One line left: the bulk toggle is gone, and the remaining line starts collapsed.
    expect(screen.queryByRole("button", { name: /expand all|collapse all/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details for Send the invoices" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("ClosePlanStage - carry over unfinished", () => {
  const unfinished = (id: string, title: string) => ({ id, title, starred: false, crowned: false, area: null, addToKillList: false, startTime: null, durationMinutes: null, order: null, criteria: null, subdomain: null });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists today's unfinished lines and carries the ticked ones onto tomorrow's plan", async () => {
    const user = userEvent.setup();
    carryOverMock.mockResolvedValueOnce({ lines: [unfinished("a", "Call the bank")] });
    render(<ClosePlanStage initialLines={[]} carryOver={[unfinished("a", "Call the bank"), unfinished("b", "Email Sam")]} />);
    expect(screen.getByText("Unfinished today · 2")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Email Sam" })); // leave this one behind
    await user.click(screen.getByTestId("close-carry-over-button"));
    await waitFor(() => expect(carryOverMock).toHaveBeenCalledWith(["a"]));
    await waitFor(() => expect(screen.getByRole("button", { name: /star call the bank/i })).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Email Sam" })).toBeInTheDocument(); // still offered
  });

  it("shows nothing when there is nothing unfinished, and never in the replan (today) mode", () => {
    const { rerender } = render(<ClosePlanStage initialLines={[]} carryOver={[]} />);
    expect(screen.queryByTestId("close-carry-over")).not.toBeInTheDocument();
    rerender(<ClosePlanStage initialLines={[]} mode="today" carryOver={[unfinished("a", "x")]} />);
    expect(screen.queryByTestId("close-carry-over")).not.toBeInTheDocument();
  });

  it("keeps the list and shows the error when the move fails", async () => {
    const user = userEvent.setup();
    carryOverMock.mockResolvedValueOnce({ error: "boom" });
    render(<ClosePlanStage initialLines={[]} carryOver={[unfinished("a", "Call the bank")]} />);
    await user.click(screen.getByTestId("close-carry-over-button"));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByTestId("close-carry-over")).toBeInTheDocument();
  });
});

// The nightly close is ONE press: Finish saves and goes Home (Edit Plan is there if the plan needs a change).
describe("ClosePlanStage - Finish goes straight Home (tonight)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitPlanMock.mockResolvedValue({ ok: true, killListOverflow: [], notices: [] });
  });

  async function starCrownThenFinish(user: ReturnType<typeof userEvent.setup>) {
    render(<ClosePlanStage initialLines={[{ id: "t2", title: "Gym" }]} mode="tonight" />);
    await user.click(screen.getByRole("button", { name: /^star gym/i }));
    await user.click(screen.getByRole("button", { name: /crown gym/i }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
  }

  it("a clean save navigates to / and does not leave a second 'Back to Home' step behind", async () => {
    const user = userEvent.setup();
    await starCrownThenFinish(user);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(commitPlanMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("close-done")).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Home")).not.toBeInTheDocument();
  });

  it("a save with a notice to read stays put (so the message isn't lost) and offers the way Home", async () => {
    commitPlanMock.mockResolvedValue({ ok: true, killListOverflow: ["Gym"], notices: [] });
    const user = userEvent.setup();
    await starCrownThenFinish(user);
    expect(await screen.findByTestId("close-done")).toBeInTheDocument();
    expect(screen.getByTestId("plan-notice")).toHaveTextContent("Kill List is already full");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("a failed save does not navigate", async () => {
    commitPlanMock.mockResolvedValue({ error: "nope" });
    const user = userEvent.setup();
    await starCrownThenFinish(user);
    await screen.findByText(/nope/);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
