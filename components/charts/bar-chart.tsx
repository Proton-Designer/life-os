"use client";

import { useState } from "react";
import { scaleLinear, niceTicks } from "@/lib/charts/scale";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

export type BarChartBar = { label: string; value: number };

const WIDTH = 600;
const PADDING = { top: 12, right: 12, bottom: 20, left: 32 };
const MAX_BAR_THICKNESS = 24;

// Weekly totals with one period emphasized — the single bar highlighted in
// --accent-info directly mirrors Ref B's treatment; every other bar stays
// the series' own de-emphasis tint.
export function BarChart({
  bars,
  colorVar,
  highlightIndex,
  height = 200,
}: {
  bars: BarChartBar[];
  colorVar: string;
  highlightIndex?: number;
  height?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = height - PADDING.top - PADDING.bottom;
  const hasData = bars.length > 0;

  const values = bars.map((b) => b.value);
  const ticks = hasData ? niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4) : [0];
  const yScale = scaleLinear([ticks[0], ticks[ticks.length - 1]], [innerHeight, 0]);
  const zeroY = yScale(0);

  const slot = bars.length > 0 ? innerWidth / bars.length : innerWidth;
  const barWidth = Math.min(MAX_BAR_THICKNESS, slot * 0.6);

  return (
    <div className="relative flex flex-col gap-2">
      {!hasData ? (
        <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
          No data yet
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${bars.map((b) => `${b.label}: ${b.value}`).join(", ")}`}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <g transform={`translate(${PADDING.left},${PADDING.top})`}>
            {ticks.map((t) => (
              <line key={`grid-${t}`} x1={0} x2={innerWidth} y1={yScale(t)} y2={yScale(t)} stroke="var(--border)" strokeWidth={1} />
            ))}
            {ticks.map((t) => (
              <text key={`label-${t}`} x={-8} y={yScale(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
                {t}
              </text>
            ))}

            {bars.map((b, i) => {
              const cx = slot * i + slot / 2;
              const y = yScale(b.value);
              const barTop = Math.min(y, zeroY);
              const barHeight = Math.max(Math.abs(zeroY - y), 1);
              const isHighlighted = i === highlightIndex;
              return (
                <g key={b.label}>
                  <rect
                    x={cx - barWidth / 2}
                    y={barTop}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={isHighlighted ? "var(--accent-info)" : `var(${colorVar})`}
                    fillOpacity={isHighlighted ? 1 : 0.55}
                    onMouseEnter={() => setHoverIndex(i)}
                    onFocus={() => setHoverIndex(i)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${b.label}: ${b.value}`}
                  />
                  <text x={cx} y={innerHeight + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {b.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hasData && hoverIndex !== null && (
        <ChartTooltip x={`${((PADDING.left + (slot * hoverIndex + slot / 2)) / WIDTH) * 100}%`} y={PADDING.top}>
          <ChartTooltipRow
            colorVar={hoverIndex === highlightIndex ? "--accent-info" : colorVar}
            label={bars[hoverIndex].label}
            value={String(bars[hoverIndex].value)}
          />
        </ChartTooltip>
      )}
    </div>
  );
}
