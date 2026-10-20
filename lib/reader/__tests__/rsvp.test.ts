import { describe, expect, it } from "vitest";
import {
  backParagraph,
  backSentence,
  clampWpm,
  delayMs,
  endsSentence,
  forwardParagraph,
  forwardSentence,
  isParagraphEnd,
  minutesLeft,
  orpIndex,
  paragraphStart,
  percentRead,
  sentenceStart,
} from "../rsvp";
import { buildDocWords, chapterIndexAt, wordIndexAtOffset } from "../doc-words";
import type { ReaderDoc } from "../types";

function docOf(...paragraphs: string[]): Pick<ReaderDoc, "blocks"> {
  let first = 0;
  return {
    blocks: paragraphs.map((text) => {
      const b = { kind: "p" as const, text, firstWord: first };
      first += text.split(/\s+/).filter(Boolean).length;
      return b;
    }),
  };
}

describe("orpIndex", () => {
  it.each([
    ["a", 0],
    ["is", 1],
    ["the", 1],
    ["words", 1],
    ["reader", 2],
    ["attention", 2],
    ["comprehension", 3],
    ["internationalization", 4],
  ])("%s -> %i", (word, expected) => {
    expect(orpIndex(word)).toBe(expected);
  });

  it("ignores leading punctuation and quotes", () => {
    expect(orpIndex('"reader')).toBe(3); // 1 quote + 2
    expect(orpIndex("(the")).toBe(2);
  });

  it("measures length without trailing punctuation", () => {
    expect(orpIndex("word,")).toBe(1);
    expect(orpIndex("reader.")).toBe(2);
  });

  it("stays inside the word for all-punctuation tokens and empty strings", () => {
    expect(orpIndex("")).toBe(0);
    expect(orpIndex("—")).toBe(0);
    expect(orpIndex("...")).toBeLessThan(3);
  });

  it("counts astral characters as one", () => {
    const w = "😀😀😀"; // each is 2 UTF-16 units, no letters
    expect(orpIndex(w)).toBeLessThan(w.length);
  });
});

describe("delayMs", () => {
  it("is 60000/wpm for a plain short word", () => {
    expect(delayMs("the", 300)).toBe(200);
    expect(delayMs("the", 600)).toBe(100);
  });
  it("pauses 2.2x after sentence ends, including closing quotes", () => {
    expect(delayMs("end.", 300)).toBe(440);
    expect(delayMs('end."', 300)).toBe(440);
    expect(delayMs("what?", 300)).toBe(440);
  });
  it("pauses 1.6x after clause marks", () => {
    expect(delayMs("so,", 300)).toBe(320);
    expect(delayMs("so;", 300)).toBe(320);
  });
  it("stretches long words 1.3x and stacks with punctuation", () => {
    expect(delayMs("attention", 300)).toBe(260);
    expect(delayMs("attention.", 300)).toBe(Math.round(200 * 2.2 * 1.3));
  });
  it("adds a paragraph-end beat", () => {
    expect(delayMs("done", 300, { paragraphEnd: true })).toBe(200 + 300);
  });
  it("does not treat abbreviations or initials as sentence ends", () => {
    expect(endsSentence("Dr.")).toBe(false);
    expect(endsSentence("e.g.")).toBe(false);
    expect(endsSentence("J.")).toBe(false);
    expect(endsSentence("Done.")).toBe(true);
  });
  it("clamps wpm", () => {
    expect(clampWpm(5)).toBe(100);
    expect(clampWpm(5000)).toBe(1000);
    expect(clampWpm(NaN)).toBe(100);
    expect(delayMs("the", 5)).toBe(600);
  });
});

