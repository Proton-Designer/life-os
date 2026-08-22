import { GoalCard } from "@/components/shared/goal-card";

type DeenGoal = { headline: string; milestones: string[]; quranPages: number; quranTarget: number | null };
type BusinessGoal = { headline: string; milestones: string[] };

const DOMAIN_LABEL = { deen: "Deen", business: "Business" } as const;

export function WeeklyFocus({
  deen,
  business,
  showPlanningNudge,
  onSaveDeen,
  onSaveBusiness,
}: {
  deen: DeenGoal | null;
  business: BusinessGoal | null;
  showPlanningNudge: boolean;
  onSaveDeen: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  onSaveBusiness: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {showPlanningNudge && (
        <p className="rounded-lg border border-accent-business/40 bg-accent-business/10 px-4 py-3 text-sm text-accent-business">
          It&apos;s the weekend — set next week&apos;s Deen and Business goals below.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GoalCard
          title={DOMAIN_LABEL.deen}
          domain="deen"
          headline={deen?.headline ?? ""}
          milestones={deen?.milestones ?? []}
          quranPageTarget={deen?.quranTarget}
          quranPagesRead={deen?.quranPages}
          showQuranTarget
          locked={false}
          onSave={onSaveDeen}
        />
        <GoalCard
          title={DOMAIN_LABEL.business}
          domain="business"
          headline={business?.headline ?? ""}
          milestones={business?.milestones ?? []}
          locked={false}
          onSave={onSaveBusiness}
        />
      </div>
    </div>
  );
}
