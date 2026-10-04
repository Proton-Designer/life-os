"use client";

import { setKillListItemCompleted, refreshBusinessViews } from "@/app/(app)/business/actions";
import { useOptimisticToggles } from "@/lib/client/use-optimistic-toggles";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { KillListItemRow } from "@/app/(app)/business/kill-list-history-actions";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshBusiness = () => refreshBusinessViews();

/**
 * Reusable list-of-items popup, shared between two callers (item B3-3):
 * a history day's items (tap a day in the calendar view) and "this week's
 * incomplete" items (the header badge's View button). Both let the user
 * change an item's completion; only the incomplete-items caller also wants
 * a completed item to disappear from the list ("Changing one to complete
 * must update its status, remove it from that list, and decrement the
 * count" — Opus Lead, from Ayman's own wording).
 */
export function KillListItemsDialog({
  open,
  onOpenChange,
  title,
  items,
  onItemsChange,
  removeOnComplete = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: KillListItemRow[];
  onItemsChange: (updater: (prev: KillListItemRow[]) => KillListItemRow[]) => void;
  /** True for the "Incompleted this Week" view — a completed item drops
   * out of the list entirely rather than just showing as done in place. */
  removeOnComplete?: boolean;
}) {
  // PERF-2: per-item optimistic toggles (nothing disabled, absolute ordered writes,
  // per-item revert); the parent list is updated when an item's writes are confirmed.
  const toggles = useOptimisticToggles({
    queuePrefix: "killlist",
    write: setKillListItemCompleted,
    refresh: refreshBusiness,
    onConfirmed: (id, completed) => {
      if (removeOnComplete && completed) {
        onItemsChange((prev) => prev.filter((i) => i.id !== id));
      } else {
        onItemsChange((prev) => prev.map((i) => (i.id === id ? { ...i, completed } : i)));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items
              .filter((item) => !(removeOnComplete && toggles.value(item.id, item.completed)))
              .map((item) => {
                const completed = toggles.value(item.id, item.completed);
                return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void toggles.set(item.id, !completed)}
                  aria-label={completed ? `Mark "${item.text}" incomplete` : `Mark "${item.text}" complete`}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border/40 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-5 shrink-0 rounded-full border transition-colors",
                      completed ? "border-accent-business bg-accent-business" : "border-border"
                    )}
                  />
                  <span className={cn("min-w-0 flex-1 truncate text-sm", completed && "text-muted-foreground line-through")}>
                    {item.text}
                  </span>
                </button>
              </li>
                );
              })}
          </ul>
        )}
        {toggles.error && (
          <p role="alert" className="text-xs text-destructive">
            Not saved. Try again.
          </p>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