describe("sentence/paragraph navigation", () => {
  // words: 0 One 1 two. 2 Three 3 four 4 five? 5 Six.   | block 2 starts at 6: 6 Alpha 7 beta
  const dw = buildDocWords(docOf("One two. Three four five? Six.", "Alpha beta"));

  it("builds the flat word list and block starts", () => {
    expect(dw.words.length).toBe(8);
    expect(dw.blockStarts).toEqual([0, 6]);
  });
  it("finds sentence starts", () => {
    expect(sentenceStart(dw, 0)).toBe(0);
    expect(sentenceStart(dw, 1)).toBe(0);
    expect(sentenceStart(dw, 4)).toBe(2);
    expect(sentenceStart(dw, 7)).toBe(6);
  });
  it("forward goes to the next sentence start and stops at the end", () => {
    expect(forwardSentence(dw, 0)).toBe(2);
    expect(forwardSentence(dw, 3)).toBe(5);
    expect(forwardSentence(dw, 5)).toBe(6); // block end counts as a boundary
    expect(forwardSentence(dw, 7)).toBe(7);
  });
  it("back snaps to this sentence start, then the previous one", () => {
    expect(backSentence(dw, 4)).toBe(2);
    expect(backSentence(dw, 2)).toBe(0);
    expect(backSentence(dw, 0)).toBe(0);
    expect(backSentence(dw, 6)).toBe(5);
  });
  it("paragraph helpers", () => {
    expect(paragraphStart(dw, 3)).toBe(0);
    expect(forwardParagraph(dw, 3)).toBe(6);
    expect(forwardParagraph(dw, 7)).toBe(7);
    expect(backParagraph(dw, 7)).toBe(6);
    expect(backParagraph(dw, 6)).toBe(0);
    expect(isParagraphEnd(dw, 5)).toBe(true);
    expect(isParagraphEnd(dw, 4)).toBe(false);
    expect(isParagraphEnd(dw, 7)).toBe(true);
  });
  it("is safe on an empty doc", () => {
    const empty = buildDocWords(docOf());
    expect(sentenceStart(empty, 0)).toBe(0);
    expect(forwardSentence(empty, 0)).toBe(0);
    expect(backParagraph(empty, 0)).toBe(0);
    expect(forwardParagraph(empty, 0)).toBe(0);
  });
});

describe("progress math", () => {
  it("minutes left rounds up and hits 0 at the end", () => {
    expect(minutesLeft(1001, 0, 250)).toBe(4);
    expect(minutesLeft(1001, 1000, 250)).toBe(0);
    expect(minutesLeft(100, 50, 300)).toBe(1);
  });
  it("percent", () => {
    expect(percentRead(101, 50)).toBe(50);
    expect(percentRead(101, 100)).toBe(100);
    expect(percentRead(0, 0)).toBe(0);
    expect(percentRead(1, 0)).toBe(100);
  });
});

describe("doc-words helpers", () => {
  it("chapterIndexAt", () => {
    const ch = [{ firstWord: 0 }, { firstWord: 10 }, { firstWord: 30 }];
    expect(chapterIndexAt(ch, 0)).toBe(0);
    expect(chapterIndexAt(ch, 29)).toBe(1);
    expect(chapterIndexAt(ch, 99)).toBe(2);
    expect(chapterIndexAt([], 5)).toBe(-1);
    expect(chapterIndexAt([{ firstWord: 4 }], 2)).toBe(-1);
  });
  it("wordIndexAtOffset maps characters to word indexes", () => {
    const t = "alpha beta  gamma";
    expect(wordIndexAtOffset(t, 0)).toBe(0);
    expect(wordIndexAtOffset(t, 3)).toBe(0);
    expect(wordIndexAtOffset(t, 7)).toBe(1);
    expect(wordIndexAtOffset(t, 12)).toBe(2); // in the gap -> next word
    expect(wordIndexAtOffset(t, 999)).toBe(2);
    expect(wordIndexAtOffset("", 0)).toBe(0);
  });
  it("skips empty blocks so block starts stay increasing", () => {
    const d = buildDocWords(docOf("a b", "   ", "c"));
    expect(d.blockStarts).toEqual([0, 2]);
    expect(d.blockIds).toEqual([0, 2]);
  });
});
