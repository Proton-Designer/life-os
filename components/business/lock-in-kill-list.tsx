"use client";

import { setKillListItemCompleted, refreshBusinessViews } from "@/app/(app)/business/actions";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import type { KillListSlotData } from "./kill-list";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// The Deep Work overlay's own presentation of today's kill list (Ayman,
// 2026-08-28): checkable from inside the full-screen session, same
// underlying kill_list_items rows and toggleKillListItem action as
// kill-list.tsx's own KillListSlot, so a check here shows up on /business
// and Home the instant kill_list_items's realtime-sync fires a
// router.refresh() (see realtime-sync-provider.tsx's SYNCED_TABLES) —
// there is no separate "overlay's own copy" of this state to drift.
// Checking an item off never removes it from view here either, matching
// the same "show it done, don't hide it" rule as the panel version.
export function LockInKillList({
  slots,
  className,
}: {
  slots: [KillListSlotData, KillListSlotData, KillListSlotData];
  className?: string;
}) {
  const filled = slots.filter((slot) => slot.text);
  if (filled.length === 0) return null;

  return (
    <div className={className}>
      {filled.map((slot) => (
        <LockInKillListItem key={slot.id} slot={slot} />
      ))}
    </div>
  );
}

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshBusiness = () => refreshBusinessViews();

function LockInKillListItem({ slot }: { slot: KillListSlotData }) {
  // PERF-2: per-item optimistic state, ordered absolute writes, one deferred refresh
  // (same queue key as kill-list.tsx, so the panel and this overlay never reorder).
  const completion = useOptimisticItem<boolean>({
    serverValue: slot.completed,
    queueKey: `killlist:${slot.id}`,
    write: (next) => setKillListItemCompleted(slot.id!, next),
    refresh: refreshBusiness,
  });
  const optimisticCompleted = completion.value;

  return (
    <button
      type="button"
      disabled={!slot.id}
      onClick={() => slot.id && void completion.set(!optimisticCompleted)}
      aria-label={optimisticCompleted ? "Mark incomplete" : "Mark complete"}
      // min-w-0 for the same reason kill-list.tsx's own slot button needs
      // it: without it a flex item's automatic minimum size refuses to
      // shrink below the untruncated text, and this row is exactly as
      // width-constrained on mobile as that one.
      className={cn(
        "flex min-w-0 max-w-full items-center gap-2 rounded-full border border-foreground/20 bg-background/10 px-3 py-1.5 text-left text-sm text-foreground transition-colors",
        "hover:bg-background/20 disabled:cursor-default disabled:opacity-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 rounded-full border transition-colors",
          optimisticCompleted ? "border-foreground bg-foreground" : "border-foreground/50"
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate", optimisticCompleted && "text-foreground/50 line-through")}>
        {slot.text}
      </span>
      {optimisticCompleted && <Badge variant="positive">Done</Badge>}
      {completion.error && (
        <span role="alert" className="shrink-0 text-xs text-destructive">
          Not saved
        </span>
      )}
    </button>
  );
}
