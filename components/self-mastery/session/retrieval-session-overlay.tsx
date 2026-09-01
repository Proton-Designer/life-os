"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { startTimer, pauseTimer, resumeTimer, elapsedMs, type TimerState } from "@/lib/self-mastery/session/timer";
import { getScheduler, toFsrsCard, computeNextState, toRpcNextState } from "@/lib/self-mastery/fsrs-scheduler";
import {
  enqueuePendingReview,
  replayPendingReviews,
  localStorageAdapter,
} from "@/lib/self-mastery/session/offline-queue";
import { createClient } from "@/lib/supabase/client";
import { buildCardSequence, rollNextInterstitialGap } from "./build-card-sequence";
import {
  loadTodaysSession,
  revealCardAnswer,
  fetchCurrentCardState,
  finishSession,
  logSelfExplanation,
  revalidateAfterReview,
  type FinishSessionResult,
} from "@/app/(app)/personal/self-mastery-session-actions";
import type { BuiltSession, SessionCard } from "@/lib/self-mastery/session/types";

type Confidence = "sure" | "think_so" | "guessing";
type Rating = 1 | 2 | 3 | 4;

const RATING_LABEL: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
const CONFIDENCE_LABEL: Record<Confidence, string> = { sure: "Sure", think_so: "Think so", guessing: "Guessing" };

type Phase = "loading" | "error" | "empty" | "card" | "revealed" | "self_explain" | "finishing" | "complete";

/**
 * The full-screen retrieval session — warm-up -> due (interleaved) -> new ->
 * closer, with a self-explanation interstitial every 4-6 cards. Built on the
 * same radix Dialog primitive as LockInOverlay (full-screen takeover, focus
 * trap, body-scroll-lock for free) but its OWN provider-free component: no
 * app-wide context, since retrieval sessions are opened on demand from Home
 * and don't need a persistent minimized presentation elsewhere (unlike
 * Lock-In). Deliberately does NOT reuse LockInOverlayContext — 'learn'
 * sessions are concurrent-safe and orthogonal to the single-active-session
 * model that context implements (see lib/business/active-session.ts's own
 * comment on counts_toward_hours excluding 'learn' by construction).
 *
 * 🔴 THE non-negotiable invariant lives one layer down, in
 * lib/self-mastery/session/build-session.ts's hydrateQueueCards/
 * fetchCardAnswer split — this component only ever holds an `answer` string
 * in state AFTER calling revealCardAnswer, which only fires after the user
 * has committed an attempt (tapped "Reveal"). There is no code path here
 * that could show an answer before that tap, because there is no answer
 * to show until that fetch runs.
 */
