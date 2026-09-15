// Pure helpers for turning a SessionPlan into the linear card sequence the
// overlay walks through, and for deciding when a self-explanation
// interstitial falls. Split out from the overlay component so the ordering
// logic (warm-up -> due -> new -> closer LAST; the interstitial's re-rolled
// gap) is unit-testable without rendering anything.
import type { SessionCard, SessionPlan, SessionQuestion } from "@/lib/self-mastery/session/types";

/** warm-up -> due (interleaved) -> new -> closer, closer always last regardless of its original reason. */
export function buildCardSequence(plan: SessionPlan): SessionCard[] {
  const sequence = [...plan.warmUp, ...plan.due, ...plan.fresh];
  if (plan.closer) sequence.push(plan.closer);
  return sequence;
}

export type SessionSequenceItem = { kind: "card"; item: SessionCard } | { kind: "question"; item: SessionQuestion };

/**
 * Phase 1 #25's whole point ("cross-course interleaving", source spec:
 * "interleaved across books and topics, not blocked by book") — Opus Lead
 * required addition: INTERLEAVE, don't append. get_session_queue already
 * round-robins book- and course-backed sources together via its own
 * `queue_position` (071/160) — appending questions after every card would
 * throw away interleaving the database already computed.
 *
 * `plan.warmUp`/`due`/`fresh` (never `plan.closer` — spliced out separately,
 * see groupQueueIntoPlan) went through `repairLessonAdjacency` (plan.ts), a
 * card-specific, no-two-same-lesson-adjacent pass with no question
 * equivalent (types.ts's own doc on `SessionQuestion`) — that repair is left
 * completely undisturbed here; this function only decides where QUESTIONS
 * slot in relative to the cards' own already-decided order, by the one
 * signal both share: `queuePosition`, get_session_queue's own ordering.
 *
 * The closer stays pinned last regardless of its queuePosition, unchanged
 * from `buildCardSequence` — closing on an application-type prompt is a
 * card-specific ritual (session-screen-spec.md §1.4) with no question
 * equivalent to interleave against.
 *
 * A STABLE TWO-POINTER MERGE, deliberately not "concat everything then sort
 * by queuePosition" — a flat sort would re-order CARDS RELATIVE TO EACH
 * OTHER too, silently undoing repairLessonAdjacency's own swaps (which
 * intentionally place a card out of strict queue_position order to avoid two
 * same-lesson cards landing adjacent). This merge only ever compares the
 * CURRENT HEAD of the card stream against the current head of the question
 * stream to decide which comes next — it never compares two cards against
 * each other, so the repaired card order survives completely untouched, and
 * questions still land in genuinely interleaved positions relative to them.
 */
export function buildInterleavedSequence(plan: SessionPlan, dueQuestions: SessionQuestion[]): SessionSequenceItem[] {
  const cards = [...plan.warmUp, ...plan.due, ...plan.fresh];
  const questions = [...dueQuestions];
  const merged: SessionSequenceItem[] = [];
  let ci = 0;
  let qi = 0;
  while (ci < cards.length && qi < questions.length) {
    if (cards[ci]!.queuePosition <= questions[qi]!.queuePosition) {
      merged.push({ kind: "card", item: cards[ci]! });
      ci++;
    } else {
      merged.push({ kind: "question", item: questions[qi]! });
      qi++;
    }
  }
  while (ci < cards.length) merged.push({ kind: "card", item: cards[ci++]! });
  while (qi < questions.length) merged.push({ kind: "question", item: questions[qi++]! });
  if (plan.closer) merged.push({ kind: "card", item: plan.closer });
  return merged;
}

/**
 * A self-explanation interstitial falls every 4-6 cards (session-screen-spec.md
 * §1.4: "re-roll the gap each time"). `random` is injectable so this is
 * deterministic in tests; defaults to Math.random for real use.
 */
export function rollNextInterstitialGap(random: () => number = Math.random): number {
  return 4 + Math.floor(random() * 3); // 4, 5, or 6
}
