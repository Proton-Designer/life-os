/**
 * Plain (no "use client") on purpose: the Business modules, a Server Component, call killListTarget; a function exported
 * from a client module cannot be called on the server.
 */

/** The first two slots are the day's commitment; the third is optional (2 items can be a full day on the tech side). */
export const KILL_LIST_REQUIRED_SLOTS = 2;

/** How many items today's list is aiming at: the two required slots, plus the optional third once it has text. Pure. */
export function killListTarget(slots: readonly { text: string }[]): number {
  return KILL_LIST_REQUIRED_SLOTS + (slots[KILL_LIST_REQUIRED_SLOTS]?.text.trim() ? 1 : 0);
}
