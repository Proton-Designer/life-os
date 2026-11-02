import { describe, expect, it } from "vitest";
import { resolveSelfMasteryHome } from "../home-visibility";

describe("resolveSelfMasteryHome", () => {
  it("preference ON changes nothing: a Learning-area account keeps every Self-Mastery piece (positive control)", () => {
    expect(resolveSelfMasteryHome({ onHome: true, hasLearningArea: true, legacy: false })).toEqual({ show: true, hasSelfMastery: true, continueReading: true });
  });

  it("preference ON: a legacy account gets the reader entry; a School-only account keeps its due-question card path (hasSelfMastery false, show true)", () => {
    expect(resolveSelfMasteryHome({ onHome: true, hasLearningArea: false, legacy: true })).toEqual({ show: true, hasSelfMastery: false, continueReading: true });
    expect(resolveSelfMasteryHome({ onHome: true, hasLearningArea: false, legacy: false })).toEqual({ show: true, hasSelfMastery: false, continueReading: false });
  });

  it("preference OFF hides all of it, whatever the account has - including a legacy account and a School-only account's due questions", () => {
    for (const a of [
      { hasLearningArea: true, legacy: false },
      { hasLearningArea: false, legacy: true },
      { hasLearningArea: false, legacy: false },
    ]) {
      expect(resolveSelfMasteryHome({ onHome: false, ...a }), JSON.stringify(a)).toEqual({ show: false, hasSelfMastery: false, continueReading: false });
    }
  });
});
