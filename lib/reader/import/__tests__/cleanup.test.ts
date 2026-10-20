import { describe, expect, it } from "vitest";
import { flattenLines, looksLikeHeading, markdownToBlocks, normalizeInline, stripPageFurniture, textToBlocks } from "../cleanup";

describe("normalizeInline", () => {
  it("strips soft hyphens and zero-widths, collapses whitespace and NBSP", () => {
    expect(normalizeInline("in­ter​nal   value\n\tx")).toBe("internal value x");
  });
});

describe("stripPageFurniture", () => {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
  const body = (n: number) => Array.from({ length: 8 }, (_, k) => `${words[(n + k) % 10]} ${words[(n * 3 + k) % 10]} line ${k} carries distinct body text ${words[(n + 2 * k) % 10]}`);
  const pages = (n: number, header = true) =>
    Array.from({ length: n }, (_, i) => [...(header ? ["My Great Book — Chapter Title"] : []), ...body(i), String(i + 12)]);

  it("removes repeated running headers and bare page numbers, keeps body", () => {
    const { pages: out, removed } = stripPageFurniture(pages(6));
    expect(removed).toBe(12);
    for (const p of out) {
      expect(p.some((l) => l.includes("My Great Book"))).toBe(false);
      expect(p.some((l) => /^\d+$/.test(l))).toBe(false);
      expect(p.length).toBe(8);
    }
  });

  it("positive control: with no repeated header only the page numbers go", () => {
    const input = pages(6, false);
    input.forEach((p, i) => p.unshift(`A distinct opening sentence number ${"x".repeat(i)} unique`));
    const { pages: out, removed } = stripPageFurniture(input);
    expect(removed).toBe(6);
    expect(out[0][0]).toContain("distinct opening");
  });

  it("does nothing repeat-based on a 2-page document", () => {
    const { removed } = stripPageFurniture([["Header", "text a text a text a"], ["Header", "text b text b text b"]]);
    expect(removed).toBe(0);
  });
});

describe("flattenLines", () => {
  const wrap = (s: string, w = 60) => {
    const out: string[] = [];
    let cur = "";
    for (const word of s.split(" ")) {
      if ((cur + " " + word).trim().length > w) {
        out.push(cur);
        cur = word;
      } else cur = (cur + " " + word).trim();
    }
    if (cur) out.push(cur);
    return out;
  };
  const p1 = "Reading quickly is a skill that improves with steady practice, and the best way to practise is to read things you actually care about every day.";
  const p2 = "A second paragraph begins here and explains why the information in the first one matters so much to anyone who wants to learn.";

  it("joins wrapped lines into paragraphs and splits on a short sentence-ending line", () => {
    const { blocks } = flattenLines([[...wrap(p1), ...wrap(p2)]]);
    expect(blocks.map((b) => b.text)).toEqual([p1, p2]);
  });

  it("de-hyphenates a line-break hyphen but keeps a real compound hyphen mid-line", () => {
    const { blocks } = flattenLines([["The informa-", "tion age and a well-known fact about long-", "term memory are discussed at length in this book."]]);
    expect(blocks[0].text).toBe("The information age and a well-known fact about longterm memory are discussed at length in this book.");
  });

  it("emits chapter-style lines as headings and records the block each page starts at", () => {
    const { blocks, pageStartBlock } = flattenLines([[...wrap(p1)], ["Chapter 2", ...wrap(p2)]]);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "h", "p"]);
    expect(pageStartBlock).toEqual([0, 1]);
  });

  it("treats each line as a paragraph when lines are long (not hard-wrapped)", () => {
    const long1 = "word ".repeat(40).trim() + ".";
    const long2 = "other ".repeat(40).trim() + ".";
    expect(flattenLines([[long1, long2]]).blocks).toHaveLength(2);
  });
});

describe("looksLikeHeading", () => {
  it.each(["Chapter 12", "CHAPTER IV: The Return", "Prologue", "Part Two", "Appendix A"])("yes: %s", (s) => expect(looksLikeHeading(s)).toBe(true));
  it.each(["Chapter 3 is where the author finally explains what happened to the whole company in 1998 and why it matters", "The chapter ended.", "Introduction to Algorithms, third edition by several authors"])(
    "no: %s",
    (s) => expect(looksLikeHeading(s)).toBe(false)
  );
});

describe("textToBlocks", () => {
  it("uses blank lines as paragraph breaks and joins inner newlines", () => {
    const b = textToBlocks("First line\nsecond line.\n\nNext para here.\n\nChapter 3\n\nAfter.");
    expect(b).toEqual([
      { kind: "p", text: "First line second line." },
      { kind: "p", text: "Next para here." },
      { kind: "h", text: "Chapter 3" },
      { kind: "p", text: "After." },
    ]);
  });
  it("falls back to the line joiner when there are no blank lines", () => {
    expect(textToBlocks("one two three\nfour five six.")).toEqual([{ kind: "p", text: "one two three four five six." }]);
  });
});

describe("markdownToBlocks", () => {
  it("keeps heading levels, strips inline syntax, lists/quotes become paragraphs, drops fences and rules", () => {
    const { blocks, headingLevels } = markdownToBlocks(
      "# Title\n\nSome **bold** and *it* and `code` with a [link](http://x.y) and ![img](a.png).\n\n## Part\n\n- item one\n- item two\n\n> quoted\n\n---\n\n```\ncode line\n```\n"
    );
    expect(blocks.map((b) => b.text)).toEqual(["Title", "Some bold and it and code with a link and img.", "Part", "item one", "item two", "quoted", "code line"]);
    expect(blocks.map((b) => b.kind)).toEqual(["h", "p", "h", "p", "p", "p", "p"]);
    expect(headingLevels[0]).toBe(1);
    expect(headingLevels[2]).toBe(2);
  });
});
