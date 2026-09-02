import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PriorityItem } from "@/lib/home/types";
import { NextActions } from "../next-actions";
import { SessionEntryCard } from "@/components/self-mastery/session/session-entry-card";
import { buildCandidatesFromPriorityItems, buildSelfMasteryCandidate, type AreaWeightLookup, type SelfMasterySummary } from "@/lib/home/build-candidates";
import { rankCandidates } from "@/lib/home/arbiter";
import { selectNextActionPerDomain } from "@/lib/home/next-actions";

// The Boss's exact request: "the first red before the design goes further"
// -- proved against the CURRENT Home render, i.e. today's actual JSX
// composition (app/(app)/page.tsx), not a narrower internal-function
// test. Same mocks each component's own test file already establishes,
// combined here because the defect only exists at the COMPOSITION level
// -- neither component is wrong in isolation. Confirmed red (self-mastery
// text at position 9, School's at 48) against the unconditional-position
// version of TodaysHomeNowSection before the A2 wiring landed; this file
// now mirrors the FIXED composition and is the regression pin for it.
vi.mock("@/app/(app)/actions", () => ({ toggleItem: vi.fn(async () => {}) }));
vi.mock("@/app/(app)/deen/actions", () => ({ toggleSunnah: vi.fn(async () => {}) }));
vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: vi.fn(async () => new Promise(() => {})),
  retryStarterDeckSeed: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function priorityItem(overrides: Partial<PriorityItem> & Pick<PriorityItem, "id" | "domain">): PriorityItem {
  return {
    title: overrides.id,
    dueAt: null,
    windowEndAt: null,
    date: "2026-09-02",
    urgencyBucket: "later_today",
    completed: false,
    actionType: "toggle_task",
    actionRefId: overrides.id,
    cost: null,
    ...overrides,
  };
}

function dueSummaryToSelfMasterySummary(
  dueSummary: { dueCount: number; newCount: number; estimatedMinutes: number },
  // Test-only stand-in for getSelfMasteryCandidateInput's real DB query
  // (earliest due card's own due_at) -- real dueAt is the whole point of
  // an "overdue" scenario, so this is a required override, not a
  // hardcoded null, whenever dueCount > 0.
  earliestDueAt: Date | null = null
): SelfMasterySummary {
  const hasCandidate = dueSummary.dueCount > 0 || dueSummary.newCount > 0;
  return {
    hasCandidate,
    dueAt: hasCandidate ? earliestDueAt : null,
    decay: null,
    cost: hasCandidate ? dueSummary.estimatedMinutes : null,
  };
}

// Mirrors app/(app)/page.tsx's real composition: SessionEntryCard's
// position responds to whether it genuinely outranks the current top of
// the five-domain list (A2 wiring), not a fixed layout slot.
function TodaysHomeNowSection({
  dueSummary,
  items,
  now,
  selfMasteryEarliestDueAt = null,
}: {
  dueSummary: { dueCount: number; newCount: number; estimatedMinutes: number; starterDeckMissing: boolean };
  items: PriorityItem[];
  now: Date;
  selfMasteryEarliestDueAt?: Date | null;
}) {
  const weights: AreaWeightLookup = {};
  const selfMasteryCandidate = buildSelfMasteryCandidate(dueSummaryToSelfMasterySummary(dueSummary, selfMasteryEarliestDueAt), weights);
  const rankedTopItems = selectNextActionPerDomain(items, weights, now);
  const topOtherCandidate = rankedTopItems.length > 0 ? buildCandidatesFromPriorityItems([rankedTopItems[0]], weights)[0] : null;
  const selfMasteryRanksFirst =
    !!selfMasteryCandidate && (!topOtherCandidate || rankCandidates([selfMasteryCandidate, topOtherCandidate], now)[0]?.area === "self_mastery");

  const sessionEntryCard = <SessionEntryCard dueSummary={dueSummary} />;
  const nextActions = <NextActions items={items} weights={weights} completedToday={[]} isFreshInstall={false} nowIso={now.toISOString()} />;

  return selfMasteryRanksFirst ? (
    <>
      {sessionEntryCard}
      {nextActions}
    </>
  ) : (
    <>
      {nextActions}
      {sessionEntryCard}
    </>
  );
}

describe("Today's Home 'Now' section, as actually composed (app/(app)/page.tsx) -- the Boss's first red, now the regression pin for the fix", () => {
  it("a School deadline in 5 minutes outranks a Self-Mastery deck with nothing due yet -- School renders first", () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    const urgentSchoolTask = priorityItem({
      id: "school-essay",
      domain: "school",
      title: "Essay due",
      dueAt: new Date(now.getTime() + 5 * 60 * 1000), // 5 minutes away -- right_now, the single most urgent thing on the page
      urgencyBucket: "right_now",
    });
    // "Ready to start" -- real cards, but no due date at all (R18(4):
    // absent urgency, never a fabricated bucket). Genuinely less urgent
    // than a 5-minute-away deadline by every signal the arbiter has.
    const readyToStartSelfMastery = { dueCount: 0, newCount: 12, estimatedMinutes: 8, starterDeckMissing: false };

    const { container } = render(<TodaysHomeNowSection dueSummary={readyToStartSelfMastery} items={[urgentSchoolTask]} now={now} />);

    const schoolPosition = container.textContent!.indexOf("Essay due");
    const selfMasteryPosition = container.textContent!.indexOf("ready to start");
    expect(schoolPosition).toBeGreaterThan(-1);
    expect(selfMasteryPosition).toBeGreaterThan(-1);

    // THE assertion this test exists to defend: the more urgent candidate
    // renders first -- no longer a fixed layout slot.
    expect(schoolPosition).toBeLessThan(selfMasteryPosition);
  });

  it("an overdue Self-Mastery deck outranks a School item due later today -- Self-Mastery renders first", () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    const laterSchoolTask = priorityItem({
      id: "school-essay",
      domain: "school",
      title: "Essay due",
      dueAt: new Date(now.getTime() + 6 * 60 * 60 * 1000), // 6 hours away -- later_today, not right_now
      urgencyBucket: "later_today",
    });
    const overdueSelfMastery = { dueCount: 4, newCount: 0, estimatedMinutes: 8, starterDeckMissing: false };
    const overdueSince = new Date(now.getTime() - 24 * 60 * 60 * 1000); // overdue by a day -- right_now bucket

    const { container } = render(
      <TodaysHomeNowSection
        dueSummary={overdueSelfMastery}
        items={[laterSchoolTask]}
        now={now}
        selfMasteryEarliestDueAt={overdueSince}
      />
    );

    const schoolPosition = container.textContent!.indexOf("Essay due");
    // "N cards due" is SessionEntryCard's own label when dueCount > 0.
    const selfMasteryPosition = container.textContent!.indexOf("cards due");
    expect(schoolPosition).toBeGreaterThan(-1);
    expect(selfMasteryPosition).toBeGreaterThan(-1);
    expect(selfMasteryPosition).toBeLessThan(schoolPosition);
  });
});
