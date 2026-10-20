"use client";

import { orpIndex } from "@/lib/reader/rsvp";

// The word is split at its optimal recognition point into [before][focal][after] inside a 1fr/auto/1fr grid, so the
// focal letter's column is always dead centre whatever the word's length or font: nothing is measured, nothing jitters.
export function splitAtOrp(word: string): { before: string; focal: string; after: string } {
  if (word.length === 0) return { before: "", focal: "", after: "" };
  const at = orpIndex(word);
  const focal = String.fromCodePoint(word.codePointAt(at) ?? 0x20);
  return { before: word.slice(0, at), focal, after: word.slice(at + focal.length) };
}

export function RsvpView({
  word,
  before,
  after,
  fontScale,
  focalLines,
}: {
  word: string;
  /** A few words of lead-in and lead-out for the faint context line. */
  before: string[];
  after: string[];
  fontScale: number;
  focalLines: boolean;
}) {
  const { before: pre, focal, after: post } = splitAtOrp(word);
  const size = `calc(clamp(2.25rem, 10vw, 4.5rem) * ${fontScale})`;
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-10 px-4" data-testid="rsvp-view">
      <div className="relative w-full max-w-3xl" style={{ fontSize: size }}>
        {focalLines ? (
          <>
            <div aria-hidden data-testid="focal-lines" className="pointer-events-none absolute inset-x-0 -top-[0.9em] bottom-auto flex flex-col items-center">
              <div className="h-px w-full bg-[var(--reader-border)]" />
              <div className="h-[0.35em] w-px bg-[var(--reader-focal)]" />
            </div>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-[0.9em] top-auto flex flex-col items-center">
              <div className="h-[0.35em] w-px bg-[var(--reader-focal)]" />
              <div className="h-px w-full bg-[var(--reader-border)]" />
            </div>
          </>
        ) : null}
        <p
          data-testid="rsvp-word"
          aria-label={word}
          className="grid grid-cols-[1fr_auto_1fr] items-baseline whitespace-pre font-medium leading-tight tracking-tight"
        >
          <span aria-hidden className="text-right">{pre}</span>
          <span aria-hidden data-testid="rsvp-focal" className="text-[var(--reader-focal)]">{focal}</span>
          <span aria-hidden className="text-left">{post}</span>
        </p>
      </div>
      <p
        aria-hidden
        data-testid="rsvp-context"
        className="w-full max-w-3xl truncate text-center text-sm text-[var(--reader-muted)] opacity-70 sm:text-base"
      >
        {before.length > 0 ? `${before.join(" ")} ` : ""}
        <span className="text-[var(--reader-fg)]">{word}</span>
        {after.length > 0 ? ` ${after.join(" ")}` : ""}
      </p>
    </div>
  );
}
