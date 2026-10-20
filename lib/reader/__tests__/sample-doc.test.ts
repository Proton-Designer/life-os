import { describe, expect, it } from "vitest";
import { SAMPLE_DOC } from "../__fixtures__/sample-doc";
import { buildDocWords } from "../doc-words";

describe("sample doc", () => {
  it("is a coherent ReaderDoc whose indexes match the shared tokenizer", () => {
    const dw = buildDocWords(SAMPLE_DOC);
    expect(dw.words.length).toBe(SAMPLE_DOC.wordCount);
    expect(SAMPLE_DOC.wordCount).toBeGreaterThan(1000);
    expect(SAMPLE_DOC.chapters).toHaveLength(3);
    SAMPLE_DOC.blocks.forEach((b, i) => expect(dw.blockStarts[i]).toBe(b.firstWord));
    SAMPLE_DOC.chapters.forEach((c) => expect(SAMPLE_DOC.blocks[c.blockIndex].firstWord).toBe(c.firstWord));
  });
});
