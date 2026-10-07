import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CompletedItem, PriorityItem } from "@/lib/home/types";
import type { PlanItem } from "@/lib/plan/get-plan-items";

// Kept in its OWN file on purpose (same reason as components/shared/__tests__/task-row-list-exit.test.tsx): a test whose write
// never resolves elsewhere leaves a transition open, React entangles later ones with it, and a revert bug (the very thing
// under test) stops happening there.
const completePlan = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; message: string }> => ({ ok: true, message: "Saved." }));
const toggle = vi.fn(async (..._a: unknown[]): Promise<void> => {});
vi.mock("@/app/(app)/actions", () => ({ toggleItem: (...a: unknown[]) => toggle(...a), delayItem: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/(app)/open/today/plan-item-actions", () => ({ startPlanItem: vi.fn(), setPlanItemCompleted: (...a: unknown[]) => completePlan(...a), pausePlanItem: vi.fn() }));
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => ({ session: null, adoptSession: vi.fn(), expand: vi.fn(), pausedHints: {}, completedTaskIds: [], pauseSession: vi.fn(), completePlanSession: vi.fn() }) }));
vi.mock("@/app/(app)/business/actions", () => ({ refreshBusinessViews: async () => {} }));
vi.mock("@/components/home/use-home-refresh", () => ({ useHomeRefresh: () => () => {} }));

import { TodayTasks } from "../today-tasks";

const NOW_ISO = "2026-10-07T15:00:00.000Z";
const plan = (id: string, title: string, over: Partial<PlanItem> = {}): PlanItem => ({ id, title, area: null, startTime: null, durationMinutes: null, timerStartedAt: null, timerElapsedSeconds: 0, completed: false, mitRank: null, planOrder: null, killListItemId: null, classId: null, createdAt: "2026-10-06T20:00:00Z", ...over });
const task = (id: string, title: string, over: Partial<PriorityItem> = {}): PriorityItem => ({ id, domain: "school", title, dueAt: null, windowEndAt: null, date: "2026-10-07", urgencyBucket: "later_today", completed: false, actionType: "toggle_task", actionRefId: id.replace(/^task-/, ""), cost: null, ...over });
const done = (id: string, title: string): CompletedItem => ({ id, domain: "school", title, actionType: "toggle_task", actionRefId: id.replace(/^task-/, ""), completedAtIso: "2026-10-07T15:00:30.000Z" });

type Props = { plans: PlanItem[]; tasks: PriorityItem[]; completed?: CompletedItem[] };
const ui = ({ plans, tasks, completed = [] }: Props) => <TodayTasks planItems={plans} priorityItems={tasks} completedToday={completed} weights={{}} isFreshInstall={false} nowIso={NOW_ISO} deenMode={false} />;
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const markPlan = (t: string) => screen.queryByRole("button", { name: `Mark ${t} done` });
const markTask = (t: string) => screen.queryByRole("button", { name: `Mark "${t}" done` });

