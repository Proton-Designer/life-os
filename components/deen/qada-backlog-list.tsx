"use client";

import { useOptimistic, useTransition } from "react";
import { History } from "lucide-react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { QadaBacklogItem } from "@/lib/deen/qada-backlog";

const PRAYER_LABEL: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

function formatBacklogDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Row({ item, onMarked }: { item: QadaBacklogItem; onMarked: (item: QadaBacklogItem) => void }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      onMarked(item);
      await markPrayer(item.date, item.prayer, "qada");
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-4 py-3">
      <span className="text-sm">
        <span className="font-medium">{PRAYER_LABEL[item.prayer]}</span>
        <span className="text-muted-foreground"> · {formatBacklogDate(item.date)}</span>
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <Badge variant="warning">Mark as qada</Badge>
      </button>
    </li>
  );
}

/**
 * Self-contained on purpose — final placement on the page is part of the
 * layout restructure that follows this phase, so this component doesn't
 * assume a Panel wrapper or a specific position. `items` is the full
 * derived backlog (most recent first, see lib/deen/qada-backlog.ts); this
 * shows the oldest `limit` outstanding prayers, oldest first — the ones
 * that have been waiting longest.
 */
export function QadaBacklogList({ items, limit = 10 }: { items: QadaBacklogItem[]; limit?: number }) {
  const oldestFirst = [...items].slice(-limit).reverse();
  const [optimisticItems, removeOptimistically] = useOptimistic(oldestFirst, (state, removed: QadaBacklogItem) =>
    state.filter((i) => !(i.date === removed.date && i.prayer === removed.prayer))
  );

  if (optimisticItems.length === 0) {
    return (
      <EmptyState
        icon={History}
        message="No outstanding qada — you're caught up"
        action={{ label: "View Salah today", href: "/deen" }}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {optimisticItems.map((item) => (
        <Row key={`${item.date}-${item.prayer}`} item={item} onMarked={removeOptimistically} />
      ))}
    </ul>
  );
}
