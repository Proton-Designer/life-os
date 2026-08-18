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
    expect(screen.getByRole("link", { name: /Co-op/ })).toHaveAttribute("href", "/co-op");
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

  it("shows a muted dash instead of 0% for a domain with a null pulse", () => {
    const snapshots: DomainSnapshots = {
      ...SNAPSHOTS,
      co_op: { ...SNAPSHOTS.co_op, pulse: null },
    };
    render(<DomainStatusStack snapshots={snapshots} />);
    expect(screen.getByRole("img", { name: "Not tracked today" })).toBeInTheDocument();
  });
});
