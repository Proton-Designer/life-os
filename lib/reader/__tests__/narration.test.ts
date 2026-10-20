import { describe, expect, it } from "vitest";
import { buildDocWords } from "../doc-words";
import {
  BOUNDARY_GRACE_MS,
  chunkFrom,
  createNarrator,
  estimateWordInChunk,
  wordAtChar,
  type NarrationScheduler,
  type SpeakHandlers,
  type SpeechBackend,
} from "../narration";
import type { ReaderDoc } from "../types";

function doc(...paras: string[]): Pick<ReaderDoc, "blocks"> {
  let fw = 0;
  return { blocks: paras.map((text) => { const b = { kind: "p" as const, text, firstWord: fw }; fw += text.split(/\s+/).length; return b; }) };
}

const TEXT = "One two three. Four five six, seven eight nine ten. Eleven twelve.";
const dw = buildDocWords(doc(TEXT));

class FakeBackend implements SpeechBackend {
  spoken: { text: string; rate: number; voiceUri: string | null; h: SpeakHandlers }[] = [];
  cancels = 0;
  speak(text: string, o: { rate: number; voiceUri: string | null }, h: SpeakHandlers) { this.spoken.push({ text, ...o, h }); }
  cancel() { this.cancels++; }
  get last() { return this.spoken[this.spoken.length - 1]; }
}

class FakeClock implements NarrationScheduler {
  t = 0;
  q: { at: number; fn: () => void; id: number }[] = [];
  n = 0;
  setTimeout(fn: () => void, ms: number) { const id = ++this.n; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  now() { return this.t; }
  advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      const next = this.q.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.q = this.q.filter((x) => x !== next);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
  }
}

function setup() {
  const backend = new FakeBackend();
  const clock = new FakeClock();
  const seen: number[] = [];
  let finished = 0;
  const errors: string[] = [];
  const settings = { rate: 1, voiceUri: null as string | null };
  const narrator = createNarrator({ backend, words: dw, scheduler: clock, getSettings: () => settings, onWord: (i) => seen.push(i), onFinish: () => finished++, onError: (c) => errors.push(c) });
  return { backend, clock, seen, narrator, settings, errors, finished: () => finished };
}

describe("chunkFrom", () => {
  it("ends at the sentence end", () => {
    const c = chunkFrom(dw, 0)!;
    expect(c.text).toBe("One two three.");
    expect([c.start, c.end]).toEqual([0, 3]);
  });
  it("starts mid-sentence and offsets map words to characters", () => {
    const c = chunkFrom(dw, 4)!; // "five six, seven ..."
    expect(c.text).toBe("five six, seven eight nine ten.");
    expect(c.offsets[0]).toBe(0);
    expect(c.text.slice(c.offsets[2], c.offsets[2] + 5)).toBe("seven");
  });
  it("breaks at a clause mark when a long sentence hits the cap", () => {
    const long = buildDocWords(doc("a b c d, e f g h i j k l m n o p q r s t"));
    const c = chunkFrom(long, 0, 10)!;
    expect(c.text.endsWith("d,")).toBe(false); // clause at word 4 is in the front half: fall through to the cap
    const c2 = buildDocWords(doc("a b c d e f g h, i j k l m n o p q r s t"));
    expect(chunkFrom(c2, 0, 10)!.text.endsWith("h,")).toBe(true);
  });
  it("returns null past the end", () => {
    expect(chunkFrom(dw, dw.words.length)).toBeNull();
  });
});

