import { describe, expect, it } from "vitest";
import { THEME_PRESET_IDS, DEFAULT_THEME_PRESET, isThemePresetId, resolveThemePreset, THEME_PRESETS } from "../theme-presets";

describe("theme-presets", () => {
  it("oxblood is the default", () => {
    expect(DEFAULT_THEME_PRESET).toBe("oxblood");
    expect(THEME_PRESET_IDS).toContain("oxblood");
  });

  it("has exactly 5 presets, each with a label and description", () => {
    expect(THEME_PRESET_IDS).toHaveLength(5);
    for (const id of THEME_PRESET_IDS) {
      expect(THEME_PRESETS[id].label.length).toBeGreaterThan(0);
      expect(THEME_PRESETS[id].description.length).toBeGreaterThan(0);
    }
  });

  it("isThemePresetId recognizes only real preset ids", () => {
    expect(isThemePresetId("oxblood")).toBe(true);
    expect(isThemePresetId("ocean")).toBe(true);
    expect(isThemePresetId("nonexistent")).toBe(false);
  });

  it("resolveThemePreset falls back to the default for anything unrecognized, null, or missing", () => {
    expect(resolveThemePreset("ocean")).toBe("ocean");
    expect(resolveThemePreset("not-a-real-preset")).toBe(DEFAULT_THEME_PRESET);
    expect(resolveThemePreset(null)).toBe(DEFAULT_THEME_PRESET);
    expect(resolveThemePreset(undefined)).toBe(DEFAULT_THEME_PRESET);
  });
});
