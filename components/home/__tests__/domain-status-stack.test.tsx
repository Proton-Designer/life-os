import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DomainStatusStack } from "../domain-status-stack";
import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";

const SNAPSHOTS: DomainSnapshots = {
  deen: {
    nextPrayer: null,
    prayerStatuses: [
      { name: "fajr", status: "on_time" },
      { name: "dhuhr", status: "qada" },
      { name: "asr", status: "pending" },
      { name: "maghrib", status: "pending" },
      { name: "isha", status: "pending" },
    ],
    quranWeekPages: 0,
    quranWeeklyTarget: null,
    habitFocusName: null,
    habitFocusStreak: 0,
    pulse: 0.4,
    qadaBacklogCount: 0,
  },
  business: { activeSession: null, killListDone: 1, killListTotal: 3, weeklyRatioDisplay: "1:1", pulse: 0.33 },
  fitness: { scheduledWorkoutName: null, workoutDone: false, weeklyConsistency: 0.8, workoutsThisWeek: 4, pulse: 0.8 },
  school: { dueTodayCount: 2, nextDueTitle: null, completedThisWeek: 1, pulse: 0.5 },
  co_op: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 0, pulse: 0 },
};

describe("DomainStatusStack", () => {
  it("renders all 5 domains as links to their own page", () => {
    render(<DomainStatusStack snapshots={SNAPSHOTS} />);
    expect(screen.getByRole("link", { name: /Deen/ })).toHaveAttribute("href", "/deen");
    expect(screen.getByRole("link", { name: /Work/ })).toHaveAttribute("href", "/work");
  });

  it("shows a domain-appropriate live metric per row", () => {
    render(<DomainStatusStack snapshots={SNAPSHOTS} />);
    expect(screen.getByText("2/5 prayers")).toBeInTheDocument();
    expect(screen.getByText("Kill list 1/3")).toBeInTheDocument();
    expect(screen.getByText("80% this week")).toBeInTheDocument();
    expect(screen.getByText("2 due today")).toBeInTheDocument();
    expect(screen.getByText("0 due today")).toBeInTheDocument();
  });

  it("renders an optional title inside the container, without a separate Panel wrapper", () => {
    render(<DomainStatusStack snapshots={SNAPSHOTS} title="Sector progress" />);
    expect(screen.getByText("Sector progress")).toBeInTheDocument();
  });

  it("does not mention qada in the Deen row when nothing is outstanding", () => {
    render(<DomainStatusStack snapshots={SNAPSHOTS} />);
    expect(screen.queryByText(/qada/i)).not.toBeInTheDocument();
  });

  it("surfaces outstanding qada in the Deen row's metric when non-zero — a doorway, not a new element", () => {
    const snapshots: DomainSnapshots = {
      ...SNAPSHOTS,
      deen: { ...SNAPSHOTS.deen, qadaBacklogCount: 3 },
    };
    render(<DomainStatusStack snapshots={snapshots} />);
    expect(screen.getByText("2/5 prayers · 3 qada")).toBeInTheDocument();
  });

  it("shows a muted dash instead of 0% for a domain with a null pulse", () => {
    const snapshots: DomainSnapshots = {
      ...SNAPSHOTS,
      co_op: { ...SNAPSHOTS.co_op, pulse: null },
    };
    render(<DomainStatusStack snapshots={snapshots} />);
    expect(screen.getByRole("img", { name: "Not tracked today" })).toBeInTheDocument();
  });

  it("shows Deen as 'Not tracked yet' with a dash ring, not 0/5 and a 0% ring, when the day hasn't closed and nothing is logged", () => {
    const snapshots: DomainSnapshots = {
      ...SNAPSHOTS,
      deen: {
        ...SNAPSHOTS.deen,
        prayerStatuses: [
          { name: "fajr", status: "upcoming" },
          { name: "dhuhr", status: "upcoming" },
          { name: "asr", status: "upcoming" },
          { name: "maghrib", status: "upcoming" },
          { name: "isha", status: "upcoming" },
        ],
        pulse: 0,
      },
    };
    render(<DomainStatusStack snapshots={snapshots} />);
    expect(screen.getByText("Not tracked yet")).toBeInTheDocument();
    expect(screen.queryByText("0/5 prayers")).not.toBeInTheDocument();
    // 6 rings total (5 sectors + none extra) — Deen's must be the dash one.
    expect(screen.getAllByRole("img", { name: "Not tracked today" })).toHaveLength(1);
  });

  it("still reports a real 0/5 with a real 0% ring once every prayer window has closed with nothing logged — a genuine bad day, not an absence of data", () => {
    const snapshots: DomainSnapshots = {
      ...SNAPSHOTS,
      deen: {
        ...SNAPSHOTS.deen,
        prayerStatuses: [
          { name: "fajr", status: "missed" },
          { name: "dhuhr", status: "missed" },
          { name: "asr", status: "missed" },
          { name: "maghrib", status: "missed" },
          { name: "isha", status: "missed" },
        ],
        pulse: 0,
      },
    };
    render(<DomainStatusStack snapshots={snapshots} />);
    expect(screen.getByText("0/5 prayers")).toBeInTheDocument();
    expect(screen.queryByText("Not tracked yet")).not.toBeInTheDocument();
  });

  it("keeps a real qada backlog visible even while today is 'Not tracked yet'", () => {
    const snapshots: DomainSnapshots = {
      ...SNAPSHOTS,
      deen: {
        ...SNAPSHOTS.deen,
        prayerStatuses: [
          { name: "fajr", status: "upcoming" },
          { name: "dhuhr", status: "upcoming" },
          { name: "asr", status: "upcoming" },
          { name: "maghrib", status: "upcoming" },
          { name: "isha", status: "upcoming" },
        ],
        pulse: 0,
        qadaBacklogCount: 4,
      },
    };
    render(<DomainStatusStack snapshots={snapshots} />);
    expect(screen.getByText("Not tracked yet · 4 qada")).toBeInTheDocument();
  });

  describe("visibleDomains gating", () => {
    it("shows only the passed domains, in canonical order, when the caller opts in", () => {
      render(<DomainStatusStack snapshots={SNAPSHOTS} visibleDomains={["deen", "school"]} />);
      expect(screen.getByRole("link", { name: /Deen/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /School/ })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Business/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Fitness/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Work/ })).not.toBeInTheDocument();
    });

    it("renders nothing at all when every domain is gated out, rather than an empty frame", () => {
      const { container } = render(<DomainStatusStack snapshots={SNAPSHOTS} visibleDomains={[]} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("defaults to all 5 domains when the caller doesn't pass visibleDomains at all -- every existing/legacy caller is unaffected", () => {
      render(<DomainStatusStack snapshots={SNAPSHOTS} />);
      expect(screen.getByRole("link", { name: /Deen/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Business/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Fitness/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /School/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Work/ })).toBeInTheDocument();
    });
  });
});
