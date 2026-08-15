import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 rounded-lg border border-border/40 px-3 py-2 text-center">
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
    </div>
  );
}

// No new data fetching — every value here was already pulled by
// get-domain-snapshots.ts for the peek cards, just surfaced again compactly.
export function WeeklySummaryStrip({ snapshots }: { snapshots: DomainSnapshots }) {
  const tasksThisWeek = snapshots.school.completedThisWeek + snapshots.co_op.completedThisWeek;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <Chip label="Signal:Noise" value={snapshots.business.weeklyRatioDisplay} />
      <Chip label="Qur'an pages" value={String(snapshots.deen.quranWeekPages)} />
      <Chip label="Workouts" value={String(snapshots.fitness.workoutsThisWeek)} />
      <Chip label="Tasks done" value={String(tasksThisWeek)} />
    </div>
  );
}
