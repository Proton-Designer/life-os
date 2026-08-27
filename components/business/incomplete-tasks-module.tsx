"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { IncompleteTasksDialog } from "@/components/business/incomplete-tasks-dialog";
import type { IncompleteByDateGroup } from "@/app/(app)/business/kill-list-history-actions";

/**
 * Business screen restructure (2026-08-26 night batch 3, per Ayman): what
 * used to be the "Incompleted this Week" text/count/View trio inside the
 * Today's kill list module is now its own top-of-page module, in the grid
 * slot the Lock In button vacated when it moved into the Focus time today
 * card. Preview is deliberately just the count and a "More" control — the
 * Lead's range ruling is that this count and the More dialog's list must
 * cover the identical range (past 3 months through today), or the headline
 * lies about what's behind it.
 *
 * `initialGroups` comes from the server page's getIncompleteByDate() call
 * inside its existing Promise.all — no client-side fetch waterfall.
 */
export function IncompleteTasksModule({
  initialGroups,
  todayStr,
}: {
  initialGroups: IncompleteByDateGroup[];
  todayStr: string;
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [dialogOpen, setDialogOpen] = useState(false);
  const count = groups.reduce((sum, g) => sum + g.items.length, 0);

  function handleItemCompleted(date: string, itemId: string) {
    setGroups((prev) =>
      prev
        .map((g) => (g.date === date ? { ...g, items: g.items.filter((i) => i.id !== itemId) } : g))
        .filter((g) => g.items.length > 0)
    );
  }

  return (
    <Panel
      title="Incompleted Tasks"
      heroValue={`${count}`}
      caption={count === 0 ? "Nothing outstanding" : "over the past 3 months"}
      controls={
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
          More
        </Button>
      }
    >
      <IncompleteTasksDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        groups={groups}
        todayStr={todayStr}
        onItemCompleted={handleItemCompleted}
      />
    </Panel>
  );
}
