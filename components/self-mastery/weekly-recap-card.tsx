import { DeltaPill, type DeltaDirection } from "@/components/ui/delta-pill";
import type { UlmWeeklyRecap } from "@/lib/self-mastery/weekly-retention-recap";

/**
 * Phase 2 #P2-03's ULM weekly recap -- a stored snapshot for the most
 * recently completed Sun-Sat week (lib/self-mastery/weekly-retention-recap.ts),
 * never a live recomputation. `recap === null` is a real, silent-absence
 * state (first week ever with a completed week, or a cron tick was missed)
 * -- renders nothing, same graceful-absence posture as every other
 * AI/cron-fed panel in this app (HomePage's morning brief, Weekly Review's
 * narrative).
 */
export function WeeklyRecapCard({ recap }: { recap: UlmWeeklyRecap | null }) {
  if (!recap) return null;

  return (
    <div data-testid="weekly-recap-card" className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Last week's retention</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">{recap.overallRetentionPct.toFixed(0)}%</span>
          {recap.trend !== "no_data" && <DeltaPill direction={recap.trend as DeltaDirection} text={TREND_LABEL[recap.trend as DeltaDirection]} />}
        </div>
      </div>
      {(recap.strongestBook || recap.weakestBook) && (
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {recap.strongestBook && <span>Strongest: {recap.strongestBook.title}</span>}
          {recap.weakestBook && recap.weakestBook.title !== recap.strongestBook?.title && <span>Weakest: {recap.weakestBook.title}</span>}
        </div>
      )}
    </div>
  );
}

const TREND_LABEL: Record<DeltaDirection, string> = {
  up: "Up",
  down: "Down",
  flat: "Flat",
};
