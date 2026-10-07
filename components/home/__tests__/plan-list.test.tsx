import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import type { StartPlanItemResult } from "@/app/(app)/open/today/plan-item-actions";

const SESSION = { id: "s1", startedAtIso: "2026-10-06T14:00:00.000Z", kind: "deep_work" as const, goalMinutes: 60, objectives: [] };
const startMock = vi.fn(async (..._a: unknown[]): Promise<StartPlanItemResult> => ({ ok: true, kind: "session", sessionKind: "deep_work", session: SESSION }));
const lockIn = { session: null as unknown, adoptSession: vi.fn(), expand: vi.fn() };
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => lockIn }));
vi.mock("@/app/(app)/business/actions", () => ({ refreshBusinessViews: async () => {} }));
const completeMock = vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Saved." }));
const stopMock = vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Stopped." }));
vi.mock("@/app/(app)/open/today/plan-item-actions", () => ({
  startPlanItem: (...a: unknown[]) => startMock(...a),
  setPlanItemCompleted: (...a: unknown[]) => completeMock(...a),
  stopPlanItemTimer: (...a: unknown[]) => stopMock(...a),
}));
vi.mock("@/components/home/use-home-refresh", () => ({ useHomeRefresh: () => () => {} }));

import { PlanList } from "../plan-list";

const NOW_ISO = "2026-10-06T14:00:00.000Z";

function plan(over: Partial<PlanItem> & Pick<PlanItem, "id" | "title">): PlanItem {
  return { area: null, startTime: null, durationMinutes: null, timerStartedAt: null, completed: false, mitRank: null, planOrder: null, killListItemId: null, classId: null, createdAt: "2026-10-05T20:00:00Z", ...over };
}

