import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PriorityItem, CompletedItem } from "@/lib/home/types";

vi.mock("@/app/(app)/actions", () => ({
  toggleItem: vi.fn(async () => {}),
  delayItem: vi.fn(async () => ({ ok: true })),
}));

// sunnah-disclosure.tsx (rendered via renderExpanded for prayer rows) pulls
// toggleSunnah from Deen's own actions module — a separate module from the
// one mocked above.
vi.mock("@/app/(app)/deen/actions", () => ({
  setSunnah: vi.fn(async () => {}),
}));

import { delayItem, toggleItem } from "@/app/(app)/actions";
import { TodayTasks } from "../today-tasks";
import type { PlanItem } from "@/lib/plan/get-plan-items";

// The unified Today list (components/home/today-tasks.tsx) replaced NextActions. Every behaviour below that NextActions
// guaranteed for its priority rows is kept; what changed is asserted explicitly in the new "Today" describes at the end
// (all of a domain's items, not one; prayers are not rows; plan rows are part of the list).
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => ({ session: null, adoptSession: vi.fn(), expand: vi.fn(), pausedHints: {}, completedTaskIds: [], pauseSession: vi.fn(), completePlanSession: vi.fn() }) }));
vi.mock("@/app/(app)/business/actions", () => ({ refreshBusinessViews: async () => {} }));
vi.mock("@/app/(app)/open/today/plan-item-actions", () => ({ startPlanItem: vi.fn(), setPlanItemCompleted: vi.fn(async () => ({ ok: true, message: "Saved." })), pausePlanItem: vi.fn() }));
vi.mock("@/components/home/use-home-refresh", () => ({ useHomeRefresh: () => () => {} }));

function Today(props: { items: PriorityItem[]; completedToday: CompletedItem[]; isFreshInstall: boolean; nowIso: string; weights: Record<string, never>; planItems?: PlanItem[] }) {
  return <TodayTasks planItems={props.planItems ?? []} priorityItems={props.items} completedToday={props.completedToday} isFreshInstall={props.isFreshInstall} nowIso={props.nowIso} weights={props.weights} deenMode />;
}

// A fixed instant, deliberately far from real wall-clock time — any test
// asserting relative-time text this way is proof the text was seeded from
// `nowIso`, not from whatever `new Date()` happens to return when the test
// runs.
const NOW_ISO = "2026-08-17T22:00:00.000Z";
const NOW_MS = new Date(NOW_ISO).getTime();

function item(overrides: Partial<PriorityItem> & Pick<PriorityItem, "id" | "domain">): PriorityItem {
  return {
    title: overrides.id,
    dueAt: null,
    windowEndAt: null,
    date: "2026-08-17",
    urgencyBucket: "later_today",
    completed: false,
    actionType: "toggle_task",
    actionRefId: overrides.id,
    cost: null,
    ...overrides,
  };
}

function completedItem(overrides: Partial<CompletedItem> & Pick<CompletedItem, "id" | "domain">): CompletedItem {
  return {
    title: overrides.id,
    actionType: "toggle_task",
    actionRefId: overrides.id,
    completedAtIso: "2026-08-17T18:00:00.000Z",
    ...overrides,
  };
}

