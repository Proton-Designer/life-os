"use client";

import { useState, useTransition } from "react";
import { recordPlanOutcome, saveActionPlan } from "@/app/(app)/distractions/actions";
import { mustRewrite } from "@/lib/distractions/plan-rules";
import type { ReviewItem } from "@/lib/distractions/types";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { IconChip } from "@/components/ui/icon-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TEXTAREA_CLASS =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

/**
 * `revising` doubles as the `followed` value the eventual recordPlanOutcome
 * call will carry — null means "not revising," true/false is which branch
 * opened the textarea. handleDidntFollow predicts mustRewrite client-side
 * (from the plan's own followedCount/skippedCount) purely for snappier UX;
 * the server (record_plan_outcome, 043) is what actually enforces it — a
 * mispredicted skip that the server rejects falls back into the same
 * revise UI via the catch below, never silently succeeds.
 */
export function ReviewItemCard({
  item,
  onReviewed,
}: {
  item: ReviewItem;
  onReviewed: (triggerId: string, updatedPlanBody?: string) => void;
}) {
  const { trigger, todayCount, isNew } = item;
  const [isPending, startTransition] = useTransition();
  const [planBody, setPlanBody] = useState("");
  const [revising, setRevising] = useState<boolean | null>(null);

  function handleSaveNewPlan() {
    const body = planBody.trim();
    if (!body) return;
    startTransition(async () => {
      await saveActionPlan(trigger.id, body);
      onReviewed(trigger.id, body);
    });
  }

  function handleDidntFollow() {
    const predictedFollowed = trigger.currentPlan?.followedCount ?? 0;
    const predictedSkipped = (trigger.currentPlan?.skippedCount ?? 0) + 1;
    if (mustRewrite(predictedFollowed, predictedSkipped)) {
      setRevising(false);
      return;
    }
    startTransition(async () => {
      try {
        await recordPlanOutcome({ triggerId: trigger.id, followed: false });
        onReviewed(trigger.id);
      } catch {
        setRevising(false);
      }
    });
  }

  function handleSubmitRevision() {
    const body = planBody.trim();
    if (!body || revising === null) return;
    startTransition(async () => {
      await recordPlanOutcome({ triggerId: trigger.id, followed: revising, newPlanBody: body });
      onReviewed(trigger.id, body);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconChip icon={DOMAIN_ICON[trigger.domain]} accent={DOMAIN_ACCENT[trigger.domain]} size="sm" />
          <span className="truncate font-medium">{trigger.name}</span>
        </div>
        <Badge variant="info">{todayCount}× today</Badge>
      </div>
      {trigger.description && <p className="text-xs text-muted-foreground">{trigger.description}</p>}

      {isNew ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">No plan yet — what&apos;s the plan of action?</p>
          <textarea
            value={planBody}
            onChange={(e) => setPlanBody(e.target.value)}
            placeholder="Plan of action"
            rows={3}
            className={TEXTAREA_CLASS}
            autoFocus
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={isPending || !planBody.trim()} onClick={handleSaveNewPlan}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm">{trigger.currentPlan?.body}</p>
          {revising === null ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleDidntFollow}>
                I didn&apos;t follow it
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => setRevising(true)}>
                I followed it, it happened anyway
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-destructive">
                {revising
                  ? "Following the plan and slipping anyway means the plan is wrong."
                  : "This plan has never once survived contact. Rewrite it smaller."}
              </p>
              <textarea
                value={planBody}
                onChange={(e) => setPlanBody(e.target.value)}
                placeholder="Rewritten plan"
                rows={3}
                className={TEXTAREA_CLASS}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setRevising(null)}>
                  Back
                </Button>
                <Button type="button" size="sm" disabled={isPending || !planBody.trim()} onClick={handleSubmitRevision}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
