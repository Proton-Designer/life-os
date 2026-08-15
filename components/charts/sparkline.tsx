import { scaleLinear } from "@/lib/charts/scale";
import { buildLinePath, buildAreaPath } from "@/lib/charts/path";

const WIDTH = 120;
const HEIGHT = 32;

// Compact inline trend — no axes, no legend, no interaction (per the dataviz
// method, a sparkline is the one figure a full hover layer isn't built for;
// it lives beside a value the reader already has). Used inside StatTile/
// KpiCard captions and small-multiples rows.
export function Sparkline({
  values,
  colorVar = "--accent-info",
}: {
  values: number[];
  colorVar?: string;
}) {
  if (values.length === 0) {
    return <div style={{ width: WIDTH, height: HEIGHT }} aria-hidden />;
  }

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const yScale = scaleLinear([min, max], [HEIGHT - 2, 2]);
  const xStep = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: values.length > 1 ? i * xStep : WIDTH / 2,
    y: yScale(v),
  }));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={`Trend: ${values.join(", ")}`}
    >
      <path d={buildAreaPath(points, HEIGHT)} fill={`var(${colorVar})`} fillOpacity={0.1} stroke="none" />
      <path d={buildLinePath(points)} fill="none" stroke={`var(${colorVar})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* A lone point has no "L" segment to draw — an "M"-only path is
          invisible, so it needs its own marker (same fix as AreaChart). */}
      {points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r={3} fill={`var(${colorVar})`} />}
    </svg>
  );
}
