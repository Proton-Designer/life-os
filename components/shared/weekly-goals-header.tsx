"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { GoalCard, isGoalHeadlineSet } from "@/components/shared/goal-card";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT, ACCENT_VAR } from "@/lib/accent-tokens";
import { cn } from "@/lib/utils";

export type WeeklyGoalEntry = {
  headline: string;
  milestones: string[];
  quranPages?: number;
  quranTarget?: number | null;
} | null;

const DOMAIN_LABEL = { deen: "Deen", business: "Business" } as const;
type GoalDomain = keyof typeof DOMAIN_LABEL;

/**
 * One domain's slice of the combined module: label + headline (or the
 * "set this week's goal" prompt) plus a subtle edit icon that opens the
 * real editing UI in a dialog — GoalCard's own form, not a reimplementation
 * (Ayman, overnight session 2026-08-24: this module absorbed all editing
 * from the deleted "This week's focus" bottom panel, so it can't be a
 * read-only summary). `defaultEditing` skips the redundant extra click
 * GoalCard's own in-form Pencil would otherwise require.
 */
function GoalSlot({
  domain,
  goal,
  onSave,
}: {
  domain: GoalDomain;
  goal: WeeklyGoalEntry;
  onSave: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
}) {
  const accent = DOMAIN_ACCENT[domain];
  const Icon = DOMAIN_ICON[domain];
  const [open, setOpen] = useState(false);
  // A row can exist with a blank (or whitespace-only) headline — clearing a
  // goal is legitimate, and saveWeeklyGoal deliberately doesn't reject an
  // empty string. Treat that the same as "no goal set" here rather than
  // rendering a blank line with no way back to the prompt (Opus Lead,
  // 2026-08-24 — Ayman can reach this himself: pencil, clear, save).
  const isSet = !!goal && isGoalHeadlineSet(goal.headline);

  async function handleSave(headline: string, milestones: string[], quranPageTarget?: number) {
    await onSave(headline, milestones, quranPageTarget);
    setOpen(false);
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 py-3 first:pt-0 last:pb-0 sm:py-0 sm:first:pl-0 sm:last:pr-0 sm:px-4">
      <IconChip icon={Icon} accent={accent} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="text-[10px] font-semibold tracking-wide uppercase"
          style={{ color: `var(${ACCENT_VAR[accent]})` }}
        >
          {DOMAIN_LABEL[domain]}
        </span>
        {isSet ? (
          <p className="truncate text-sm font-medium">{goal!.headline}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Set this week&apos;s {DOMAIN_LABEL[domain]} goal</p>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${DOMAIN_LABEL[domain]} goal`}
            className="shrink-0 text-muted-foreground"
          >
            <Pencil className="size-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{DOMAIN_LABEL[domain]} goal</DialogTitle>
          </DialogHeader>
          <GoalCard
            title={DOMAIN_LABEL[domain]}
            domain={domain}
            headline={goal?.headline ?? ""}
            milestones={goal?.milestones ?? []}
            quranPageTarget={domain === "deen" ? goal?.quranTarget : undefined}
            quranPagesRead={domain === "deen" ? goal?.quranPages : undefined}
            showQuranTarget={domain === "deen"}
            locked={false}
            onSave={handleSave}
            defaultEditing
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The combined, standout "This Week's Focus" module (Ayman, overnight
 * session 2026-08-24: replaces two separate small cards plus the redundant
 * bottom-of-Home "This week's focus" panel, which is now gone — this module
 * is the only place weekly goals live and get edited). One card, one
 * glowing-white border to set it apart from every gray-bordered panel
 * elsewhere on Home, Deen/Business divided by a subtle internal line.
 * Shared with /calendar's header — same contract, same component.
 */
export function WeeklyGoalsHeader({
  deen,
  business,
  onSaveDeen,
  onSaveBusiness,
  showPlanningNudge,
  className,
}: {
  deen: WeeklyGoalEntry;
  business: WeeklyGoalEntry;
  onSaveDeen: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  onSaveBusiness: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  showPlanningNudge?: boolean;
  className?: string;
}) {
  return (
    <div
      id="weekly-focus"
      className={cn("scroll-mt-20 flex flex-col gap-3", className)}
      data-testid="weekly-goals-header"
    >
      <h2 className="text-sm font-semibold text-muted-foreground">This Week&apos;s Focus</h2>
      {showPlanningNudge && (
        <p className="rounded-lg border border-accent-business/40 bg-accent-business/10 px-4 py-3 text-sm text-accent-business">
          It&apos;s the weekend — set next week&apos;s Deen and Business goals below.
        </p>
      )}
      <div
        className="flex flex-col divide-y divide-border/40 rounded-2xl border border-white/70 bg-card p-4 sm:flex-row sm:divide-x sm:divide-y-0"
        style={{
          boxShadow:
            "0 0 0 1px color-mix(in oklch, var(--glow-white) 30%, transparent), 0 0 20px 2px color-mix(in oklch, var(--glow-white) 22%, transparent)",
        }}
      >
        <GoalSlot domain="deen" goal={deen} onSave={onSaveDeen} />
        <GoalSlot domain="business" goal={business} onSave={onSaveBusiness} />
      </div>
    </div>
  );
}
