// Positioned relative to a `relative`-positioned chart wrapper. Values lead,
// labels follow (per the dataviz method): render the number as the strong
// element and the series/category name secondary.
export function ChartTooltip({
  x,
  y,
  children,
}: {
  x: number | string;
  y: number | string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-border/50 bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}

export function ChartTooltipRow({ colorVar, label, value }: { colorVar?: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      {colorVar && <span className="h-[2px] w-3 shrink-0" style={{ backgroundColor: `var(${colorVar})` }} />}
      <span className="font-mono font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
