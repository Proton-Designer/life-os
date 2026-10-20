"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReadingStats } from "@/lib/reader/server/stats";
import { cn } from "@/lib/utils";

/** Progress toward today's goal as a ring; with no goal set it is a plain ring showing today's word count tooltip. */
export function GoalRing({ stats, className }: { stats: ReadingStats; className?: string }) {
  const goal = stats.dailyWordGoal;
  const pct = goal ? Math.min(1, stats.todayWords / goal) : 0;
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className={cn("size-7", className)} aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--reader-border)" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={stats.goalMet ? "var(--reader-fg)" : "var(--reader-focal)"}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}

function weekday(date: string): string {
  // `date` is already the user's local YYYY-MM-DD; parse it as a calendar date, not an instant.
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" });
}

/** Spoken summary used for the ring button's accessible name. */
export function statsLabel(s: ReadingStats): string {
  const words = s.todayWords.toLocaleString("en-US");
  return s.dailyWordGoal ? `Reading stats: ${words} of ${s.dailyWordGoal.toLocaleString("en-US")} words today` : `Reading stats: ${words} words today`;
}

export function ReadingStatsBody({ stats }: { stats: ReadingStats }) {
  const max = Math.max(1, ...stats.last7.map((d) => d.words), stats.dailyWordGoal ?? 0);
  return (
    <div className="flex flex-col gap-4" data-testid="reading-stats">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border p-2">
          <div className="text-lg font-semibold tabular-nums">{stats.todayWords.toLocaleString("en-US")}</div>
          <div className="text-xs text-muted-foreground">{stats.dailyWordGoal ? `of ${stats.dailyWordGoal.toLocaleString("en-US")} today` : "words today"}</div>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-lg font-semibold tabular-nums">{stats.streak}</div>
          <div className="text-xs text-muted-foreground">day streak</div>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-lg font-semibold tabular-nums">{stats.avgWpm ?? "–"}</div>
          <div className="text-xs text-muted-foreground">avg wpm</div>
        </div>
      </div>
      <div className="flex h-20 items-end gap-1.5" aria-label="Words read in the last 7 days">
        {stats.last7.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end">
              <div className="w-full rounded-sm bg-foreground/70" style={{ height: `${Math.max(d.words > 0 ? 6 : 2, (d.words / max) * 100)}%` }} title={`${d.words.toLocaleString("en-US")} words`} />
            </div>
            <span className="text-[10px] text-muted-foreground">{weekday(d.date)}</span>
          </div>
        ))}
      </div>
      {!stats.dailyWordGoal ? <p className="text-xs text-muted-foreground">Set a daily word goal in Reader settings to track a streak.</p> : null}
    </div>
  );
}

export function ReadingStatsDialog({ open, onOpenChange, stats }: { open: boolean; onOpenChange: (open: boolean) => void; stats: ReadingStats }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reading stats</DialogTitle>
        </DialogHeader>
        <ReadingStatsBody stats={stats} />
      </DialogContent>
    </Dialog>
  );
}
