"use client";

import { useTransition } from "react";
import { toggleItem } from "@/app/(app)/actions";
import type { PriorityItem } from "@/lib/home/types";
import { Button } from "@/components/ui/button";

const DOMAIN_LABEL: Record<PriorityItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Co-op",
};

function relativeTime(dueAt: Date | null, now: Date): string {
  if (!dueAt) return "Today";
  const diffMin = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (diffMin < -1) return `${Math.abs(diffMin)} min overdue`;
  if (diffMin <= 1) return "Now";
  if (diffMin < 60) return `in ${diffMin} min`;
  const hours = Math.round(diffMin / 60);
  return `in ${hours} hr${hours === 1 ? "" : "s"}`;
}

export function NextUpHero({ item, now }: { item: PriorityItem | null; now: Date }) {
  const [isPending, startTransition] = useTransition();

  if (!item) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6">
        <p className="text-sm text-muted-foreground">Next up</p>
        <p className="mt-2 text-lg font-medium">You&apos;re all clear</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-6"
      style={{
        borderColor: "color-mix(in oklch, var(--accent-deen) 30%, transparent)",
        background:
          "radial-gradient(ellipse at top left, color-mix(in oklch, var(--accent-deen) 16%, transparent), transparent 70%)",
      }}
    >
      <p className="text-sm text-muted-foreground">
        {DOMAIN_LABEL[item.domain]} &middot; {relativeTime(item.dueAt, now)}
      </p>
      <p className="mt-1 text-xl font-semibold">{item.title}</p>
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
