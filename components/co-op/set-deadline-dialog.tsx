"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Built once, used at both trigger points (spec): fires automatically
 * right after a stretch goal promotes into a target slot, and reused as
 * the persistent "Set a deadline" affordance on any target row that still
 * has none. Real Radix Dialog (focus trap, Escape, close button) — never
 * blocking: dismissing it just leaves the target showing that affordance
 * again, per the never-invent-a-deadline ruling.
 */
export function SetDeadlineDialog({
  open,
  onOpenChange,
  targetTitle,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetTitle: string;
  onSubmit: (deadline: string) => Promise<void>;
}) {
  const [deadline, setDeadline] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!deadline) return;
    startTransition(async () => {
      await onSubmit(deadline);
      setDeadline("");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a deadline</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            &ldquo;{targetTitle}&rdquo; is now a target and needs a deadline.
          </p>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} autoFocus />
          <DialogFooter>
            <Button type="submit" disabled={isPending || !deadline}>
              Save deadline
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
