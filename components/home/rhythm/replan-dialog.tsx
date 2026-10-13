"use client";

import { useRef, useState } from "react";
import { getReplanData, type ReplanData } from "@/app/(app)/close/actions";
import { ClosePlanStage } from "@/components/evening-close/close-plan-stage";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** 45 -> "45m", 120 -> "2h", 150 -> "2h 30m". */
function formatPlanTotal(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * "Edit Plan" on Home's day card: today's plan, editable in place -- add, remove and reorder lines, change which are
 * starred and which is crowned, and change each line's domain, start time or timer. It is the SAME ClosePlanStage
 * (mode "today") the nightly close uses, opened already filled with what the plan holds now, inside a dialog.
 *
 * Speed: the data is read through the getReplanData Server Action (so Home's own render stays lean), and the read
 * STARTS when the pointer reaches the button or it takes focus -- by the time the tap lands, the plan is usually
 * already here -- instead of waiting for the click. The dialog opens at once with a skeleton either way.
 */
export function ReplanDialog() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReplanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalMinutes, setTotalMinutes] = useState(0);
  // One read at a time; a fresh read replaces the last (a stale prefetch is never shown after the plan changed).
  const inflight = useRef<Promise<void> | null>(null);
  const loadedAt = useRef(0);

  function load(force = false): Promise<void> {
    if (!force && inflight.current && Date.now() - loadedAt.current < 30_000) return inflight.current;
    setError(null);
    loadedAt.current = Date.now();
    const run = (async () => {
      try {
        const res = await getReplanData();
        if (res === null) setError("Sign in again to edit your plan.");
        else setData(res);
      } catch {
        inflight.current = null;
        setError("Couldn't load today's plan. Try again.");
      }
    })();
    inflight.current = run;
    return run;
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
    else {
      setData(null);
      setTotalMinutes(0);
      inflight.current = null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="replan-open"
          onPointerEnter={() => void load()}
          onFocus={() => void load()}
          className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Edit Plan
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-y-auto">
        {/* Pinned above the header so the total stays in view however far the list is scrolled; it also holds the close button. */}
        <div
          data-testid="replan-total-banner"
          className="sticky top-0 z-10 -mx-4 -mt-4 flex shrink-0 items-center justify-between gap-3 rounded-t-xl border-b bg-muted px-4 py-1.5"
        >
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Total planned time{" "}
            <span data-testid="replan-total" className="font-medium text-foreground">
              {totalMinutes > 0 ? formatPlanTotal(totalMinutes) : "none set"}
            </span>
          </p>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="-mr-2">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>
        <DialogHeader>
          <DialogTitle>Edit plan</DialogTitle>
          <DialogDescription>Change today&apos;s plan: add, remove or reorder tasks, change the star and crown, and set each task&apos;s domain, start time, timer or criteria.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => void load(true)}>
              Retry
            </button>
          </p>
        ) : null}
        {!error && data === null ? (
          <div role="status" aria-label="Loading your plan" className="space-y-2 py-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          </div>
        ) : null}
        {data ? (
          <ClosePlanStage
            initialLines={data.todayLines}
            seeds={data.planSeeds}
            mode="today"
            killList={data.killList}
            areas={data.areas}
            workTabs={data.workTabs}
            timezone={data.timezone}
            onSaved={() => onOpenChange(false)}
            onTotalMinutesChange={setTotalMinutes}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
