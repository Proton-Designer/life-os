import { describe, expect, it } from "vitest";
import { FEATURE_IDS, isFeatureId, sanitizeHiddenFeatures, FEATURES } from "../features";

describe("features", () => {
  it("never includes home or settings — the lockout guard", () => {
    expect(FEATURE_IDS).not.toContain("home");
    expect(FEATURE_IDS).not.toContain("settings");
  });

  it("every id has a label", () => {
    for (const id of FEATURE_IDS) {
      expect(FEATURES[id].label.length).toBeGreaterThan(0);
    }
  });

  it("isFeatureId rejects unknown/retired ids", () => {
    expect(isFeatureId("deen")).toBe(true);
    expect(isFeatureId("home")).toBe(false);
    expect(isFeatureId("settings")).toBe(false);
    expect(isFeatureId("some-retired-module")).toBe(false);
  });

  describe("sanitizeHiddenFeatures", () => {
    it("passes through real feature ids", () => {
      expect(sanitizeHiddenFeatures(["deen", "work"])).toEqual(["deen", "work"]);
    });

    it("drops unknown/stale ids rather than letting them reach a nav filter silently", () => {
      expect(sanitizeHiddenFeatures(["deen", "some-retired-module", "home"])).toEqual(["deen"]);
    });

    it("handles null/undefined as empty", () => {
      expect(sanitizeHiddenFeatures(null)).toEqual([]);
      expect(sanitizeHiddenFeatures(undefined)).toEqual([]);
    });
  });
});
