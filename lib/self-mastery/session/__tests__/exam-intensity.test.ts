import { describe, expect, it } from "vitest";
import {
  applyExamIntensity,
  daysBetweenDateStrings,
  describeExamIntensity,
  examIntensityMultiplier,
  loadNearestUpcomingExamsByClass,
  pickExamIntensity,
  type UpcomingAssessment,
} from "../exam-intensity";

describe("daysBetweenDateStrings", () => {
  it("is 0 for the same date", () => {
    expect(daysBetweenDateStrings("2026-09-14", "2026-09-14")).toBe(0);
  });

  it("counts forward days correctly, including across a month boundary", () => {
    expect(daysBetweenDateStrings("2026-09-28", "2026-10-02")).toBe(4);
  });

  it("counts forward days correctly across a year boundary", () => {
    expect(daysBetweenDateStrings("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("is negative when toStr is before fromStr", () => {
    expect(daysBetweenDateStrings("2026-09-14", "2026-09-10")).toBe(-4);
  });

  it("is exact across a DST-transition-adjacent range (pure calendar math, no timezone involved)", () => {
    // Nov 1, 2026 is near a US DST fallback -- this function must not care,
    // since it never touches a timezone or an instant, only calendar ints.
    expect(daysBetweenDateStrings("2026-10-30", "2026-11-02")).toBe(3);
  });
});

describe("examIntensityMultiplier", () => {
  it("is baseline (1.0) with no known exam", () => {
    expect(examIntensityMultiplier(null)).toBe(1.0);
  });

  it("is baseline for a date more than 21 days out", () => {
    expect(examIntensityMultiplier(22)).toBe(1.0);
    expect(examIntensityMultiplier(365)).toBe(1.0);
  });

  it("ramps monotonically as the exam approaches", () => {
    const points = [30, 21, 14, 7, 3, 1, 0];
    const values = points.map(examIntensityMultiplier);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    }
    expect(values[values.length - 1]).toBe(3.0); // day-of is the peak
  });

  it("is baseline for a NEGATIVE distance (the exam already happened -- stale data, not infinitely urgent)", () => {
    expect(examIntensityMultiplier(-1)).toBe(1.0);
    expect(examIntensityMultiplier(-30)).toBe(1.0);
  });
});

describe("applyExamIntensity", () => {
  it("scales up and floors to an integer", () => {
    expect(applyExamIntensity(10, 2.5)).toBe(25);
    expect(applyExamIntensity(3, 1.5)).toBe(4); // floor(4.5) = 4
  });

  it("never returns less than the base limit, even for a sub-1.0 multiplier", () => {
    expect(applyExamIntensity(10, 0.5)).toBe(10);
  });

  it("is a true no-op at the baseline multiplier", () => {
    expect(applyExamIntensity(7, 1.0)).toBe(7);
  });
});

describe("describeExamIntensity", () => {
  // Phase 1 #27's own gap: the multiplier was wired into scheduling capacity
  // from day one but named nowhere a user could see -- this is the
  // plain-language line the one UI surface that shows it renders verbatim.
  // It names the CLASS whose exam is driving the session (and only appears
  // when that class has items in it -- see pickExamIntensity).
  const info = (over: Partial<Parameters<typeof describeExamIntensity>[0] & object> = {}) => ({
    classId: "c1",
    className: "MATH 2418",
    daysUntilExam: 1,
    multiplier: 3.0,
    assessmentName: "Midterm Exam (proctored)",
    assessmentType: "exam",
    ...over,
  });

  it("is null when there is no known exam", () => {
    expect(describeExamIntensity(null)).toBeNull();
  });

  it("is null at the baseline multiplier -- nothing to say when there's no active boost", () => {
    expect(describeExamIntensity(info({ daysUntilExam: 30, multiplier: 1.0 }))).toBeNull();
  });

  it("names the class and says tomorrow for one day out", () => {
    expect(describeExamIntensity(info())).toBe("MATH 2418 exam tomorrow — more review today");
  });

  it("says today for a same-day exam and 'in N days' further out", () => {
    expect(describeExamIntensity(info({ daysUntilExam: 0 }))).toBe("MATH 2418 exam today — more review today");
    expect(describeExamIntensity(info({ daysUntilExam: 3, multiplier: 2.5 }))).toBe("MATH 2418 exam in 3 days — more review today");
  });

  it("labels a final_midterm-type assessment distinctly from a plain exam", () => {
    expect(describeExamIntensity(info({ daysUntilExam: 2, multiplier: 2.5, assessmentType: "final_midterm" }))).toBe(
      "MATH 2418 final/midterm in 2 days — more review today"
    );
  });

  it("without a class label it still reads, capitalized, rather than inventing one", () => {
    expect(describeExamIntensity(info({ className: null }))).toBe("Exam tomorrow — more review today");
  });
});

describe("pickExamIntensity", () => {
  const exam = (classId: string, date: string, name = "Exam"): UpcomingAssessment => ({ classId, date, type: "exam", name });
  const exams = (...rows: UpcomingAssessment[]) => new Map(rows.map((r) => [r.classId, r]));

  it("(a) an exam whose class has no items in the session picks nothing", () => {
    expect(pickExamIntensity(exams(exam("c1", "2026-09-15")), new Set(), "2026-09-14")).toBeNull();
  });

  it("(b) an exam whose class has items is picked, naming that class", () => {
    expect(pickExamIntensity(exams(exam("c1", "2026-09-15", "Midterm")), new Set(["c1"]), "2026-09-14")).toEqual({
      classId: "c1",
      className: null,
      daysUntilExam: 1,
      multiplier: 3.0,
      assessmentName: "Midterm",
      assessmentType: "exam",
    });
  });

  it("takes the MAX over eligible classes only, never a product", () => {
    const picked = pickExamIntensity(
      exams(exam("c1", "2026-09-15"), exam("c2", "2026-09-16"), exam("c3", "2026-09-17")),
      new Set(["c2", "c3"]),
      "2026-09-14"
    );
    expect(picked).toMatchObject({ classId: "c2", multiplier: 2.5 });
  });

  it("an exam already past is baseline, and no exams at all is null", () => {
    expect(pickExamIntensity(exams(exam("c1", "2026-09-10")), new Set(["c1"]), "2026-09-14")).toMatchObject({ multiplier: 1.0 });
    expect(pickExamIntensity(new Map(), new Set(["c1"]), "2026-09-14")).toBeNull();
  });
});

describe("loadNearestUpcomingExamsByClass", () => {
  function fakeClient(rows: Array<{ class_id: string; date: string; type: string; name: string }>) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => ({
                order: async () => ({ data: rows, error: null }),
              }),
            }),
          }),
        }),
      }),
    };
  }

  it("keeps only the NEAREST assessment per class (rows arrive date-ascending)", async () => {
    const client = fakeClient([
      { class_id: "c1", date: "2026-09-20", type: "exam", name: "Midterm 1" },
      { class_id: "c1", date: "2026-10-15", type: "final_midterm", name: "Final" },
      { class_id: "c2", date: "2026-09-25", type: "exam", name: "Quiz-as-exam" },
    ]);
    const result = await loadNearestUpcomingExamsByClass(client, "u1", "2026-09-14");
    expect(result.get("c1")?.date).toBe("2026-09-20");
    expect(result.get("c1")?.name).toBe("Midterm 1");
    expect(result.get("c2")?.date).toBe("2026-09-25");
    expect(result.size).toBe(2);
  });

  it("a class with no upcoming exam-type row is simply ABSENT, never a null placeholder", async () => {
    const client = fakeClient([]);
    const result = await loadNearestUpcomingExamsByClass(client, "u1", "2026-09-14");
    expect(result.size).toBe(0);
    expect(result.has("nonexistent-class")).toBe(false);
  });

  it("throws on a query error rather than returning a silently-empty result", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => ({
                order: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        }),
      }),
    };
    await expect(loadNearestUpcomingExamsByClass(client, "u1", "2026-09-14")).rejects.toEqual({ message: "boom" });
  });
});
