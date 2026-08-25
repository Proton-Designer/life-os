"use client";

import { useState } from "react";
import { getReviewData, type ReviewData } from "@/app/(app)/review/actions";
import { ReviewClient } from "@/components/distractions/review-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Converts the topbar's Review link into a popup — Ayman: "change the
 * 'Review' tab/screen at the top into a popup module that is easily
 * accessible, like the distractions popup." Follows
 * DistractionCaptureDialog's exact shape: a self-contained "use client"
 * component that imports its Server Actions directly (no prop-threading
 * through layout.tsx — getReviewData is a plain unbound Server Action
 * reference, not a plain closure, so importing it here doesn't cross the
 * Server→Client boundary AGENTS.md warns about), same outline/sm Button
 * trigger, same reliance on the shared Dialog primitives for Esc/overlay/
 * close-button dismissal.
 *
 * Differs from CalendarDialogTrigger in one deliberate way: this refetches
 * on EVERY open rather than caching across the dialog's lifetime. Unlike
 * the calendar (read-mostly, one save action with an obvious "this exact
 * value must look fresh" moment), Review is a multi-item checklist whose
 * underlying trigger list can change between opens — new distractions
 * logged via the capture dialog, or the review date itself rolling over at
 * the 4am tail — so a stale cross-session snapshot would be the wrong
 * default. WITHIN one open session, ReviewClient already tracks reviewed
 * items in its own local state and never re-reads this component's copy,
 * so no per-mutation refresh wiring is needed here — see review-client.tsx.
 * The /review route itself is untouched and still renders the same
 * ReviewClient for e2e/direct links (e2e/distractions.spec.ts navigates
 * there directly).
 */
export function ReviewDialogTrigger() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      setData(await getReviewData());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void load();
    } else {
      // Discard, don't cache — see the file comment above.
      setData(null);
      setLoadError(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Review
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{data ? `Review · ${data.dateLabel}` : "Review"}</DialogTitle>
        </DialogHeader>
        {loading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
        {!loading && loadError && (
          <p className="py-12 text-center text-sm text-muted-foreground">Couldn&apos;t load your review. Try again.</p>
        )}
        {!loading && !loadError && data && <ReviewClient groups={data.groups} />}
        {!loading && !loadError && data === null && (
          <p className="py-12 text-center text-sm text-muted-foreground">The review window has closed.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
