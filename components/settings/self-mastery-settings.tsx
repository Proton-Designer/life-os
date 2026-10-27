"use client";

import { useState, useTransition } from "react";
import { saveSelfMasterySettings } from "@/app/(app)/settings/self-mastery-actions";
import {
  MAX_DAILY_NEW_LIMIT,
  MAX_SESSION_MINUTES,
  MIN_DAILY_NEW_LIMIT,
  MIN_SESSION_MINUTES,
  validateSelfMasterySettings,
  type SelfMasterySessionSettings,
} from "@/lib/self-mastery/session-settings";

/**
 * Settings > Self-Mastery: how many brand-new cards may start each day, and how long a session is meant to run.
 * Shown only to accounts that have Self-Mastery. The save is optimistic ("Saved." at once, flipped to the error if
 * the write is refused), like the daily focus target.
 */
export function SelfMasterySettings({ initial }: { initial: SelfMasterySessionSettings }) {
  const [newCards, setNewCards] = useState(String(initial.dailyNewLimit));
  const [minutes, setMinutes] = useState(String(initial.sessionTargetMinutes));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  function save() {
    // Number("") is 0: an empty field must not become a silent "no new cards".
    const next = { dailyNewLimit: newCards.trim() === "" ? Number.NaN : Number(newCards), sessionTargetMinutes: minutes.trim() === "" ? Number.NaN : Number(minutes) };
    const invalid = validateSelfMasterySettings(next);
    if (invalid) {
      setMessage({ ok: false, text: invalid });
      return;
    }
    setMessage({ ok: true, text: "Saved." }); // optimistic
    startTransition(async () => {
      const res = await saveSelfMasterySettings(next);
      if (!res.ok) setMessage({ ok: false, text: res.message });
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="self-mastery-settings">
      <p className="text-xs text-muted-foreground">
        A session takes the cards that are due first, then up to your new-card allowance for the day, within the session length at your own pace.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-sm">New cards per day</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_DAILY_NEW_LIMIT}
          max={MAX_DAILY_NEW_LIMIT}
          step={1}
          value={newCards}
          onChange={(e) => setNewCards(e.target.value)}
          aria-label="New cards per day"
          className="h-9 w-24 rounded-md border bg-background px-2"
        />
        <span className="text-xs text-muted-foreground">
          {MIN_DAILY_NEW_LIMIT}–{MAX_DAILY_NEW_LIMIT}. Cards you have already started today count against it.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Daily session length</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_SESSION_MINUTES}
          max={MAX_SESSION_MINUTES}
          step={1}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-label="Daily session length (minutes)"
          className="h-9 w-24 rounded-md border bg-background px-2"
        />
        <span className="text-xs text-muted-foreground">
          {MIN_SESSION_MINUTES}–{MAX_SESSION_MINUTES} minutes. Close to an exam a session can run longer, never past {MAX_SESSION_MINUTES}.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} className="h-9 rounded-md border px-3">
          Save
        </button>
        {message && (
          <span role="status" className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
