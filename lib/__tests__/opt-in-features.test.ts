import { describe, expect, it } from "vitest";
import { OPT_IN_FEATURE_IDS, isOptInFeatureId, sanitizeEnabledFeatures, hasOptInFeature, OPT_IN_FEATURES } from "../opt-in-features";

describe("opt-in-features", () => {
  it("every id has a label and description", () => {
    for (const id of OPT_IN_FEATURE_IDS) {
      expect(OPT_IN_FEATURES[id].label.length).toBeGreaterThan(0);
      expect(OPT_IN_FEATURES[id].description.length).toBeGreaterThan(0);
    }
  });

  it("isOptInFeatureId rejects unknown/retired ids", () => {
    expect(isOptInFeatureId("cards_library")).toBe(true);
    expect(isOptInFeatureId("estimate_vs_actual")).toBe(true);
    expect(isOptInFeatureId("some-retired-feature")).toBe(false);
  });

  describe("sanitizeEnabledFeatures", () => {
    it("passes through real opt-in feature ids", () => {
      expect(sanitizeEnabledFeatures(["cards_library", "estimate_vs_actual"])).toEqual(["cards_library", "estimate_vs_actual"]);
    });

    it("drops unknown/stale ids rather than letting them reach a gate check silently", () => {
      expect(sanitizeEnabledFeatures(["cards_library", "some-retired-feature"])).toEqual(["cards_library"]);
    });

    it("handles null/undefined as empty -- both features start absent, mirroring today's behavior exactly", () => {
      expect(sanitizeEnabledFeatures(null)).toEqual([]);
      expect(sanitizeEnabledFeatures(undefined)).toEqual([]);
    });
  });

  describe("hasOptInFeature", () => {
    it("is true only when the specific feature id is present", () => {
      expect(hasOptInFeature(["cards_library"], "cards_library")).toBe(true);
      expect(hasOptInFeature(["cards_library"], "estimate_vs_actual")).toBe(false);
    });

    it("is false for null/undefined/empty", () => {
      expect(hasOptInFeature(null, "cards_library")).toBe(false);
      expect(hasOptInFeature(undefined, "cards_library")).toBe(false);
      expect(hasOptInFeature([], "cards_library")).toBe(false);
    });

    it("ignores a stale/unknown id rather than treating it as any feature being on", () => {
      expect(hasOptInFeature(["some-retired-feature"], "cards_library")).toBe(false);
    });
  });
});
