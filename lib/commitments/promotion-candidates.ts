import type { CommitmentKind } from "./binding";

/**
 * Promotions as a candidate source for the read model (R30).
 *
 * A `lesson_promotion` IS a commitment — the fourth lifecycle, the time-boxed
 * experiment. It is NOT a lesson, and the distinction is the whole reason this
 * module exists: the lesson is a thing you learned, the promotion is a thing
 * you agreed to try, and the candidate the user sees must be the agreement.
 * Hence `acceptedText` as the title, never the lesson's own text.
 *
 * WINDOW = ITS CUE. URGENCY = `verdict_due_at`. That pairing is deliberate: the
 * cue says when in a day this belongs, the verdict deadline says how pressing
 * the whole experiment has become. Collapsing them — treating the verdict date
 * as a window — would make a promotion invisible for 29 days and then urgent
 * for one.
 *
 * A MISSING CUE IS ABSENT, NOT DEFAULTED. R30 makes cadence/cue optional, so a
 * promotion without one is anytime. Giving it a fabricated window would make an
 * anytime experiment compete for a slot it never claimed — the same
 * absent-read-as-a-value error that has cost this codebase more than any other
 * single mistake.
 */

export type PromotionRow = {
  id: string;
  /** What the user agreed to try. The candidate's title — NOT the lesson text. */
  acceptedText: string;
  area: string;
  /** Optional local cue, "HH:MM". Null means anytime. */
  cueTime: string | null;
  verdictDueAt: string;
  /** Single writer: a trigger from the verdict insert. Set iff a terminal verdict exists. */
  retiredAt: string | null;
};

export type PromotionCandidate = {
  commitmentKind: Extract<CommitmentKind, "promotion">;
  commitmentId: string;
  title: string;
  area: string;
  /** Null means anytime — the arbiter must not invent a window. */
  cueTime: string | null;
  /** The verdict deadline. Overdue is still a candidate: the experiment needs judging. */
  dueAt: string;
};

export function promotionCandidates(rows: PromotionRow[], _now: Date): PromotionCandidate[] {
  return rows
    // A retired promotion is finished — not a candidate, and not an error.
    .filter((r) => r.retiredAt === null)
    .map((r) => ({
      commitmentKind: "promotion" as const,
      commitmentId: r.id,
      title: r.acceptedText,
      area: r.area,
      cueTime: r.cueTime,
      dueAt: r.verdictDueAt,
    }));
}
