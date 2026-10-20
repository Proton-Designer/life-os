import type { DocWords } from "./doc-words";
import { endsSentence, isParagraphEnd } from "./rsvp";

// Narration core: pure chunking + a narrator state machine over an injectable speech backend. The Web Speech adapter
// lives in web-speech-backend.ts; tests drive this file with a fake backend and fake timers.

export const MAX_CHUNK_WORDS = 45;
/** Without a boundary event this soon after speaking starts, assume the engine never sends them (iOS) and estimate. */
export const BOUNDARY_GRACE_MS = 600;
const ESTIMATE_TICK_MS = 120;
/** Average speech at rate 1 is roughly 15 characters a second. */
const CHARS_PER_SEC_AT_RATE_1 = 15;

export interface SpeechVoiceInfo {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
}

export interface SpeakHandlers {
  /** charIndex is an offset into the text passed to speak(). */
  onBoundary(charIndex: number): void;
  onEnd(): void;
  onError(code: string): void;
}

export interface SpeechBackend {
  speak(text: string, opts: { rate: number; voiceUri: string | null }, handlers: SpeakHandlers): void;
  cancel(): void;
}

export interface Chunk {
  /** Global index of the first word. */
  start: number;
  /** Exclusive end. */
  end: number;
  text: string;
  /** Character offset of each word's first letter inside `text`. */
  offsets: number[];
}

const CLAUSE_END = /[,;:—–)\]]["”'’)]*$/;

/** Sentence-sized text to speak, starting at `start`: ends at a sentence/paragraph end, else the last clause mark, else the cap. */
export function chunkFrom(dw: DocWords, start: number, maxWords = MAX_CHUNK_WORDS): Chunk | null {
  const total = dw.words.length;
  if (start < 0 || start >= total) return null;
  const cap = Math.min(total, start + maxWords);
  let end = cap;
  let lastClause = -1;
  for (let i = start; i < cap; i++) {
    if (endsSentence(dw.words[i]) || isParagraphEnd(dw, i)) {
      end = i + 1;
      lastClause = -1;
      break;
    }
    if (CLAUSE_END.test(dw.words[i])) lastClause = i + 1;
  }
  // Hit the cap mid-sentence: prefer to stop at a clause mark in the back half.
  if (end === cap && cap < total && lastClause > start + (cap - start) / 2) end = lastClause;
  const offsets: number[] = [];
  let text = "";
  for (let i = start; i < end; i++) {
    if (i > start) text += " ";
    offsets.push(text.length);
    text += dw.words[i];
  }
  return { start, end, text, offsets };
}

/** Index (inside the chunk) of the word containing `charIndex`. */
export function wordAtChar(offsets: number[], charIndex: number): number {
  let ans = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] <= charIndex) ans = i;
    else break;
  }
  return ans;
}

/** Fallback when the engine sends no boundary events: the word expected after `elapsedMs` of speech. */
export function estimateWordInChunk(offsets: number[], elapsedMs: number, rate: number): number {
  const chars = (elapsedMs / 1000) * CHARS_PER_SEC_AT_RATE_1 * Math.max(0.1, rate);
  return wordAtChar(offsets, chars);
}

export interface NarrationScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const realNarrationScheduler: NarrationScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface NarratorOptions {
  backend: SpeechBackend;
  words: DocWords;
  /** Read at every utterance so a voice or rate change applies from the next one. */
  getSettings(): { rate: number; voiceUri: string | null };
  /** The word now being spoken (global index). */
  onWord(index: number): void;
  /** Speech reached the end of the book. */
  onFinish(): void;
  /** The engine failed for a reason other than being cancelled. */
  onError?(code: string): void;
  scheduler?: NarrationScheduler;
}

export interface Narrator {
  readonly speaking: boolean;
  readonly word: number;
  /** Speak from `wordIndex` (cancels whatever was playing). */
  start(wordIndex: number): void;
  /** Stop and remember the word; resume with start(word). Returns the word. */
  pause(): number;
  /** Re-speak from the current word with fresh settings; no-op when idle. */
  restart(): void;
  destroy(): void;
}

export function createNarrator(opts: NarratorOptions): Narrator {
  const { backend, words } = opts;
  const sched = opts.scheduler ?? realNarrationScheduler;
  let generation = 0;
  let speaking = false;
  let current = 0;
  let timers: unknown[] = [];

  const clearTimers = () => {
    for (const t of timers) sched.clearTimeout(t);
    timers = [];
  };

  const setWord = (i: number) => {
    if (i === current) return;
    current = i;
    opts.onWord(i);
  };

  function speakFrom(from: number, gen: number) {
    const chunk = chunkFrom(words, from);
    if (!chunk) {
      speaking = false;
      opts.onFinish();
      return;
    }
    const { rate, voiceUri } = opts.getSettings();
    const startedAt = sched.now();
    let sawBoundary = false;
    setWord(chunk.start);

    const estimate = () => {
      if (gen !== generation || sawBoundary) return;
      const w = chunk.start + estimateWordInChunk(chunk.offsets, sched.now() - startedAt, rate);
      setWord(Math.min(w, chunk.end - 1));
      timers.push(sched.setTimeout(estimate, ESTIMATE_TICK_MS));
    };
    timers.push(sched.setTimeout(estimate, BOUNDARY_GRACE_MS));

    backend.speak(chunk.text, { rate, voiceUri }, {
      onBoundary(charIndex) {
        if (gen !== generation) return;
        sawBoundary = true;
        setWord(chunk.start + wordAtChar(chunk.offsets, charIndex));
      },
      onEnd() {
        if (gen !== generation) return;
        clearTimers();
        speakFrom(chunk.end, gen);
      },
      onError(code) {
        if (gen !== generation) return;
        // "interrupted"/"canceled" arrive for our own cancel(); the generation check already covers those, but some
        // engines report them late, so treat them as benign here too.
        if (code === "interrupted" || code === "canceled") return;
        clearTimers();
        speaking = false;
        opts.onError?.(code);
      },
    });
  }

  function begin(wordIndex: number) {
    generation++;
    clearTimers();
    backend.cancel();
    const clamped = Math.min(Math.max(0, Math.floor(wordIndex)), Math.max(0, words.words.length - 1));
    current = clamped;
    speaking = words.words.length > 0;
    if (!speaking) return;
    // The first word is reported even when it equals `current`, so the UI sees "speaking started here".
    opts.onWord(clamped);
    speakFrom(clamped, generation);
  }

  return {
    get speaking() {
      return speaking;
    },
    get word() {
      return current;
    },
    start: begin,
    pause() {
      generation++;
      clearTimers();
      backend.cancel();
      speaking = false;
      return current;
    },
    restart() {
      if (speaking) begin(current);
    },
    destroy() {
      generation++;
      clearTimers();
      backend.cancel();
      speaking = false;
    },
  };
}

/** Speech rate sent to the engine: speechRate 1 means "follow the reading speed" (wpm / 180), anything else is the user's choice. */
export function effectiveSpeechRate(speechRate: number, wpm: number): number {
  const r = speechRate === 1 ? wpm / 180 : speechRate;
  return Math.min(2.5, Math.max(0.5, Math.round(r * 100) / 100));
}
