"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewItemCard } from "@/components/distractions/review-item-card";
import type { ReviewItem } from "@/lib/distractions/types";

/**
 * The plan-rewrite, mounted INSIDE the evening close's account stage.
 *
 * WHY THIS WRAPPER EXISTS. `ReviewItemCard` takes an `onReviewed` callback —
 * a function prop — so a Server Component cannot render it directly. That is
 * AGENTS.md's RSC rule, and this file is the boundary: the page passes plain
 * serializable `ReviewItem`s to this client component, and the callback is
 * created here, on the client, where it belongs.
 *
 * WHY IT IS MOUNTED RATHER THAN LINKED. The account stage used to link each
 * blocking trigger out to `/review`. Once `/review` redirects to `/close` that
 * link becomes a loop AND the only rewrite surface disappears — the forced
 * rewrite becomes unresolvable, and the close permanently uncompletable for
 * anyone with a three-strike plan. Absorbing the UI is what makes the redirect
 * safe; shipping the redirect without it would have been a silent deadlock,
 * because every screen still renders correctly.
 *
 * REUSED, NOT REWRITTEN. `ReviewItemCard` already knows the rewrite rules —
 * `mustRewrite`, `saveActionPlan`, the follow/skip question it must NOT ask a
 * failing plan. A second implementation here would be a second definition of
 * "this plan has failed" that could drift from the first, invisibly, since both
 * would keep rendering plausible cards.
 */
export function CloseBlockerRewrite({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [rewritten, setRewritten] = useState<Set<string>>(new Set());

  function handleReviewed(triggerId: string) {
    setRewritten((prev) => new Set(prev).add(triggerId));
    // The gate is computed on the server from `mustRewrite`. Refresh so the
    // account stage re-evaluates rather than trusting this component's local
    // idea of whether the close is now unblocked — the blocker list is the
    // server's answer, and this is only the surface that changed it.
    router.refresh();
  }

  const remaining = items.filter((i) => !rewritten.has(i.trigger.id));

  return (
    <div className="space-y-3">
      {remaining.map((item) => (
        <ReviewItemCard key={item.trigger.id} item={item} onReviewed={handleReviewed} />
      ))}
      {remaining.length === 0 && items.length > 0 ? (
        <p className="text-sm text-muted-foreground">Rewritten. Reloading the close…</p>
      ) : null}
    </div>
  );
}
