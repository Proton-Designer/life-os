import { describe, expect, it } from "vitest";
import { buildDocWords } from "../doc-words";
import { clampRange, MAX_HIGHLIGHT_WORDS, rangesByBlock, rangeText, segmentBlock, sentenceRange, wordIsHighlighted } from "../highlights";
import type { ReaderDoc } from "../types";

function doc(...paras: string[]): Pick<ReaderDoc, "blocks"> {
  let fw = 0;
  return { blocks: paras.map((text) => { const b = { kind: "p" as const, text, firstWord: fw }; fw += text.split(/\s+/).length; return b; }) };
}
const dw = buildDocWords(doc("One two three. Four five six seven.", "Eight nine ten"));

describe("sentenceRange", () => {
  it("covers the sentence around any word in it", () => {
    expect(sentenceRange(dw, 1)).toEqual({ start: 0, end: 2 });
    expect(sentenceRange(dw, 5)).toEqual({ start: 3, end: 6 });
  });
  it("a paragraph without final punctuation still ends at the paragraph", () => {
    expect(sentenceRange(dw, 8)).toEqual({ start: 7, end: 9 });
  });
  it("text of a range", () => {
    expect(rangeText(dw, { start: 3, end: 5 })).toBe("Four five six");
  });
  it("clamps very long ranges", () => {
    expect(clampRange({ start: 10, end: 10_000 }).end).toBe(10 + MAX_HIGHLIGHT_WORDS - 1);
    expect(clampRange({ start: 9, end: 4 })).toEqual({ start: 4, end: 9 });
  });
});

describe("segmentBlock", () => {
  it("marks only highlighted words and joins the band across spaces", () => {
    const runs = segmentBlock("alpha beta gamma delta", 10, [{ start: 11, end: 12 }]);
    expect(runs).toEqual([
      { text: "alpha ", marked: false },
      { text: "beta gamma", marked: true },
      { text: " delta", marked: false },
    ]);
  });
  it("positive control: no ranges means one unmarked run", () => {
    expect(segmentBlock("alpha beta", 0, [])).toEqual([{ text: "alpha beta", marked: false }]);
  });
  it("a range that does not touch the block marks nothing", () => {
    expect(segmentBlock("alpha beta", 0, [{ start: 50, end: 60 }]).every((r) => !r.marked)).toBe(true);
  });
});

describe("rangesByBlock / wordIsHighlighted", () => {
  it("assigns a range to every block it touches and nothing to the others", () => {
    const m = rangesByBlock(dw, [{ start: 6, end: 8 }]);
    expect(m.get(0)).toHaveLength(1);
    expect(m.get(1)).toHaveLength(1);
    expect(rangesByBlock(dw, [{ start: 0, end: 1 }]).get(1)).toHaveLength(0);
  });
  it("word membership", () => {
    expect(wordIsHighlighted([{ start: 2, end: 4 }], 3)).toBe(true);
    expect(wordIsHighlighted([{ start: 2, end: 4 }], 5)).toBe(false);
  });
});