describe("Today: every row leaves the same way, and never comes back (Package F's rule, for both row kinds)", () => {
  it("a PLAN row: struck at once, then fades out after the beat, and is NOT back while the server list is still the old one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const props = { plans: [plan("p1", "Call the bank"), plan("p2", "Email Sam")], tasks: [] };
      render(ui(props));
      await user.click(markPlan("Call the bank")!);
      expect(screen.getByText("Call the bank")).toHaveClass("line-through");
      await advance(300);
      expect(screen.getAllByTestId("plan-row")).toHaveLength(2); // still the beat: nothing has left yet
      await advance(400); // beat (550) + part of the fade
      expect(screen.getAllByTestId("plan-row").some((r) => r.getAttribute("data-exiting") === "true")).toBe(true);
      await advance(1000);
      expect(markPlan("Call the bank")).not.toBeInTheDocument();
      await advance(4000); // the debounced refresh has not landed
      expect(markPlan("Call the bank")).not.toBeInTheDocument();
      expect(markPlan("Email Sam")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a PRIORITY row leaves the same way (strike, beat, fade) and stays gone after the write resolves with the OLD list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(ui({ plans: [], tasks: [task("task-a", "Essay"), task("task-b", "Problem set")] }));
      await user.click(markTask("Essay")!);
      await advance(1000);
      expect(markTask("Essay")).not.toBeInTheDocument();
      await advance(4000);
      expect(markTask("Essay")).not.toBeInTheDocument();
      expect(markTask("Problem set")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unrelated refresh (same data, both kinds still pending) does not resurrect either row; the confirming refresh takes over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const base = (): Props => ({ plans: [plan("p1", "Call the bank")], tasks: [task("task-a", "Essay")] });
      const { rerender } = render(ui(base()));
      await user.click(markPlan("Call the bank")!);
      await user.click(markTask("Essay")!);
      await advance(1500);
      rerender(ui(base())); // fresh data that predates both writes
      expect(markPlan("Call the bank")).not.toBeInTheDocument();
      expect(markTask("Essay")).not.toBeInTheDocument();
      rerender(ui({ plans: [plan("p1", "Call the bank", { completed: true })], tasks: [], completed: [done("task-a", "Essay")] })); // the server caught up
      expect(markPlan("Call the bank")).not.toBeInTheDocument();
      expect(markTask("Essay")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Completed" }));
      expect(screen.getByRole("button", { name: "Undo Call the bank" })).toBeInTheDocument();
      expect(screen.getByText("Essay")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the highlight moves on to the next row as soon as the focus row is ticked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(ui({ plans: [plan("p1", "Crowned line", { mitRank: 1 }), plan("p2", "Second line")], tasks: [] }));
      const focus = () => screen.getAllByRole("listitem").find((li) => li.dataset.emphasis === "focus")!;
      expect(focus()).toHaveTextContent("Crowned line");
      await user.click(markPlan("Crowned line")!);
      await advance(1000);
      expect(focus()).toHaveTextContent("Second line");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a plan write that fails AFTER the row left puts it back in Today with the server's message", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      completePlan.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: "Couldn't update that task. Try again." }), 900)));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(ui({ plans: [plan("p1", "Call the bank")], tasks: [] }));
      await user.click(markPlan("Call the bank")!);
      await advance(800);
      expect(markPlan("Call the bank")).not.toBeInTheDocument(); // left at the beat, the write still in flight
      await advance(300);
      expect(markPlan("Call the bank")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't update that task");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a priority write that fails after the row left puts it back with an inline error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      toggle.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error("network")), 900)));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(ui({ plans: [], tasks: [task("task-a", "Essay")] }));
      await user.click(markTask("Essay")!);
      await advance(800);
      expect(markTask("Essay")).not.toBeInTheDocument();
      await advance(300);
      expect(markTask("Essay")).toBeInTheDocument();
      expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Kill List: ticking line A does not hide line B when B arrives from the server (they have different row ids)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const kill = (id: string, text: string, first: boolean): PriorityItem => task(first ? "kill-list" : `kill-list-${id}`, text, { domain: "business", actionType: "toggle_kill_list", actionRefId: id });
      const { rerender } = render(ui({ plans: [], tasks: [kill("k1", "Ship it", true), kill("k2", "Call the vendor", false)] }));
      await user.click(markTask("Ship it")!);
      await advance(1500);
      // the server list after the refresh: A is completed, B is now the FIRST line (so it carries the id "kill-list")
      rerender(ui({ plans: [], tasks: [kill("k2", "Call the vendor", true)], completed: [{ id: "kill-list-k1", domain: "business", title: "Ship it", actionType: "toggle_kill_list", actionRefId: "k1", completedAtIso: "2026-10-07T15:00:30.000Z" }] }));
      expect(markTask("Call the vendor")).toBeInTheDocument();
      expect(markTask("Ship it")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
