import { rankBars, type RankedBar } from "@/lib/charts/ranked-bars";

export type RankedBarsItem = RankedBar & { colorVar: string };

// 7-category Focus Map and anything similar — per the spec's chart-form
// ruling, position/rank carries identity here, not a donut (an 8-hue
// palette clears the adjacent-pair color gate but not all-pairs past ~3
// slots). Every bar is direct-labeled, so color is reinforcement, not the
// only channel.
export function RankedBars({ items }: { items: RankedBarsItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No data yet</p>;
  }

  const ranked = rankBars(items);

  return (
    <ul className="flex flex-col gap-2">
      {ranked.map((item) => {
        const original = items.find((i) => i.label === item.label);
        return (
          <li key={item.label} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 truncate text-muted-foreground">{item.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${item.pct}%`, backgroundColor: `var(${original?.colorVar})` }}
              />
            </div>
            <span className="w-12 shrink-0 text-right font-mono tabular-nums">{item.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
