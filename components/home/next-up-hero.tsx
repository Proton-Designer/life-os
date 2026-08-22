"use client";

import { useTransition } from "react";
import { toggleItem } from "@/app/(app)/actions";
import type { PriorityItem } from "@/lib/home/types";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { formatWindowRelativeTime } from "@/lib/date-utils";
import { featuredCardStyle } from "@/lib/featured-card-style";

const DOMAIN_LABEL: Record<PriorityItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Work",
};

function relativeTime(item: PriorityItem, now: Date): string {
  return formatWindowRelativeTime(item.dueAt, item.windowEndAt, now);
}

// The "Next Up" slot of Home's cross-cutting KPI row (Tier 1 — same
// min-h-[168px] rhythm as KpiCard, but keeps its own component rather than
// being forced through KpiCard's generic shape, since it's the one KPI
// that needs an inline primary action button. No internal "all clear"
// fallback — per the chart-empty-states ruling, the caller renders
// EmptyState instead of this component when there's no next item, rather
// than this component rendering its own stub.
export function NextUpHero({
  item,
  now,
  caption,
  ...props
}: { item: PriorityItem; now: Date; caption: string } & React.HTMLAttributes<HTMLDivElement>) {
  const [isPending, startTransition] = useTransition();

  const accent = DOMAIN_ACCENT[item.domain];
  const colorVar = ACCENT_VAR[accent];

  return (
    <div className="flex min-h-[168px] flex-col justify-between rounded-2xl border p-4" style={featuredCardStyle(colorVar)} {...props}>
      <div className="flex items-center gap-3">
        <IconChip icon={DOMAIN_ICON[item.domain]} accent={accent} />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {DOMAIN_LABEL[item.domain]} &middot; {relativeTime(item, now)}
          </p>
          <p className="mt-1 truncate text-lg font-semibold">{item.title}</p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-xs text-muted-foreground">{caption}</p>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => toggleItem(item))}
        >
          {isPending ? "Marking…" : "Mark done"}
        </Button>
      </div>
    </div>
  );
}
