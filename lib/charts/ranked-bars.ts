export type RankedBar = { label: string; value: number };
export type RankedBarLayout = RankedBar & { pct: number };

/** Sorts descending and scales each bar's width relative to the largest value. */
export function rankBars(bars: RankedBar[]): RankedBarLayout[] {
  const sorted = [...bars].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;
  return sorted.map((b) => ({ ...b, pct: max === 0 ? 0 : (b.value / max) * 100 }));
}
