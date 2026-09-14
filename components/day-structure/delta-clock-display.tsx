"use client";

import { useEffect, useState } from "react";
import { computeDeltaSeconds, formatDeltaClock } from "@/lib/day-structure/delta-clock";

/**
 * The live-ticking half of #34 (Delta clock). Receives `wokeAtIso` — a
 * plain serializable string, never a function — from the Server Component
 * that renders it (app/(app)/open/today/page.tsx); all the ticking state
 * lives here because a Server Component has no way to re-render itself
 * once a second on its own.
 *
 * `initialSeconds` is computed server-side at request time and used
 * directly for the first render, so SSR and the client's initial paint
 * agree exactly — no flash of "0:00" while the client mounts, and no
 * hydration mismatch from computing a fresh `now` on first render.
 */
export function DeltaClockDisplay({ wokeAtIso, initialSeconds }: { wokeAtIso: string; initialSeconds: number }) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    // Recomputed from wokeAtIso + Date.now() every tick, never incremented
    // by 1 each time — an incrementing counter drifts from wall-clock truth
    // the instant a backgrounded tab throttles setInterval (browsers can go
    // well over a second between fires), and silent drift is exactly the
    // failure mode a "time since X" clock must not have.
    const id = setInterval(() => {
      setSeconds(computeDeltaSeconds(wokeAtIso, new Date()));
    }, 1000);
    return () => clearInterval(id);
  }, [wokeAtIso]);

  return <span className="font-mono text-2xl font-semibold tabular-nums">{formatDeltaClock(seconds)}</span>;
}
