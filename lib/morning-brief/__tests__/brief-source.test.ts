import { describe, expect, it } from "vitest";
import { briefSourceLabel, briefParagraphs, BRIEF_CLAMP_CHARS, briefNeedsClamp } from "../brief-source";

describe("briefSourceLabel", () => {
  it("names the connector client for an agent-written brief", () => {
    expect(briefSourceLabel("mcp", "Claude")).toBe("Written by Claude via your connector");
  });
  it("falls back to 'your agent' when the token had no name", () => {
    expect(briefSourceLabel("mcp", "agent")).toBe("Written by your agent via your connector");
    expect(briefSourceLabel("mcp", null)).toBe("Written by your agent via your connector");
    expect(briefSourceLabel("mcp", "   ")).toBe("Written by your agent via your connector");
  });
  it("leaves the built-in brief unlabeled", () => {
    expect(briefSourceLabel("user", "")).toBeNull();
    expect(briefSourceLabel(null, null)).toBeNull();
  });
});

describe("briefParagraphs", () => {
  it("splits on blank lines, trims, drops empties, and keeps single line breaks inside a paragraph", () => {
    expect(briefParagraphs("One.\nStill one.\n\n\n  Two.  \n\n")).toEqual(["One.\nStill one.", "Two."]);
  });
});

describe("briefNeedsClamp", () => {
  it("clamps a long brief and leaves a short one alone", () => {
    expect(briefNeedsClamp("a".repeat(BRIEF_CLAMP_CHARS + 1))).toBe(true);
    expect(briefNeedsClamp("short")).toBe(false);
  });
  it("clamps many short lines too", () => {
    expect(briefNeedsClamp(Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n"))).toBe(true);
  });
});
