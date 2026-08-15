// Always present for >=2 series — the dependable identity channel, never
// color-matching alone. A single series needs no legend box (the chart's
// title/subtitle already names it) — callers simply don't render this for
// a 1-series chart.
export function ChartLegend({ series }: { series: { label: string; colorVar: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: `var(${s.colorVar})` }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
