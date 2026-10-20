import { describe, expect, it } from "vitest";
import { buildReaderDoc } from "../build-doc";
import { buildDocWords } from "../../doc-words";
import { ReaderImportError } from "../errors";

describe("buildReaderDoc", () => {
  const blocks = [
    { kind: "h" as const, text: "One" },
    { kind: "p" as const, text: "alpha beta gamma" },
    { kind: "p" as const, text: "   " },
    { kind: "h" as const, text: "Two" },
    { kind: "p" as const, text: "delta   epsilon" },
  ];

  it("assigns firstWord consistent with the shared tokenizer (buildDocWords) and drops empty blocks", () => {
    const doc = buildReaderDoc({ title: "T", source: "text", blocks });
    expect(doc.blocks).toHaveLength(4);
    expect(doc.wordCount).toBe(7);
    const dw = buildDocWords(doc);
    expect(dw.words).toHaveLength(7);
    doc.blocks.forEach((b, i) => expect(dw.blockStarts[i]).toBe(b.firstWord));
    expect(dw.words[doc.blocks[3].firstWord]).toBe("delta");
  });

  it("falls back to heading blocks, then to one chapter", () => {
    expect(buildReaderDoc({ title: "T", source: "text", blocks }).chapters.map((c) => [c.title, c.firstWord])).toEqual([["One", 0], ["Two", 4]]);
    const plain = buildReaderDoc({ title: "T", source: "text", blocks: [{ kind: "p", text: "a b" }] });
    expect(plain.chapters).toEqual([{ title: "T", blockIndex: 0, firstWord: 0 }]);
  });

  it("maps explicit chapter starts through dropped empty blocks and dedupes same position", () => {
    const doc = buildReaderDoc({
      title: "T",
      source: "epub",
      blocks,
      chapterStarts: [
        { title: "Second", blockIndex: 2 }, // empty block -> resolves to the next surviving one ("Two")
        { title: "Dup", blockIndex: 3 },
        { title: "First", blockIndex: 0 },
      ],
    });
    expect(doc.chapters.map((c) => [c.title, c.blockIndex, c.firstWord])).toEqual([["First", 0, 0], ["Second", 2, 4]]);
  });

  it("throws empty when there are no words", () => {
    expect(() => buildReaderDoc({ title: "T", source: "paste", blocks: [{ kind: "p", text: " " }] })).toThrowError(ReaderImportError);
  });
});
