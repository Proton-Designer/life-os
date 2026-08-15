export type ChartPoint = { x: number; y: number };

/** An SVG path `d` string connecting `points` with straight 2px line segments. */
export function buildLinePath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

/** `buildLinePath` closed down to `baselineY` — the ~10% opacity area wash under a line. */
export function buildAreaPath(points: ChartPoint[], baselineY: number): string {
  if (points.length === 0) return "";
  const line = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x},${baselineY} L${first.x},${baselineY} Z`;
}
