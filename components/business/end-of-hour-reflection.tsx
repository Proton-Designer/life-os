"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { listMyReflectionCards, startEndOfHourRitual, submitEndOfHourReflection } from "@/app/(app)/personal/reflection-cards-actions";
import type { HourRecap, HourWorkInterval, ReflectionCard, ReflectionCardKind } from "@/lib/reflection-cards/types";

const KIND_LABEL: Record<ReflectionCardKind, string> = {
  goal: "Goal",
  motivation: "Motivation",
  thought_habit: "Thought-Habit",
  trait: "Trait",
};

const TEXTAREA_CLASS =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

type Phase = "closed" | "recap" | "submitted";

/**
 * P3-05's End-of-Hour ritual entry point -- manually triggered (the plan's
 * own wording), placed exactly where HourCompleteBanner already renders
 * (components/business/lock-in-session.tsx and lock-in-overlay.tsx): "the
 * Hour" completing at 60 real minutes, both the minimized Lock-In panel
 * and the full-screen overlay.
 *
 * Visibility is derived from listMyReflectionCards() rather than a
 * dedicated "is the flag on" check or a prop threaded down from a Server
 * Component: both callers of this component sit many layers inside the
 * app-wide LockInOverlayProvider (lock-in-overlay-context.tsx), and
 * threading a boolean flag that deep would mean touching AppShell,
 * AppShellChrome, business/page.tsx AND wherever the Home Focus module
 * mounts LockInPanel, for one manually-triggered, off-by-default feature.
 * listMyReflectionCards is itself flag-gated server-side (returns `[]`
 * when `cards_library` is off, same as a disabled user with zero cards) --
 * so "no cards came back" already implies "nothing to reflect on right
 * now" regardless of WHY, and reusing it avoids a second, near-duplicate
 * Server Action just to answer a boolean. Checked once, only after the
 * hour is actually up (never before) -- no point paying the round trip on
 * every session that never reaches 60 minutes.
 */
export function EndOfHourReflection({
  elapsedMinutes,
  intervals,
}: {
  elapsedMinutes: number;
  intervals: HourWorkInterval[];
}) {
  const [checked, setChecked] = useState(false);
  const [hasCards, setHasCards] = useState(false);
  const [phase, setPhase] = useState<Phase>("closed");
  const [recap, setRecap] = useState<HourRecap | null>(null);
  const [card, setCard] = useState<ReflectionCard | null>(null);
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (checked || elapsedMinutes < 60) return;
    setChecked(true);
    listMyReflectionCards()
      .then((cards) => setHasCards(cards.length > 0))
      .catch(() => setHasCards(false));
  }, [checked, elapsedMinutes]);

  if (elapsedMinutes < 60 || !hasCards) return null;

  function openRitual() {
    setError(null);
    setRecap(null);
    setCard(null);
    setResponse("");
    setPhase("recap");
    startTransition(async () => {
      const result = await startEndOfHourRitual(intervals);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRecap(result.recap ?? null);
      setCard(result.card ?? null);
    });
  }

  function handleSubmit() {
    if (!card) return;
    startTransition(async () => {
      const result = await submitEndOfHourReflection(card.id, response.trim() || null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPhase("submitted");
    });
  }

  function handleOpenChange(open: boolean) {
    if (open) return;
    setPhase("closed");
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openRitual}>
        Reflect
      </Button>
      <Dialog open={phase !== "closed"} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{phase === "submitted" ? "Logged" : "This hour"}</DialogTitle>
          </DialogHeader>
          {phase === "recap" ? (
            <div className="flex flex-col gap-4">
              {recap ? (
                <p className="text-sm">
                  {recap.workMinutes} of {recap.totalMinutes} minutes were real work
                  {recap.distractionCount > 0
                    ? `, ${recap.distractionCount} distraction${recap.distractionCount === 1 ? "" : "s"} logged`
                    : ""}
                  .
                </p>
              ) : !error ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {card ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card p-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[card.kind]}
                  </span>
                  <p className="text-sm text-foreground">{card.content}</p>
                  <textarea
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    placeholder="A quick reflection (optional)"
                    rows={3}
                    className={TEXTAREA_CLASS}
                  />
                </div>
              ) : recap ? (
                <p className="text-sm text-muted-foreground">
                  No cards in your library yet — add a Goal, Motivation, Thought-Habit, or Trait card from Self-Mastery.
                </p>
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="button" disabled={!card || isPending} onClick={handleSubmit}>
                  {isPending ? "Logging…" : "Log it"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
          {phase === "submitted" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Logged. Back to it.</p>
              <DialogFooter>
                <Button type="button" onClick={() => setPhase("closed")}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
