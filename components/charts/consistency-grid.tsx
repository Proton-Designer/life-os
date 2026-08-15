"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { consistencyCellStyle, type CellTreatment } from "@/lib/charts/consistency-style";

export type ConsistencyCell = { date: string; status: string };
export type ConsistencyRow = { label: string; cells: ConsistencyCell[] };
export type ConsistencyStatusStyle = { colorVar: string; treatment: CellTreatment; label: string };

// Ordered categorical status (on-time -> qada -> missed; done -> not-done)
// over many days — a dense heatmap, not a donut/bar (the spec's chart-form
// ruling: position/order carries the scale, color is reinforcement). Div-based
// rather than SVG — a rectangular grid of cells gets nothing from SVG that
// Tailwind's own grid doesn't already give it, and it matches the existing
// segmented-bar/StatCard precedent already established in this app.
//
// Fill treatment (solid/hatch/hollow) is a REQUIRED second channel here, not
// an opt-in accessibility toggle — the on-time/qada/missed hues fail the
// dataviz method's normal-vision floor (ΔE 13.0 on the amber/red pair,
// below the 15-floor hard fail), and that floor holds regardless of the
// per-cell aria-label/tooltip, which are assistive/on-demand, not the
// at-a-glance read this grid exists for.
export function ConsistencyGrid({
  rows,
  statusStyle,
}: {
  rows: ConsistencyRow[];
  statusStyle: Record<string, ConsistencyStatusStyle>;
}) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  if (rows.length === 0 || rows[0].cells.length === 0) {
    return <p className="text-xs text-muted-foreground">No data yet</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {rows.map((row, rowIndex) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{row.label}</span>
            <div className="flex flex-1 gap-[2px]">
              {row.cells.map((cell, colIndex) => {
                const style = statusStyle[cell.status];
                const isHovered = hovered?.row === rowIndex && hovered?.col === colIndex;
                return (
                  <div key={cell.date} className="relative flex-1">
                    <button
                      type="button"
                      aria-label={`${row.label}, ${cell.date}: ${style?.label ?? cell.status}`}
                      onMouseEnter={() => setHovered({ row: rowIndex, col: colIndex })}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered({ row: rowIndex, col: colIndex })}
                      onBlur={() => setHovered(null)}
                      className={cn("aspect-square w-full rounded-[2px] transition-opacity hover:opacity-80")}
                      style={
                        style
                          ? consistencyCellStyle(style.treatment, style.colorVar)
                          : { backgroundColor: "var(--muted)" }
                      }
                    />
                    {isHovered && (
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/50 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                      >
                        {cell.date}: {style?.label ?? cell.status}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[72px] text-xs text-muted-foreground">
        {Object.entries(statusStyle).map(([key, s]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="size-3 rounded-[2px]" style={consistencyCellStyle(s.treatment, s.colorVar)} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
