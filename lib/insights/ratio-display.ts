/**
 * Shared "X.X : 1" / "All Signal" / "No data" display logic — used by both
 * Business's weekly S:N ratio (Task 6.1) and Insights' global/per-domain
 * ratios (Task 12.1), so the divide-by-zero/no-data handling isn't
 * duplicated. `hasAnyData` should reflect whether there were any answered
 * check-ins at all in range (not just signal+noise), since a week of only
 * 'other_work' check-ins is real data, not "no data".
 */
export function computeRatioDisplay(signal: number, noise: number, hasAnyData: boolean): string {
  if (!hasAnyData) return "No data";
  if (noise === 0) return "All Signal";
  return `${(signal / noise).toFixed(1)} : 1`;
}
