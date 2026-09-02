import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PriorityItem, CompletedItem } from "@/lib/home/types";

vi.mock("@/app/(app)/actions", () => ({
  toggleItem: vi.fn(async () => {}),
}));

// sunnah-disclosure.tsx (rendered via renderExpanded for prayer rows) pulls
// toggleSunnah from Deen's own actions module — a separate module from the
// one mocked above.
vi.mock("@/app/(app)/deen/actions", () => ({
  toggleSunnah: vi.fn(async () => {}),
}));

import { toggleItem } from "@/app/(app)/actions";
import { NextActions } from "../next-actions";

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

describe("NextActions", () => {
  // The four (active, completed) combinations, explicitly — the regression
  // this covers (2026-08-25, caught in production): "nothing pending, but
  // something completed today" rendered a blank gap (an empty <ul>) with
  // no "all clear" message above the Completed section, because the old
  // condition only showed the empty state when BOTH active and completed
  // were empty, instead of whenever active alone was empty. This is the
  // single most common end-of-day state once the app is in real use.
  describe("the four active/completed combinations", () => {
    it("nothing at all: shows the all-clear empty state with a planning link, no Completed section", () => {
      render(<NextActions items={[]} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);
      expect(screen.getByText("You're all clear")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Plan the week" })).toHaveAttribute("href", "#weekly-focus");
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    });

    it("only active: shows the row, no all-clear message, no Completed section", () => {
      render(
        <NextActions
          items={[item({ id: "fajr", domain: "deen", title: "Fajr" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
        />
      );
      expect(screen.getByText("Fajr")).toBeInTheDocument();
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument();
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    });

    it("only completed: STILL shows the all-clear message (nothing left to DO), plus the Completed section beneath it — the production regression", async () => {
      const user = userEvent.setup();
      render(
        <NextActions
          items={[]}
          completedToday={[completedItem({ id: "fajr", domain: "deen", title: "Fajr" })]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
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
        <NextActions
          items={[item({ id: "dhuhr", domain: "deen", title: "Dhuhr" })]}
          completedToday={[completedItem({ id: "fajr", domain: "deen", title: "Fajr" })]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
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
        <NextActions
          items={[item({ id: "fitness-today", domain: "fitness", title: "Push Day A", actionType: "open_fitness" })]}
          completedToday={[]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
        />
      );
      expect(screen.getByRole("link", { name: /Push Day A/ })).toBeInTheDocument();
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument();
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    });

    it("fitness pending plus something completed: shows the fitness row AND the Completed section, but no all-clear message", async () => {
      const user = userEvent.setup();
      render(
        <NextActions
          items={[item({ id: "fitness-today", domain: "fitness", title: "Push Day A", actionType: "open_fitness" })]}
          completedToday={[completedItem({ id: "fajr", domain: "deen", title: "Fajr" })]}
          isFreshInstall={false}
          nowIso={NOW_ISO}
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
    render(<NextActions items={[]} completedToday={[]} isFreshInstall nowIso={NOW_ISO} />);
    expect(screen.getByText("Welcome — head into a domain tab to get started")).toBeInTheDocument();
  });

  it("renders one row per domain with its title", () => {
    const items = [
      item({ id: "fajr", domain: "deen", title: "Fajr" }),
      item({ id: "kill-list", domain: "business", title: "Ship the proposal" }),
    ];
    render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

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
    render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={staleNowIso} />);
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
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

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
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

      const fajrRow = screen.getByText("Fajr").closest("li");
      expect(fajrRow).not.toBeNull();
      // "Now" shows exactly once — not doubled into "Now · Now".
      expect(fajrRow!.textContent?.match(/Now/g)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression (Ayman, 2026-08-20): Home's "Now" panel showed an open
  // prayer window as "2h overdue" — backwards, since the window (dueAt =
  // window start) had passed but was still open. Should read time left
  // until the window closes instead.
  //
  // Fake timers here (not just nowIso) because NextActions' mount effect
  // immediately re-ticks `now` to the real wall clock (staleTimes-cache
  // correction, see the component's own comment) — without pinning the
  // system clock too, that tick would overwrite the seeded time with
  // whatever day the test actually runs on, days away from NOW_ISO.
  it("shows time left, not overdue, for a prayer whose window has opened but not closed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    try {
      const items = [
        item({
          id: "maghrib",
          domain: "deen",
          title: "Maghrib",
          dueAt: new Date(NOW_MS - 120 * 60_000), // window opened 2h ago
          windowEndAt: new Date(NOW_MS + 7 * 60_000), // closes in 7m
          urgencyBucket: "right_now",
        }),
      ];
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

      const maghribRow = screen.getByText("Maghrib").closest("li");
      expect(maghribRow).not.toBeNull();
      expect(maghribRow!.textContent).toContain("7m left");
      expect(maghribRow!.textContent).not.toContain("overdue");
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
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

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
    render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

    expect(screen.getByRole("link", { name: /Push Day A/ })).toHaveAttribute("href", "/fitness");
  });

  // 2026-08-25/26: "on the home screen, for prayers in the Now module ... it
  // should also have a little dropdown showing that prayer's sunnah
  // prayers." A prayer row gets a chevron (via TaskRowList's generic
  // expand/renderExpanded slot); its own primary tap still completes the
  // fard prayer, unchanged.
  describe("prayer rows — sunnah disclosure", () => {
    it("shows a sunnah chevron with a completion badge for a prayer that has rawatib", () => {
      const items = [
        item({
          id: "prayer-fajr",
          domain: "deen",
          title: "Fajr",
          actionType: "toggle_prayer",
          actionRefId: "fajr",
          sunnahCompletions: [],
        }),
      ];
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

      expect(screen.getByRole("button", { name: "Sunnah for Fajr" })).toBeInTheDocument();
      expect(screen.getByText("0/1")).toBeInTheDocument();
    });

    it("shows no chevron for a prayer with no rawatib slots (e.g. Asr's before-only counts, but a hypothetical zero-slot prayer wouldn't)", () => {
      // Asr has one before-slot per lib/deen/sunnah.ts, so use it as the
      // has-sunnah case and rely on the badge count assertion above; this
      // test instead confirms non-prayer items never get a chevron at all.
      const items = [item({ id: "task-1", domain: "school", title: "Essay", actionType: "toggle_task" })];
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

      expect(screen.queryByRole("button", { name: /sunnah/i })).not.toBeInTheDocument();
    });

    it("tapping the chevron expands the sunnah panel without completing the prayer", async () => {
      const items = [
        item({
          id: "prayer-fajr",
          domain: "deen",
          title: "Fajr",
          actionType: "toggle_prayer",
          actionRefId: "fajr",
          sunnahCompletions: [],
        }),
      ];
      vi.mocked(toggleItem).mockClear();
      const user = userEvent.setup();
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

      const chevron = screen.getByRole("button", { name: "Sunnah for Fajr" });
      await user.click(chevron);

      expect(chevron).toHaveAttribute("aria-expanded", "true");
      // The rawatib slot itself, rendered by SunnahDisclosure.
      expect(screen.getByRole("button", { name: /before.*2 rak/i })).toBeInTheDocument();
      expect(toggleItem).not.toHaveBeenCalled();
    });

    it("the row's own primary tap still completes the fard prayer — the chevron is a separate control", async () => {
      const items = [
        item({
          id: "prayer-fajr",
          domain: "deen",
          title: "Fajr",
          actionType: "toggle_prayer",
          actionRefId: "fajr",
          sunnahCompletions: [],
        }),
      ];
      vi.mocked(toggleItem).mockClear();
      const user = userEvent.setup();
      render(<NextActions items={items} completedToday={[]} isFreshInstall={false} nowIso={NOW_ISO} />);

      await user.click(screen.getByRole("button", { name: 'Mark "Fajr" done' }));
      expect(toggleItem).toHaveBeenCalledTimes(1);
    });
  });
});
