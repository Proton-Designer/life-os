import { describe, expect, it } from "vitest";
import { featuredCardStyle } from "../featured-card-style";

describe("featuredCardStyle", () => {
  it("sets an opaque --card base so the card never becomes transparent", () => {
    const style = featuredCardStyle("--accent-business");
    expect(style.backgroundColor).toBe("var(--card)");
  });

  it("layers a radial wash over a flat tint in backgroundImage, on top of the base color", () => {
    const style = featuredCardStyle("--accent-business");
    expect(style.backgroundImage).toContain("radial-gradient(ellipse at top left");
    expect(style.backgroundImage).toContain("linear-gradient(");
    // radial-gradient must come first (top layer) so it's visually on top.
    expect(style.backgroundImage?.indexOf("radial-gradient")).toBeLessThan(
      style.backgroundImage?.indexOf("linear-gradient") ?? -1
    );
  });

  it("uses the given accent color var throughout", () => {
    const style = featuredCardStyle("--accent-deen");
    expect(style.borderColor).toContain("--accent-deen");
    expect(style.backgroundImage).toContain("--accent-deen");
  });

  it("defaults to 30% border / 16% wash / 10% tint opacity", () => {
    const style = featuredCardStyle("--accent-business");
    expect(style.borderColor).toContain("30%");
    expect(style.backgroundImage).toContain("16%");
    expect(style.backgroundImage).toContain("10%");
  });

  it("accepts per-call opacity overrides (domain-peek-card's lighter 25%/10% treatment)", () => {
    const style = featuredCardStyle("--accent-deen", { borderOpacity: 25, washOpacity: 10 });
    expect(style.borderColor).toContain("25%");
    expect(style.backgroundImage).toContain("10%");
  });
});
