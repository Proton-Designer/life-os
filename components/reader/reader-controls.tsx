"use client";

import { Minus, Pause, Play, Plus, SkipBack, SkipForward } from "lucide-react";
import { MAX_WPM, MIN_WPM, WPM_STEP, minutesLeft, percentRead } from "@/lib/reader/rsvp";
import { cn } from "@/lib/utils";

export const READER_BTN =
  "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-fg)] transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--reader-focal)] disabled:opacity-40";

export function ReaderControls({
  totalWords,
  index,
  playing,
  wpm,
  chapterTitle,
  onToggle,
  onBack,
  onForward,
  onSeek,
  onWpm,
}: {
  totalWords: number;
  index: number;
  playing: boolean;
  wpm: number;
  chapterTitle: string | null;
  onToggle: () => void;
  onBack: () => void;
  onForward: () => void;
  onSeek: (wordIndex: number) => void;
  onWpm: (wpm: number) => void;
}) {
  const pct = percentRead(totalWords, index);
  const left = minutesLeft(totalWords, index, wpm);
  const last = Math.max(0, totalWords - 1);
  return (
    <div
      data-testid="reader-controls"
      className="flex flex-col gap-3 border-t border-[var(--reader-border)] bg-[var(--reader-bg)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1">
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={Math.min(index, last)}
          aria-label="Position in book"
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-8 w-full cursor-pointer accent-[var(--reader-focal)]"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--reader-muted)]">
          <span data-testid="reader-progress">
            {pct}% · {left === 0 ? "finished" : `~${left} min left`}
          </span>
          {chapterTitle ? <span className="min-w-0 truncate">{chapterTitle}</span> : null}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Back one sentence" onClick={onBack} className={cn(READER_BTN, "size-12")}>
            <SkipBack className="size-5" />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onToggle}
            className={cn(READER_BTN, "size-16 border-transparent bg-[var(--reader-fg)] text-[var(--reader-bg)]")}
          >
            {playing ? <Pause className="size-7" /> : <Play className="size-7" />}
          </button>
          <button type="button" aria-label="Forward one sentence" onClick={onForward} className={cn(READER_BTN, "size-12")}>
            <SkipForward className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Slower"
            disabled={wpm <= MIN_WPM}
            onClick={() => onWpm(wpm - WPM_STEP)}
            className={cn(READER_BTN, "size-11")}
          >
            <Minus className="size-4" />
          </button>
          <span data-testid="reader-wpm" className="min-w-[4.5rem] text-center text-sm tabular-nums">
            {wpm} <span className="text-xs text-[var(--reader-muted)]">wpm</span>
          </span>
          <button
            type="button"
            aria-label="Faster"
            disabled={wpm >= MAX_WPM}
            onClick={() => onWpm(wpm + WPM_STEP)}
            className={cn(READER_BTN, "size-11")}
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
