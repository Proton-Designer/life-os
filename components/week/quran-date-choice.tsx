"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { keepOrMoveFinishDate } from "@/app/(app)/deen/quran-plan-actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { addDaysToDateString, formatShortDate } from "@/lib/date-utils";

/**
 * QURAN-02: the weekly reset's "keep or move the finish date" choice. Keep re-spreads the remaining pages to the SAME
 * date; Move takes a new date (pre-filled with the suggestion). The chosen outcome shows at once and rolls back with a
 * reason when the write fails. `todayStr` is the user's local date (the earliest a new finish date can be, plus one day).
 */
export function QuranDateChoice({ finishDate, suggestedDate, todayStr }: { finishDate: string; suggestedDate: string | null; todayStr: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(suggestedDate ?? "");
  const [error, setError] = useState<string | null>(null);

  function choose(newDate: string | null) {
    setError(null);
    setMoving(false);
    setChosen(newDate ?? finishDate);
    enqueueByKey("quran:plan", () => keepOrMoveFinishDate(newDate))
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
      })
      .catch((e: unknown) => {
        setChosen(null);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      });
  }

  if (chosen) {
    return (
      <p className="text-sm" role="status" data-testid="quran-date-chosen">
        Finish date: {formatShortDate(chosen)}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="quran-date-choice">
      {moving ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="quran-date-move-form">
          <Input type="date" value={date} min={addDaysToDateString(todayStr, 1)} onChange={(e) => setDate(e.target.value)} aria-label="New finish date" className="h-8 w-40" />
          <Button type="button" size="sm" disabled={date <= todayStr} onClick={() => choose(date)} data-testid="quran-date-move-confirm">
            Move date
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMoving(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => choose(null)} data-testid="quran-date-keep">
            Keep {formatShortDate(finishDate)}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMoving(true)} data-testid="quran-date-move">
            Move date
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid="quran-date-error">
          Couldn&apos;t save: {error}
        </p>
      ) : null}
    </div>
  );
}
