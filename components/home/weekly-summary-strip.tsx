import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { StatCard } from "@/components/ui/stat-card";
import { DOMAIN_ICON } from "@/lib/domain-icons";

// No new data fetching — every value here was already pulled by
// get-domain-snapshots.ts for the peek cards, just surfaced again compactly.
export function WeeklySummaryStrip({ snapshots }: { snapshots: DomainSnapshots }) {
  const tasksThisWeek = snapshots.school.completedThisWeek + snapshots.co_op.completedThisWeek;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <StatCard
        className="min-w-[9.5rem] shrink-0"
        icon={DOMAIN_ICON.business}
        accent="business"
        label="Signal:Noise"
        value={snapshots.business.weeklyRatioDisplay}
      />
      <StatCard
        className="min-w-[9.5rem] shrink-0"
        icon={DOMAIN_ICON.deen}
        accent="deen"
        label="Qur'an pages"
        value={String(snapshots.deen.quranWeekPages)}
      />
      <StatCard
        className="min-w-[9.5rem] shrink-0"
        icon={DOMAIN_ICON.fitness}
        accent="fitness"
        label="Workouts"
        value={String(snapshots.fitness.workoutsThisWeek)}
      />
      <StatCard
        className="min-w-[9.5rem] shrink-0"
        icon={DOMAIN_ICON.school}
        accent="school"
        label="Tasks done"
        value={String(tasksThisWeek)}
      />
    </div>
  );
}
