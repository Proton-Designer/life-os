"use client";

import { useEffect, useState } from "react";
import { HINT_VISIBLE_LIMIT_MS, accumulate, readVisibleMs, safeLocalStorage, writeVisibleMs } from "@/lib/client/visible-time";

const TICK_MS = 1000;

/**
 * Visible milliseconds of Home so far on `localDate` (this device), or null until the stored value has
 * been read (so nothing flashes on first paint). Counts a second only while the document is visible AND
 * focused; the total is persisted, keyed by the local date, so a new day starts at zero.
 *
 * Cheap by design (battery): the 1 s interval is NOT started when the hint is already retired (the stored
 * total is at the limit) or `enabled` is false (hours are already logged), and it stops itself the moment
 * the limit is reached. Before every write the total is merged with what is stored (max), so a second tab
 * on the same day can never overwrite this one's progress downward.
 */
export function useHomeVisibleMs(localDate: string, enabled = true): number | null {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const storage = safeLocalStorage();
    let total = readVisibleMs(storage, localDate);
    setMs(total);
    if (!enabled || total >= HINT_VISIBLE_LIMIT_MS) return;
    let last = Date.now();
    const id = setInterval(() => {
      const nowAt = Date.now();
      const active = document.visibilityState === "visible" && document.hasFocus();
      total = Math.max(total, readVisibleMs(storage, localDate)); // another tab may be ahead
      const next = accumulate(total, last, nowAt, active);
      last = nowAt;
      if (next !== total) {
        total = next;
        writeVisibleMs(storage, localDate, total);
        setMs(total);
      }
      if (total >= HINT_VISIBLE_LIMIT_MS) clearInterval(id); // retired: nothing left to count
    }, TICK_MS);
    return () => clearInterval(id);
  }, [localDate, enabled]);

  return ms;
}
