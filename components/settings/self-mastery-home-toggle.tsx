"use client";

import { useState, useTransition } from "react";
import { setSelfMasteryOnHome } from "@/app/(app)/settings/self-mastery-actions";

/**
 * Settings > Self-Mastery: the master switch for Self-Mastery on Home. Optimistic like the other Settings controls; a refused save flips the box
 * back. When off, it says what is hidden and that the library, reader and Self-Mastery tab are still there.
 */
export function SelfMasteryHomeToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function change(next: boolean) {
    setOn(next);
    setError(null);
    startTransition(async () => {
      const res = await setSelfMasteryOnHome(next);
      if (!res.ok) {
        setOn(!next);
        setError(res.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1" data-testid="self-mastery-home-toggle">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} aria-label="Show Self-Mastery on Home" />
        <span>Show Self-Mastery on Home</span>
      </label>
      <p className="text-xs text-muted-foreground">
        {on
          ? "Your study session, “Continue reading” and book-loading status appear on Home."
          : "Self-Mastery is hidden on Home. Your library, reader and Self-Mastery tab are untouched; turn this back on any time."}
      </p>
      {error && (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
