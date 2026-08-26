"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TaskRowList, type TaskRowItem } from "@/components/shared/task-row-list";

/**
 * The "View" dialog behind each of School's three header KPI cards (2026-08-26
 * night batch, item B2): a bucket of tasks (due today / overdue / due this
 * week), each row showing "type · class" as `meta`, checkable via the shared
 * TaskRowList — same tap-to-complete-and-cross-off contract every other
 * domain list already uses, not a second bespoke implementation (Opus Lead
 * explicitly ruled out re-deriving this). `toggleTask` is a real Server
 * Action reference passed down from the Server Component page, same pattern
 * SchoolTaskPanel already uses — not a closure, so the RSC boundary rule
 * (AGENTS.md) isn't in play.
 */
export function KpiTaskDialog({
  title,
  items,
  toggleTask,
  emptyMessage,
}: {
  title: string;
  items: TaskRowItem[];
  toggleTask: (id: string) => Promise<void>;
  emptyMessage: string;
}) {
  async function handleComplete(item: TaskRowItem) {
    await toggleTask(item.id);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mt-1 self-start">
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">
          <TaskRowList
            items={items}
            onComplete={handleComplete}
            emptyState={<p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
