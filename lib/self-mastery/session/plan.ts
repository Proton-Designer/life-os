// Groups a flat, already-ordered list of hydrated cards into a SessionPlan —
// ported verbatim (pure) from ULM's packages/core/src/session/index.ts.
import type { SessionCard, SessionPlan } from "./types";

/**
 * Deterministic O(n) repair (bounded at n passes) so no two consecutive
 * cards share a `lessonId` — the last mile after get_session_queue's SQL
 * (071): that fix solves new-card lesson-spread and due-card adjacency
 * *within* each book-interleave wave, but under tied `due_at` at a wave
 * boundary two same-lesson cards can still land adjacent (most likely right
 * after a book is ingested, when all its cards share one created_at-adjacent
 * due_at — exactly a new user's first session).
 *
 * `pinnedPrefixLength` cards at the start are never moved (the warm-up slot
 * — deliberate "easy win first," not swappable) but are still checked as a
 * neighbor. When a violation has no safe swap anywhere ahead, it's left in
 * place — never crashes, never drops a card.
 */
export function repairLessonAdjacency(cards: SessionCard[], pinnedPrefixLength = 0): SessionCard[] {
  const result = [...cards];
  const n = result.length;
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = Math.max(1, pinnedPrefixLength); i < n; i++) {
      if (result[i]!.lessonId !== result[i - 1]!.lessonId) continue;
      let swapIndex = -1;
      for (let j = i + 1; j < n; j++) {
        if (result[j]!.lessonId === result[i - 1]!.lessonId) continue;
        swapIndex = j;
        break;
      }
      if (swapIndex === -1) continue;
      const tmp = result[i]!;
      result[i] = result[swapIndex]!;
      result[swapIndex] = tmp;
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}

export function groupQueueIntoPlan(cards: SessionCard[]): SessionPlan {
  const seen = new Set<string>();
  const deduped = cards.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  const warmUpRaw = deduped.filter((c) => c.reason === "warm_up");
  const dueRaw = deduped.filter((c) => c.reason === "due");
  const freshRaw = deduped.filter((c) => c.reason === "new");

  const repaired = repairLessonAdjacency([...warmUpRaw, ...dueRaw, ...freshRaw], warmUpRaw.length);
  const warmUp = repaired.filter((c) => c.reason === "warm_up");
  const due = repaired.filter((c) => c.reason === "due");
  const fresh = repaired.filter((c) => c.reason === "new");

  let closer: SessionCard | null = null;
  for (let i = fresh.length - 1; i >= 0 && !closer; i--) {
    if (fresh[i]?.promptType === "application") {
      closer = fresh.splice(i, 1)[0] ?? null;
    }
  }
  for (let i = due.length - 1; i >= 0 && !closer; i--) {
    if (due[i]?.promptType === "application") {
      closer = due.splice(i, 1)[0] ?? null;
    }
  }

  return { warmUp, due, fresh, closer };
}
