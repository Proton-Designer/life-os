import { describe, expect, it } from "vitest";
import { buildContextView, findQuoteRange, splitSentences, type Paragraph } from "../context-window";
import { GAMIFICATION_CHUNK, GAMIFICATION_QUOTE } from "./__fixtures__/gamification-chunk";

const flat = (paragraphs: Paragraph[]) => paragraphs.map((p) => p.map((s) => s.text).join("")).join("\n");
const marked = (paragraphs: Paragraph[]) =>
  paragraphs
    .map((p) =>
      p
        .filter((s) => s.highlighted)
        .map((s) => s.text)
        .join(""),
    )
    .filter(Boolean)
    .join(" ");
const sentenceCount = (text: string) => splitSentences(text).length;

describe("findQuoteRange", () => {
  it("returns original offsets for an exact substring", () => {
    const r = findQuoteRange(GAMIFICATION_CHUNK, GAMIFICATION_QUOTE);
    expect(r).not.toBeNull();
    expect(GAMIFICATION_CHUNK.slice(r!.start, r!.end)).toBe(GAMIFICATION_QUOTE);
  });

  it("matches across punctuation, quote-mark, dash and whitespace differences, and maps back to the ORIGINAL text", () => {
    const text = "Intro here. He said, “Pay now – or go away,” and left.\n\nNext bit.";
    const r = findQuoteRange(text, `he said, "Pay now - or   go away," and left`);
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe("He said, “Pay now – or go away,” and left.");
  });

  it("matches the real quote once a hyphen becomes an en dash and straight quotes curl", () => {
    const variant = GAMIFICATION_QUOTE.replace(" - ", " – ");
    const r = findQuoteRange(GAMIFICATION_CHUNK, variant);
    expect(r).not.toBeNull();
    expect(GAMIFICATION_CHUNK.slice(r!.start, r!.end)).toBe(GAMIFICATION_QUOTE);
  });

  it("returns null when the quote is absent, empty or has nothing to normalize", () => {
    expect(findQuoteRange("Some chunk text.", "not in here at all")).toBeNull();
    expect(findQuoteRange("Some chunk text.", "")).toBeNull();
    expect(findQuoteRange("Some chunk text.", "—…!?")).toBeNull();
    expect(findQuoteRange("", "anything")).toBeNull();
  });
});

describe("splitSentences", () => {
  it("splits on . ! ? and a closing quote, only before an uppercase letter, quote or digit", () => {
    const text = "One. Two! Three? “Four.” Five 5. 6 is next. then lowercase stays.";
    const parts = splitSentences(text).map((r) => text.slice(r.start, r.end));
    expect(parts).toEqual(["One.", "Two!", "Three?", "“Four.”", "Five 5.", "6 is next. then lowercase stays."]);
  });

  it("does not split on abbreviations or initials", () => {
    const cases = [
      "Use rewards, e.g. Boosters, to keep people playing.",
      "That is a Juxtaposition, i.e. Two options, side by side.",
      "Dr. Chou coined the term. Mr. Smith agreed.",
      "Mrs. Jones, vs. Mr. Brown, was the example.",
      "Core Drive No. 8 is Loss & Avoidance.",
      "See p. 44 for the table.",
      "J. K. Rowling wrote it.",
      "It is Core Drive #44) Then it continues.",
    ];
    for (const text of cases) {
      const parts = splitSentences(text);
      // Only the one deliberate split (two real sentences) is allowed.
      const expected = text.startsWith("Dr. Chou") ? 2 : 1;
      expect(parts.length, text).toBe(expected);
    }
  });

  it("returns ranges in original offsets and handles empty or whitespace-only text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n ")).toEqual([]);
    const text = "  First one.   Second one.  ";
    const parts = splitSentences(text).map((r) => text.slice(r.start, r.end));
    expect(parts).toEqual(["First one.", "Second one."]);
  });

  it("finds many sentences in the real chunk", () => {
    expect(sentenceCount(GAMIFICATION_CHUNK)).toBeGreaterThan(12);
  });
});

