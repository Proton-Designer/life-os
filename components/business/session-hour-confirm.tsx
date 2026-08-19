"use client";

import { Button } from "@/components/ui/button";

/**
 * The hourly Lock-In confirm — one tap, nothing else. Deliberately NOT a
 * Dialog/Sheet: this fires during declared deep work, so it has to be
 * cheaper than a modal to answer — an inline bar in the already-open
 * session card, no overlay, no focus trap, no dismissal ceremony. Compare
 * components/checkin/checkin-prompt.tsx (the 2h allocation flow's full
 * domain/minutes picker) — that one is a real decision; this one is a
 * single honest yes/no.
 */
export function SessionHourConfirm({
  onAnswer,
  disabled,
}: {
  onAnswer: (stillOnIt: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-testid="session-hour-confirm"
      className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-accent/30 px-3 py-2 text-sm"
    >
      <span className="font-medium">Still on it?</span>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={() => onAnswer(true)}>
          Yes
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer(false)}>
          Not really
        </Button>
      </div>
    </div>
  );
}
