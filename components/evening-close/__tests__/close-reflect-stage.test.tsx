import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CloseReflectStage } from "../close-reflect-stage";
import type { HabitWithStatus } from "@/lib/habits/queries";
import { DAILY_FIELDS } from "@/lib/habits/__tests__/daily-fixture";

const NO_PLAN = { todaysThree: [], hoursTodayMinutes: 90, weekdayBaselines: null, weekdayIndex: 1, activeHabits: [] as HabitWithStatus[] };

function habit(overrides: Partial<HabitWithStatus> = {}): HabitWithStatus {
  return {
    id: "h1",
    identityStatement: "the reader",
    rank: 1,
    votedToday: false,
    isNew: false,
    score: 0.6,
    voteCount: 10,
    ...DAILY_FIELDS,
    streak: { count: 0, unit: "day" },
    ...overrides,
  };
}

describe("CloseReflectStage — Delta/Efficiency close-out stats (#38)", () => {
  it("omits Delta/Efficiency entirely when Start Day was never tapped today", () => {
    render(<CloseReflectStage {...NO_PLAN} deltaMinutes={null} />);
    expect(screen.queryByText(/Awake/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Efficiency/)).not.toBeInTheDocument();
  });

  it("renders Delta and Efficiency together once a wake mark exists today", () => {
    // 90 focused minutes over a 180-minute delta = 50%.
    render(<CloseReflectStage {...NO_PLAN} deltaMinutes={180} />);
    expect(screen.getByText("3h")).toBeInTheDocument(); // Delta, formatDurationMagnitude(180)
    expect(screen.getByText("50%")).toBeInTheDocument(); // Efficiency
  });

  it("still renders Hours and the Day Won verdict alongside Delta/Efficiency", () => {
    render(
      <CloseReflectStage
        todaysThree={[]}
        hoursTodayMinutes={240}
        weekdayBaselines={[0, 4, 4, 4, 4, 4, 2]}
        weekdayIndex={1}
        deltaMinutes={300}
        activeHabits={[]}
      />
    );
    expect(screen.getByText("4:00")).toBeInTheDocument(); // formatHoursMinutes(240)
    expect(screen.getByText(/Day won/)).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument(); // 240/300
  });
});

// P3-04: today's habit-vote display, distinct from the Weekly Review's own
// "N this week" habit-score section.
describe("CloseReflectStage — habit-vote display (P3-04)", () => {
  it("renders nothing at all when there are no active habits -- absent, not a '0 of 0'", () => {
    render(<CloseReflectStage {...NO_PLAN} deltaMinutes={null} />);
    expect(screen.queryByText(/Habits/)).not.toBeInTheDocument();
  });

  it("shows the today X/Y count and Voted/Not yet per habit", () => {
    render(
      <CloseReflectStage
        {...NO_PLAN}
        deltaMinutes={null}
        activeHabits={[
          habit({ id: "h1", identityStatement: "the reader", votedToday: true }),
          habit({ id: "h2", identityStatement: "the early riser", votedToday: false }),
        ]}
      />
    );
    expect(screen.getByText("1/2 today")).toBeInTheDocument();
    expect(screen.getByText("the reader")).toBeInTheDocument();
    expect(screen.getByText("the early riser")).toBeInTheDocument();
    expect(screen.getByText("Voted")).toBeInTheDocument();
    expect(screen.getByText("Not yet")).toBeInTheDocument();
  });

  it("counts every active habit toward the total even while isNew (a new habit still gets a vote-today state)", () => {
    render(
      <CloseReflectStage
        {...NO_PLAN}
        deltaMinutes={null}
        activeHabits={[habit({ isNew: true, score: null, votedToday: true })]}
      />
    );
    expect(screen.getByText("1/1 today")).toBeInTheDocument();
    expect(screen.getByText("Voted")).toBeInTheDocument();
  });

  it("habits that aren't due today are left out of the count and the list (HABIT-FREQ), unless already voted", () => {
    const NOT_DUE = { due: false, doneToday: false, progress: null, nextDueDate: null, statusText: "Next: Wed" };
    render(
      <CloseReflectStage
        {...NO_PLAN}
        deltaMinutes={null}
        activeHabits={[
          habit({ id: "h1", identityStatement: "the reader", votedToday: true }),
          habit({ id: "h2", identityStatement: "the lifter", frequency: { kind: "weekdays", days: [1, 3, 5] }, due: NOT_DUE }),
          habit({ id: "h3", identityStatement: "the stretcher", frequency: { kind: "per_week", count: 2 }, due: NOT_DUE, votedToday: true }),
        ]}
      />
    );
    expect(screen.getByText("2/2 today")).toBeInTheDocument(); // reader + the already-voted stretcher; the lifter isn't today's
    expect(screen.queryByText("the lifter")).not.toBeInTheDocument();
    expect(screen.getByText("the stretcher")).toBeInTheDocument();
  });

  it("the section is absent when every habit is off-day", () => {
    const NOT_DUE = { due: false, doneToday: false, progress: null, nextDueDate: null, statusText: "Next: Wed" };
    render(<CloseReflectStage {...NO_PLAN} deltaMinutes={null} activeHabits={[habit({ due: NOT_DUE })]} />);
    expect(screen.queryByText(/Habits/)).not.toBeInTheDocument();
  });
});

