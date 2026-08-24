"use client";

import { useState } from "react";
import { ReviewItemCard } from "./review-item-card";
import type { DistractionDomain, ReviewItem } from "@/lib/distractions/types";

// Spec order (§5): Deen, Business, School, Fitness, Work — domains with no
// events today are already omitted by getReviewItems, so this is only the
// display label for whatever groups actually arrive.
const DOMAIN_LABEL: Record<DistractionDomain, string> = {
  deen: "Deen",
  business: "Business",
  school: "School",
  fitness: "Fitness",
  co_op: "Work",
};

type Group = { domain: DistractionDomain; items: ReviewItem[] };

export function ReviewClient({ groups: initialGroups }: { groups: Group[] }) {
  // A local mutable copy so the finish state can show the actual plan
  // bodies just saved during this pass, not the pre-review snapshot from
  // the server — "the review ends on the payoff," not a stale list.
  const [groups, setGroups] = useState(initialGroups);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const reviewedCount = reviewed.size;

  function handleReviewed(triggerId: string, updatedPlanBody?: string) {
    setReviewed((prev) => new Set(prev).add(triggerId));
    if (updatedPlanBody === undefined) return;
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) =>
          item.trigger.id === triggerId
            ? {
                ...item,
                trigger: {
                  ...item.trigger,
                  currentPlan: item.trigger.currentPlan
                    ? { ...item.trigger.currentPlan, body: updatedPlanBody }
                    : {
                        id: "pending",
                        body: updatedPlanBody,
                        version: 1,
                        createdAtIso: new Date(0).toISOString(),
                        followedCount: 0,
                        skippedCount: 0,
                        mustRewrite: false,
                      },
                },
              }
            : item
        ),
      }))
    );
  }

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No triggers today — nothing to review.</p>;
  }

  const done = reviewedCount === total;

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm font-medium">All {total} reviewed.</p>
        {groups.map((g) => (
          <div key={g.domain} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{DOMAIN_LABEL[g.domain]}</h3>
            {g.items.map((item) => (
              <div key={item.trigger.id} className="rounded-lg border border-border/40 p-3">
                <p className="text-sm font-medium">{item.trigger.name}</p>
                {item.trigger.currentPlan && <p className="mt-1 text-sm text-muted-foreground">{item.trigger.currentPlan.body}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {reviewedCount} of {total} reviewed
      </p>
      {groups.map((g) => {
        const remaining = g.items.filter((item) => !reviewed.has(item.trigger.id));
        if (remaining.length === 0) return null;
        return (
          <div key={g.domain} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{DOMAIN_LABEL[g.domain]}</h3>
            <div className="flex flex-col gap-2">
              {remaining.map((item) => (
                <ReviewItemCard key={item.trigger.id} item={item} onReviewed={handleReviewed} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