describe("buildContextView — the real Gamification chunk", () => {
  const view = buildContextView(GAMIFICATION_CHUNK, GAMIFICATION_QUOTE);

  it("highlights exactly the quote", () => {
    expect(view.found).toBe(true);
    expect(marked(view.window.paragraphs)).toBe(GAMIFICATION_QUOTE);
    expect(marked(view.full)).toBe(GAMIFICATION_QUOTE);
  });

  it("is a short window: quote sentence + 2 before + 2 after, in paragraphs of at most 3 sentences", () => {
    const text = flat(view.window.paragraphs).replace(/\n/g, " ");
    expect(text.length).toBeLessThan(GAMIFICATION_CHUNK.length / 2);
    expect(view.window.paragraphs.length).toBeGreaterThan(1);
    for (const p of view.window.paragraphs) {
      expect(sentenceCount(p.map((s) => s.text).join(""))).toBeLessThanOrEqual(3);
    }
    // The 2 sentences before the quote and the 2 after are present…
    expect(text).toContain("Conversely, if you just put on your site");
    expect(text).toContain("But does this work in the real world, outside of games?");
    expect(text).toContain("You bet.");
    // …and the third before / third after are not.
    expect(text).not.toContain("With Anchored Juxtapositions, you must have two options");
    expect(text).not.toContain("In the beginning, most people started");
    expect(view.window.hasMoreBefore).toBe(true);
    expect(view.window.hasMoreAfter).toBe(true);
  });

  it("the full form is the whole chunk (modulo paragraph joins) with the same highlight", () => {
    const joined = view.full.map((p) => p.map((s) => s.text).join("")).join(" ");
    expect(joined).toBe(GAMIFICATION_CHUNK.trim());
    expect(view.full.length).toBeGreaterThan(view.window.paragraphs.length);
  });

  it("every paragraph is made only of the book's own characters (no invented text)", () => {
    for (const para of [...view.window.paragraphs, ...view.full]) {
      for (const seg of para) expect(GAMIFICATION_CHUNK.includes(seg.text)).toBe(true);
    }
  });
});

describe("buildContextView — synthetic edges", () => {
  const s = (n: number) => `Sentence number ${n} is here.`;
  const body = (n: number) => Array.from({ length: n }, (_, i) => s(i + 1)).join(" ");

  it("quote at the very start: nothing before, trailing context only", () => {
    const text = body(10);
    const v = buildContextView(text, "Sentence number 1 is here");
    expect(marked(v.window.paragraphs)).toBe("Sentence number 1 is here.");
    expect(v.window.hasMoreBefore).toBe(false);
    expect(v.window.hasMoreAfter).toBe(true);
    expect(flat(v.window.paragraphs)).toContain("Sentence number 3 is here.");
    expect(flat(v.window.paragraphs)).not.toContain("Sentence number 4 is here.");
  });

  it("quote at the very end: nothing after, leading context only", () => {
    const text = body(10);
    const v = buildContextView(text, "Sentence number 10 is here.");
    expect(v.window.hasMoreBefore).toBe(true);
    expect(v.window.hasMoreAfter).toBe(false);
    expect(flat(v.window.paragraphs)).toContain("Sentence number 8 is here.");
    expect(flat(v.window.paragraphs)).not.toContain("Sentence number 7 is here.");
  });

  it("quote that starts mid-sentence and spans two sentences highlights only its own range", () => {
    const text = `${body(4)} The start of it is here. And the end of it is there. ${body(4)}`;
    const v = buildContextView(text, "is here. And the end of it");
    expect(marked(v.window.paragraphs)).toBe("is here. And the end of it");
    const paras = v.window.paragraphs.map((p) => p.map((x) => x.text).join(""));
    expect(paras.join(" ")).toContain("The start of it is here. And the end of it is there.");
    // the unhighlighted head of the first marked sentence is its own segment
    const seg = v.window.paragraphs.flat().find((x) => x.highlighted)!;
    expect(seg.text.startsWith("is here.")).toBe(true);
  });

  it("not found: first ~5 sentences, no highlight, show-more available, never throws", () => {
    const text = body(12);
    const v = buildContextView(text, "this was never in the book");
    expect(v.found).toBe(false);
    expect(marked(v.window.paragraphs)).toBe("");
    expect(sentenceCount(flat(v.window.paragraphs).replace(/\n/g, " "))).toBe(5);
    expect(v.window.hasMoreBefore).toBe(false);
    expect(v.window.hasMoreAfter).toBe(true);
    expect(marked(v.full)).toBe("");
  });

  it("a short chunk that fits entirely has no 'more' on either side", () => {
    const v = buildContextView("Only one. And two.", "And two.");
    expect(v.window.hasMoreBefore).toBe(false);
    expect(v.window.hasMoreAfter).toBe(false);
  });

  it("empty chunk or empty quote does not throw", () => {
    expect(buildContextView("", "x").window.paragraphs).toEqual([]);
    expect(buildContextView("Some text here.", "").found).toBe(false);
  });
});
