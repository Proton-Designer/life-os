import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import type { PriorityItem } from "@/lib/home/types";

// Package E: Mark Done beside Start, and Pause / Resume / Mark Done for inline timers and Deep Sessions, as they appear on the
// plan rows of Home's Today list. In its own file (like the other leave-cleanly tests: F's transition-entanglement trap).
const startMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, kind: "timer", startedAt: new Date().toISOString() }));
const pauseMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, kind: "timer", elapsedSeconds: 900 }));
const completeMock = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; message: string }> => ({ ok: true, message: "Saved." }));
vi.mock("@/app/(app)/open/today/plan-item-actions", () => ({ startPlanItem: (...a: unknown[]) => startMock(...a), pausePlanItem: (...a: unknown[]) => pauseMock(...a), setPlanItemCompleted: (...a: unknown[]) => completeMock(...a) }));
vi.mock("@/app/(app)/actions", () => ({ toggleItem: vi.fn(async () => {}), delayItem: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/(app)/business/actions", () => ({ refreshBusinessViews: async () => {} }));
vi.mock("@/components/home/use-home-refresh", () => ({ useHomeRefresh: () => () => {} }));
const lockIn = {
  session: null as null | { id: string; startedAtIso: string; planTaskId: string | null; bankedSeconds: number },
  adoptSession: vi.fn(),
  expand: vi.fn(),
  pausedHints: {} as Record<string, number>,
  completedTaskIds: [] as string[],
  pauseSession: vi.fn(async () => {}),
  completePlanSession: vi.fn(async (..._a: unknown[]) => {}),
};
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => lockIn }));

import { TodayTasks } from "../today-tasks";

const NOW_ISO = "2026-10-07T15:00:00.000Z";
const NOW = new Date(NOW_ISO).getTime();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const plan = (id: string, title: string, over: Partial<PlanItem> = {}): PlanItem => ({ id, title, area: null, startTime: null, durationMinutes: null, timerStartedAt: null, timerElapsedSeconds: 0, completed: false, mitRank: null, planOrder: null, killListItemId: null, classId: null, createdAt: "2026-10-06T20:00:00Z", ...over });
const ui = (plans: PlanItem[], tasks: PriorityItem[] = []) => <TodayTasks planItems={plans} priorityItems={tasks} completedToday={[]} weights={{}} isFreshInstall={false} nowIso={NOW_ISO} deenMode={false} />;
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const rowOf = (title: string) => screen.getAllByTestId("plan-row").find((r) => r.textContent?.includes(title))!;
const btn = (title: string, name: RegExp | string) => within(rowOf(title)).queryByRole("button", { name });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW_ISO));
  vi.clearAllMocks();
  lockIn.session = null;
  lockIn.pausedHints = {};
  lockIn.completedTaskIds = [];
});
afterEach(() => vi.useRealTimers());
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe("idle rows: Start with a subtle Mark Done", () => {
  it("a startable row has Start (primary) AND a Mark Done that is visibly secondary: text style, no fill, no border", () => {
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30 })]));
    const start = btn("Run", "Start Run")!;
    const done = btn("Run", "Mark Run done")!;
    expect(start.className).toContain("bg-primary");
    expect(done).toHaveTextContent("Mark Done");
    expect(done.className).toContain("text-muted-foreground");
    expect(done.className).not.toMatch(/bg-primary|border/);
  });

  it("the subtle Mark Done checks a task off WITHOUT starting it, and the row leaves like every other row", async () => {
    const u = user();
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30 }), plan("p2", "Other", { area: "body", durationMinutes: 10 })]));
    await u.click(btn("Run", "Mark Run done")!);
    expect(completeMock).toHaveBeenCalledWith("p1", true);
    expect(startMock).not.toHaveBeenCalled();
    expect(screen.getByText("Run")).toHaveClass("line-through");
    await advance(1500);
    expect(screen.queryByText("Run")).not.toBeInTheDocument();
  });

  it("a line with nothing to start keeps its single outline Mark Done (unchanged)", () => {
    render(ui([plan("p1", "Call the bank")]));
    const done = btn("Call the bank", "Mark Call the bank done")!;
    expect(done.className).toContain("border");
    expect(btn("Call the bank", /^Start/)).toBeNull();
    expect(btn("Call the bank", /^Pause/)).toBeNull();
  });
});

