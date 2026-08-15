"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type ConsistencyCell = { date: string; status: string };
export type ConsistencyRow = { label: string; cells: ConsistencyCell[] };

// Ordered categorical status (on-time -> qada -> missed; done -> not-done)
// over many days — a dense heatmap, not a donut/bar (the spec's chart-form
// ruling: position/order carries the scale, color is reinforcement). Div-based
// rather than SVG — a rectangular grid of cells gets nothing from SVG that
// Tailwind's own grid doesn't already give it, and it matches the existing
// segmented-bar/StatCard precedent already established in this app.
export function ConsistencyGrid({
  rows,
  statusColorVar,
  statusLabel,
}: {
  rows: ConsistencyRow[];
  statusColorVar: Record<string, string>;
  statusLabel: Record<string, string>;
}) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  if (rows.length === 0 || rows[0].cells.length === 0) {
    return <p className="text-xs text-muted-foreground">No data yet</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, rowIndex) => (
        <div key={row.label} className="flex items-center gap-2">
          <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{row.label}</span>
          <div className="flex flex-1 gap-[2px]">
            {row.cells.map((cell, colIndex) => {
              const colorVar = statusColorVar[cell.status];
              const isHovered = hovered?.row === rowIndex && hovered?.col === colIndex;
              return (
                <div key={cell.date} className="relative flex-1">
                  <button
                    type="button"
                    aria-label={`${row.label}, ${cell.date}: ${statusLabel[cell.status] ?? cell.status}`}
                    onMouseEnter={() => setHovered({ row: rowIndex, col: colIndex })}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered({ row: rowIndex, col: colIndex })}
                    onBlur={() => setHovered(null)}
                    className={cn("aspect-square w-full rounded-[2px] transition-opacity hover:opacity-80")}
                    style={{ backgroundColor: colorVar ? `var(${colorVar})` : "var(--muted)" }}
                  />
                  {isHovered && (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/50 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                    >
                      {cell.date}: {statusLabel[cell.status] ?? cell.status}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
