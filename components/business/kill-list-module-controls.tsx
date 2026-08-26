"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { KillListHistoryDialog } from "@/components/business/kill-list-history-dialog";
import { KillListItemsDialog } from "@/components/business/kill-list-items-dialog";
import type { KillListItemRow } from "@/app/(app)/business/kill-list-history-actions";

/**
 * Today's kill list module's header-right content (item B3-3, verbatim
 * spec, both pieces): "Incompleted this Week" — light red text, a count,
 * a View button — to the right of the module's own title with some
 * buffer, and a "View More" button in the corner opening the full
 * history. Both live in Panel's `controls` slot together since the spec
 * places both in the same top-right area of one module.
 *
 * `initialIncompleteItems` comes from the server page and refreshes on
 * every `revalidatePath("/business")` the underlying toggle already
 * triggers, but that round trip isn't instant — the visible badge count
 * decrements optimistically the moment an item completes inside the
 * popup ("must ... decrement the count," Ayman's own wording), then
 * resyncs to the server's real count once the next prop arrives.
 */
export function KillListModuleControls({ initialIncompleteItems }: { initialIncompleteItems: KillListItemRow[] }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [incompleteOpen, setIncompleteOpen] = useState(false);
  const [incompleteItems, setIncompleteItems] = useState(initialIncompleteItems);
  const [badgeCount, setBadgeCount] = useState(initialIncompleteItems.length);

  useEffect(() => {
    setIncompleteItems(initialIncompleteItems);
    setBadgeCount(initialIncompleteItems.length);
  }, [initialIncompleteItems]);

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-destructive/70">Incompleted this Week</span>
        <span className="font-mono text-xs font-medium tabular-nums text-destructive/70">{badgeCount}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIncompleteOpen(true)}>
          View
        </Button>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
        View More
      </Button>

      <KillListHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <KillListItemsDialog
        open={incompleteOpen}
        onOpenChange={setIncompleteOpen}
        title="Incompleted this week"
        items={incompleteItems}
        onItemsChange={(updater) => {
          setIncompleteItems((prev) => {
            const next = updater(prev);
            if (next.length < prev.length) setBadgeCount((c) => Math.max(0, c - (prev.length - next.length)));
            return next;
          });
        }}
        removeOnComplete
      />
    </div>
  );
}
