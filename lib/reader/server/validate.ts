import type { ReaderSettings, ReaderTheme } from "@/lib/reader/types";

// Hand-rolled input validation for the reader server actions (the repo has no schema library).
// Every validator either returns the cleaned value or throws ReaderInputError with a message that is
// safe to show a person. Server Action arguments are untrusted JSON, so nothing here assumes a type.

export class ReaderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReaderInputError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_TITLE_CHARS = 200;
export const MAX_AUTHOR_CHARS = 200;
export const MAX_HIGHLIGHT_CHARS = 4000;
export const MAX_NOTE_CHARS = 2000;
export const MAX_SESSION_WORDS = 50_000;
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
export const MAX_WORD_INDEX = 20_000_000;

export const SESSION_MODES = ["rsvp", "page", "listen"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];
export const READER_THEMES: readonly ReaderTheme[] = ["dark", "light", "sepia", "contrast"];

export function parseUuid(value: unknown, what = "book"): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new ReaderInputError(`That ${what} id isn't valid.`);
  return value.toLowerCase();
}

export function parseTitle(value: unknown): string {
  if (typeof value !== "string") throw new ReaderInputError("Give this book a title.");
  const t = value.replace(/\s+/g, " ").trim();
  if (!t) throw new ReaderInputError("Give this book a title.");
  return t.slice(0, MAX_TITLE_CHARS);
}

export function parseAuthor(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ReaderInputError("That author isn't valid.");
  const a = value.replace(/\s+/g, " ").trim();
  return a ? a.slice(0, MAX_AUTHOR_CHARS) : null;
}

function int(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new ReaderInputError(`${what} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function parseWordIndex(value: unknown): number {
  return int(value, "Word position", 0, MAX_WORD_INDEX);
}

export function parseWpm(value: unknown): number {
  return int(value, "Speed", 100, 1000);
}

/** ISO timestamp -> Date; rejects garbage and anything more than `slackMs` in the future. */
export function parseTimestamp(value: unknown, now: Date, slackMs = 5 * 60 * 1000): Date {
  if (typeof value !== "string") throw new ReaderInputError("That time isn't valid.");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ReaderInputError("That time isn't valid.");
  if (d.getTime() > now.getTime() + slackMs) throw new ReaderInputError("That time is in the future.");
  return d;
}

export interface PositionInput {
  bookId: string;
  wordIndex: number;
  wpm: number;
  clientUpdatedAt: Date;
}

export function parsePositionInput(raw: unknown, now: Date): PositionInput {
  const o = asObject(raw);
  return {
    bookId: parseUuid(o.bookId),
    wordIndex: parseWordIndex(o.wordIndex),
    // The bookmark records the speed at the time; a missing/odd value falls back to the default
    // rather than failing a save (progress must never be lost to a cosmetic field).
    wpm: typeof o.wpm === "number" && Number.isFinite(o.wpm) ? Math.min(1000, Math.max(100, Math.round(o.wpm))) : 300,
    clientUpdatedAt: parseTimestamp(o.clientUpdatedAt, now),
  };
}

export interface HighlightInput {
  bookId: string;
  startWord: number;
  endWord: number;
  text: string;
  note: string | null;
}

export function parseHighlightInput(raw: unknown): HighlightInput {
  const o = asObject(raw);
  const startWord = parseWordIndex(o.startWord);
  const endWord = parseWordIndex(o.endWord);
  if (endWord < startWord) throw new ReaderInputError("The highlight ends before it starts.");
  if (typeof o.text !== "string") throw new ReaderInputError("There's no text to highlight.");
  const text = o.text.replace(/\s+/g, " ").trim().slice(0, MAX_HIGHLIGHT_CHARS);
  if (!text) throw new ReaderInputError("There's no text to highlight.");
  let note: string | null = null;
  if (o.note != null) {
    if (typeof o.note !== "string") throw new ReaderInputError("That note isn't valid.");
    note = o.note.trim().slice(0, MAX_NOTE_CHARS) || null;
  }
  return { bookId: parseUuid(o.bookId), startWord, endWord, text, note };
}

export interface SessionInput {
  bookId: string;
  startedAt: Date;
  endedAt: Date;
  wordsRead: number;
  mode: SessionMode;
  avgWpm: number | null;
}

export function parseSessionInput(raw: unknown, now: Date): SessionInput {
  const o = asObject(raw);
  const startedAt = parseTimestamp(o.startedAt, now);
  const endedAt = parseTimestamp(o.endedAt, now);
  if (endedAt < startedAt) throw new ReaderInputError("The session ends before it starts.");
  if (endedAt.getTime() - startedAt.getTime() > MAX_SESSION_MS) throw new ReaderInputError("That session is too long.");
  if (!SESSION_MODES.includes(o.mode as SessionMode)) throw new ReaderInputError("That reading mode isn't valid.");
  const wordsRead = int(o.wordsRead, "Words read", 0, MAX_SESSION_WORDS);
  let avgWpm: number | null = null;
  if (o.avgWpm != null) avgWpm = int(o.avgWpm, "Average speed", 0, 5000);
  return { bookId: parseUuid(o.bookId), startedAt, endedAt, wordsRead, mode: o.mode as SessionMode, avgWpm };
}

/** A partial settings patch; only known keys survive, each range-checked like the column's CHECK. */
export function parseSettingsPatch(raw: unknown): Partial<ReaderSettings> {
  const o = asObject(raw);
  const out: Partial<ReaderSettings> = {};
  if (o.wpm !== undefined) out.wpm = parseWpm(o.wpm);
  if (o.fontScale !== undefined) {
    if (typeof o.fontScale !== "number" || !(o.fontScale >= 0.75 && o.fontScale <= 2)) {
      throw new ReaderInputError("Text size must be between 75% and 200%.");
    }
    out.fontScale = Math.round(o.fontScale * 100) / 100;
  }
  if (o.theme !== undefined) {
    if (!READER_THEMES.includes(o.theme as ReaderTheme)) throw new ReaderInputError("That theme isn't valid.");
    out.theme = o.theme as ReaderTheme;
  }
  if (o.voiceUri !== undefined) {
    if (o.voiceUri !== null && (typeof o.voiceUri !== "string" || o.voiceUri.length > 500)) {
      throw new ReaderInputError("That voice isn't valid.");
    }
    out.voiceUri = o.voiceUri === "" ? null : (o.voiceUri as string | null);
  }
  if (o.speechRate !== undefined) {
    if (typeof o.speechRate !== "number" || !(o.speechRate >= 0.5 && o.speechRate <= 3)) {
      throw new ReaderInputError("Speaking speed must be between 0.5x and 3x.");
    }
    out.speechRate = Math.round(o.speechRate * 100) / 100;
  }
  if (o.focalLines !== undefined) {
    if (typeof o.focalLines !== "boolean") throw new ReaderInputError("That setting isn't valid.");
    out.focalLines = o.focalLines;
  }
  if (o.dailyWordGoal !== undefined) {
    out.dailyWordGoal = o.dailyWordGoal === null ? null : int(o.dailyWordGoal, "Daily goal", 1, 1_000_000);
  }
  return out;
}

export function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ReaderInputError("That request isn't valid.");
  return raw as Record<string, unknown>;
}
