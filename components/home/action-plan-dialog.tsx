"use client";

import { DistractionPlanReview } from "@/components/distractions/distraction-plan-review";
import { buildReviewGroups } from "@/lib/distractions/review-groups";
import { rankTriggersForPlanList } from "@/lib/distractions/plan-rules";
import type { TriggerSummary } from "@/lib/distractions/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Home's door to the distraction-plan review (IA-P1b): the SAME DistractionPlanReview the evening
 * close's Account stage renders (today's triggers: rewrite / follow-skip / first plan), plus an
 * "All plans" list to edit any existing plan. Not time-gated -- the topbar's 9pm Review popup it
 * replaces was.
 */
export function ActionPlanDialog({
  open,
  onOpenChange,
  triggers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggers: TriggerSummary[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Action Plan</DialogTitle>
        </DialogHeader>
        {/* Excludes plan-less triggers from "All plans" (spec 2026-08-23 §6): today's ones appear above as "write a plan" cards. */}
        <DistractionPlanReview groups={buildReviewGroups(triggers)} plans={rankTriggersForPlanList(triggers)} />
      </DialogContent>
    </Dialog>
  );
}