export function RetrievalSessionOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuiltSession | null>(null);
  const [sequence, setSequence] = useState<SessionCard[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [answeredText, setAnsweredText] = useState("");
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [explanationText, setExplanationText] = useState("");
  const [completion, setCompletion] = useState<FinishSessionResult | null>(null);

  const timerRef = useRef<TimerState>(startTimer(Date.now()));
  const nextInterstitialAtRef = useRef(rollNextInterstitialGap());
  const cardsSinceInterstitialRef = useRef(0);

  const currentCard = sequence[cardIndex] ?? null;

  // Reset and load fresh every time the overlay opens — start_session
  // itself resumes an incomplete same-local-date session rather than
  // creating a duplicate, so this is safe (and correct) to call on every
  // open, including "mid-session resume after a cold start."
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setCardIndex(0);
    void (async () => {
      try {
        const result = await loadTodaysSession();
        if (cancelled) return;
        setBuilt(result);
        const seq = buildCardSequence(result.plan);
        setSequence(seq);
        setPhase(seq.length === 0 ? "empty" : "card");
        timerRef.current = startTimer(Date.now());
      } catch {
        if (!cancelled) {
          setError("Couldn't load today's session. Check your connection and try again.");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pause the recall timer while the tab is backgrounded — "thinking time,"
  // not wall-clock time (session-screen-spec.md §0's mechanism argument
  // applies to measurement too: counting backgrounded time would overstate
  // effort that didn't happen).
  useEffect(() => {
    if (!open) return;
    function handleVisibility() {
      timerRef.current =
        document.visibilityState === "hidden"
          ? pauseTimer(timerRef.current, Date.now())
          : resumeTimer(timerRef.current, Date.now());
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [open]);

  // A new card's prompt just showed -- start its own clock fresh.
  useEffect(() => {
    if (phase === "card") timerRef.current = startTimer(Date.now());
  }, [phase, cardIndex]);

  // Flush any reviews left queued from an earlier interrupted session
  // (app closed mid-offline-stretch) the moment today's session id is
  // known, and again on every reconnect while the overlay is open —
  // catches the case where the user keeps grading offline for a while and
  // the browser regains connectivity mid-session, not just at the very end.
  useEffect(() => {
    if (!open || !built) return;
    const sessionId = built.session.id;
    function flush() {
      const browserClient = createClient();
      void replayPendingReviews(browserClient, localStorageAdapter, sessionId).then((result) => {
        if (result.succeeded.length > 0) void revalidateAfterReview();
      });
    }
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [open, built]);

  function resetCardInputs() {
    setAnsweredText("");
    setConfidence(null);
    setRevealedAnswer(null);
  }

  async function handleReveal() {
    if (!currentCard) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const answer = await revealCardAnswer(currentCard.id);
      setRevealedAnswer(answer);
      setPhase("revealed");
    } catch {
      setError("Couldn't load the answer. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function advanceToNextCardOrInterstitial() {
    cardsSinceInterstitialRef.current += 1;
    resetCardInputs();
    const isLastCard = cardIndex + 1 >= sequence.length;
    if (!isLastCard && cardsSinceInterstitialRef.current >= nextInterstitialAtRef.current) {
      cardsSinceInterstitialRef.current = 0;
      nextInterstitialAtRef.current = rollNextInterstitialGap();
      setExplanationText("");
      setPhase("self_explain");
      return;
    }
    if (isLastCard) {
      void handleFinish();
      return;
    }
    setCardIndex((i) => i + 1);
    setPhase("card");
  }

  /**
   * Grading always goes through enqueue-then-immediate-replay, online or
   * offline — never a direct one-shot RPC call. This is deliberate, not
   * belt-and-suspenders: it means there is exactly ONE code path that
   * submits a review (this one), so the retry/dead-letter logic in
   * offline-queue.ts is exercised on every single grade, not just the rare
   * offline case that would otherwise be the only thing testing it.
   *
   * FSRS is computed HERE, client-side, via the same fsrs-scheduler.ts the
   * server uses — not through the gradeCard Server Action — for a reason
   * that isn't about performance: a Server Action's thrown error is
   * redacted to a generic message in a production build, which would
   * silently defeat offline-queue.ts's retry classifier (it string-matches
   * submit_review's REAL Postgres error text, which only survives over a
   * direct Supabase client call). See fetchCurrentCardState/gradeCard's own
   * comments in self-mastery-session-actions.ts.
   */
  async function handleGrade(rating: Rating) {
    if (!currentCard || !built) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const currentState = await fetchCurrentCardState(currentCard.id);
      const scheduler = getScheduler();
      const now = new Date();
      const { card: nextCard } = computeNextState(scheduler, toFsrsCard(currentState, now), rating, now);

      await enqueuePendingReview(localStorageAdapter, {
        id: crypto.randomUUID(),
        cardId: currentCard.id,
        rating,
        elapsedMs: elapsedMs(timerRef.current, Date.now()),
        answeredText,
        aiFeedback: null,
        aiSuggestedRating: null,
        confidence,
        nextState: toRpcNextState(nextCard),
      });

      const browserClient = createClient();
      const result = await replayPendingReviews(browserClient, localStorageAdapter, built.session.id);
      const permanentFailure = result.failures.find((f) => f.classification === "permanent");
      if (permanentFailure) {
        // Rare, and by definition unrecoverable by retrying -- surface it
        // rather than silently dropping the attempt, but don't block the
        // session over one card.
        setError(`That review couldn't be saved: ${permanentFailure.error}`);
      } else {
        void revalidateAfterReview();
      }
      // transient-retrying is NOT an error from the user's point of view —
      // this is the offline case working as designed: the attempt is
      // safely queued and will replay on the next reconnect, and the
      // session keeps moving. Nothing here blocks on it.
      advanceToNextCardOrInterstitial();
    } catch {
      setError("Couldn't save that grade. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSelfExplanationSubmit(skip: boolean) {
    if (!currentCard || !built) return;
    setIsSubmitting(true);
    try {
      await logSelfExplanation({
        lessonId: currentCard.lessonId,
        sessionId: built.session.id,
        prompt: "Put this lesson in your own words.",
        response: skip ? null : explanationText.trim() || null,
      });
    } catch {
      // Ungraded, never blocking -- a failed log shouldn't strand the
      // session. Continue regardless; nothing here is scored.
    } finally {
      setIsSubmitting(false);
    }
    const isLastCard = cardIndex + 1 >= sequence.length;
    if (isLastCard) {
      void handleFinish();
      return;
    }
    setCardIndex((i) => i + 1);
    setPhase("card");
  }

  async function handleFinish() {
    if (!built) return;
    setPhase("finishing");
    try {
      const result = await finishSession(built.session.id);
      setCompletion(result);
      setPhase("complete");
    } catch {
      setError("Session saved, but the summary couldn't load. Your progress is safe.");
      setPhase("error");
    }
  }

  const elapsedLabel = useMemo(
    () => formatElapsedDuration(elapsedMs(timerRef.current, Date.now())),
    // Recomputed on every render while a card is shown (state changes on
    // every keystroke), which is precise enough for display -- no separate
    // ticking clock needed the way Lock-In's overlay has one.
    [phase, cardIndex, answeredText]
  );

  if (!open) return null;

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onClose();
          }}
          aria-label="Retrieval session"
          className={cn(
            "fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-background p-6 text-foreground outline-none",
            "duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
          )}
        >
          <DialogPrimitive.Title className="sr-only">Retrieval session</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Full-screen spaced-repetition review session.
          </DialogPrimitive.Description>

          <div className="flex w-full items-center justify-between">
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {phase === "card" || phase === "revealed" ? elapsedLabel : null}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label="Close session" onClick={onClose}>
              <X />
            </Button>
          </div>

          {/* A transient, dismissible banner -- distinct from the full-page
              "error" phase below, which is for a load/finish failure that
              blocks the whole session. This is for a single grade that
              couldn't be saved (session-screen-spec.md: a permanent
              submit_review failure) -- real, but must not strand the rest
              of the session over one card. */}
          {error && phase !== "error" && (
            <div
              role="alert"
              className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <span>{error}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setError(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
          )}

          <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
            {phase === "loading" && <p className="text-muted-foreground">Loading today&apos;s session...</p>}

            {phase === "error" && (
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-muted-foreground">{error}</p>
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
              </div>
            )}

            {phase === "empty" && (
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-lg font-medium">Nothing due today.</p>
                <p className="text-sm text-muted-foreground">You&apos;re caught up.</p>
                <Button type="button" variant="outline" className="mt-4" onClick={onClose}>
                  Close
                </Button>
              </div>
            )}

            {(phase === "card" || phase === "revealed") && currentCard && (
              <div className="flex w-full max-w-xl flex-col gap-4">
                <p className="text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {currentCard.reason === "warm_up" ? "Warm-up" : currentCard.reason === "new" ? "New" : "Due"}
                </p>
                <p className="text-center text-xl font-medium">{currentCard.prompt}</p>

                <textarea
                  value={answeredText}
                  onChange={(e) => setAnsweredText(e.target.value)}
                  disabled={phase === "revealed"}
                  placeholder="Type what you remember -- an honest 'I don't know' is fine, leave it blank."
                  rows={4}
                  maxLength={20_000}
                  className="rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-70"
                />

                {phase === "card" && (
                  <>
                    <div className="flex justify-center gap-2">
                      {(["sure", "think_so", "guessing"] as const).map((c) => (
                        <Button
                          key={c}
                          type="button"
                          variant={confidence === c ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setConfidence(c)}
                        >
                          {CONFIDENCE_LABEL[c]}
                        </Button>
                      ))}
                    </div>
                    <Button type="button" size="lg" disabled={isSubmitting} onClick={handleReveal}>
                      Reveal answer
                    </Button>
                  </>
                )}

                {phase === "revealed" && (
                  <>
                    <div className="rounded-lg border border-border/40 bg-card p-4">
                      <p className="text-xs text-muted-foreground">Answer</p>
                      <p className="mt-1">{revealedAnswer}</p>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {([1, 2, 3, 4] as const).map((r) => (
                        <Button key={r} type="button" variant="outline" disabled={isSubmitting} onClick={() => handleGrade(r)}>
                          {RATING_LABEL[r]}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {phase === "self_explain" && currentCard && (
              <div className="flex w-full max-w-xl flex-col gap-4">
                <p className="text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  In your own words
                </p>
                <p className="text-center text-lg">Put this lesson in your own words.</p>
                <textarea
                  value={explanationText}
                  onChange={(e) => setExplanationText(e.target.value)}
                  placeholder="No wrong answers here -- this isn't graded."
                  rows={4}
                  className="rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex justify-center gap-2">
                  <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => handleSelfExplanationSubmit(true)}>
                    Skip
                  </Button>
                  <Button type="button" disabled={isSubmitting} onClick={() => handleSelfExplanationSubmit(false)}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {phase === "finishing" && <p className="text-muted-foreground">Finishing up...</p>}

            {phase === "complete" && completion && (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-lg font-medium">Session complete.</p>
                <p className="font-mono text-4xl font-semibold tabular-nums">{completion.currentStreak}</p>
                <p className="text-sm text-muted-foreground">day streak</p>
                {completion.freezeConsumed && (
                  <p className="text-sm text-muted-foreground">
                    A freeze covered the gap. {completion.freezeConsumed.freezesRemaining} left.
                  </p>
                )}
                {completion.effortfulWin && <EffortfulWinCallout win={completion.effortfulWin} />}
                <p className="text-sm text-muted-foreground">
                  {completion.dueTomorrow > 0
                    ? `${completion.dueTomorrow} card${completion.dueTomorrow === 1 ? "" : "s"} due tomorrow.`
                    : "Nothing due tomorrow yet."}
                </p>
                <Button type="button" className="mt-4" onClick={onClose}>
                  Done
                </Button>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function EffortfulWinCallout({ win }: { win: NonNullable<FinishSessionResult["effortfulWin"]> }) {
  switch (win.kind) {
    case "recovered_card":
      return <p className="max-w-sm text-sm">A card you&apos;d struggled with came back clean today.</p>;
    case "comeback":
      return <p className="max-w-sm text-sm">Good to have you back.</p>;
    case "hard_won_recall":
      return <p className="max-w-sm text-sm">You stuck with a hard one and got it.</p>;
    case "deck_complete":
      return <p className="max-w-sm text-sm">Every card in &ldquo;{win.bookTitle}&rdquo; has now been reviewed at least once.</p>;
    case "book_milestone":
      return <p className="max-w-sm text-sm">&ldquo;{win.bookTitle}&rdquo; crossed a real retention milestone.</p>;
    default:
      return null;
  }
}
