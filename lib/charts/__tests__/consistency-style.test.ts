import { describe, expect, it } from "vitest";
import { consistencyCellStyle } from "../consistency-style";

describe("consistencyCellStyle", () => {
  it("solid: opaque fill in the status color", () => {
    const style = consistencyCellStyle("solid", "--accent-business");
    expect(style.backgroundColor).toBe("var(--accent-business)");
    expect(style.backgroundImage).toBeUndefined();
    expect(style.border).toBeUndefined();
  });

  it("hatch: a diagonal repeating pattern in the status color, at 45deg (never 0/90 — those read as gridlines)", () => {
    const style = consistencyCellStyle("hatch", "--accent-deen");
    expect(style.backgroundImage).toContain("45deg");
    expect(style.backgroundImage).toContain("--accent-deen");
  });

  it("hollow: transparent fill with a colored border, not colored fill", () => {
    const style = consistencyCellStyle("hollow", "--destructive");
    expect(style.backgroundColor).toBe("transparent");
    expect(style.border).toContain("--destructive");
  });
});
