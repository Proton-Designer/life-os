"use client";

import { WeeklyGoalSlot } from "@/components/shared/weekly-goal-slot";
import { cn } from "@/lib/utils";

export type WeeklyGoalEntry = {
  headline: string;
  milestones: string[];
  quranPages?: number;
  quranTarget?: number | null;
} | null;

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
  showDeen = true,
  showBusiness = true,
  extraActions,
}: {
  deen: WeeklyGoalEntry;
  business: WeeklyGoalEntry;
  onSaveDeen: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  onSaveBusiness: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  showPlanningNudge?: boolean;
  className?: string;
  /** Both default true — every existing caller (Calendar's header, or a
   * legacy account) keeps seeing both slots unless it explicitly opts into
   * gating. Home is the only caller that passes these, scoped to whether
   * the user actually selected the domain each slot belongs to. If both
   * end up false, the whole module is hidden rather than rendering an
   * empty frame with nothing in it (Opus Lead ruling: an empty module is
   * worse than none). */
  showDeen?: boolean;
  showBusiness?: boolean;
  /** Optional element(s) beside the title (Home passes its Goals sheet button). A React node, never a function. */
  extraActions?: React.ReactNode;
}) {
  if (!showDeen && !showBusiness) return null;

  return (
    <div
      id="weekly-focus"
      className={cn("scroll-mt-20 flex flex-col gap-3", className)}
      data-testid="weekly-goals-header"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">This Week&apos;s Focus</h2>
        {extraActions}
      </div>
      {showPlanningNudge && (
        <p className="rounded-lg border border-accent-business/40 bg-accent-business/10 px-4 py-3 text-sm text-accent-business">
          {showDeen
            ? "It's the weekend — set next week's Deen and Business goals below."
            : "It's the weekend — set next week's Business goal below."}
        </p>
      )}
      <div
        className="flex flex-col divide-y divide-border/40 rounded-2xl border border-white/70 bg-card p-4 sm:flex-row sm:divide-x sm:divide-y-0"
        style={{
          boxShadow:
            "0 0 0 1px color-mix(in oklch, var(--glow-white) 30%, transparent), 0 0 20px 2px color-mix(in oklch, var(--glow-white) 22%, transparent)",
        }}
      >
        {showDeen && <WeeklyGoalSlot domain="deen" goal={deen} onSave={onSaveDeen} />}
        {showBusiness && <WeeklyGoalSlot domain="business" goal={business} onSave={onSaveBusiness} />}
      </div>
    </div>
  );
}
