"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { getGoalsSheetData } from "@/app/(app)/goals/actions";
import type { GoalBoardData } from "@/lib/goals/board-data";
import { GoalBoard } from "@/components/goals/goal-board";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * "Goals" on Home's weekly header (IA-P3b): the monthly goal board, reachable any day without
 * the weekly reset. The data is read when the sheet opens (getGoalsSheetData, a lean Server
 * Action -- no function props, nothing fetched until asked); the board inside is the same
 * GoalBoard /week step 2 renders.
 */
export function GoalsSheetButton() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GoalBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setData(await getGoalsSheetData());
    } catch {
      setError("Couldn't load your goals. Try again.");
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
    else setData(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="goals-sheet-open" className="gap-1.5">
          <Flag className="size-3.5" aria-hidden />
          Goals
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Goals</DialogTitle>
          <DialogDescription>This month&apos;s goals and their milestones.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!error && data === null ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : null}
        {data ? <GoalBoard {...data} /> : null}
      </DialogContent>
    </Dialog>
  );
}
