"use client";

import { useOptimistic, useTransition } from "react";
import { toggleItem } from "@/app/(app)/actions";
import type { PriorityItem } from "@/lib/home/types";
import { cn } from "@/lib/utils";

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

  if (optimisticItems.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing due right now.</p>;
  }

  const rightNow = optimisticItems.filter((i) => i.urgencyBucket === "right_now");
  const laterToday = optimisticItems.filter((i) => i.urgencyBucket === "later_today");

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
