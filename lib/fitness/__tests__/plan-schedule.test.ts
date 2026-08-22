import { describe, expect, it } from "vitest";
import { expandPlanToWeek, expandPreset } from "../plan-schedule";
import type { PlanDraft } from "../plan-types";

describe("expandPreset", () => {
  it("expands every named preset to its fixed day array", () => {
    expect(expandPreset("everyday")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(expandPreset("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(expandPreset("weekends")).toEqual([0, 6]);
    expect(expandPreset("mw")).toEqual([1, 3]);
    expect(expandPreset("tth")).toEqual([2, 4]);
  });

  it("custom passes customDays through, sanitized and deduped", () => {
    expect(expandPreset("custom", [3, 1, 3, 5])).toEqual([1, 3, 5]);
  });

  it("custom with no customDays is an empty schedule, not an error", () => {
    expect(expandPreset("custom")).toEqual([]);
  });

  it("an unrecognized preset falls back to weekdays rather than throwing", () => {
    // @ts-expect-error hostile input
    expect(expandPreset("bogus")).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("expandPlanToWeek — micro", () => {
  it("places an all-day band on every scheduled day", () => {
    const draft: PlanDraft = {
      kind: "micro",
      id: null,
      name: "Starter Reps",
      exercises: [
        {
          id: null,
          exerciseId: "ex-1",
          name: "Pull-ups",
          scheduleDays: [1, 2, 3, 4, 5],
          goalType: "daily_total",
          goalValue: 30,
          notes: null,
        },
      ],
    };
    const week = expandPlanToWeek(draft);
    expect(week[0]).toEqual([]);
    expect(week[1]).toEqual([{ kind: "micro", name: "Pull-ups", goalLabel: "30 reps" }]);
    expect(week[6]).toEqual([]);
  });

  it("a frequency goal renders a bouts label, not a reps label", () => {
    const draft: PlanDraft = {
      kind: "micro",
      id: null,
      name: "M",
      exercises: [
        {
          id: null,
          exerciseId: "ex-1",
          name: "Farmer carry",
          scheduleDays: [0],
          goalType: "frequency",
          goalValue: 3,
          notes: null,
        },
      ],
    };
    expect(expandPlanToWeek(draft)[0]).toEqual([{ kind: "micro", name: "Farmer carry", goalLabel: "3× today" }]);
  });

  it("multiple micro exercises on the same day keep draft order", () => {
    const draft: PlanDraft = {
      kind: "micro",
      id: null,
      name: "M",
      exercises: [
        { id: null, exerciseId: "a", name: "A", scheduleDays: [1], goalType: "daily_total", goalValue: 1, notes: null },
        { id: null, exerciseId: "b", name: "B", scheduleDays: [1], goalType: "daily_total", goalValue: 1, notes: null },
      ],
    };
    expect(expandPlanToWeek(draft)[1].map((i) => i.name)).toEqual(["A", "B"]);
  });

  it("adversarial: negative/NaN/out-of-range/duplicate days never crash and are dropped", () => {
    const draft: PlanDraft = {
      kind: "micro",
      id: null,
      name: "M",
      exercises: [
        {
          id: null,
          exerciseId: "a",
          name: "A",
          scheduleDays: [1, 1, -1, 7, NaN, 3.5],
          goalType: "daily_total",
          goalValue: 5,
          notes: null,
        },
      ],
    };
    const week = expandPlanToWeek(draft);
    expect(week[1].length).toBe(1);
    for (const d of [0, 2, 3, 4, 5, 6]) expect(week[d]).toEqual([]);
  });

  it("adversarial: negative/NaN/unrecognized goalValue and goalType degrade to 0 rather than throwing", () => {
    const draft: PlanDraft = {
      kind: "micro",
      id: null,
      name: "M",
      exercises: [
        {
          id: null,
          exerciseId: "a",
          name: "A",
          scheduleDays: [1],
          // @ts-expect-error hostile input
          goalType: "bogus",
          goalValue: NaN,
          notes: null,
        },
      ],
    };
    expect(expandPlanToWeek(draft)[1]).toEqual([{ kind: "micro", name: "A", goalLabel: "0" }]);
  });

  it("empty exercises list produces a fully empty week, not a crash", () => {
    const draft: PlanDraft = { kind: "micro", id: null, name: "M", exercises: [] };
    const week = expandPlanToWeek(draft);
    for (let d = 0; d <= 6; d++) expect(week[d]).toEqual([]);
  });
});

describe("expandPlanToWeek — routine", () => {
  it("carries startTime and sums exercise durations into one session band", () => {
    const draft: PlanDraft = {
      kind: "routine",
      id: null,
      name: "R",
      sessions: [
        {
          id: null,
          name: "Push Day",
          scheduleDays: [1],
          startTime: "07:00",
          exercises: [
            { id: null, exerciseId: "a", name: "Bench", durationMinutes: 20, loadLb: null, targetSets: null, targetReps: null },
            { id: null, exerciseId: "b", name: "Fly", durationMinutes: 10, loadLb: null, targetSets: null, targetReps: null },
          ],
        },
      ],
    };
    expect(expandPlanToWeek(draft)[1]).toEqual([
      { kind: "session", name: "Push Day", startTime: "07:00", durationMinutes: 30 },
    ]);
  });

  it("a session with no startTime renders as an unscheduled band (startTime: null)", () => {
    const draft: PlanDraft = {
      kind: "routine",
      id: null,
      name: "R",
      sessions: [{ id: null, name: "Whenever", scheduleDays: [2], startTime: null, exercises: [] }],
    };
    expect(expandPlanToWeek(draft)[2]).toEqual([{ kind: "session", name: "Whenever", startTime: null, durationMinutes: 0 }]);
  });

  it("multiple sessions overlapping on the same day both appear, in order — layout is the caller's job", () => {
    const draft: PlanDraft = {
      kind: "routine",
      id: null,
      name: "R",
      sessions: [
        { id: null, name: "AM", scheduleDays: [3], startTime: "06:00", exercises: [] },
        { id: null, name: "PM", scheduleDays: [3], startTime: "18:00", exercises: [] },
      ],
    };
    expect(expandPlanToWeek(draft)[3].map((i) => i.name)).toEqual(["AM", "PM"]);
  });

  it("adversarial: negative/NaN exercise durations sanitize to 0 and never go negative", () => {
    const draft: PlanDraft = {
      kind: "routine",
      id: null,
      name: "R",
      sessions: [
        {
          id: null,
          name: "S",
          scheduleDays: [4],
          startTime: null,
          exercises: [
            { id: null, exerciseId: "a", name: "A", durationMinutes: -5, loadLb: null, targetSets: null, targetReps: null },
            { id: null, exerciseId: "b", name: "B", durationMinutes: NaN, loadLb: null, targetSets: null, targetReps: null },
            { id: null, exerciseId: "c", name: "C", durationMinutes: 15, loadLb: null, targetSets: null, targetReps: null },
          ],
        },
      ],
    };
    expect(expandPlanToWeek(draft)[4]).toEqual([{ kind: "session", name: "S", startTime: null, durationMinutes: 15 }]);
  });
});

describe("expandPlanToWeek — mixed-week shapes B's fixtures rely on", () => {
  it("a day with a micro exercise AND two overlapping sessions renders all three in draft order across the two calls a caller combines", () => {
    const micro: PlanDraft = {
      kind: "micro",
      id: null,
      name: "M",
      exercises: [{ id: null, exerciseId: "p", name: "Pull-ups", scheduleDays: [1], goalType: "daily_total", goalValue: 30, notes: null }],
    };
    const routine: PlanDraft = {
      kind: "routine",
      id: null,
      name: "R",
      sessions: [
        { id: null, name: "AM", scheduleDays: [1], startTime: "07:00", exercises: [] },
        { id: null, name: "PM", scheduleDays: [1], startTime: "18:00", exercises: [] },
      ],
    };
    const combined = [...expandPlanToWeek(micro)[1], ...expandPlanToWeek(routine)[1]];
    expect(combined).toEqual([
      { kind: "micro", name: "Pull-ups", goalLabel: "30 reps" },
      { kind: "session", name: "AM", startTime: "07:00", durationMinutes: 0 },
      { kind: "session", name: "PM", startTime: "18:00", durationMinutes: 0 },
    ]);
  });

  it("null/undefined draft never crashes — returns a fully empty week", () => {
    // @ts-expect-error hostile input
    const week = expandPlanToWeek(null);
    for (let d = 0; d <= 6; d++) expect(week[d]).toEqual([]);
  });
});
