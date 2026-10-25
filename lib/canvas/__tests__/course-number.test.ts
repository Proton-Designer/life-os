import { describe, it, expect } from "vitest";
import { courseNumberKeys, findClassByCourseNumber } from "../course-number";

// The real labels from Ayman's feed and the real codes of his classes.
const CLASSES = [
  { id: "dsa", shortName: "DSA", code: "CS-3345-HON" },
  { id: "comm", shortName: "Prof Comm", code: "ECS-2390-5H3" },
  { id: "stats", shortName: "Prob & Stats", code: "CS-3341-HON" },
];
const LABELS = {
  dsa: "CS 3345.HON - F26",
  comm: "ECS 2390.5H3 - F26",
  stats: "CS-3341.HON-SE-3341.HON-STAT-3341.HON - F26",
};

describe("courseNumberKeys — subject letters + number digits", () => {
  it.each([
    ["CS 3345.HON - F26", ["CS3345"]],
    ["CS-3345-HON", ["CS3345"]],
    ["CS3345", ["CS3345"]],
    ["cs 3345", ["CS3345"]],
    ["ECS-2390-5H3", ["ECS2390"]],
    ["CS-3341.HON-SE-3341.HON-STAT-3341.HON - F26", ["CS3341", "SE3341", "STAT3341"]],
  ])("%s -> %j", (text, keys) => {
    expect([...courseNumberKeys(text)].sort()).toEqual([...keys].sort());
  });

  it("a term code or a name with no course number gives no key", () => {
    expect(courseNumberKeys("F26").size).toBe(0);
    expect(courseNumberKeys("Data Structures").size).toBe(0);
    expect(courseNumberKeys(null).size).toBe(0);
  });
});

describe("findClassByCourseNumber", () => {
  it("maps each of Ayman's feed labels to his existing class, however the code is punctuated", () => {
    expect(findClassByCourseNumber(CLASSES, [LABELS.dsa])?.id).toBe("dsa");
    expect(findClassByCourseNumber(CLASSES, [LABELS.comm])?.id).toBe("comm");
  });

  it("a cross-listed label matches when ANY subject+number pair matches exactly one class", () => {
    expect(findClassByCourseNumber(CLASSES, [LABELS.stats])?.id).toBe("stats");
  });

  it("a different number does not match (CS 3346 is not CS 3345), and a missing class is no match", () => {
    expect(findClassByCourseNumber(CLASSES, ["CS 3346.HON - F26"])).toBeNull();
    expect(findClassByCourseNumber([], [LABELS.dsa])).toBeNull();
  });

  it("is ambiguous -> null: two classes with the same number (a lecture and its lab) must not be guessed between", () => {
    const two = [...CLASSES, { id: "dsa-lab", shortName: "DSA Lab", code: "CS 3345 L" }];
    expect(findClassByCourseNumber(two, [LABELS.dsa])).toBeNull();
  });

  it("matches on the class's name too, not only its code", () => {
    expect(findClassByCourseNumber([{ id: "x", shortName: "CS 3345 Data Structures", code: "DSA" }], [LABELS.dsa])?.id).toBe("x");
  });
});
