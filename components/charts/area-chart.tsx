"use client";

import { useState } from "react";
import { scaleLinear, niceTicks } from "@/lib/charts/scale";
import { buildLinePath, buildAreaPath } from "@/lib/charts/path";
import { ChartLegend } from "./chart-legend";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

export type AreaChartSeries = { label: string; colorVar: string; values: number[] };

const WIDTH = 600;
const PADDING = { top: 12, right: 12, bottom: 20, left: 32 };

// Change-over-time, 1-2 series, one y-axis (never dual). A single logical
// coordinate space (WIDTH x height) stretched to the container's real width
// via width="100%" — the crosshair position is reported to ChartTooltip as
// a PERCENT of WIDTH rather than a raw viewBox px, so it lands correctly
// regardless of the SVG's actual rendered width.
export function AreaChart({
  categories,
  series,
  height = 200,
  unit = "",
}: {
  categories: string[];
  series: AreaChartSeries[];
  height?: number;
  /** Appended to both axis ticks and tooltip values — e.g. "%" when the
   * plotted values are a percentage, so the axis and any hero value shown
   * alongside the chart can't read as two different units. A plain string,
   * not a formatter function: AreaChart is a Client Component and this
   * often gets called from a Server Component page, which can't pass
   * functions as props across that boundary. */
  unit?: string;
}) {
  const formatValue = (v: number) => `${v}${unit}`;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = height - PADDING.top - PADDING.bottom;

  const hasData = categories.length > 0 && series.some((s) => s.values.length > 0);
  const allValues = series.flatMap((s) => s.values);
  const ticks = hasData ? niceTicks(Math.min(0, ...allValues), Math.max(0, ...allValues), 4) : [0];
  const yScale = scaleLinear([ticks[0], ticks[ticks.length - 1]], [innerHeight, 0]);
  const xStep = categories.length > 1 ? innerWidth / (categories.length - 1) : 0;
  const xAt = (i: number) => (categories.length > 1 ? i * xStep : innerWidth / 2);

  return (
    <div className="relative flex flex-col gap-2">
      {series.length >= 2 && <ChartLegend series={series} />}
      {!hasData ? (
        <div
          className="flex items-center justify-center text-xs text-muted-foreground"
          style={{ height }}
        >
          No data yet
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${series.map((s) => s.label).join(", ")} across ${categories.join(", ")}`}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <g transform={`translate(${PADDING.left},${PADDING.top})`}>
            {ticks.map((t) => (
              <line
                key={`grid-${t}`}
                x1={0}
                x2={innerWidth}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="var(--border)"
                strokeWidth={1}
              />
            ))}
            {ticks.map((t) => (
              <text
                key={`label-${t}`}
                x={-8}
                y={yScale(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {formatValue(t)}
              </text>
            ))}

            {series.map((s) => {
              const points = s.values.map((v, i) => ({ x: xAt(i), y: yScale(v) }));
              return (
                <g key={s.label}>
                  <path
                    d={buildAreaPath(points, innerHeight)}
                    fill={`var(${s.colorVar})`}
                    fillOpacity={0.1}
                    stroke="none"
                  />
                  <path
                    d={buildLinePath(points)}
                    fill="none"
                    stroke={`var(${s.colorVar})`}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {/* A lone point has no "L" segment to draw — an "M"-only
                      path is invisible, so it needs its own marker. */}
                  {points.length === 1 && (
                    <circle cx={points[0].x} cy={points[0].y} r={4} fill={`var(${s.colorVar})`} stroke="var(--card)" strokeWidth={2} />
                  )}
                </g>
              );
            })}

            {categories.map((_, i) => (
              <rect
                key={i}
                x={xAt(i) - (xStep || innerWidth) / 2}
                y={0}
                width={xStep || innerWidth}
                height={innerHeight}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onFocus={() => setHoverIndex(i)}
                tabIndex={0}
                role="button"
                aria-label={categories[i]}
              />
            ))}
            {hoverIndex !== null && (
              <line
                x1={xAt(hoverIndex)}
                x2={xAt(hoverIndex)}
                y1={0}
                y2={innerHeight}
                stroke="var(--accent-info)"
                strokeWidth={1}
              />
            )}
          </g>
        </svg>
      )}
      {hasData && hoverIndex !== null && (
        <ChartTooltip
          x={`${((PADDING.left + xAt(hoverIndex)) / WIDTH) * 100}%`}
          y={PADDING.top}
        >
          <div className="mb-1 font-medium">{categories[hoverIndex]}</div>
          {series.map((s) => (
            <ChartTooltipRow
              key={s.label}
              colorVar={s.colorVar}
              label={s.label}
              value={s.values[hoverIndex] !== undefined ? formatValue(s.values[hoverIndex]) : "—"}
            />
          ))}
        </ChartTooltip>
      )}
    </div>
  );
}
