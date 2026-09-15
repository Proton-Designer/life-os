"use client";

import { useState, useTransition } from "react";
import { killIdentityHabitAction } from "@/app/(app)/habits/actions";
import { killRequiresReason } from "@/lib/habits/kill-escalation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * P2-11 -- the escalation-aware kill flow. Below the vote-count threshold
 * (lib/habits/kill-escalation.ts), a plain confirm; at/above it, a REQUIRED
 * reason (can't confirm with an empty/whitespace-only field), same "can't
 * skip past it" discipline as components/evening-close/close-blocker-
 * rewrite.tsx's forced plan rewrite -- the existing escalation pattern this
 * flow reuses the shape of.
 */
export function KillHabitDialog({
  open,
  onOpenChange,
  habitId,
  identityStatement,
  voteCount,
  onKilled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habitId: string;
  identityStatement: string;
  voteCount: number;
  onKilled: (habitId: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const requiresReason = killRequiresReason(voteCount);
  const canConfirm = !requiresReason || reason.trim().length > 0;

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await killIdentityHabitAction(habitId, reason.trim() || undefined);
      if ("ok" in res && res.ok) {
        onKilled(habitId);
        onOpenChange(false);
        setReason("");
      } else if ("reason" in res && res.reason === "requires_reason") {
        // The server disagreed with our own optimistic read of voteCount
        // (stale prop) -- fail safe by asking for the reason now rather
        // than silently killing an investment-heavy habit un-reasoned.
        setError("This habit needs a reason before it can be killed.");
      } else if ("error" in res) {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kill &ldquo;{identityStatement}&rdquo;?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {requiresReason ? (
            <>
              <p className="text-xs text-muted-foreground">
                You&apos;ve voted for this identity {voteCount} times. Write a real reason before killing it.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you killing this habit?"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">This can&apos;t be undone.</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={isPending || !canConfirm} onClick={handleConfirm}>
              {isPending ? "Killing…" : "Kill this habit"}
            </Button>
            <Button type="button" variant="ghost" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
