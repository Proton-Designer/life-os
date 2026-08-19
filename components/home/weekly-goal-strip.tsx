import Link from "next/link";

type GoalStripEntry = { headline: string } | null;
type Domain = "deen" | "business";

const DOMAIN_LABEL: Record<Domain, string> = { deen: "Deen", business: "Business" };
// Matches weekly-focus.tsx's own convention: the accent marks the recruiting
// prompt, not the set headline — once a goal exists it reads as content, not
// as "this belongs to Deen."
const DOMAIN_ACCENT_CLASS: Record<Domain, string> = {
  deen: "text-accent-deen",
  business: "text-accent-business",
};

function GoalSlot({ domain, goal }: { domain: Domain; goal: GoalStripEntry }) {
  const content = goal ? goal.headline : `Set this week's ${DOMAIN_LABEL[domain]} goal →`;
  return (
    <Link
      href="/weekly-planning"
      prefetch
      className={`flex min-h-11 min-w-0 flex-1 items-center hover:underline ${
        goal ? "text-foreground" : DOMAIN_ACCENT_CLASS[domain]
      }`}
    >
      <span className="truncate">{content}</span>
    </Link>
  );
}

export function WeeklyGoalStrip({ deen, business }: { deen: GoalStripEntry; business: GoalStripEntry }) {
  const neitherSet = !deen && !business;

  return (
    <div className="flex flex-col gap-0.5 text-sm text-muted-foreground lg:flex-row lg:items-center lg:gap-4">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide">This week</span>
      {neitherSet ? (
        <Link
          href="/weekly-planning"
          prefetch
          className="flex min-h-11 min-w-0 items-center hover:text-foreground hover:underline"
        >
          <span className="truncate">Set this week&apos;s goals →</span>
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-4">
          <GoalSlot domain="deen" goal={deen} />
          <GoalSlot domain="business" goal={business} />
        </div>
      )}
    </div>
  );
}