describe("running inline timer: readout, Pause, Mark Done", () => {
  it("shows the countdown from the START plus the BANKED time (a resumed timer does not restart from zero)", () => {
    // 30-minute timer, 10 min banked, running again for 2 min: 18:00 left
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerStartedAt: ago(120), timerElapsedSeconds: 600 })]));
    expect(within(rowOf("Run")).getByTestId("plan-timer")).toHaveTextContent("−18:00");
    expect(btn("Run", "Pause Run")).toBeInTheDocument();
    expect(btn("Run", "Complete Run")).toHaveTextContent("Mark Done");
    expect(btn("Run", /Stop timer/)).toBeNull(); // the old Stop (reset) is gone
  });

  it("a count-up timer (start time, no duration) counts up from the banked time", () => {
    render(ui([plan("p1", "Read", { startTime: "09:00", timerStartedAt: ago(120), timerElapsedSeconds: 600 })]));
    expect(within(rowOf("Read")).getByTestId("plan-timer")).toHaveTextContent("12:00");
  });

  it("Pause freezes the readout at once as 'Paused', calls the server, and offers Resume", async () => {
    const u = user();
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerStartedAt: ago(300) })]));
    await u.click(btn("Run", "Pause Run")!);
    expect(pauseMock).toHaveBeenCalledWith("p1");
    expect(within(rowOf("Run")).getByTestId("plan-timer")).toHaveTextContent("Paused · 15:00 left"); // the server banked 900 s
    expect(btn("Run", "Resume Run")).toBeInTheDocument();
    expect(btn("Run", "Pause Run")).toBeNull();
  });

  it("a refused Pause puts the running timer back and says why", async () => {
    pauseMock.mockResolvedValueOnce({ ok: false, message: "Couldn't pause that. Try again." });
    const u = user();
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerStartedAt: ago(300) })]));
    await u.click(btn("Run", "Pause Run")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't pause that");
    expect(btn("Run", "Pause Run")).toBeInTheDocument();
  });

  it("Mark Done on a RUNNING inline timer completes the line and the row leaves cleanly", async () => {
    const u = user();
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerStartedAt: ago(300) })]));
    await u.click(btn("Run", "Complete Run")!);
    expect(completeMock).toHaveBeenCalledWith("p1", true);
    await advance(1500);
    expect(screen.queryByTestId("plan-row")).not.toBeInTheDocument();
  });
});

describe("paused: frozen readout, Resume, subtle Mark Done", () => {
  it("a countdown shows 'Paused · mm:ss left' from the banked time", () => {
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerElapsedSeconds: 724 })]));
    expect(within(rowOf("Run")).getByTestId("plan-timer")).toHaveTextContent("Paused · 17:56 left");
    expect(btn("Run", "Resume Run")!.className).toContain("bg-primary");
    expect(btn("Run", "Mark Run done")!.className).not.toMatch(/bg-primary|border/);
  });

  it("a count-up shows 'Paused · mm:ss' (no 'left')", () => {
    render(ui([plan("p1", "Read", { startTime: "09:00", timerElapsedSeconds: 1390 })]));
    expect(within(rowOf("Read")).getByTestId("plan-timer")).toHaveTextContent(/^Paused · 23:10$/);
  });

  it("the frozen readout does not move while time passes", async () => {
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerElapsedSeconds: 600 })]));
    await advance(5000);
    expect(within(rowOf("Run")).getByTestId("plan-timer")).toHaveTextContent("Paused · 20:00 left");
  });

  it("Resume is the same server call as Start, and the timer then runs from the banked value, not from zero", async () => {
    startMock.mockResolvedValueOnce({ ok: true, kind: "timer", startedAt: new Date(NOW).toISOString() });
    const u = user();
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerElapsedSeconds: 600 })]));
    await u.click(btn("Run", "Resume Run")!);
    expect(startMock).toHaveBeenCalledWith("p1");
    expect(within(rowOf("Run")).getByTestId("plan-timer")).toHaveTextContent("−20:00"); // 30 min - 10 banked, just resumed
    expect(btn("Run", "Pause Run")).toBeInTheDocument();
  });

  it("Mark Done from a paused row completes it and the row leaves", async () => {
    const u = user();
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerElapsedSeconds: 600 })]));
    await u.click(btn("Run", "Mark Run done")!);
    expect(completeMock).toHaveBeenCalledWith("p1", true);
    await advance(1500);
    expect(screen.queryByTestId("plan-row")).not.toBeInTheDocument();
  });

  it("a COMPLETED line with time banked is not 'paused' (it is just done)", () => {
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30, timerElapsedSeconds: 600, completed: true })]));
    expect(screen.queryByTestId("plan-row")).not.toBeInTheDocument();
  });
});