describe("wordAtChar / estimate", () => {
  it("maps characters to words", () => {
    const offsets = [0, 4, 10];
    expect([wordAtChar(offsets, 0), wordAtChar(offsets, 3), wordAtChar(offsets, 4), wordAtChar(offsets, 99)]).toEqual([0, 0, 1, 2]);
  });
  it("estimates later words as time passes and faster at a higher rate", () => {
    const offsets = [0, 5, 10, 15, 20, 25, 30];
    expect(estimateWordInChunk(offsets, 0, 1)).toBe(0);
    const slow = estimateWordInChunk(offsets, 1500, 1);
    const fast = estimateWordInChunk(offsets, 1500, 2);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("createNarrator", () => {
  it("speaks the first sentence and follows boundary events", () => {
    const s = setup();
    s.narrator.start(0);
    expect(s.backend.last.text).toBe("One two three.");
    s.backend.last.h.onBoundary(4);
    s.backend.last.h.onBoundary(8);
    expect(s.seen).toEqual([0, 1, 2]);
  });
  it("chains to the next chunk on end and finishes at the end of the book", () => {
    const s = setup();
    s.narrator.start(0);
    s.backend.last.h.onEnd();
    expect(s.backend.last.text).toBe("Four five six, seven eight nine ten.");
    expect(s.seen).toContain(3);
    s.backend.last.h.onEnd();
    expect(s.backend.last.text).toBe("Eleven twelve.");
    s.backend.last.h.onEnd();
    expect(s.finished()).toBe(1);
    expect(s.narrator.speaking).toBe(false);
  });
  it("pause cancels and remembers the word; resume speaks from it; stale events are ignored", () => {
    const s = setup();
    s.narrator.start(0);
    const first = s.backend.last;
    first.h.onBoundary(4);
    const at = s.narrator.pause();
    expect(at).toBe(1);
    expect(s.narrator.speaking).toBe(false);
    first.h.onBoundary(8); // late event from the cancelled utterance
    first.h.onEnd();
    expect(s.seen).toEqual([0, 1]);
    expect(s.backend.spoken).toHaveLength(1);
    s.narrator.start(at);
    expect(s.backend.last.text).toBe("two three.");
  });
  it("restart re-speaks the current word with the new rate and voice", () => {
    const s = setup();
    s.narrator.start(0);
    s.backend.last.h.onBoundary(4);
    s.settings.rate = 1.5;
    s.settings.voiceUri = "v1";
    s.narrator.restart();
    expect(s.backend.last).toMatchObject({ text: "two three.", rate: 1.5, voiceUri: "v1" });
  });
  it("estimates the word by elapsed time when no boundary events arrive (iOS)", () => {
    const s = setup();
    s.narrator.start(3); // the long second sentence
    s.clock.advance(BOUNDARY_GRACE_MS - 1);
    expect(s.seen).toEqual([3]);
    s.clock.advance(3000);
    expect(s.seen[s.seen.length - 1]).toBeGreaterThan(3);
  });
  it("positive control: once a boundary event arrives the estimator stops", () => {
    const s = setup();
    s.narrator.start(3);
    s.backend.last.h.onBoundary(0);
    const n = s.seen.length;
    s.clock.advance(5000);
    expect(s.seen).toHaveLength(n);
  });
  it("reports real errors but ignores interrupted/canceled", () => {
    const s = setup();
    s.narrator.start(0);
    s.backend.last.h.onError("interrupted");
    expect(s.errors).toEqual([]);
    s.backend.last.h.onError("synthesis-failed");
    expect(s.errors).toEqual(["synthesis-failed"]);
    expect(s.narrator.speaking).toBe(false);
  });
  it("clamps a start past the end to the last word", () => {
    const s = setup();
    s.narrator.start(9999);
    expect(s.backend.last.text).toBe("twelve.");
  });
});

import { effectiveSpeechRate } from "../narration";
describe("effectiveSpeechRate", () => {
  it("follows wpm when speechRate is 1 (auto) and is clamped", () => {
    expect(effectiveSpeechRate(1, 360)).toBe(2);
    expect(effectiveSpeechRate(1, 100)).toBe(0.56);
    expect(effectiveSpeechRate(1, 1000)).toBe(2.5);
  });
  it("uses an explicit rate regardless of wpm", () => {
    expect(effectiveSpeechRate(1.3, 900)).toBe(1.3);
    expect(effectiveSpeechRate(0.7, 100)).toBe(0.7);
  });
});
