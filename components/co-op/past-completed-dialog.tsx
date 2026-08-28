"use client";

import { useState, useTransition } from "react";
import { Undo2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CoopTaskRow } from "@/lib/coop/tasks";
import { returnTaskToReview, removeTask, bulkRemoveTasks } from "@/app/(app)/work/tasks-actions";

/**
 * Ayman's spec (batch 5, item 3): tasks that have sat in Complete for 7+
 * days move here automatically (lib/coop/tasks.ts's isPastCompletedTask
 * decides that upstream, in page.tsx — this component only ever sees the
 * already-split list). Per row: bring back to Review, or delete. Plus
 * multi-select + bulk delete. No bulk "return to review" — a mis-tap there
 * is recoverable anyway, per the Lead's explicit ruling.
 */
export function PastCompletedDialog({
  open,
  onOpenChange,
  tasks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: CoopTaskRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete(id: string) {
    startTransition(() => removeTask(id));
    setConfirmingDeleteId(null);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleBulkDelete() {
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkRemoveTasks(ids);
    });
    setSelected(new Set());
    setConfirmingBulkDelete(false);
  }

  const confirmingDeleteTask = tasks.find((t) => t.id === confirmingDeleteId) ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Past completed tasks</DialogTitle>
          </DialogHeader>

          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing here yet — a task lands here 7 days after it&apos;s completed.
            </p>
          ) : (
            <>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {selected.size > 0 ? `${selected.size} selected` : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
                </span>
                {selected.size > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive hover:bg-destructive/10"
                    disabled={isPending}
                    onClick={() => setConfirmingBulkDelete(true)}
                  >
                    <Trash2 /> Delete {selected.size}
                  </Button>
                )}
              </div>

              <ul className="flex flex-col gap-2">
                {tasks.map((task) => (
                  <li key={task.id} className="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border/40 p-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(task.id)}
                      onChange={() => toggleSelected(task.id)}
                      aria-label={`Select "${task.title}"`}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      aria-label={`Return "${task.title}" to Review`}
                      disabled={isPending}
                      onClick={() => startTransition(() => returnTaskToReview(task.id))}
                    >
                      <Undo2 />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-destructive hover:bg-destructive/10"
                      aria-label={`Delete "${task.title}"`}
                      disabled={isPending}
                      onClick={() => setConfirmingDeleteId(task.id)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDeleteId !== null} onOpenChange={(next) => !next && setConfirmingDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{confirmingDeleteTask?.title}&rdquo; will be permanently removed. This can&apos;t be undone.
          </p>
          <DialogFooter>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => confirmingDeleteId && handleDelete(confirmingDeleteId)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingBulkDelete} onOpenChange={setConfirmingBulkDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} tasks?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {selected.size} past completed task{selected.size === 1 ? "" : "s"} will be permanently removed. This can&apos;t be undone.
          </p>
          <DialogFooter>
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleBulkDelete}>
              Delete {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
