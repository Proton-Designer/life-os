"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recordVerdict } from "@/lib/promotions/actions";
import type { ActivePromotion, Verdict } from "@/lib/promotions/types";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/**
 * The thirty-day verdict — one promotion, three answers.
 *
 * WHY `still_testing` IS A FIRST-CLASS ANSWER AND NOT A DISMISS. A month is
 * the app's guess, not the user's. Forcing adopted/abandoned at an arbitrary
 * date makes the honest answer ("I haven't given it a fair run") unavailable,
 * and every unavailable honest answer becomes a dishonest one. `still_testing`
 * is deliberately not terminal in the schema: it records the judgement in the
 * append-only log and leaves the promotion active, so it comes back.
 *
 * WHY `abandoned` DEMANDS A REASON. `lesson_verdicts_abandoned_needs_reason`
 * enforces it in the database; the UI asks for it before submitting so the
 * user meets a sentence rather than a constraint violation. Without the
 * reason the log is a list of things that failed with nothing learned in it.
 */
export function VerdictCard({ promotion }: { promotion: ActivePromotion }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const timesDeferred = promotion.priorVerdicts.filter((v) => v.verdict === "still_testing").length;

  function submit(verdict: Verdict) {
    if (verdict === "abandoned" && !showReason) {
      // Ask first, submit second. The user should never meet the CHECK.
      setShowReason(true);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await recordVerdict({ promotionId: promotion.id, verdict, reason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border p-4" data-testid="verdict-card">
      <p className="text-xs text-muted-foreground">
        From &ldquo;{promotion.lessonTitle}&rdquo; · {promotion.areaLabel} · started {formatDate(promotion.startedAt)}
      </p>
      <p className="mt-2 text-sm font-medium">{promotion.acceptedText}</p>

      {timesDeferred > 0 && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="verdict-deferred-count">
          You said &ldquo;still testing&rdquo; {timesDeferred === 1 ? "once" : `${timesDeferred} times`} before.
        </p>
      )}

      <p className="mt-3 text-sm">Did this stick?</p>

      {showReason && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="What didn't work?"
            className={TEXTAREA_CLASS}
            disabled={isPending}
            data-testid="verdict-reason"
            aria-label="What didn't work?"
          />
          <p className="text-xs text-muted-foreground">
            A month from now this sentence is the part worth having.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert" data-testid="verdict-error">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => submit("adopted")} disabled={isPending} data-testid="verdict-adopted">
          I do this now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => submit("still_testing")}
          disabled={isPending}
          data-testid="verdict-still-testing"
        >
          Still testing
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => submit("abandoned")}
          disabled={isPending}
          data-testid="verdict-abandoned"
        >
          {showReason ? "Drop it" : "Didn't stick"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The reflect stage's whole surface. Renders NOTHING when nothing is due —
 * not a card, not an empty state, not a "no experiments yet" placeholder.
 * Most nights this list is empty and the close should be exactly as long as
 * it was before promotions existed.
 */
export function VerdictDueList({ promotions }: { promotions: ActivePromotion[] }) {
  if (promotions.length === 0) return null;
  return (
    <section className="space-y-3" data-testid="verdict-due-list">
      <h3 className="text-sm font-semibold">
        {promotions.length === 1 ? "One experiment is due" : `${promotions.length} experiments are due`}
      </h3>
      {promotions.map((promotion) => (
        <VerdictCard key={promotion.id} promotion={promotion} />
      ))}
    </section>
  );
}
