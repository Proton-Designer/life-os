import type { PriorityItem } from "./types";

/** The literal id build-candidates.ts's buildSelfMasteryCandidate always uses -- exported once here so this file and that one can never drift on it independently. */
export const SELF_MASTERY_CANDIDATE_ID = "self-mastery-session";

export type CandidateSource = { kind: "priority_item"; item: PriorityItem } | { kind: "self_mastery" };

/**
 * Resolves a winning arbiter Candidate's id back to the real thing it
 * came from. The arbiter only ranks (Candidate is deliberately a bare
 * ranking shape -- no actionType/actionRefId/sunnahCompletions); this is
 * what lets a winning candidate actually be acted on without fattening
 * Candidate with rendering-only fields.
 *
 * EXHAUSTIVE BY CONSTRUCTION (Boss requirement): build-candidates.ts's
 * two builders only ever produce a `candidate.id` equal to a
 * PriorityItem's own `id` (buildCandidatesFromPriorityItems) or the fixed
 * `SELF_MASTERY_CANDIDATE_ID` sentinel (buildSelfMasteryCandidate) --
 * both forms are covered here, so a new PriorityItem-sourced domain needs
 * no change to this function at all, and a genuinely new candidate SHAPE
 * (neither form) is the one case this returns null for, which the caller
 * must treat as "nothing to act on," not silently ignore.
 */
export function resolveCandidateSource(candidateId: string, items: PriorityItem[]): CandidateSource | null {
  if (candidateId === SELF_MASTERY_CANDIDATE_ID) return { kind: "self_mastery" };
  const item = items.find((i) => i.id === candidateId);
  return item ? { kind: "priority_item", item } : null;
}
