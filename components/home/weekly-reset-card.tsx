import Link from "next/link";
import { CalendarCheck } from "lucide-react";

/** Home's Sunday card (IA-P3b): shown from Sunday 00:00 to Monday 12:00 local until this week's goal is set; one tap into the weekly reset (/week). */
export function WeeklyResetCard() {
  return (
    <div data-testid="weekly-reset-card" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <CalendarCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium">Time for your weekly reset</p>
          <p className="text-xs text-muted-foreground">Look back, sort goals, habits and worries, then pick this week&apos;s goal.</p>
        </div>
      </div>
      <Link href="/week" prefetch className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="start-weekly-reset">
        Start the reset
      </Link>
    </div>
  );
}
