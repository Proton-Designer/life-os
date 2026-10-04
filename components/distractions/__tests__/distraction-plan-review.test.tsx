import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/distractions/actions", () => ({
  updateTrigger: vi.fn(),
  saveActionPlan: vi.fn(),
  recordPlanOutcome: vi.fn(),
  refreshDistractionViews: vi.fn(async () => {}),
}));

import { DistractionPlanReview } from "../distraction-plan-review";
import { buildReviewGroups } from "@/lib/distractions/review-groups";
import type { TriggerSummary } from "@/lib/distractions/types";

const trig = (over: Partial<TriggerSummary> = {}): TriggerSummary => ({
  id: "t1",
  domain: "school",
  name: "Phone in class",
  description: null,
  totalCount: 2,
  todayCount: 1,
  lastOccurredAtIso: "2026-10-04T10:00:00Z",
  createdDate: "2026-10-01",
  currentPlan: { id: "p", body: "Phone in bag", version: 1, createdAtIso: "2026-10-01T00:00:00Z", followedCount: 0, skippedCount: 0, mustRewrite: false },
  ...over,
});

describe("DistractionPlanReview", () => {
  it("renders today's triggers as review cards grouped by domain", () => {
    render(<DistractionPlanReview groups={buildReviewGroups([trig()])} />);
    expect(screen.getByText("0 of 1 reviewed")).toBeInTheDocument();
    expect(screen.getByTestId("review-item-card")).toHaveTextContent("Phone in class");
  });
  it("shows the 'All plans' editor only when plans are passed (positive control: both cases)", () => {
    const { unmount } = render(<DistractionPlanReview groups={[]} />);
    expect(screen.queryByTestId("all-plans")).not.toBeInTheDocument();
    unmount();
    render(<DistractionPlanReview groups={[]} plans={[trig({ todayCount: 0 })]} />);
    expect(screen.getByTestId("all-plans")).toHaveTextContent("Phone in class");
  });
  it("says there is nothing to review when no trigger fired today", () => {
    render(<DistractionPlanReview groups={[]} />);
    expect(screen.getByText(/nothing to review/i)).toBeInTheDocument();
  });
});
