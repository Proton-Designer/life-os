import { describe, expect, it } from "vitest";
import { READER_PALETTES, READER_THEMES, readerThemeVars } from "../themes";

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("reader themes", () => {
  it("measures contrast correctly (positive control: black on white is 21)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#808080")).toBeLessThan(1.5);
  });

  for (const theme of READER_THEMES) {
    it(`${theme}: text, muted, focal letter and highlight are readable`, () => {
      const p = READER_PALETTES[theme];
      const floor = theme === "contrast" ? 7 : 4.5;
      expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(floor);
      expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(theme === "contrast" ? 7 : 4.5);
      expect(contrast(p.focal, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.hlFg, p.hlBg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("exposes every palette entry as a --reader-* variable", () => {
    expect(Object.keys(readerThemeVars("dark")).sort()).toEqual(
      ["--reader-bg", "--reader-border", "--reader-fg", "--reader-focal", "--reader-hl-bg", "--reader-hl-fg", "--reader-muted", "--reader-surface"]
    );
  });
});
