"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cancelAgentBookWork } from "@/app/(app)/personal/self-mastery-actions";
import type { AgentBookProgress } from "@/lib/self-mastery/agent-book-progress";

/**
 * A book being processed by the owner's connected agent (no AI key): "Waiting for your agent: X of N steps done", the stage it is on, and a Cancel
 * that stops the remaining steps and fails the book retryably (Try again starts it over). Shown only for a book an agent is actually working on.
 */
export function AgentWorkCard({ bookId, progress }: { bookId: string; progress: AgentBookProgress }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = progress.total > 0 ? `${progress.done} of ${progress.total} steps done` : `${progress.done} steps done`;
  const title = progress.parked ? `Waiting for your agent: ${counts}` : `Your agent is working on this book: ${counts}`;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelAgentBookWork(bookId).catch(() => ({ ok: false }));
      if (res.ok) router.refresh();
      else setError("Couldn't cancel. Please try again.");
    });
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-5" data-testid="agent-work-card">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {progress.stageLabel}. Your connected agent does a batch of steps each time its scheduled task runs, so a long book finishes over several runs. You can leave and come back; progress is saved.
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/60" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[var(--accent-info)] transition-[width] duration-300" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <p className="text-xs text-muted-foreground">This stops your agent&apos;s work on this book. Tap Try again later to start it over.</p>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={cancel}>
              {pending ? "Cancelling…" : "Yes, cancel"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Keep waiting
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Cancel
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