describe("a Deep Session working on the line", () => {
  const session = (over = {}) => ({ id: "s1", startedAtIso: ago(300), planTaskId: "p1", bankedSeconds: 0, ...over });

  it("shows 'In session · mm:ss' (tap opens the overlay), Pause and Mark Done", async () => {
    lockIn.session = session();
    const u = user();
    render(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30 })]));
    const row = rowOf("Lab report");
    expect(within(row).getByTestId("plan-session-readout")).toHaveTextContent("In session · −25:00");
    expect(btn("Lab report", "Pause Lab report")).toBeInTheDocument();
    expect(btn("Lab report", "Complete Lab report")).toBeInTheDocument();
    await u.click(within(row).getByTestId("plan-session-readout"));
    expect(lockIn.expand).toHaveBeenCalled();
  });

  it("a resumed session continues from the banked time (banked + this session)", () => {
    lockIn.session = session({ bankedSeconds: 600 });
    render(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30, timerElapsedSeconds: 600 })]));
    expect(within(rowOf("Lab report")).getByTestId("plan-session-readout")).toHaveTextContent("In session · −15:00"); // 30 - 10 banked - 5 this session
  });

  it("Pause goes through the Lock-In provider (ends + banks the session), not the inline-timer path", async () => {
    lockIn.session = session();
    const u = user();
    render(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30 })]));
    await u.click(btn("Lab report", "Pause Lab report")!);
    expect(lockIn.pauseSession).toHaveBeenCalledTimes(1);
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it("Mark Done ends + banks the session and completes the line through the provider, and the row leaves", async () => {
    lockIn.session = session();
    const u = user();
    render(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30 })]));
    await u.click(btn("Lab report", "Complete Lab report")!);
    expect(lockIn.completePlanSession).toHaveBeenCalledWith({ announce: false });
    expect(completeMock).not.toHaveBeenCalled();
    await advance(1500);
    expect(screen.queryByTestId("plan-row")).not.toBeInTheDocument();
  });

  it("a session paused from the OVERLAY shows 'Paused' at once (the hint), before Home's refresh brings the banked time", () => {
    lockIn.pausedHints = { p1: 724 };
    render(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30 })]));
    expect(within(rowOf("Lab report")).getByTestId("plan-timer")).toHaveTextContent("Paused · 17:56 left");
    expect(btn("Lab report", "Resume Lab report")).toBeInTheDocument();
  });

  it("a line completed from the OVERLAY leaves Today cleanly (it does not linger until the refresh)", async () => {
    const { rerender } = render(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30 }), plan("p2", "Other", { area: "body", durationMinutes: 10 })]));
    expect(screen.getAllByTestId("plan-row")).toHaveLength(2);
    lockIn.completedTaskIds = ["p1"];
    rerender(ui([plan("p1", "Lab report", { area: "school", durationMinutes: 30 }), plan("p2", "Other", { area: "body", durationMinutes: 10 })]));
    await advance(1500);
    expect(screen.queryByText("Lab report")).not.toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("the FOCUS follows a running Deep Session even when its row is not first", () => {
    lockIn.session = session({ planTaskId: "p2" });
    render(ui([plan("p1", "Crowned line", { mitRank: 1 }), plan("p2", "Session line", { area: "school", durationMinutes: 30 })]));
    const rows = screen.getAllByRole("listitem").filter((li) => li.dataset.emphasis);
    expect(rows.find((r) => r.dataset.emphasis === "focus")).toHaveTextContent("Session line");
  });
});

describe("one list, one look: every row has its leading icon chip", () => {
  it("plan rows and priority rows both start with an icon chip (a plan line with no area gets the neutral one)", () => {
    const task: PriorityItem = { id: "task-a", domain: "school", title: "Essay", dueAt: null, windowEndAt: null, date: "2026-10-07", urgencyBucket: "later_today", completed: false, actionType: "toggle_task", actionRefId: "a", cost: null };
    render(ui([plan("p1", "Plain line"), plan("p2", "Run", { area: "body", durationMinutes: 30 })], [task]));
    const rows = screen.getAllByRole("listitem").filter((li) => li.dataset.emphasis);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.querySelector("[data-dim].rounded-xl, [data-dim] svg")).not.toBeNull();
    // the chip is the first dimmable thing in a plan row and carries an svg icon
    expect(rowOf("Plain line").querySelector("svg")).not.toBeNull();
  });

  it("the actions sit in their own right-aligned group that wraps under the title (a phone) instead of squeezing it", () => {
    render(ui([plan("p1", "Run", { area: "body", durationMinutes: 30 })]));
    const row = rowOf("Run");
    const line = row.querySelector("div.flex-wrap")!;
    expect(line).not.toBeNull();
    expect(line.querySelector("p")!.parentElement!.className).toContain("basis-[7.5rem]"); // the title never gets less than ~120px before the actions wrap
    expect(btn("Run", "Start Run")!.parentElement!.className).toContain("ml-auto");
  });
});
