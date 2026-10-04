"use client";

import { useState } from "react";
import { getReplanData } from "@/app/(app)/close/actions";
import { ClosePlanStage } from "@/components/evening-close/close-plan-stage";
import type { DumpItem } from "@/lib/night-plan/night-plan";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type ReplanData = { todayLines: { id: string; title: string }[]; planSeeds: DumpItem[] };

/**
 * "Re-plan" on the Morning card (IA-P2): today's plan stage (the SAME ClosePlanStage, mode "today",
 * whose Finish writes the ranks) inside a dialog, replacing the old /close/replan page. The data is
 * read when the dialog opens through the getReplanData Server Action, so Home's render stays lean.
 */
export function ReplanDialog() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReplanData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await getReplanData();
      if (res === null) setError("Sign in again to re-plan.");
      else setData({ todayLines: res.todayLines, planSeeds: res.planSeeds });
    } catch {
      setError("Couldn't load today's plan. Try again.");
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
        <Button type="button" variant="ghost" size="sm" data-testid="replan-open" className="text-muted-foreground underline underline-offset-4">
          Re-plan
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Re-plan today</DialogTitle>
          <DialogDescription>Today&apos;s plan, redone. Yesterday&apos;s crown is cleared the moment you finish.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!error && data === null ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : null}
        {data ? <ClosePlanStage initialLines={data.todayLines} seeds={data.planSeeds} mode="today" /> : null}
      </DialogContent>
    </Dialog>
  );
}
