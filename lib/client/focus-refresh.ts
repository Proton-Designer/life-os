// Pure throttle behind FocusRefresh (components/shell/focus-refresh.tsx). Kept separate so the
// rule is unit-testable without a DOM. Tracks when the user LEFT (tab hidden / window blurred);
// on return, refreshes once if they were away for at least `awayMs`, and never more often than
// `minGapMs`. Visibility + focus usually fire together on return: the first one consumes the
// "left" timestamp, so the second is a no-op.
export const FOCUS_REFRESH_AWAY_MS = 60_000;
export const FOCUS_REFRESH_MIN_GAP_MS = 30_000;

export function createFocusRefresher(opts: {
  refresh: () => void;
  now?: () => number;
  awayMs?: number;
  minGapMs?: number;
}) {
  const now = opts.now ?? Date.now;
  const awayMs = opts.awayMs ?? FOCUS_REFRESH_AWAY_MS;
  const minGapMs = opts.minGapMs ?? FOCUS_REFRESH_MIN_GAP_MS;
  let leftAt: number | null = null;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;

  return {
    /** Tab hidden or window blurred. Keeps the EARLIEST departure of a hide+blur pair. */
    left() {
      if (leftAt === null) leftAt = now();
    },
    /** Tab visible again or window focused. */
    returned() {
      if (leftAt === null) return;
      const t = now();
      const away = t - leftAt;
      leftAt = null;
      if (away < awayMs || t - lastRefreshAt < minGapMs) return;
      lastRefreshAt = t;
      opts.refresh();
    },
  };
}
