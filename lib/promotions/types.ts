/**
 * The loop seam's vocabulary. `124` is live on production; this is the
 * TypeScript half of it.
 *
 * A PROMOTION is a commitment: the user read a lesson, and took its
 * `action_template` on as something they will actually do. A VERDICT is the
 * judgement, thirty days later: did it stick?
 *
 * The database shape these mirror (124):
 *   lesson_promotions  current state, one ACTIVE row per lesson per user
 *   lesson_verdicts    append-only log; `adopted`/`abandoned` retire the
 *                      promotion via trigger, `still_testing` does not
 */

/** The three verdicts, exactly `lesson_verdict` in Postgres. */
export type Verdict = "adopted" | "abandoned" | "still_testing";

/** `adopted` and `abandoned` retire the promotion. `still_testing` does not. */
export const TERMINAL_VERDICTS = ["adopted", "abandoned"] as const;

export function isTerminal(verdict: Verdict): boolean {
  return (TERMINAL_VERDICTS as readonly string[]).includes(verdict);
}

/** One of the user's areas, as `lesson_promotions.area_id` needs it. */
export interface PromotableArea {
  /** `user_domains.id` — the FK target. NOT the domain key. */
  id: string;
  key: string;
  label: string;
}

/**
 * Why a legacy account gets its own state rather than an empty array.
 *
 * `lesson_promotions.area_id` is NOT NULL and FKs to `user_domains(user_id,
 * id)`. An account in `mode: "legacy"` — onboarded before domain selection
 * existed — has NO `user_domains` rows, so it cannot promote anything: there
 * is no id to write. Ayman's real account and the SEED account are both in
 * exactly this state.
 *
 * `{ areas: [] }` would be indistinguishable from "the query returned
 * nothing", and every consumer would render an empty picker that cannot ever
 * be filled. A named state makes the UI say the true thing.
 */
export type PromotableAreasState =
  | { status: "ready"; areas: PromotableArea[] }
  | { status: "no-areas" };

/** An active promotion, as the verdict card needs it. */
export interface ActivePromotion {
  id: string;
  lessonId: string;
  lessonTitle: string;
  acceptedText: string;
  areaId: string;
  areaLabel: string;
  startedAt: string;
  verdictDueAt: string;
  /** Verdicts recorded so far — `still_testing` entries, newest first. */
  priorVerdicts: { verdict: Verdict; verdictAt: string; reason: string | null }[];
}

/** Every action in this module returns this shape. R15: failures are values. */
export type ActionResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; message: string };