describe("PlanList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockIn.session = null;
  });

  it("renders nothing for an empty plan", () => {
    const { container } = render(<PlanList items={[]} nowIso={NOW_ISO} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the one action that fits each task, to the right of it", () => {
    render(
      <PlanList
        nowIso={NOW_ISO}
        items={[
          plan({ id: "b", title: "Ship the proposal", area: "business", durationMinutes: 90 }),
          plan({ id: "s", title: "Study stats", area: "school", durationMinutes: 120 }),
          plan({ id: "sn", title: "Finish the HW", area: "school" }),
          plan({ id: "f", title: "Run", area: "body", startTime: "06:30" }),
          plan({ id: "n", title: "Call the bank" }),
          plan({ id: "bn", title: "Email the client", area: "business" }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Start Ship the proposal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Study stats" })).toBeInTheDocument(); // School: always a Deep Study start
    expect(screen.getByRole("button", { name: "Start Run" })).toBeInTheDocument();
    // No timing: Complete only, never Start.
    expect(screen.getByRole("button", { name: "Mark Call the bank done" })).toHaveTextContent("Mark Done");
    expect(screen.queryByRole("button", { name: "Start Call the bank" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Email the client done" })).toBeInTheDocument();
    // School with no start time and no timer is just marked done, like any other domain.
    expect(screen.getByRole("button", { name: "Mark Finish the HW done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Finish the HW" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Email the client" })).not.toBeInTheDocument();
  });

  it("shows the domain, the 12-hour start time and the timer on the row", () => {
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "a", title: "Study 3 hours for Stats", area: "school", startTime: "05:00", durationMinutes: 180 })]} />);
    const row = screen.getByTestId("plan-row");
    expect(within(row).getByText("School · 5:00 AM · 3h")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("05:00");
  });

  it("keeps the order it is given", () => {
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "1", title: "First" }), plan({ id: "2", title: "Second" })]} />);
    expect(screen.getAllByTestId("plan-row").map((r) => r.textContent)).toEqual([expect.stringContaining("First"), expect.stringContaining("Second")]);
  });

  it("Start on a session task calls the server action with that task", async () => {
    const user = userEvent.setup();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "b", title: "Ship", area: "business", durationMinutes: 60 })]} />);
    await user.click(screen.getByRole("button", { name: "Start Ship" }));
    expect(startMock).toHaveBeenCalledWith("b");
  });

  it("Start on an inline-timer task shows the timer, a stop and Done", async () => {
    startMock.mockResolvedValueOnce({ ok: true, kind: "timer", startedAt: new Date().toISOString() });
    const user = userEvent.setup();
    render(<PlanList nowIso={new Date().toISOString()} items={[plan({ id: "f", title: "Run", area: "body", durationMinutes: 30 })]} />);
    await user.click(screen.getByRole("button", { name: "Start Run" }));
    expect(await screen.findByTestId("plan-timer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Run" })).toHaveTextContent("Done");
    await user.click(screen.getByRole("button", { name: "Stop timer for Run" }));
    expect(stopMock).toHaveBeenCalledWith("f");
    expect(await screen.findByRole("button", { name: "Start Run" })).toBeInTheDocument();
  });

  it("a timer already running on load is shown (survives a reload)", () => {
    const started = new Date(new Date(NOW_ISO).getTime() - 5 * 60_000).toISOString();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "f", title: "Run", area: "body", durationMinutes: 30, timerStartedAt: started })]} />);
    expect(screen.getByTestId("plan-timer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Run" })).not.toBeInTheDocument();
  });

  it("a started session opens the Lock-In overlay at once (the provider is told, not left to a refresh)", async () => {
    const user = userEvent.setup();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "b", title: "Ship", area: "business", durationMinutes: 60 })]} />);
    await user.click(screen.getByRole("button", { name: "Start Ship" }));
    await waitFor(() => expect(lockIn.adoptSession).toHaveBeenCalledWith(SESSION));
  });

  it("with a session already running, Start opens it instead of asking the server to refuse", async () => {
    lockIn.session = SESSION;
    const user = userEvent.setup();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "b", title: "Ship", area: "business", durationMinutes: 60 })]} />);
    await user.click(screen.getByRole("button", { name: "Start Ship" }));
    expect(startMock).not.toHaveBeenCalled();
    expect(lockIn.expand).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("already running");
  });

  it("a refused Start says why on the row", async () => {
    startMock.mockResolvedValueOnce({ ok: false, message: "A session is already running. End it first." });
    const user = userEvent.setup();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "b", title: "Ship", area: "business", durationMinutes: 60 })]} />);
    await user.click(screen.getByRole("button", { name: "Start Ship" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A session is already running");
  });

  it("Complete checks the task off and moves it to the done list, with Undo", async () => {
    const user = userEvent.setup();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "n", title: "Call the bank" })]} />);
    await user.click(screen.getByRole("button", { name: "Mark Call the bank done" }));
    expect(completeMock).toHaveBeenCalledWith("n", true);
    await waitFor(() => expect(screen.queryByTestId("plan-row")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Undo Call the bank" }));
    expect(completeMock).toHaveBeenLastCalledWith("n", false);
    expect(await screen.findByTestId("plan-row")).toBeInTheDocument();
  });

  it("a failed Complete puts the task back with the error", async () => {
    completeMock.mockResolvedValueOnce({ ok: false, message: "Couldn't update that task. Try again." });
    const user = userEvent.setup();
    render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "n", title: "Call the bank" })]} />);
    await user.click(screen.getByRole("button", { name: "Mark Call the bank done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't update that task");
    expect(screen.getByTestId("plan-row")).toBeInTheDocument();
  });

  // Package F: fresh server data that PREDATES a write must not resurrect the row. The local state used to be wiped on ANY
  // items change, so an unrelated refresh landing while the write was still in flight put a ticked row back in Pending.
  it("an unrelated refresh while the write is in flight does not resurrect a ticked row; the confirming refresh takes over", async () => {
    let resolveSave!: (v: { ok: boolean; message: string }) => void;
    completeMock.mockImplementationOnce(() => new Promise((r) => (resolveSave = r)));
    const user = userEvent.setup();
    const { rerender } = render(<PlanList nowIso={NOW_ISO} items={[plan({ id: "n", title: "Call the bank" }), plan({ id: "m", title: "Email Sam" })]} />);
    await user.click(screen.getByRole("button", { name: "Mark Call the bank done" }));
    expect(screen.queryByRole("button", { name: "Mark Call the bank done" })).not.toBeInTheDocument();
    rerender(<PlanList nowIso={NOW_ISO} items={[plan({ id: "n", title: "Call the bank" }), plan({ id: "m", title: "Email Sam" })]} />); // unrelated refresh: same data, the write has not landed
    expect(screen.queryByRole("button", { name: "Mark Call the bank done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo Call the bank" })).toBeInTheDocument();
    resolveSave({ ok: true, message: "Saved." });
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    rerender(<PlanList nowIso={NOW_ISO} items={[plan({ id: "n", title: "Call the bank", completed: true }), plan({ id: "m", title: "Email Sam" })]} />); // the server caught up
    expect(screen.queryByRole("button", { name: "Mark Call the bank done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo Call the bank" })).toBeInTheDocument();
    // and once confirmed, the server is the truth again: an Undo from elsewhere shows it pending
    rerender(<PlanList nowIso={NOW_ISO} items={[plan({ id: "n", title: "Call the bank" }), plan({ id: "m", title: "Email Sam" })]} />);
    expect(screen.getByRole("button", { name: "Mark Call the bank done" })).toBeInTheDocument();
  });
});

