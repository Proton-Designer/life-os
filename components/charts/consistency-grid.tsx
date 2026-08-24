"use client";

import { useEffect, useRef, useState } from "react";
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
/** "2026-08-15" -> "8/15" — short enough to sit above a 16-22px column. */
function formatShortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function ConsistencyGrid({
  rows,
  statusStyle,
  showDateLabels = false,
}: {
  rows: ConsistencyRow[];
  statusStyle: Record<string, ConsistencyStatusStyle>;
  /** Opt-in, backward-compatible (2026-08-23 spec §8/§9): one row of date
   * labels above the columns, each read top-to-bottom via vertical-rl so a
   * label per square isn't needed. Every existing caller renders unchanged
   * when this is absent. Assumes every row shares the same date sequence as
   * rows[0] — true for every current caller (one shared day range per grid). */
  showDateLabels?: boolean;
}) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opus Lead review (2026-08-16): the 30-column grid measured ~6.5px cells
  // at 390px, well past where the required hatch/hollow texture channel
  // stops reading — texture itself is fine (confirmed legible down to
  // ~17px), the cell was the problem. Fix is a minimum cell size, not a
  // truncated day range — history stays whole, the row scrolls instead.
  // Same mount-scroll pattern as the Day Ribbon, anchored to the most
  // recent day (the right edge) rather than centered on "now", since
  // there's no single "now" point on a status grid.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = el.scrollWidth;
  }, []);

  if (rows.length === 0 || rows[0].cells.length === 0) {
    return <p className="text-xs text-muted-foreground">No data yet</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={scrollRef} className="overflow-x-auto">
        <div className="flex w-fit flex-col gap-1">
          {showDateLabels && rows.length > 0 && (
            <div className="flex items-end gap-2">
              <span aria-hidden="true" className="sticky left-0 z-20 w-16 shrink-0 bg-card" />
              <div className="flex gap-[2px]">
                {rows[0].cells.map((cell) => (
                  <div key={cell.date} className="flex w-4 shrink-0 justify-center sm:w-[22px]">
                    <span
                      className="whitespace-nowrap text-[9px] leading-none text-muted-foreground"
                      style={{ writingMode: "vertical-rl" }}
                    >
                      {formatShortDate(cell.date)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {rows.map((row, rowIndex) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="sticky left-0 z-20 w-16 shrink-0 truncate bg-card pr-1 text-xs text-muted-foreground">
                {row.label}
              </span>
              <div className="flex gap-[2px]">
                {row.cells.map((cell, colIndex) => {
                  const style = statusStyle[cell.status];
                  const isHovered = hovered?.row === rowIndex && hovered?.col === colIndex;
                  return (
                    <div key={cell.date} className="relative w-4 shrink-0 sm:w-[22px]">
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
                          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/50 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
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
