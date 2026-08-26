"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { getSalahMonthSummary, getSalahDayDetail, type SalahDaySummary, type SalahDayDetail } from "@/app/(app)/deen/salah-calendar-actions";
import { markPrayer } from "@/app/(app)/deen/actions";
import { ProgressRing } from "@/components/charts/progress-ring";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dayOfWeekFromDateString } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const MONTH_LABEL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABEL = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Deen's "Salah" module View More popup (item B3-2, verbatim spec): a
 * monthly calendar, scrollable through past and future months, each day a
 * ring showing #/5 prayers completed, tapping a day opens an editor for
 * that day's five prayers.
 *
 * The one rule everything here is built around (Opus Lead, correcting R7):
 * a day this account never tracked — before the tracking floor, or in the
 * future — renders BLANK, no ring at all, never as a 0/5 ring that could
 * read as "five missed." That's `SalahDaySummary.hasData`, sourced from
 * the same floor (`computeTrackingFloorDateStr`) the rest of Deen uses.
 */
export function SalahCalendarDialog({
  open,
  onOpenChange,
  initialYear,
  initialMonth,
  todayStr,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialYear: number;
  /** 1-12 */
  initialMonth: number;
  todayStr: string;
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [days, setDays] = useState<SalahDaySummary[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  function loadMonth(y: number, m: number) {
    setDays(null);
    getSalahMonthSummary(y, m).then(setDays);
  }

  useEffect(() => {
    if (!open) return;
    loadMonth(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, year, month]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setSelectedDate(null);
  }

  function prevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const leadingBlankCells = days && days.length > 0 ? dayOfWeekFromDateString(days[0].date) : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto sm:max-w-md">
        {selectedDate ? (
          <SalahDayEditor
            date={selectedDate}
            todayStr={todayStr}
            onBack={() => setSelectedDate(null)}
            onChanged={() => loadMonth(year, month)}
          />
        ) : (
          <>
            {/* pr-8 clears the DialogContent's own absolute-positioned
                close button (top-2 right-2) — without it, "Next month"
                sits under the X and never receives the click (found live,
                not in vitest, which doesn't lay out absolute positioning
                against a real close button). */}
            <DialogHeader className="flex-row items-center justify-between space-y-0 pr-8">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous month" onClick={prevMonth}>
                <ChevronLeft />
              </Button>
              <DialogTitle>
                {MONTH_LABEL[month - 1]} {year}
              </DialogTitle>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Next month" onClick={nextMonth}>
                <ChevronRight />
              </Button>
            </DialogHeader>

            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
              {WEEKDAY_LABEL.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>

            {days === null ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: leadingBlankCells }, (_, i) => (
                  <div key={`blank-${i}`} />
                ))}
                {days.map((d) => {
                  const dayNumber = Number(d.date.slice(-2));
                  const isFuture = d.date > todayStr;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      disabled={isFuture}
                      onClick={() => setSelectedDate(d.date)}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-lg p-1 transition-colors",
                        !isFuture && "hover:bg-accent/50",
                        isFuture && "cursor-default opacity-40"
                      )}
                    >
                      <span className="text-[10px] text-muted-foreground">{dayNumber}</span>
                      {d.hasData ? (
                        <ProgressRing
                          pct={(d.doneCount / 5) * 100}
                          colorVar="--accent-deen"
                          centerLabel={`${d.doneCount}/5`}
                          size={36}
                          strokeWidth={3}
                        />
                      ) : (
                        // Never tracked (before the tracking floor, or in
                        // the future) — genuinely blank, not a "0/5" ring.
                        <div style={{ width: 36, height: 36 }} />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STATUS_OPTIONS: { value: "on_time" | "qada" | "missed"; label: string }[] = [
  { value: "on_time", label: "On-time" },
  { value: "qada", label: "Qada" },
  { value: "missed", label: "Missed" },
];

/**
 * Per-day editor (item B3-2): the five prayers for `date`, each switchable
 * between On-time/Qada/Missed. `markPrayer` (deen/actions.ts, A's file) is
 * reused as-is — no new write path.
 *
 * Future-date guard is UI-only here (the day grid already disables future
 * cells, and this component is only ever reached for a past-or-today
 * date) — flagged to the Lead separately that `markPrayer` itself has no
 * server-side future-date rejection, which is out of scope for this file
 * to add unilaterally.
 */
function SalahDayEditor({
  date,
  todayStr,
  onBack,
  onChanged,
}: {
  date: string;
  todayStr: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SalahDayDetail[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const isFuture = date > todayStr;

  useEffect(() => {
    getSalahDayDetail(date).then(setDetail);
  }, [date]);

  function setStatus(prayerName: SalahDayDetail["prayerName"], status: "on_time" | "qada" | "missed") {
    if (isFuture) return;
    startTransition(async () => {
      await markPrayer(date, prayerName, status);
      setDetail((prev) => prev?.map((p) => (p.prayerName === prayerName ? { ...p, status } : p)) ?? null);
      onChanged();
    });
  }

  return (
    <>
      <DialogHeader className="flex-row items-center gap-2 space-y-0">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <DialogTitle>{date}</DialogTitle>
      </DialogHeader>

      {detail === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.map((p) => (
            <li key={p.prayerName} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 p-2">
              <span className="text-sm font-medium">{p.label}</span>
              <div className="flex gap-1">
                {STATUS_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={p.status === opt.value ? "default" : "outline"}
                    disabled={isPending || isFuture}
                    onClick={() => setStatus(p.prayerName, opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
