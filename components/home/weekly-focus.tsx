"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoalCard } from "@/components/shared/goal-card";

type DeenGoal = { headline: string; milestones: string[]; quranPages: number; quranTarget: number | null };
type BusinessGoal = { headline: string; milestones: string[] };

const DOMAIN_LABEL = { deen: "Deen", business: "Business" } as const;
// Matches this codebase's accent-token discipline (see AGENTS.md-adjacent
// convention across priority-list.tsx/next-actions.tsx) — never borrow
// another domain's color for a domain-specific element.
const DOMAIN_ACCENT_CLASS = { deen: "text-accent-deen", business: "text-accent-business" } as const;

/**
 * One domain's slot inside "This week's focus" — read view by default, an
 * inline GoalCard when editing. Editing here is now the ONLY place weekly
 * goals get set (2026-08-20: the Weekly Planning page this used to link out
 * to is gone — its goal-editing half moved here, its recap-charts half
 * moved to Insights). A domain with no goal yet opens straight into the
 * form instead of showing a link to click through, since there's no longer
 * anywhere else for that link to go.
 */
function GoalSection({
  domain,
  goal,
  showQuranTarget,
  onSave,
}: {
  domain: "deen" | "business";
  goal: DeenGoal | BusinessGoal | null;
  showQuranTarget?: boolean;
  onSave: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(goal === null);

  async function handleSave(headline: string, milestones: string[], quranPageTarget?: number) {
    await onSave(headline, milestones, quranPageTarget);
    setEditing(false);
  }

  if (editing) {
    return (
      <GoalCard
        title={DOMAIN_LABEL[domain]}
        domain={domain}
        headline={goal?.headline ?? ""}
        milestones={goal?.milestones ?? []}
        quranPageTarget={goal && "quranTarget" in goal ? goal.quranTarget : undefined}
        showQuranTarget={showQuranTarget}
        locked={false}
        onSave={handleSave}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{DOMAIN_LABEL[domain]}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditing(true)}
          aria-label={`Edit this week's ${DOMAIN_LABEL[domain]} goal`}
        >
          <Pencil />
        </Button>
      </div>
      <p className="font-medium">{goal!.headline}</p>
      {goal!.milestones.length > 0 && (
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          {goal!.milestones.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {"quranTarget" in goal! && goal!.quranTarget != null && (
        <p className="text-sm text-muted-foreground">
          Qur&apos;an {goal!.quranPages}/{goal!.quranTarget} pages
        </p>
      )}
    </div>
  );
}

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
        <GoalSection domain="deen" goal={deen} showQuranTarget onSave={onSaveDeen} />
        <GoalSection domain="business" goal={business} onSave={onSaveBusiness} />
      </div>
    </div>
  );
}
