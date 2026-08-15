export type DonutSlice = { label: string; value: number; colorVar: string };
export type DonutSliceLayout = DonutSlice & { pct: number; dashArray: string; dashOffset: number };

/**
 * Lays out donut slices as stroke-dasharray/dashoffset pairs for a `<circle>`
 * of the given `circumference` (2 * PI * r) — the standard SVG donut trick,
 * avoiding hand-rolled arc-path math and its large-arc-flag edge cases.
 */
export function computeDonutLayout(slices: DonutSlice[], circumference: number): DonutSliceLayout[] {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let cumulativeLength = 0;
  return slices.map((slice) => {
    const pct = total === 0 ? 0 : (slice.value / total) * 100;
    const length = (pct / 100) * circumference;
    const layout: DonutSliceLayout = {
      ...slice,
      pct,
      dashArray: `${length} ${circumference - length}`,
      dashOffset: -cumulativeLength,
    };
    cumulativeLength += length;
    return layout;
  });
}
