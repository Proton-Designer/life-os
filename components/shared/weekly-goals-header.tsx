import Link from "next/link";
import { IconChip } from "@/components/ui/icon-chip";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT, ACCENT_VAR } from "@/lib/accent-tokens";
import { cn } from "@/lib/utils";

export type WeeklyGoalEntry = { headline: string } | null;

const DOMAIN_LABEL = { deen: "Deen", business: "Business" } as const;
type GoalDomain = keyof typeof DOMAIN_LABEL;

/**
 * Two clearly separated, labelled cards — one per domain — replacing the
 * old "colored text" strip whose only signal for which goal was which was
 * a tint (Ayman, overnight session 2026-08-23/24: "make this distinct so
 * the user knows what is deen what is business"). An explicit DEEN/
 * BUSINESS eyebrow plus the domain icon means the label is never inferred
 * from color alone. Shared between Home (replacing weekly-goal-strip.tsx's
 * presentation) and the top of /calendar — one component, two homes, so
 * the "what's this week's goal" answer can never drift between them.
 */
function GoalCard({ domain, goal }: { domain: GoalDomain; goal: WeeklyGoalEntry }) {
  const accent = DOMAIN_ACCENT[domain];
  const Icon = DOMAIN_ICON[domain];

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border border-border/60 bg-card p-3">
      <IconChip icon={Icon} accent={accent} size="md" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="text-[10px] font-semibold tracking-wide uppercase"
          style={{ color: `var(${ACCENT_VAR[accent]})` }}
        >
          {DOMAIN_LABEL[domain]}
        </span>
        {goal ? (
          <p className="truncate text-sm font-medium">{goal.headline}</p>
        ) : (
          <Link href="#weekly-focus" prefetch className="min-h-11 text-sm text-muted-foreground hover:text-foreground hover:underline">
            Set this week&apos;s {DOMAIN_LABEL[domain]} goal →
          </Link>
        )}
      </div>
    </div>
  );
}

export function WeeklyGoalsHeader({
  deen,
  business,
  className,
}: {
  deen: WeeklyGoalEntry;
  business: WeeklyGoalEntry;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)} data-testid="weekly-goals-header">
      <GoalCard domain="deen" goal={deen} />
      <GoalCard domain="business" goal={business} />
    </div>
  );
}
