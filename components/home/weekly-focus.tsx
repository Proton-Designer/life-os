import Link from "next/link";

type DeenGoal = { headline: string; milestones: string[]; quranPages: number; quranTarget: number | null };
type BusinessGoal = { headline: string; milestones: string[] };

const DOMAIN_LABEL = { deen: "Deen", business: "Business" } as const;
// Matches this codebase's accent-token discipline (see AGENTS.md-adjacent
// convention across priority-list.tsx/next-actions.tsx) — never borrow
// another domain's color for a domain-specific element.
const DOMAIN_ACCENT_CLASS = { deen: "text-accent-deen", business: "text-accent-business" } as const;

function GoalBlock({
  domain,
  goal,
}: {
  domain: "deen" | "business";
  goal: DeenGoal | BusinessGoal | null;
}) {
  const label = (
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{DOMAIN_LABEL[domain]}</p>
  );

  if (!goal) {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Link href="/weekly-planning" prefetch className={`text-sm ${DOMAIN_ACCENT_CLASS[domain]} hover:underline`}>
          Set this week&apos;s {DOMAIN_LABEL[domain]} goal →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <p className="font-medium">{goal.headline}</p>
      {goal.milestones.length > 0 && (
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          {goal.milestones.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {"quranTarget" in goal && goal.quranTarget != null && (
        <p className="text-sm text-muted-foreground">
          Qur&apos;an {goal.quranPages}/{goal.quranTarget} pages
        </p>
      )}
    </div>
  );
}

export function WeeklyFocus({
  deen,
  business,
  showPlanningNudge,
}: {
  deen: DeenGoal | null;
  business: BusinessGoal | null;
  showPlanningNudge: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {showPlanningNudge && (
        <Link
          href="/weekly-planning"
          prefetch
          className="block rounded-lg border border-accent-business/40 bg-accent-business/10 px-4 py-3 text-sm text-accent-business hover:bg-accent-business/20"
        >
          Plan next week&apos;s Deen and Business goals →
        </Link>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GoalBlock domain="deen" goal={deen} />
        <GoalBlock domain="business" goal={business} />
      </div>
    </div>
  );
}
