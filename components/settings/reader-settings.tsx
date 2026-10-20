"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { updateReaderSettings } from "@/app/(app)/personal/reader-actions";
import { MAX_WPM, MIN_WPM } from "@/lib/reader/rsvp";

export interface ReaderSettingsValues {
  wpm: number;
  dailyWordGoal: number | null;
  focalLines: boolean;
}

/** Whole-number text field -> number; blank is "not set"; anything else (decimals, letters, out of range) is invalid. */
export function parseWholeNumber(text: string, min: number, max: number): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  return n >= min && n <= max ? n : "invalid";
}

/**
 * Settings > Reading: the focus reader's defaults (speed, daily word goal, focal lines) and a plain statement of what
 * is stored where. The reader itself saves these as you change them while reading; this is the same row.
 */
export function ReaderSettings({ initial }: { initial: ReaderSettingsValues }) {
  const [wpm, setWpm] = useState(String(initial.wpm));
  const [goal, setGoal] = useState(initial.dailyWordGoal === null ? "" : String(initial.dailyWordGoal));
  const [focal, setFocal] = useState(initial.focalLines);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const w = parseWholeNumber(wpm, MIN_WPM, MAX_WPM);
    if (w === null || w === "invalid") {
      setMessage({ ok: false, text: `Reading speed must be a whole number from ${MIN_WPM} to ${MAX_WPM}.` });
      return;
    }
    const g = parseWholeNumber(goal, 1, 1_000_000);
    if (g === "invalid") {
      setMessage({ ok: false, text: "Daily goal must be a whole number of words, or blank for none." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await updateReaderSettings({ wpm: w, dailyWordGoal: g, focalLines: focal });
      setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.message });
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="reader-settings">
      <p className="text-xs text-muted-foreground">Defaults for the focus reader. You can still change speed while you read.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Reading speed (words per minute)</span>
          <input type="text" inputMode="numeric" value={wpm} onChange={(e) => setWpm(e.target.value)} aria-label="Reading speed in words per minute" className="h-9 w-28 rounded-md border bg-background px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Daily goal (words, blank for none)</span>
          <input type="text" inputMode="numeric" value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Daily reading goal in words" className="h-9 w-32 rounded-md border bg-background px-2" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Not sure what speed suits you?{" "}
        <Link href="/read/speed-test" className="underline underline-offset-2" data-testid="settings-speed-test-link">
          Take the two-minute reading speed test
        </Link>
        . It checks understanding too, because speed without it isn&apos;t the goal.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={focal} onChange={(e) => setFocal(e.target.checked)} aria-label="Highlight the focal letter" />
        Highlight the focal letter in speed-reading mode
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="h-9 rounded-md border px-3 disabled:opacity-60">
          Save reading settings
        </button>
        {message && (
          <span role="status" className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {message.text}
          </span>
        )}
      </div>
      <div className="border-t border-border/40 pt-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">What is stored where</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>The text you import is kept in your private storage, visible only to you, and is deleted with the book.</li>
          <li>Your place, highlights and reading time are saved to your account so you can pick up on any device.</li>
          <li>Listening uses the voices already on your device. No audio or text is sent to a speech service.</li>
        </ul>
      </div>
    </div>
  );
}
