import type { TimeRange } from "./schedule";

/**
 * Deep sessions account for themselves -- pure, no React, no I/O.
 *
 * A Deep Work / Deep Study session is never asked about: no hourly "Still on it?", no check-in inside the overlay, and
 * no hour that turns into Wasted because nobody tapped. Its minutes belong to the session's own domain from the moment
 * it runs (Deep Work -> Business, Deep Study / exam prep -> School), and every reader derives that the same way:
 *   - the 2-hour check-in pre-fills the overlapping minutes into that domain (prefill.ts);
 *   - a window the sessions already cover end to end is never queued (schedule.ts);
 *   - Signal:Noise adds the session minutes no answered window already holds (deriveSessionMinutesByDomain below).
 * Nothing here writes a row. An answered window is the person's own account of those two hours, so session minutes
 * inside a stored window are left to that row -- they are never counted twice.
 */

/** A session's span plus the allocation domain its time belongs to. `domain: null` = no domain (never credited). */
export type SessionRange = TimeRange & { domain: string | null };

const SESSION_KIND_DOMAIN: Record<string, string> = {
  deep_work: "business",
  deep_study: "school",
  exam_prep: "school",
};

/** The allocation domain a work-session kind is credited to, or null for a kind that has none. */
export function sessionDomainForKind(kind: string): string | null {
  return SESSION_KIND_DOMAIN[kind] ?? null;
}

type Span = { start: number; end: number };

/** Sorts and coalesces overlapping / touching spans. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * Whole minutes each domain gained from sessions inside [rangeStart, rangeEnd), leaving out every minute that falls
 * inside a stored allocation window (that row already holds them, as the person confirmed or edited them). An open
 * session counts up to `now`.
 */
export function deriveSessionMinutesByDomain(
  sessions: readonly SessionRange[],
  storedSpans: readonly { start: Date; end: Date }[],
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
): { domain: string; minutes: number }[] {
  const stored = mergeSpans(storedSpans.map((s) => ({ start: s.start.getTime(), end: s.end.getTime() })));
  const byDomain = new Map<string, number>();
  for (const session of sessions) {
    if (session.domain === null) continue;
    const start = Math.max(session.start.getTime(), rangeStart.getTime());
    const end = Math.min((session.end ?? now).getTime(), rangeEnd.getTime(), now.getTime());
    if (end <= start) continue;
    // Subtract the stored spans from [start, end).
    let ms = end - start;
    for (const s of stored) {
      const overlap = Math.min(end, s.end) - Math.max(start, s.start);
      if (overlap > 0) ms -= overlap;
    }
    if (ms <= 0) continue;
    byDomain.set(session.domain, (byDomain.get(session.domain) ?? 0) + ms);
  }
  return [...byDomain.entries()]
    .map(([domain, ms]) => ({ domain, minutes: Math.floor(ms / 60_000) }))
    .filter((d) => d.minutes > 0);
}
