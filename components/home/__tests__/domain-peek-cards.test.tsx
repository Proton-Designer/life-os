import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DomainPeekCards } from "../domain-peek-cards";
import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";

const NOW = new Date("2026-08-15T12:00:00Z");

function snapshots(prayerStatuses: { name: string; status: string }[]): DomainSnapshots {
  return {
    deen: {
      nextPrayer: null,
      prayerStatuses,
      quranWeekPages: 0,
      quranWeeklyTarget: null,
      habitFocusName: null,
      habitFocusStreak: 0,
      pulse: 0,
    },
    business: { activeSession: null, killListDone: 0, killListTotal: 3, weeklyRatioDisplay: "1:1", pulse: 0 },
    fitness: { scheduledWorkoutName: null, workoutDone: false, weeklyConsistency: 0, workoutsThisWeek: 0, pulse: 0 },
    school: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 0, pulse: 0 },
    co_op: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 0, pulse: 0 },
  };
}

describe("DomainPeekCards — prayer status dots", () => {
  it("colors an on-time prayer with the positive (business) accent", () => {
    render(
      <DomainPeekCards
        snapshots={snapshots([{ name: "fajr", status: "on_time" }])}
        now={NOW}
        domains={["deen"]}
      />
    );
    const dot = screen.getByTitle("Fajr");
    expect(dot.style.backgroundColor).toContain("--accent-business");
  });

  it("colors a qada (late) prayer with the warning (deen) accent", () => {
    render(
      <DomainPeekCards
        snapshots={snapshots([{ name: "dhuhr", status: "qada" }])}
        now={NOW}
        domains={["deen"]}
      />
    );
    const dot = screen.getByTitle("Dhuhr");
    expect(dot.style.backgroundColor).toContain("--accent-deen");
  });

  it("colors a missed prayer with the negative (destructive) accent", () => {
    render(
      <DomainPeekCards
        snapshots={snapshots([{ name: "asr", status: "missed" }])}
        now={NOW}
        domains={["deen"]}
      />
    );
    const dot = screen.getByTitle("Asr");
    expect(dot.style.backgroundColor).toContain("--destructive");
  });

  it("leaves a pending prayer unfilled", () => {
    render(
      <DomainPeekCards
        snapshots={snapshots([{ name: "isha", status: "pending" }])}
        now={NOW}
        domains={["deen"]}
      />
    );
    const dot = screen.getByTitle("Isha");
    expect(dot.style.backgroundColor).toBe("");
  });
});

describe("DomainPeekCards — next prayer countdown", () => {
  it("formats an overdue next prayer in hours, not raw minutes", () => {
    const snaps = snapshots([]);
    // 778 minutes before NOW.
    snaps.deen.nextPrayer = { name: "fajr", dueAt: new Date(NOW.getTime() - 778 * 60_000).toISOString() };
    render(<DomainPeekCards snapshots={snaps} now={NOW} domains={["deen"]} />);
    expect(screen.getByText(/13h overdue/)).toBeInTheDocument();
  });
});
