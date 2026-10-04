import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_PRESET_IDS, DEFAULT_THEME_PRESET, isThemePresetId, resolveThemePreset, THEME_PRESETS, PRESET_PREVIEW } from "../theme-presets";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

/** Variables declared inside one preset's block, or in :root for the default. */
function varsFor(id: string): Record<string, string> {
  const re = id === "oxblood" ? /:root \{([\s\S]*?)\n\}/ : new RegExp(`:root\\[data-theme-preset="${id}"\\] \\{([\\s\\S]*?)\\n\\}`);
  const body = css.match(re)?.[1] ?? "";
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("theme-presets registry", () => {
  it("Midnight (stored id oxblood) is first and the default; 5 presets, each labelled", () => {
    expect(DEFAULT_THEME_PRESET).toBe("oxblood");
    expect(THEME_PRESET_IDS[0]).toBe("oxblood");
    expect(THEME_PRESETS.oxblood.label).toBe("Midnight");
    expect(THEME_PRESET_IDS).toHaveLength(5);
    for (const id of THEME_PRESET_IDS) {
      expect(THEME_PRESETS[id].label.length).toBeGreaterThan(0);
      expect(THEME_PRESETS[id].description.length).toBeGreaterThan(0);
    }
  });

  it("isThemePresetId / resolveThemePreset: unknown, null and missing fall back to Midnight; stored oxblood resolves to the default", () => {
    expect(isThemePresetId("ocean")).toBe(true);
    expect(isThemePresetId("nonexistent")).toBe(false);
    expect(resolveThemePreset("ocean")).toBe("ocean");
    expect(resolveThemePreset("oxblood")).toBe(DEFAULT_THEME_PRESET);
    expect(resolveThemePreset("not-a-real-preset")).toBe(DEFAULT_THEME_PRESET);
    expect(resolveThemePreset(null)).toBe(DEFAULT_THEME_PRESET);
    expect(resolveThemePreset(undefined)).toBe(DEFAULT_THEME_PRESET);
  });
});

describe("theme presets actually restyle the whole app (app/globals.css)", () => {
  const SURFACE_VARS = ["--background", "--foreground", "--card", "--muted", "--muted-foreground", "--border", "--ring", "--sidebar", "--glow-oxblood"];

  it("every non-default preset defines the full scheme, not just accents", () => {
    for (const id of THEME_PRESET_IDS.filter((p) => p !== "oxblood")) {
      const v = varsFor(id);
      for (const name of [...SURFACE_VARS, "--accent-deen", "--accent-fitness", "--accent-business", "--accent-school", "--accent-coop", "--accent-info"]) {
        expect(v[name], `${id} ${name}`).toBeTruthy();
      }
    }
  });

  it("POSITIVE CONTROL: --background differs between every pair of presets (the old accents-only behaviour would fail this)", () => {
    const backgrounds = THEME_PRESET_IDS.map((id) => varsFor(id)["--background"]);
    expect(new Set(backgrounds).size).toBe(THEME_PRESET_IDS.length);
  });

  it("Midnight is :root's own default, unchanged (no override block exists for it)", () => {
    expect(css).not.toContain('data-theme-preset="oxblood"');
    expect(varsFor("oxblood")["--background"]).toBe("#0a0a0c");
    expect(varsFor("oxblood")["--glow-oxblood"]).toBe("#2b0e13");
  });

  it("the settings swatch data (PRESET_PREVIEW) matches the CSS for every preset", () => {
    for (const id of THEME_PRESET_IDS) {
      const v = varsFor(id);
      const p = PRESET_PREVIEW[id];
      expect(v["--background"], id).toBe(p.bg);
      expect(v["--card"], id).toBe(p.card);
      expect(v["--foreground"], id).toBe(p.foreground);
      for (const [k, hex] of Object.entries(p.accents)) expect(v[`--accent-${k}`], `${id} ${k}`).toBe(hex);
    }
  });

  it("WCAG AA: body text and muted text pass on every surface of every preset; accents and destructive pass on cards", () => {
    const destructive = varsFor("oxblood")["--destructive"];
    for (const id of THEME_PRESET_IDS) {
      const v = id === "oxblood" ? varsFor(id) : varsFor(id);
      const surfaces = [v["--background"], v["--card"], v["--muted"]];
      for (const s of surfaces) {
        expect(ratio(v["--foreground"], s), `${id} fg on ${s}`).toBeGreaterThanOrEqual(7);
        expect(ratio(v["--muted-foreground"], s), `${id} muted on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(destructive, v["--card"]), `${id} destructive on card`).toBeGreaterThanOrEqual(4.5);
      for (const k of ["deen", "fitness", "business", "school", "coop", "info"]) {
        expect(ratio(v[`--accent-${k}`], v["--card"]), `${id} accent-${k} on card`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("semantic colours are never overridden by a preset", () => {
    for (const id of THEME_PRESET_IDS.filter((p) => p !== "oxblood")) {
      const v = varsFor(id);
      expect(v["--destructive"]).toBeUndefined();
      expect(v["--accent-warning"]).toBeUndefined();
      expect(v["--accent-noise"]).toBeUndefined();
    }
  });
});
