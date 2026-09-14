import { describe, expect, it } from "vitest";
import { getSchoolTodayFeed } from "../school-today";

const TODAY = "2026-09-15"; // a Tuesday

function classCard(code: string, assessments: { id: string; name: string; date: string; score: number; band: "low" | "moderate" | "high" | "critical" }[]) {
  return {
    code,
    assessments: assessments.map((a) => ({ id: a.id, name: a.name, date: a.date, risk: { score: a.score, band: a.band } })),
  };
}

describe("getSchoolTodayFeed", () => {
  it("returns an empty list when nothing is due today, real state not fabricated", () => {
    const result = getSchoolTodayFeed(
      [classCard("MATH 2418", [{ id: "a1", name: "Quiz", date: "2026-09-20", score: 10, band: "low" }])],
      TODAY
    );
    expect(result).toEqual([]);
  });

  it("includes only assessments due exactly today, across every class", () => {
    const result = getSchoolTodayFeed(
      [
        classCard("MATH 2418", [
          { id: "a1", name: "Quiz 2", date: TODAY, score: 40, band: "moderate" },
          { id: "a2", name: "Not today", date: "2026-09-16", score: 90, band: "critical" },
        ]),
        classCard("CS 3345", [{ id: "a3", name: "Homework 3", date: TODAY, score: 20, band: "low" }]),
      ],
      TODAY
    );
    expect(result.map((r) => r.id)).toEqual(["a1", "a3"]);
  });

  it("formats the title as 'CODE · name · due Thu', matching the spec verbatim", () => {
    const result = getSchoolTodayFeed([classCard("MATH 2418", [{ id: "a1", name: "Quiz 2", date: TODAY, score: 40, band: "moderate" }])], TODAY);
    expect(result[0]!.title).toBe("MATH 2418 · Quiz 2 · due Tue");
  });

  it("ranks by risk score descending, highest first", () => {
    const result = getSchoolTodayFeed(
      [
        classCard("A", [{ id: "low", name: "Low risk", date: TODAY, score: 10, band: "low" }]),
        classCard("B", [{ id: "critical", name: "Critical risk", date: TODAY, score: 95, band: "critical" }]),
      ],
      TODAY
    );
    expect(result.map((r) => r.id)).toEqual(["critical", "low"]);
  });
});
