"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePipeline } from "@/components/co-op/pipeline-context";

/**
 * The merged Weekly Agenda Pipeline panel's header-right control (batch 5,
 * item 3) — carries over the Weekly Agenda's only capability that wasn't
 * already duplicated by the pipeline board itself: adding a task. Lives in
 * a dialog rather than an inline expanding form (the Agenda's old shape)
 * because the header's `controls` slot is a small, fixed-height strip, not
 * room for a form (see components/business/kill-list-module-controls.tsx
 * for the same "+ header button opens a popup" convention).
 *
 * Dispatches through PipelineProvider's `addTask` (item 1) rather than
 * calling the Server Action directly, so the new card appears in the
 * board on the same tap that submits this form — this component and
 * PipelineBoard are siblings under Panel's two separate slots, and
 * PipelineProvider is the shared ancestor that lets them agree on one
 * optimistic task list instantly instead of waiting for the round trip.
 */
export function PipelinePanelControls() {
  const { addTask } = usePipeline();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    addTask(trimmed, deadline || undefined);
    setTitle("");
    setDeadline("");
    setOpen(false);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add a task
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a task</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="flex flex-col gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus />
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="Deadline (optional)" />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Add task
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
