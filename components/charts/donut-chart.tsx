"use client";

import { useState } from "react";
import { computeDonutLayout, type DonutSlice } from "@/lib/charts/donut";
import { ChartLegend } from "./chart-legend";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// 2-3 slices only (per the spec's chart-form rulings — all-pairs color
// comparison caps a validated palette at ~3 slots). Center total is the
// hero value; this is the one place in the app a donut is the right form.
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const layout = computeDonutLayout(slices, CIRCUMFERENCE);
  const hasData = layout.some((s) => s.value > 0);

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label={`${centerLabel}: ${centerValue}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          {hasData &&
            layout.map((s, i) => (
              <circle
                key={s.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={`var(${s.colorVar})`}
                strokeWidth={STROKE}
                strokeDasharray={s.dashArray}
                strokeDashoffset={s.dashOffset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(i)}
                tabIndex={0}
                role="button"
                aria-label={`${s.label}: ${Math.round(s.pct)}%`}
              />
            ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-semibold tabular-nums">{centerValue}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
        </div>
        {hoverIndex !== null && (
          <ChartTooltip x="50%" y={-8}>
            <ChartTooltipRow
              colorVar={layout[hoverIndex].colorVar}
              label={layout[hoverIndex].label}
              value={`${Math.round(layout[hoverIndex].pct)}%`}
            />
          </ChartTooltip>
        )}
      </div>
      <ChartLegend series={slices} />
    </div>
  );
}
