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
 * this page's own sibling extraction) so this stays unit-tested directly
 * rather than only implied by the page rendering correctly in practice.
 *
 * [ONB item 11, 2026-09-19] This interface used to also carry
 * `starterDeckMissing`, and this file's own header used to document, at
 * length, why `shouldShowSessionEntry` must NOT gate on it (doing so would
 * have surfaced a "Your starter deck didn't load" retry to a School-only
 * user who never wanted Self-Mastery at all). That whole caution is now
 * moot rather than relevant-but-satisfied: the automatic starter-deck seed
 * it was protecting against the fallout of no longer exists (see
 * self-mastery-session-actions.ts's own history), so there is no
 * `starterDeckMissing`-shaped field left to be tempted to gate on. This
 * function's own logic never actually read that field either way — it was
 * always `dueCount > 0 || newCount > 0` alone — so nothing here changes
 * except the interface losing a field it never used.
 */
export interface SessionEntryDueSummary {
  dueCount: number;
  newCount: number;
}

/** `hasSelfMastery` preserves every existing behavior for a real Self-Mastery user unchanged. */
export function shouldShowSessionEntry(hasSelfMastery: boolean, dueSummary: SessionEntryDueSummary | null): boolean {
  const hasDueOrNewItems = !!dueSummary && (dueSummary.dueCount > 0 || dueSummary.newCount > 0);
  return hasSelfMastery || hasDueOrNewItems;
}
