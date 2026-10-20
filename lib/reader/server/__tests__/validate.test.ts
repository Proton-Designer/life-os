import { describe, it, expect } from "vitest";
import { addDaysToDateString } from "@/lib/date-utils";
import { computeReadingStats } from "../stats";
import { sourceExtension, readerDocPath, readerSourcePath } from "../paths";
import { parseHighlightInput, parseSettingsPatch, parseTitle, parseUuid, parseWordIndex, ReaderInputError } from "../validate";

describe("validate", () => {
  it("uuid / title / word index", () => {
    expect(parseUuid("33333333-3333-4333-8333-333333333333")).toBeTruthy();
    expect(() => parseUuid("../../etc/passwd")).toThrow(ReaderInputError);
    expect(parseTitle("  A   B ")).toBe("A B");
    expect(parseTitle("x".repeat(500))).toHaveLength(200);
    expect(() => parseTitle("")).toThrow();
    expect(() => parseTitle(5)).toThrow();
    expect(() => parseWordIndex(NaN)).toThrow();
    expect(() => parseWordIndex(Infinity)).toThrow();
    expect(parseWordIndex(0)).toBe(0);
  });
  it("highlight text is whitespace-collapsed and capped at the column limit", () => {
    const h = parseHighlightInput({ bookId: "33333333-3333-4333-8333-333333333333", startWord: 0, endWord: 1, text: `a \n b ${"z".repeat(5000)}` });
    expect(h.text.startsWith("a b ")).toBe(true);
    expect(h.text.length).toBe(4000);
  });
  it("settings patch keeps only known, in-range keys", () => {
    expect(parseSettingsPatch({ wpm: 200, junk: 1 })).toEqual({ wpm: 200 });
    expect(parseSettingsPatch({ voiceUri: "" })).toEqual({ voiceUri: null });
    expect(() => parseSettingsPatch({ fontScale: 0.5 })).toThrow();
  });
});

describe("paths", () => {
  it("only allowed source extensions, normalised; paths start with the uid", () => {
    expect(sourceExtension("a.PDF")).toBe("pdf");
    expect(sourceExtension("a.markdown")).toBe("md");
    expect(sourceExtension("a.exe")).toBeNull();
    expect(sourceExtension("noext")).toBeNull();
    expect(readerDocPath("u", "b")).toBe("u/b/reader-v1.json");
    expect(readerSourcePath("u", "b", "epub")).toBe("u/b/source.epub");
  });
});

describe("computeReadingStats", () => {
  const T = "2026-10-19";
  const day = (d: number, words: number) => ({ local_date: addDaysToDateString(T, -d), words_read: words, avg_wpm: 300 });

  it("streak counts consecutive goal-meeting days; today not done yet does not zero it", () => {
    const rows = [day(1, 1000), day(2, 1200), day(3, 1000), day(5, 5000)];
    expect(computeReadingStats(rows, 1000, T).streak).toBe(3);
    expect(computeReadingStats([day(0, 1000), ...rows], 1000, T).streak).toBe(4);
  });
  it("a day under the goal breaks the streak; without a goal any reading counts", () => {
    expect(computeReadingStats([day(0, 200), day(1, 5000)], 1000, T).streak).toBe(1);
    expect(computeReadingStats([day(0, 200), day(1, 5)], null, T).streak).toBe(2);
    expect(computeReadingStats([], 1000, T).streak).toBe(0);
  });
  it("last7 is oldest-first and ends today", () => {
    const s = computeReadingStats([day(0, 10), day(6, 7)], null, T);
    expect(s.last7).toHaveLength(7);
    expect(s.last7[0]).toEqual({ date: addDaysToDateString(T, -6), words: 7 });
    expect(s.last7[6]).toEqual({ date: T, words: 10 });
  });
});
