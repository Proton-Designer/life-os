import { describe, it, expect } from "vitest";
import { importChunks } from "../index";
import { chunksToBlocks, overlapWords, paragraphsOf } from "../chunks";
import { tokenizeBlock } from "../../tokenize";

const S = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ") + ".";

describe("overlapWords", () => {
  it("finds the repeated tail/head the chunker leaves, and ignores short coincidences", () => {
    const prev = "a b c d e f g h i j k l m n o p".split(" ");
    const next = "i j k l m n o p q r s".split(" ");
    expect(overlapWords(prev, next)).toBe(8);
    expect(overlapWords("x y z".split(" "), "x y z q".split(" "))).toBe(0); // under MIN_OVERLAP_WORDS
    expect(overlapWords(prev, "zz yy".split(" "))).toBe(0);
  });
});

describe("chunksToBlocks / importChunks", () => {
  // chunk 1 ends with the 10 words chunk 2 starts with (the chunker's overlap)
  const shared = S(10, "shared");
  const c1 = { text: `${S(30, "alpha")} ${shared}`, sort_order: 0, section_id: "s1" };
  const c2 = { text: `${shared} ${S(30, "beta")}`, sort_order: 1, section_id: "s1" };
  const c3 = { text: S(20, "gamma"), sort_order: 2, section_id: "s2" };
  const sections = [
    { id: "s1", title: "Part One", sort_order: 0 },
    { id: "s2", title: "Full Book", sort_order: 1 },
  ];

  it("drops the overlap exactly once, in order, regardless of input order", () => {
    const r = importChunks([c3, c2, c1], sections, { title: "T" });
    const words = r.doc.blocks.flatMap((b) => tokenizeBlock(b.text));
    expect(words.filter((w) => w === "shared0.")).toHaveLength(0);
    expect(words.filter((w) => w === "shared0")).toHaveLength(1);
    expect(r.doc.wordCount).toBe(30 + 10 + 30 + 20 + 2); // + "Part One" heading words
    expect(words.indexOf("alpha0")).toBeLessThan(words.indexOf("beta0"));
  });

  it("section titles become headings/chapters; the 'Full Book' sentinel does not", () => {
    const r = importChunks([c1, c2, c3], sections, { title: "T" });
    expect(r.doc.chapters.map((c) => c.title)).toEqual(["Part One"]);
    expect(r.doc.blocks.some((b) => b.text === "Full Book")).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/Rebuilt/);
  });

  it("paragraphs are split at sentence ends, around the target size", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} has exactly seven words here.`).join(" ");
    const ps = paragraphsOf(text);
    expect(ps.length).toBeGreaterThan(2);
    for (const p of ps.slice(0, -1)) expect(p.endsWith(".")).toBe(true);
  });

  it("no usable text is a typed 'empty' error", () => {
    expect(() => importChunks([], [])).toThrow(/no stored text/);
    expect(chunksToBlocks([{ text: "   ", sort_order: 0, section_id: null }], []).blocks).toHaveLength(0);
  });
});