describe("TodayTasks (priority rows)", () => {
  // The four (active, completed) combinations, explicitly — the regression
  // this covers (2026-08-25, caught in production): "nothing pending, but
  // something completed today" rendered a blank gap (an empty <ul>) with
  // no "all clear" message above the Completed section, because the old
  // condition only showed the empty state when BOTH active and completed
  // were empty, instead of whenever active alone was empty. This is the
  // single most common end-of-day state once the app is in real use.
  describe("the four active/completed combinations", () => {
    it("nothing at all: shows the all-clear empty state with a planning link, no Completed section", () => {
      render(<Today items={[]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      expect(screen.getByText("You're all clear")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Plan the week" })).toHaveAttribute("href", "#weekly-focus");
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    });

    it("only active: shows the row, no all-clear message, no Completed section", () => {
      render(
        <Today
          items={[item({ id: "fajr", domain: "deen", title: "Fajr" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO} weights={{}}
        />
      );
      expect(screen.getByText("Fajr")).toBeInTheDocument();
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument();
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    });

    it("only completed: STILL shows the all-clear message (nothing left to DO), plus the Completed section beneath it — the production regression", async () => {
      const user = userEvent.setup();
      render(
        <Today
          items={[]}
          completedToday={[completedItem({ id: "fajr", domain: "deen", title: "Fajr" })]}
          isFreshInstall={false}
          nowIso={NOW_ISO} weights={{}}
        />
      );
      expect(screen.getByText("You're all clear")).toBeInTheDocument();
      const completedToggle = screen.getByRole("button", { name: "Completed" });
      expect(completedToggle).toBeInTheDocument();
      await user.click(completedToggle);
      expect(screen.getByText("Fajr")).toBeInTheDocument();
    });

    it("both active and completed: shows the active row, no all-clear message, plus the Completed section", async () => {
      const user = userEvent.setup();
      render(
        <Today
          items={[item({ id: "dhuhr", domain: "deen", title: "Dhuhr" })]}
          completedToday={[completedItem({ id: "fajr", domain: "deen", title: "Fajr" })]}
          isFreshInstall={false}
          nowIso={NOW_ISO} weights={{}}
        />
      );
      expect(screen.getByText("Dhuhr")).toBeInTheDocument();
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Completed" }));
      expect(screen.getByText("Fajr")).toBeInTheDocument();
    });
  });

  // The fitness row lives outside TaskRowList entirely (navigate-away, not
  // toggle/log), so it needs its own deliberate call: "all clear" would be
  // a lie while a workout is still outstanding, regardless of what the
  // active/completed task combinations look like.
  describe("fitness interacting with the all-clear message", () => {
    it("fitness pending, nothing else: shows the fitness row, no all-clear message, no Completed section", () => {
      render(
        <Today
          items={[item({ id: "fitness-today", domain: "fitness", title: "Push Day A", actionType: "open_fitness" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO} weights={{}}
        />
      );
      expect(screen.getByRole("link", { name: /Push Day A/ })).toBeInTheDocument();
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument();
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    });

    it("fitness pending plus something completed: shows the fitness row AND the Completed section, but no all-clear message", async () => {
      const user = userEvent.setup();
      render(
        <Today
          items={[item({ id: "fitness-today", domain: "fitness", title: "Push Day A", actionType: "open_fitness" })]}
          completedToday={[completedItem({ id: "fajr", domain: "deen", title: "Fajr" })]}
          isFreshInstall={false}
          nowIso={NOW_ISO} weights={{}}
        />
      );
      expect(screen.getByRole("link", { name: /Push Day A/ })).toBeInTheDocument();
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument();
      const completedToggle = screen.getByRole("button", { name: "Completed" });
      expect(completedToggle).toBeInTheDocument();
      await user.click(completedToggle);
      expect(screen.getByText("Fajr")).toBeInTheDocument();
    });
  });

  it("shows the fresh-install copy instead when isFreshInstall and nothing is pending", () => {
    render(<Today items={[]} completedToday={[]} isFreshInstall nowIso={NOW_ISO} weights={{}} />);
    expect(screen.getByText("Welcome — head into a domain tab to get started")).toBeInTheDocument();
  });

  it("renders one row per domain with its title", () => {
    const items = [
      item({ id: "fajr", domain: "deen", title: "Fajr" }),
      item({ id: "kill-list", domain: "business", title: "Ship the proposal" }),
    ];
    render(<Today items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);

    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByText("Ship the proposal")).toBeInTheDocument();
  });

  it("corrects a stale nowIso (a Router-Cache-served hour-old payload) via the effect's immediate tick", () => {
    // The seed alone would show a due time computed against an hour-old
    // clock; the immediate tick inside the effect must correct it to the
    // real current time before anything is asserted here.
    const staleNowIso = new Date(Date.now() - 60 * 60_000).toISOString();
    const items = [
      item({
        id: "fajr",
        domain: "deen",
        title: "Fajr",
        dueAt: new Date(Date.now() + 45 * 60_000),
        urgencyBucket: "later_today",
      }),
    ];
    render(<Today items={items} completedToday={[]} isFreshInstall={false} nowIso={staleNowIso} weights={{}} />);
    expect(screen.getByText("in 45m")).toBeInTheDocument();
  });

  it("shows Now (only once) for the single earliest right_now item", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    try {
      const items = [
        item({
          id: "fajr",
          domain: "deen",
          title: "Fajr",
          dueAt: new Date(NOW_MS + 10 * 60_000),
          urgencyBucket: "right_now",
        }),
        item({
          id: "workout",
          domain: "fitness",
          title: "Run",
          dueAt: new Date(NOW_MS + 60 * 60_000),
          urgencyBucket: "right_now",
        }),
        item({ id: "task-1", domain: "school", title: "Essay", urgencyBucket: "later_today" }),
      ];
      render(<Today items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);

      expect(screen.getAllByText(/^Now/)).toHaveLength(1);
      const fajrRow = screen.getByText("Fajr").closest("li");
      expect(fajrRow).not.toBeNull();
      expect(fajrRow!.textContent).toContain("Now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses the redundant relative-time text when the badged item's time would also read Now", () => {
    // Fake timers, same reason as the window-status test below — without
    // pinning the clock, the mount effect's immediate re-tick to the real
    // wall clock would make this item read as several days overdue instead
    // of "Now".
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    try {
      const items = [
        item({
          id: "fajr",
          domain: "deen",
          title: "Fajr",
          dueAt: new Date(NOW_MS), // due this instant — formatRelativeDuration("Now")
          urgencyBucket: "right_now",
        }),
      ];
      render(<Today items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);

      const fajrRow = screen.getByText("Fajr").closest("li");
      expect(fajrRow).not.toBeNull();
      // "Now" shows exactly once — not doubled into "Now · Now".
      expect(fajrRow!.textContent?.match(/Now/g)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks an item done via toggleItem instantly (checkbox+strikethrough), then removes it from the active list after the confirm beat", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(toggleItem).mockResolvedValue(undefined);
      const items = [item({ id: "fajr", domain: "deen", title: "Fajr" })];
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Today items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);

      const button = screen.getByRole("button", { name: 'Mark "Fajr" done' });
      await user.click(button);

      expect(toggleItem).toHaveBeenCalledWith(items[0]);
      // Still on screen immediately — instant visual response, not yet removed.
      expect(screen.getByText("Fajr")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(600);
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: 'Mark "Fajr" done' })).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a fitness row that navigates to /fitness instead of completing in place", () => {
    const items = [item({ id: "fitness-today", domain: "fitness", title: "Push Day A", actionType: "open_fitness" })];
    render(<Today items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);

    expect(screen.getByRole("link", { name: /Push Day A/ })).toHaveAttribute("href", "/fitness");
  });

  describe("Delay", () => {
    it("shows a Delay button on a task and a kill-list row, left of the meta; a prayer is not a row at all (it lives in the Right now strip)", () => {
      render(
        <Today
          items={[
            item({ id: "t1", domain: "school", title: "Read ch. 4", actionType: "toggle_task" }),
            item({ id: "kill-list", domain: "business", title: "Ship it", actionType: "toggle_kill_list" }),
            item({ id: "prayer-asr", domain: "deen", title: "Asr", actionType: "toggle_prayer", actionRefId: "asr" }),
          ]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
          weights={{}}
        />
      );
      const delay = screen.getByRole("button", { name: 'Delay "Read ch. 4" until tomorrow' });
      expect(screen.getByRole("button", { name: 'Delay "Ship it" until tomorrow' })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Delay "Asr"/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Asr")).not.toBeInTheDocument();
      // DOM order: the Delay button comes before the "Today" meta of its own row.
      const row = delay.closest("li")!;
      const todayMeta = Array.from(row.querySelectorAll("span")).find((s) => s.textContent === "Today")!;
      expect(delay.compareDocumentPosition(todayMeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("delays the item (not completes it) and drops the row from Today", async () => {
      const user = userEvent.setup();
      vi.mocked(toggleItem).mockClear();
      vi.mocked(delayItem).mockClear();
      render(
        <Today
          items={[item({ id: "t1", domain: "school", title: "Read ch. 4", actionType: "toggle_task" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
          weights={{}}
        />
      );
      await user.click(screen.getByRole("button", { name: 'Delay "Read ch. 4" until tomorrow' }));
      await waitFor(() => expect(delayItem).toHaveBeenCalledWith(expect.objectContaining({ actionRefId: "t1", actionType: "toggle_task" })));
      expect(toggleItem).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText("Read ch. 4")).not.toBeInTheDocument());
    });

    it("keeps the row and shows the reason when the delay is refused", async () => {
      const user = userEvent.setup();
      vi.mocked(delayItem).mockResolvedValueOnce({ ok: false, message: "Tomorrow's Kill List is already full" } as never);
      render(
        <Today
          items={[item({ id: "kill-list", domain: "business", title: "Ship it", actionType: "toggle_kill_list" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
          weights={{}}
        />
      );
      await user.click(screen.getByRole("button", { name: 'Delay "Ship it" until tomorrow' }));
      expect(await screen.findByText("Tomorrow's Kill List is already full")).toBeInTheDocument();
      expect(screen.getByText("Ship it")).toBeInTheDocument();
    });
  });

  // PACKAGE D: what is NEW about the unified list.
  describe("the unified Today list", () => {
    const plan = (over: Partial<PlanItem> & Pick<PlanItem, "id" | "title">): PlanItem => ({ area: null, startTime: null, durationMinutes: null, timerStartedAt: null, timerElapsedSeconds: 0, completed: false, mitRank: null, planOrder: null, killListItemId: null, classId: null, createdAt: "2026-08-16T20:00:00Z", ...over });
    const titles = () => screen.getAllByRole("listitem").filter((li) => li.dataset.emphasis).map((li) => li.textContent ?? "");

    it("shows ALL of a domain's items (the old Now module kept one per domain)", () => {
      render(<Today items={[item({ id: "t1", domain: "school", title: "Essay" }), item({ id: "t2", domain: "school", title: "Problem set" }), item({ id: "t3", domain: "school", title: "Reading" })]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      for (const t of ["Essay", "Problem set", "Reading"]) expect(screen.getByText(t)).toBeInTheDocument();
    });

    it("orders the crown, then the starred lines, then the rest of the plan, then the other priority items", () => {
      render(
        <Today
          planItems={[plan({ id: "r", title: "Plain line" }), plan({ id: "s", title: "Starred line", mitRank: 2 }), plan({ id: "c", title: "Crowned line", mitRank: 1 })]}
          items={[item({ id: "t1", domain: "school", title: "School task" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
          weights={{}}
        />,
      );
      const rows = titles();
      expect(rows.findIndex((t) => t.includes("Crowned line"))).toBe(0);
      expect(rows.findIndex((t) => t.includes("Starred line"))).toBe(1);
      expect(rows.findIndex((t) => t.includes("Plain line"))).toBe(2);
      expect(rows.findIndex((t) => t.includes("School task"))).toBe(3);
    });

    it("highlights the first row (Focus label, tinted) and dims ONLY the content of the others (title, meta, icon), back to full on hover", () => {
      render(<Today planItems={[plan({ id: "c", title: "Crowned line", mitRank: 1 }), plan({ id: "b", title: "Second line", area: "body", durationMinutes: 30 })]} items={[item({ id: "t1", domain: "school", title: "School task" })]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      const rows = screen.getAllByRole("listitem").filter((li) => li.dataset.emphasis);
      expect(rows.map((r) => r.dataset.emphasis)).toEqual(["focus", "dim", "dim"]);
      expect(rows[0]).toHaveTextContent("Focus");
      expect(rows[1]).not.toHaveTextContent("Focus");
      // the dim is a rule on [data-dim] content, NOT an opacity on the whole row
      expect(rows[1]!.className).toContain("[&_[data-dim]]:opacity-70");
      expect(rows[1]!.className).toContain("hover:[&_[data-dim]]:opacity-100");
      expect(rows[1]!.className).not.toMatch(/(^| )opacity-70/);
      // title, meta and icon are marked; the action buttons are NOT inside anything dimmed
      expect(within(rows[1]!).getByText("Second line")).toHaveAttribute("data-dim");
      expect(within(rows[1]!).getByText("Fitness · 30m")).toHaveAttribute("data-dim");
      expect(rows[1]!.querySelector("[data-dim] button, button[data-dim]")).toBeNull();
      expect(within(rows[1]!).getByRole("button", { name: "Start Second line" }).closest("[data-dim]")).toBeNull();
      // priority rows follow the same rule: Delay is an action, the title/meta/chip are dimmed content
      expect(within(rows[2]!).getByRole("button", { name: /^Delay/ }).closest("[data-dim]")).toBeNull();
      expect(within(rows[2]!).getByText("School task").closest("[data-dim]")).not.toBeNull();
    });

    it("the highlight moves to the row with a RUNNING timer", () => {
      const started = new Date(new Date(NOW_ISO).getTime() - 5 * 60_000).toISOString();
      render(<Today planItems={[plan({ id: "c", title: "Crowned line", mitRank: 1 }), plan({ id: "run", title: "Running line", area: "body", durationMinutes: 30, timerStartedAt: started })]} items={[]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      const rows = screen.getAllByRole("listitem").filter((li) => li.dataset.emphasis);
      expect(rows.find((r) => r.dataset.emphasis === "focus")).toHaveTextContent("Running line");
    });

    it("never lists a prayer, even when one is passed in", () => {
      render(<Today items={[item({ id: "prayer-asr", domain: "deen", title: "Asr", actionType: "toggle_prayer", actionRefId: "asr" })]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      expect(screen.queryByText("Asr")).not.toBeInTheDocument();
      expect(screen.getByText("You're all clear")).toBeInTheDocument();
    });

    it("a plan line is never shown twice when it also arrives as a priority item (same task row)", () => {
      render(<Today planItems={[plan({ id: "uuid-1", title: "Finish the HW", area: "school" })]} items={[item({ id: "task-uuid-1", domain: "school", title: "Finish the HW", actionRefId: "uuid-1" })]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      expect(screen.getAllByText("Finish the HW")).toHaveLength(1);
      expect(screen.getByTestId("plan-row")).toBeInTheDocument();
    });

    it("several Kill List lines each get a row, with a Delay on each", () => {
      render(<Today items={[item({ id: "kill-list", domain: "business", title: "Ship it", actionType: "toggle_kill_list", actionRefId: "k1" }), item({ id: "kill-list-k2", domain: "business", title: "Call the vendor", actionType: "toggle_kill_list", actionRefId: "k2" })]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} weights={{}} />);
      expect(screen.getByRole("button", { name: 'Delay "Ship it" until tomorrow' })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: 'Delay "Call the vendor" until tomorrow' })).toBeInTheDocument();
    });
  });
});

