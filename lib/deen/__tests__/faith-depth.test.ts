import { describe, expect, it } from "vitest";
import { depthIncludes, type FaithFeature } from "../faith-depth";

const ALL_FEATURES: FaithFeature[] = ["quran", "sunnah", "adhkar", "habits", "reflection", "qada_backlog"];

describe("depthIncludes", () => {
  it("prayers_only gates out every feature — the floor tier has none", () => {
    for (const feature of ALL_FEATURES) {
      expect(depthIncludes("prayers_only", feature)).toBe(false);
    }
  });

  it("prayers_quran includes only quran, nothing else", () => {
    expect(depthIncludes("prayers_quran", "quran")).toBe(true);
    for (const feature of ALL_FEATURES.filter((f) => f !== "quran")) {
      expect(depthIncludes("prayers_quran", feature)).toBe(false);
    }
  });

  it("full_practice includes every feature", () => {
    for (const feature of ALL_FEATURES) {
      expect(depthIncludes("full_practice", feature)).toBe(true);
    }
  });

  // M6: a legacy account (zero user_domains rows) predates depth entirely
  // and must render byte-identical to today — every feature unlocked,
  // exactly like full_practice, not the lightest tier's near-empty set.
  it("legacy mode includes every feature, matching today's unconditional render — never the lightest tier's default", () => {
    for (const feature of ALL_FEATURES) {
      expect(depthIncludes("legacy", feature)).toBe(true);
    }
  });
});
