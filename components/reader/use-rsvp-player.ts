"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocWords } from "@/lib/reader/doc-words";
import {
  backParagraph,
  backSentence,
  clampWpm,
  delayMs,
  forwardParagraph,
  forwardSentence,
  isParagraphEnd,
} from "@/lib/reader/rsvp";

/** Injectable clock so tests (and a future narration driver) control time instead of real timers. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface RsvpPlayer {
  index: number;
  playing: boolean;
  finished: boolean;
  wpm: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(wordIndex: number): void;
  backSentence(): void;
  forwardSentence(): void;
  backParagraph(): void;
  forwardParagraph(): void;
  setWpm(wpm: number): void;
}

export function useRsvpPlayer(opts: {
  words: DocWords;
  initialIndex?: number;
  wpm: number;
  scheduler?: Scheduler;
  /** Fired when playback stops for any reason (pause, end of book) with the index it stopped at. */
  onPause?: (index: number) => void;
  /** Fired for every index change (seek, step or tick); the caller throttles persistence. */
  onIndexChange?: (index: number) => void;
}): RsvpPlayer {
  const { words, scheduler = defaultScheduler } = opts;
  const last = Math.max(0, words.words.length - 1);
  const clampIdx = useCallback((i: number) => Math.min(last, Math.max(0, Math.floor(i))), [last]);

  const [index, setIndexState] = useState(() => clampIdx(opts.initialIndex ?? 0));
  const [playing, setPlaying] = useState(false);
  const [wpm, setWpmState] = useState(() => clampWpm(opts.wpm));

  const indexRef = useRef(index);
  const wpmRef = useRef(wpm);
  const onPauseRef = useRef(opts.onPause);
  const onIndexRef = useRef(opts.onIndexChange);
  useEffect(() => {
    onPauseRef.current = opts.onPause;
    onIndexRef.current = opts.onIndexChange;
  });

  const setIndex = useCallback(
    (next: number) => {
      const i = clampIdx(next);
      if (i === indexRef.current) return;
      indexRef.current = i;
      setIndexState(i);
      onIndexRef.current?.(i);
    },
    [clampIdx]
  );

  const playingRef = useRef(false);
  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    setPlaying(false);
    onPauseRef.current?.(indexRef.current);
  }, []);

  // The clock: one timeout per shown word. Re-armed on every index change, so a seek mid-delay simply restarts the
  // wait for the new word; wpm changes apply from the next word because the delay reads wpmRef when it is armed.
  useEffect(() => {
    if (!playing || words.words.length === 0) return;
    const word = words.words[index];
    const ms = delayMs(word, wpmRef.current, { paragraphEnd: isParagraphEnd(words, index) });
    const handle = scheduler.setTimeout(() => {
      if (index >= last) {
        stop();
        return;
      }
      setIndex(index + 1);
    }, ms);
    return () => scheduler.clearTimeout(handle);
  }, [playing, index, words, last, scheduler, setIndex, stop]);

  const play = useCallback(() => {
    if (words.words.length === 0 || playingRef.current) return;
    if (indexRef.current >= last) setIndex(0); // finished: play again from the top
    playingRef.current = true;
    setPlaying(true);
  }, [words, last, setIndex]);

  const toggle = useCallback(() => {
    if (playingRef.current) stop();
    else play();
  }, [stop, play]);

  const setWpm = useCallback((w: number) => {
    const c = clampWpm(w);
    wpmRef.current = c;
    setWpmState(c);
  }, []);

  // A new document (or a shorter one) must not leave the index past its end.
  useEffect(() => {
    if (indexRef.current > last) setIndex(last);
  }, [last, setIndex]);

  return useMemo(
    () => ({
      index,
      playing,
      finished: !playing && words.words.length > 0 && index >= last,
      wpm,
      play,
      pause: stop,
      toggle,
      seek: (i: number) => setIndex(i),
      backSentence: () => setIndex(backSentence(words, indexRef.current)),
      forwardSentence: () => setIndex(forwardSentence(words, indexRef.current)),
      backParagraph: () => setIndex(backParagraph(words, indexRef.current)),
      forwardParagraph: () => setIndex(forwardParagraph(words, indexRef.current)),
      setWpm,
    }),
    [index, playing, wpm, last, words, play, stop, toggle, setIndex, setWpm]
  );
}
