"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { GoalCard, isGoalHeadlineSet } from "@/components/shared/goal-card";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT, ACCENT_VAR } from "@/lib/accent-tokens";
import type { WeeklyGoalEntry } from "@/components/shared/weekly-goals-header";

/**
 * THE weekly-goal editor (IA-P1b): one display row + the one edit dialog (GoalCard's own form).
 * Home's WeeklyGoalsHeader, /calendar and the topbar calendar popup (both via WeekCalendarView ->
 * WeeklyGoalsHeader) and the Business "This week's goal" widget all render this, and all save
 * through the same `saveWeeklyGoal(domain, ...)` Server Action.
 */
export const GOAL_DOMAIN_LABEL = { deen: "Deen", business: "Business" } as const;
export type GoalDomain = keyof typeof GOAL_DOMAIN_LABEL;

/** One domain's slice of the combined module: label + headline (or the
 * "set this week's goal" prompt) plus a subtle edit icon that opens the
 * real editing UI in a dialog — GoalCard's own form, not a reimplementation
 * (Ayman, overnight session 2026-08-24: this module absorbed all editing
 * from the deleted "This week's focus" bottom panel, so it can't be a
 * read-only summary). `defaultEditing` skips the redundant extra click
 * GoalCard's own in-form Pencil would otherwise require.
 */
export function WeeklyGoalSlot({
  domain,
  goal,
  onSave,
  compact = false,
}: {
  domain: GoalDomain;
  goal: WeeklyGoalEntry;
  onSave: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  /** Inside the page-header bar (Home): a slim column -- 24px chip, tiny label, one-line headline (2 lines on a phone), small edit control. */
  compact?: boolean;
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

  const label = GOAL_DOMAIN_LABEL[domain];
  return (
    <div className={cn("flex min-w-0 flex-1 items-center", compact ? "gap-2 px-2.5" : "gap-3 py-2 first:pt-0 last:pb-0 sm:py-0 sm:first:pl-0 sm:last:pr-0 sm:px-4")}>
      <IconChip icon={Icon} accent={accent} size={compact ? "sm" : "md"} className={compact ? "size-6 rounded-lg [&>svg]:size-3.5" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn("font-semibold tracking-wide uppercase", compact ? "text-[9px] leading-none" : "text-[10px]")}
          style={{ color: `var(${ACCENT_VAR[accent]})` }}
        >
          {label}
        </span>
        {isSet ? (
          <p title={goal!.headline} className={cn("font-medium", compact ? "line-clamp-2 text-[13px] leading-tight md:line-clamp-1" : "truncate text-sm")}>
            {goal!.headline}
          </p>
        ) : (
          <p className={cn("text-muted-foreground", compact ? "line-clamp-2 text-[13px] leading-tight md:line-clamp-1" : "text-sm")}>Set this week&apos;s {label} goal</p>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${GOAL_DOMAIN_LABEL[domain]} goal`}
            className={cn("shrink-0 text-muted-foreground", compact && "size-6")}
          >
            {compact && !isSet ? <Plus className="size-3.5" /> : <Pencil className="size-3.5" />}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{GOAL_DOMAIN_LABEL[domain]} goal</DialogTitle>
          </DialogHeader>
          <GoalCard
            title={GOAL_DOMAIN_LABEL[domain]}
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

