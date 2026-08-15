"use client";

import { useTransition } from "react";
import { toggleItem } from "@/app/(app)/actions";
import type { PriorityItem } from "@/lib/home/types";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { formatRelativeDuration } from "@/lib/date-utils";
import { featuredCardStyle } from "@/lib/featured-card-style";

const DOMAIN_LABEL: Record<PriorityItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Co-op",
};

function relativeTime(dueAt: Date | null, now: Date): string {
  if (!dueAt) return "Today";
  const diffMin = (dueAt.getTime() - now.getTime()) / 60_000;
  const formatted = formatRelativeDuration(diffMin);
  return formatted === "now" ? "Now" : formatted;
}

export function NextUpHero({
  item,
  now,
  ...props
}: { item: PriorityItem | null; now: Date } & React.HTMLAttributes<HTMLDivElement>) {
  const [isPending, startTransition] = useTransition();

  if (!item) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6" {...props}>
        <p className="text-sm text-muted-foreground">Next up</p>
        <p className="mt-2 text-lg font-medium">You&apos;re all clear</p>
      </div>
    );
  }

  const accent = DOMAIN_ACCENT[item.domain];
  const colorVar = ACCENT_VAR[accent];

  return (
    <div
      className="rounded-2xl border p-6"
      style={featuredCardStyle(colorVar)}
      {...props}
    >
      <div className="flex items-center gap-3">
        <IconChip icon={DOMAIN_ICON[item.domain]} accent={accent} />
        <div>
          <p className="text-sm text-muted-foreground">
            {DOMAIN_LABEL[item.domain]} &middot; {relativeTime(item.dueAt, now)}
          </p>
          <p className="mt-1 text-xl font-semibold">{item.title}</p>
        </div>
      </div>
      <Button
        className="mt-4"
        disabled={isPending}
        onClick={() => startTransition(() => toggleItem(item))}
      >
        {isPending ? "Marking…" : "Mark done"}
      </Button>
    </div>
  );
}
