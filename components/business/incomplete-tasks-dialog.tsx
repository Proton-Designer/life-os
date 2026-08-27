"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleKillListItem } from "@/app/(app)/business/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatShortDate } from "@/lib/date-utils";
import type { IncompleteByDateGroup } from "@/app/(app)/business/kill-list-history-actions";

/**
 * The "More" dialog for the Incompleted Tasks module (2026-08-26 night
 * batch 3) — a date-grouped list, most recent date first, each date only
 * shown if it has at least one incomplete item.
 *
 * Deliberately a new component rather than reusing KillListItemsDialog:
 * that component's `items` prop is a flat KillListItemRow[] with no notion
 * of a date header between groups, and bolting date-sectioning onto it
 * would mean threading a grouping concept through a component two other
 * callers (kill-list-history-dialog's day-detail popup, this module's own
 * sibling) already use for a genuinely flat list. It shares the same
 * per-item toggle behaviour instead (toggleKillListItem, optimistic
 * removal on complete) — every item here is incomplete by construction
 * (the query that fills `groups` already filters completed=false), so
 * there's only ever one direction to toggle.
 */
export function IncompleteTasksDialog({
  open,
  onOpenChange,
  groups,
  todayStr,
  onItemCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: IncompleteByDateGroup[];
  todayStr: string;
  onItemCompleted: (date: string, itemId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function complete(date: string, itemId: string) {
    startTransition(async () => {
      await toggleKillListItem(itemId);
      onItemCompleted(date, itemId);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Incompleted Tasks</DialogTitle>
        </DialogHeader>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing outstanding.</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.date} className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">{formatShortDate(group.date, todayStr)}</p>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => complete(group.date, item.id)}
                        aria-label={`Mark "${item.text}" complete`}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border/40 px-3 py-2 text-left transition-colors hover:bg-accent/50 disabled:opacity-50"
                      >
                        <span aria-hidden className="size-5 shrink-0 rounded-full border border-border" />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
