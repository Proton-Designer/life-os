import type { SchoolTodayItem } from "@/lib/school/school-today";
import { cn } from "@/lib/utils";
import type { RiskBand } from "@/lib/school/risk/assignment-risk";

const BAND_COLOR: Record<RiskBand, string> = {
  low: "text-muted-foreground",
  moderate: "text-accent-warning",
  high: "text-destructive",
  critical: "text-destructive font-semibold",
};

/**
 * Phase 1 #15 — the day-level "School Today" feed, surfaced. `getSchoolTodayFeed`
 * (lib/school/school-today.ts) is pure data; this is its first UI reader — reachability
 * now, ahead of #28 (Night Plan seam) becoming its second consumer later in the build
 * order. Each row's `title` already carries the full "CODE · name · due Thu" format —
 * this component renders it verbatim, it does not re-derive it.
 */
export function SchoolTodayPanel({ items }: { items: SchoolTodayItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing due today across your classes.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <div
          key={item.id}
          data-testid={`school-today-row-${item.id}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-2 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
          <span className={cn("shrink-0 text-xs", BAND_COLOR[item.risk.band])}>{item.risk.band}</span>
        </div>
      ))}
    </div>
  );
}
