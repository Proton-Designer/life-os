import { describe, expect, it } from "vitest";
import { buildDocWords } from "../doc-words";
import { findWordIndex, parseFindPhrase, quoteFindPhrase } from "../find-word";
import { GAMIFICATION_CHUNK, GAMIFICATION_QUOTE } from "@/lib/self-mastery/__tests__/__fixtures__/gamification-chunk";

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

describe("findWordIndex", () => {
  it("returns the index of the first word of the phrase, comparing lowercase [a-z0-9] per word", () => {
    const words = wordsOf("Intro words here. He said, “Pay now – or go away,” and left.");
    expect(findWordIndex(words, "he SAID pay now")).toBe(3);
    expect(findWordIndex(words, "Pay now or go away")).toBe(5);
  });

  it("skips words that are only punctuation on both sides (a spaced dash is its own word)", () => {
    const words = wordsOf("options together - hence Juxtaposition, do people");
    expect(findWordIndex(words, "together hence juxtaposition do")).toBe(1);
    expect(findWordIndex(words, "together - hence")).toBe(1);
  });

  it("finds the first occurrence when the phrase repeats", () => {
    const words = wordsOf("a b c a b c");
    expect(findWordIndex(words, "b c")).toBe(1);
  });

  it("returns null when the phrase is absent, only partly present, empty, or pure punctuation", () => {
    const words = wordsOf("one two three four");
    expect(findWordIndex(words, "two four")).toBeNull();
    expect(findWordIndex(words, "three four five")).toBeNull();
    expect(findWordIndex(words, "")).toBeNull();
    expect(findWordIndex(words, " - … ")).toBeNull();
    expect(findWordIndex([], "one")).toBeNull();
  });

  it("agrees with the reader's own tokenizer on a real chunk (the index is a buildDocWords index)", () => {
    const { words } = buildDocWords({ blocks: [{ kind: "p", text: GAMIFICATION_CHUNK, firstWord: 0 }] });
    const idx = findWordIndex(words, quoteFindPhrase(GAMIFICATION_QUOTE));
    expect(idx).not.toBeNull();
    expect(words.slice(idx!, idx! + 5).join(" ")).toBe("Only when you put those");
  });
});

describe("quoteFindPhrase", () => {
  it("is the first 12 whitespace-separated words of the quote", () => {
    expect(quoteFindPhrase(GAMIFICATION_QUOTE)).toBe("Only when you put those two options together - hence Juxtaposition, do");
    expect(quoteFindPhrase("  short   quote  ")).toBe("short quote");
    expect(quoteFindPhrase("")).toBe("");
  });
});

describe("parseFindPhrase", () => {
  it("takes the first param, trims, and caps the length", () => {
    expect(parseFindPhrase("  hello world ")).toBe("hello world");
    expect(parseFindPhrase(["a b", "c"])).toBe("a b");
    expect(parseFindPhrase("x".repeat(500))!.length).toBe(200);
  });
  it("missing, blank or empty list means no search", () => {
    for (const v of [undefined, "", "   ", []]) expect(parseFindPhrase(v as string | undefined), String(v)).toBeNull();
  });
});
