"use client";

import { useEffect, useState } from "react";
import { accumulate, readVisibleMs, safeLocalStorage, writeVisibleMs } from "@/lib/client/visible-time";

const TICK_MS = 1000;

/**
 * Visible milliseconds of Home so far on `localDate` (this device), or null until the stored value has
 * been read (so nothing flashes on first paint). Counts a second only while the document is visible AND
 * focused; the total is persisted every tick, keyed by the local date, so a new day starts at zero.
 */
export function useHomeVisibleMs(localDate: string): number | null {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const storage = safeLocalStorage();
    let total = readVisibleMs(storage, localDate);
    let last = Date.now();
    setMs(total);
    const id = setInterval(() => {
      const nowAt = Date.now();
      const active = document.visibilityState === "visible" && document.hasFocus();
      const next = accumulate(total, last, nowAt, active);
      last = nowAt;
      if (next !== total) {
        total = next;
        writeVisibleMs(storage, localDate, total);
        setMs(total);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [localDate]);

  return ms;
}
