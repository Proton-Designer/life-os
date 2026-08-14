"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toggleItem } from "@/app/(app)/actions";
import type { PriorityItem } from "@/lib/home/types";
import { urgencyBucket } from "@/lib/home/urgency";
import { cn } from "@/lib/utils";

const TICK_MS = 60 * 1000;

const DOMAIN_LABEL: Record<PriorityItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Co-op",
};

const DOMAIN_ACCENT_CLASS: Record<PriorityItem["domain"], string> = {
  deen: "text-accent-deen",
  business: "text-accent-business",
  fitness: "text-accent-fitness",
  school: "text-accent-school",
  co_op: "text-accent-school",
};

function Row({ item, onComplete }: { item: PriorityItem; onComplete: (item: PriorityItem) => void }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      // Dispatched synchronously as the transition's first step so React
      // associates it with this pending action and can revert it if the
      // action fails — see useOptimistic in the parent component.
      onComplete(item);
      await toggleItem(item);
    });
  }

  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/50">
      <button
        type="button"
        aria-label={`Mark "${item.title}" done`}
        disabled={isPending}
        onClick={handleClick}
        className="size-5 shrink-0 rounded-full border border-border transition-opacity disabled:opacity-50"
      />
      <span className={cn("shrink-0 text-xs font-medium", DOMAIN_ACCENT_CLASS[item.domain])}>
        {DOMAIN_LABEL[item.domain]}
      </span>
      <span className="flex-1 text-sm">{item.title}</span>
    </li>
  );
}

export function PriorityList({ items }: { items: PriorityItem[] }) {
  const [optimisticItems, removeOptimistically] = useOptimistic(
    items,
    (state, removedId: string) => state.filter((i) => i.id !== removedId)
  );

  // Re-derive each item's urgency bucket against the current time on an
  // interval, so an item can move from "Later today" into "Right now" as
  // its due time approaches without a server refetch — the client router
  // cache (see next.config.ts's staleTimes) can otherwise hold the
  // server-baked bucket for up to an hour. `now` stays null through the
  // first render (falling back to the server-computed item.urgencyBucket,
  // which is correct for that exact instant) and only starts ticking after
  // mount, so there's no hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  if (optimisticItems.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing due right now.</p>;
  }

  const byDueAtAsc = (a: PriorityItem, b: PriorityItem) =>
    (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  const bucketOf = (item: PriorityItem) => (now ? urgencyBucket(item.dueAt, now) : item.urgencyBucket);
  const rightNow = optimisticItems.filter((i) => bucketOf(i) === "right_now").sort(byDueAtAsc);
  const laterToday = optimisticItems.filter((i) => bucketOf(i) === "later_today").sort(byDueAtAsc);

  return (
    <div className="flex flex-col gap-6">
      {rightNow.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Right now</h2>
          <ul className="flex flex-col gap-1">
            {rightNow.map((item) => (
              <Row key={item.id} item={item} onComplete={(i) => removeOptimistically(i.id)} />
            ))}
          </ul>
        </section>
      )}
      {laterToday.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Later today</h2>
          <ul className="flex flex-col gap-1">
            {laterToday.map((item) => (
              <Row key={item.id} item={item} onComplete={(i) => removeOptimistically(i.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
