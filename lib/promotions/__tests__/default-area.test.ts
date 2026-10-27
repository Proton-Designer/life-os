import { describe, expect, it } from "vitest";
import { defaultPromotionAreaId } from "../types";

const area = (id: string, key: string) => ({ id, key, label: key });

// A lesson is Self-Mastery material, so the "which area of your life" pick
// starts on Learning, not on whatever area happens to be first (2026-10-26).
describe("defaultPromotionAreaId", () => {
  it("picks learning even when it is not first", () => {
    expect(defaultPromotionAreaId([area("w", "work"), area("f", "faith"), area("l", "learning")])).toBe("l");
  });

  it("falls back to the pre-115 personal_growth group, which holds self_mastery", () => {
    expect(defaultPromotionAreaId([area("s", "school"), area("p", "personal_growth")])).toBe("p");
  });

  it("prefers learning over personal_growth", () => {
    expect(defaultPromotionAreaId([area("p", "personal_growth"), area("l", "learning")])).toBe("l");
  });

  it("falls back to the first area, then to empty", () => {
    expect(defaultPromotionAreaId([area("w", "work"), area("s", "school")])).toBe("w");
    expect(defaultPromotionAreaId([])).toBe("");
  });
});
