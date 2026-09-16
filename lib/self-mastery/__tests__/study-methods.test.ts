import { describe, expect, it } from "vitest";
import { STUDY_METHODS, studyMethodLabel, type StudyMethodId } from "../study-methods";

describe("STUDY_METHODS", () => {
  it("names exactly the six modes from the P3-03 acceptance criteria", () => {
    const ids = STUDY_METHODS.map((m) => m.id);
    expect(ids).toEqual(["retrieval", "interleave", "draft", "recite", "compose", "cards"]);
  });

  it("every 'active' entry cites a real file:function implementation; every 'planned' entry has none", () => {
    for (const method of STUDY_METHODS) {
      if (method.status === "active") {
        expect(method.implementedAt, `${method.id} is active but cites no implementation`).toBeTruthy();
      } else {
        expect(method.implementedAt, `${method.id} is planned but cites an implementation`).toBeUndefined();
      }
    }
  });

  it("compose is honestly unimplemented and cards is reserved for P3-05 -- neither is fabricated here", () => {
    const compose = STUDY_METHODS.find((m) => m.id === "compose");
    const cards = STUDY_METHODS.find((m) => m.id === "cards");
    expect(compose?.status).toBe("planned");
    expect(cards?.status).toBe("planned");
    expect(cards?.description).toContain("P3-05");
  });
});

describe("studyMethodLabel", () => {
  it("returns the taxonomy's own label for a known id", () => {
    expect(studyMethodLabel("retrieval" satisfies StudyMethodId)).toBe("Retrieval");
    expect(studyMethodLabel("interleave" satisfies StudyMethodId)).toBe("Interleave");
    expect(studyMethodLabel("draft" satisfies StudyMethodId)).toBe("Draft");
  });

  it("falls back to the raw id for anything unknown, rather than throwing", () => {
    expect(studyMethodLabel("not_a_real_method")).toBe("not_a_real_method");
  });
});
