"use client";

import { useEffect, useState } from "react";
import { getReadingStats } from "@/app/(app)/personal/reader-actions";
import { GoalRing, ReadingStatsDialog, statsLabel } from "@/components/reader/reading-stats";
import type { ReadingStats } from "@/lib/reader/server/stats";

/** Today's reading against the daily goal, for the library header. Renders nothing until there is something to show. */
export function ReadingStatsChip() {
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getReadingStats()
      .then((r) => {
        if (!cancelled && r.ok) setStats(r.stats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActivity = stats && (stats.dailyWordGoal !== null || stats.todayWords > 0 || stats.streak > 0 || stats.last7.some((d) => d.words > 0));
  if (!stats || !hasActivity) return null;
  return (
    <>
      <button
        type="button"
        aria-label={statsLabel(stats)}
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 self-start rounded-full border px-3 text-xs text-muted-foreground hover:bg-muted"
        data-testid="reading-stats-chip"
        style={{ ["--reader-border" as string]: "var(--border)", ["--reader-focal" as string]: "var(--primary)", ["--reader-fg" as string]: "var(--foreground)" }}
      >
        <GoalRing stats={stats} className="size-5" />
        <span className="tabular-nums">
          {stats.todayWords.toLocaleString()}
          {stats.dailyWordGoal ? ` / ${stats.dailyWordGoal.toLocaleString()}` : ""} words today
          {stats.streak > 0 ? ` · ${stats.streak}-day streak` : ""}
        </span>
      </button>
      <ReadingStatsDialog open={open} onOpenChange={setOpen} stats={stats} />
    </>
  );
}
