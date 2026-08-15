"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { answerCheckin, snoozeCheckin, skipCheckinsToday } from "@/app/(app)/checkin/actions";
import type { CheckinOption } from "@/lib/checkins/types";

function optionKey(option: CheckinOption): string {
  return `${option.tagType}-${option.refId ?? ""}`;
}

export function CheckinPrompt({
  open,
  checkinTime,
  intervalMinutes,
  options,
  workSessionId,
  onAnswered,
  onSnoozed,
}: {
  open: boolean;
  checkinTime: string;
  intervalMinutes: number;
  options: CheckinOption[];
  /** Set when this prompt was fired by a Business Lock-In session (Phase 2), so the answer is tagged to that session. */
  workSessionId?: string | null;
  /**
   * Receives the selected option — Lock-In (Phase 2) needs it to append to
   * its session-local answered list without a second round trip. Called
   * with no argument from the "Skip check-ins today" path, since nothing
   * was actually answered there.
   */
  onAnswered: (option?: CheckinOption) => void;
  onSnoozed: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [showMore, setShowMore] = useState(false);

  const primaryOptions = options.filter((o) => o.primary);
  const secondaryOptions = options.filter((o) => !o.primary);
  const hours = Math.round((intervalMinutes / 60) * 10) / 10;

  function select(option: CheckinOption) {
    startTransition(async () => {
      await answerCheckin(checkinTime, option.tagType, option.label, option.refId, workSessionId ?? null);
      onAnswered(option);
    });
  }

  function snooze() {
    startTransition(async () => {
      await snoozeCheckin(checkinTime, 15);
      onSnoozed();
    });
  }

  function skipToday() {
    startTransition(async () => {
      await skipCheckinsToday();
      onAnswered();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onSnoozed();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            What&apos;d you spend the last {hours} {hours === 1 ? "hour" : "hours"} on?
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {primaryOptions.map((opt) => (
            <Button
              key={optionKey(opt)}
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => select(opt)}
              className="justify-start"
            >
              {opt.label}
            </Button>
          ))}
          {!showMore && secondaryOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="text-left text-sm text-muted-foreground hover:text-foreground"
            >
              Something else…
            </button>
          )}
          {showMore &&
            secondaryOptions.map((opt) => (
              <Button
                key={optionKey(opt)}
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => select(opt)}
                className="justify-start"
              >
                {opt.label}
              </Button>
            ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={isPending}
            onClick={snooze}
            className="text-muted-foreground hover:text-foreground"
          >
            Remind me in 15
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={skipToday}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip check-ins today
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
