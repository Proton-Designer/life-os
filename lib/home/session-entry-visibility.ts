/**
 * Phase 1 #24 fix (Opus Lead, live production finding, 2026-09-15): a student
 * who picked School but not Learning can create questions (#20-22) and, once
 * #24's trigger gives each one a card_states row, has real due/new items in
 * exactly the same card_states rows countDueCards/countNewCards already count
 * (those queries never filter on card_id vs question_id — they count by
 * user_id/state/due_at alone). The bug was purely gating: app/(app)/page.tsx
 * discarded a real, already-fetched DueSummary into null whenever the user
 * hadn't selected the Learning area, so a School-only user's due questions
 * were computed, fetched, and then thrown away before the entry card ever
 * saw them — built and unreachable, the exact disease this whole phase keeps
 * finding one layer past where the previous fix looked.
 *
 * Extracted as a pure function (same reasoning as compute-domain-visibility.ts,
 * this page's own sibling extraction) so the one subtle case — NOT gating on
 * `starterDeckMissing` — is unit-tested directly rather than only implied by
 * the page rendering correctly in practice.
 */
export interface SessionEntryDueSummary {
  dueCount: number;
  newCount: number;
  starterDeckMissing: boolean;
}

/**
 * `hasSelfMastery` preserves every existing behavior for a real Self-Mastery
 * user unchanged, including the `starterDeckMissing` retry nudge.
 *
 * The OR clause is deliberately `dueCount > 0 || newCount > 0`, NOT
 * `!starterDeckMissing` or "has any dueSummary at all" — `starterDeckMissing`
 * fires whenever the account has zero books AND zero due/new items, which is
 * ALSO the exact shape of a School-only user who has never opened Self-
 * Mastery. Showing the entry card on that shape would surface "Your starter
 * deck didn't load" to someone who never wanted a starter deck — a worse bug
 * than the one being fixed. Requiring a genuine due-or-new count excludes
 * that shape by construction: `starterDeckMissing` is only ever true when
 * this OR clause is already false.
 */
export function shouldShowSessionEntry(hasSelfMastery: boolean, dueSummary: SessionEntryDueSummary | null): boolean {
  const hasDueOrNewItems = !!dueSummary && (dueSummary.dueCount > 0 || dueSummary.newCount > 0);
  return hasSelfMastery || hasDueOrNewItems;
}
