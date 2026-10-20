import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocWords } from "@/lib/reader/doc-words";
import { delayMs } from "@/lib/reader/rsvp";
import { useRsvpPlayer, type Scheduler } from "../use-rsvp-player";

// "One two. Three four five? Six." | "Alpha beta"  -> 8 words, blocks at 0 and 6
const dw = buildDocWords({
  blocks: [
    { kind: "p", text: "One two. Three four five? Six.", firstWord: 0 },
    { kind: "p", text: "Alpha beta", firstWord: 6 },
  ],
});

/** Manual scheduler: nothing fires until the test says how much time passed. */
function manualScheduler() {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const s: Scheduler = {
    setTimeout(fn, ms) {
      pending.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
  };
  return {
    s,
    pendingCount: () => pending.size,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        act(() => next[1].fn());
      }
      now = target;
    },
  };
}

describe("useRsvpPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts paused at the initial index and does not tick until played", () => {
    const m = manualScheduler();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, initialIndex: 3, scheduler: m.s }));
    expect(result.current.index).toBe(3);
    expect(result.current.playing).toBe(false);
    m.advance(10_000);
    expect(result.current.index).toBe(3);
    expect(m.pendingCount()).toBe(0);
  });

  it("advances one word per word-delay, using punctuation-aware timing", () => {
    const m = manualScheduler();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, scheduler: m.s }));
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    m.advance(delayMs("One", 300) - 1);
    expect(result.current.index).toBe(0);
    m.advance(1);
    expect(result.current.index).toBe(1);
    // "two." is a sentence end: it must hold for 2.2x, not 1x
    m.advance(delayMs("two.", 300) - 1);
    expect(result.current.index).toBe(1);
    m.advance(1);
    expect(result.current.index).toBe(2);
  });

  it("pause stops the clock, reports the index, and resume continues from the same word", () => {
    const m = manualScheduler();
    const onPause = vi.fn();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, scheduler: m.s, onPause }));
    act(() => result.current.play());
    m.advance(delayMs("One", 300));
    expect(result.current.index).toBe(1);
    act(() => result.current.pause());
    expect(onPause).toHaveBeenCalledWith(1);
    expect(m.pendingCount()).toBe(0);
    m.advance(60_000);
    expect(result.current.index).toBe(1);
    act(() => result.current.toggle());
    expect(result.current.playing).toBe(true);
    m.advance(delayMs("two.", 300));
    expect(result.current.index).toBe(2);
  });

  it("toggle flips play/pause and pausing twice fires onPause once", () => {
    const m = manualScheduler();
    const onPause = vi.fn();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, scheduler: m.s, onPause }));
    act(() => result.current.toggle());
    expect(result.current.playing).toBe(true);
    act(() => result.current.toggle());
    act(() => result.current.pause());
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("changing wpm while playing applies to the next word", () => {
    const m = manualScheduler();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, scheduler: m.s }));
    act(() => result.current.play());
    act(() => result.current.setWpm(600));
    expect(result.current.wpm).toBe(600);
    m.advance(delayMs("One", 300)); // the word already armed finishes on the old clock
    expect(result.current.index).toBe(1);
    m.advance(delayMs("two.", 600));
    expect(result.current.index).toBe(2);
  });

  it("clamps wpm to 100..1000", () => {
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 5, scheduler: manualScheduler().s }));
    expect(result.current.wpm).toBe(100);
    act(() => result.current.setWpm(99999));
    expect(result.current.wpm).toBe(1000);
  });

  it("seek and sentence/paragraph steps move the index and restart the delay for the new word", () => {
    const m = manualScheduler();
    const onIndexChange = vi.fn();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, scheduler: m.s, onIndexChange }));
    act(() => result.current.seek(4));
    expect(result.current.index).toBe(4);
    act(() => result.current.backSentence());
    expect(result.current.index).toBe(2);
    act(() => result.current.forwardSentence());
    expect(result.current.index).toBe(5);
    act(() => result.current.forwardParagraph());
    expect(result.current.index).toBe(6);
    act(() => result.current.backParagraph());
    expect(result.current.index).toBe(0);
    expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual([4, 2, 5, 6, 0]);

    act(() => result.current.play());
    m.advance(100);
    act(() => result.current.seek(3));
    m.advance(delayMs("four", 300) - 1); // seek mid-delay re-armed the clock for word 3 ("four")
    expect(result.current.index).toBe(3);
  });

  it("clamps seeks to the document", () => {
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300, scheduler: manualScheduler().s }));
    act(() => result.current.seek(999));
    expect(result.current.index).toBe(7);
    act(() => result.current.seek(-5));
    expect(result.current.index).toBe(0);
    act(() => result.current.seek(2.9));
    expect(result.current.index).toBe(2);
  });

  it("stops at the last word, flags finished, and play restarts from the top", () => {
    const m = manualScheduler();
    const onPause = vi.fn();
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 1000, initialIndex: 6, scheduler: m.s, onPause }));
    act(() => result.current.play());
    m.advance(100_000);
    expect(result.current.index).toBe(7);
    expect(result.current.playing).toBe(false);
    expect(result.current.finished).toBe(true);
    expect(onPause).toHaveBeenCalledWith(7);
    act(() => result.current.play());
    expect(result.current.index).toBe(0);
    expect(result.current.playing).toBe(true);
    expect(result.current.finished).toBe(false);
  });

  it("an empty document never plays", () => {
    const empty = buildDocWords({ blocks: [] });
    const { result } = renderHook(() => useRsvpPlayer({ words: empty, wpm: 300, scheduler: manualScheduler().s }));
    act(() => result.current.play());
    expect(result.current.playing).toBe(false);
    expect(result.current.index).toBe(0);
  });

  it("works with the default real-timer scheduler under fake timers", () => {
    const { result } = renderHook(() => useRsvpPlayer({ words: dw, wpm: 300 }));
    act(() => result.current.play());
    act(() => {
      vi.advanceTimersByTime(delayMs("One", 300));
    });
    expect(result.current.index).toBe(1);
  });
});
