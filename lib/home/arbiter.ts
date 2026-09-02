// The cross-domain arbiter (R18/R19) -- the single ranking that decides
// which candidate, across every area, is THE next action, and which two
// alternates back it up. Built as a pure function over a generic
// `Candidate` shape rather than `PriorityItem` directly: Self-Mastery's due
// session (R19) comes from `getDueSummary`, a completely different shape
// than the five-domain `PriorityItem` system, and the arbiter has to rank
// both together. Wiring real candidates from both systems into this shape
// is the next piece of work, sequenced after this ranking function itself
// is proven correct -- same lib-layer-first discipline this build has used
// throughout (prove the pure logic, then wire real data sources).
import type { Domain } from "./types";
import { classifyUrgency, type UrgencyLevel } from "./urgency";

/**
 * `Domain` deliberately stays closed to the five DB-frozen values
 * (lib/home/types.ts's own doc comment) -- a real safety property, not
 * incidental strictness, so it is NOT widened here. Self-Mastery's area is
 * a locally-scoped addition, used only for this ranking/fairness logic
 * (Boss ruling, R19): the five-domain system already treats Deen and
 * Fitness as fully independent ranked areas despite sharing an onboarding
 * SELECTION grouping ("Personal Growth") with Self-Mastery -- Self-Mastery
 * gets the same independence, not a stricter rule for being newest.
 */
export type Area = Domain | "self_mastery";

export type WeightTier = "essential" | "important" | "background";

export interface Candidate {
  id: string;
  area: Area;
  title: string;
  dueAt: Date | null;
  /** The domain's user_domains.weight tier (migration 110). Null only for an area with no resolved tier yet -- treated as 'important', the same safe floor the DB backfill itself uses. */
  weightTier: WeightTier | null;
  /** Tie-break WITHIN a tier -- user_domains.position. Null when unknown. */
  position: number | null;
  /**
   * 0-1 retrievability, lower = more in need of review. Null for every
   * area with no decay source (R18(2): decay generalises only where a
   * source computes it -- nothing here invents one). Today that's every
   * area except self_mastery.
   */
  decay: number | null;
  /** Estimated minutes to complete. Null where no source exists (R18(5): absent, never invented, for School/co_op/Business/Deen). */
  cost: number | null;
}

const URGENCY_ORDER: Record<UrgencyLevel, number> = { right_now: 0, later_today: 1, absent: 2 };
const WEIGHT_TIER_ORDER: Record<WeightTier, number> = { essential: 0, important: 1, background: 2 };

/**
 * Compares two REAL due dates already known to share an urgency tier.
 * Overdue is a genuinely new case this arbiter introduces: no existing
 * PriorityItem source has ever produced a past `dueAt` (missed prayers
 * flow to the Qada backlog, not Home's due-today list; tasks are queried
 * `due_date = today` only -- verified directly, `.eq("due_date", date)` in
 * lib/home/get-priority-items.ts's `getTasks`). `urgencyBucket`/
 * `classifyUrgency` collapse ANY negative time-to-due into "right_now" the
 * same as a due-soon-future instant, so naive ascending comparison
 * (earliest timestamp wins) would rank a days-overdue item above a
 * due-in-20-minutes item -- backwards. Boss ruling, R19: something still
 * closeable deserves the top slot over something already missed -- the
 * missed one isn't getting more missed in the next twenty minutes, but the
 * closing one is running out of runway right now. So: not-yet-due always
 * outranks already-passed, and each half sorts ascending on its own.
 *
 * WITHIN the overdue half, ascending means MOST-overdue ranks highest
 * (earliest/most-negative timestamp first) -- a deliberate design decision,
 * not yet exercised by anything real. Overdue is only representable for
 * the Self-Mastery due session today (R19's `dueAt` = earliest due card's
 * `due_at`), and there is exactly one Self-Mastery candidate per user, so
 * two overdue candidates can never coexist and this half of the rule never
 * fires. It becomes live the moment a second overdue source exists --
 * concretely, if School/co_op tasks are ever queried beyond
 * `due_date = today` -- and at that point it encodes "the most stale item
 * wins," surfacing abandoned work above recently-missed work (a task
 * overdue a year outranking one overdue five minutes). That may not be
 * what's wanted then; it is a stated trade-off now, not a discovery later.
 */
function compareDueAt(a: Date, b: Date, now: Date): number {
  const aTime = a.getTime();
  const bTime = b.getTime();
  const aOverdue = aTime < now.getTime();
  const bOverdue = bTime < now.getTime();
  if (aOverdue !== bOverdue) return aOverdue ? 1 : -1;
  return aTime - bTime;
}

/**
 * `Array.prototype.sort`'s comparator must be a valid total order: if it
 * ever says two pairs are each "tied" (0) it cannot then say a third pair
 * drawn from those same two is NOT tied, or the sort is undefined -- V8
 * doesn't throw, it just produces an unspecified result that can vary by
 * input size/engine, which is worse than a wrong-but-consistent answer.
 * "Only compare when both sides have a real value, else 0" breaks exactly
 * this the moment three candidates mix reals and nulls: two null-vs-real
 * pairs each read as tied (0), while the two real values themselves are
 * NOT tied -- a genuine A~B, A~C, B<C contradiction (found via this file's
 * own test suite, not by inspection). Coalescing a missing value to
 * `Infinity` keeps the comparator a real total order: a real value always
 * beats a missing one (concrete data outranks the unknown), and two
 * missing values compare as genuinely, consistently equal.
 */
function compareWithMissingLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * The cross-domain arbiter's ranking order (R18/R19, Boss ruling):
 * urgency -> dueAt -> weight tier -> position -> decay -> cost.
 * Lexicographic, deliberately not a weighted blend -- an additive score
 * would make a missing signal equivalent to a bad one (null-is-zero again,
 * moved up to the aggregate level), which given today's real signal
 * coverage (most candidates are missing most signals) would be actively
 * misleading. Each tier below falls through untouched when it doesn't
 * apply to either candidate -- a genuine no-op, not a special case -- so a
 * tier activates for free the moment its signal exists for more areas.
 */
export function rankCandidates(candidates: Candidate[], now: Date): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aUrgency = classifyUrgency(a.dueAt, now);
    const bUrgency = classifyUrgency(b.dueAt, now);
    if (aUrgency !== bUrgency) return URGENCY_ORDER[aUrgency] - URGENCY_ORDER[bUrgency];

    if (a.dueAt && b.dueAt) {
      const cmp = compareDueAt(a.dueAt, b.dueAt, now);
      if (cmp !== 0) return cmp;
    }

    const aTier = WEIGHT_TIER_ORDER[a.weightTier ?? "important"];
    const bTier = WEIGHT_TIER_ORDER[b.weightTier ?? "important"];
    if (aTier !== bTier) return aTier - bTier;

    const positionCmp = compareWithMissingLast(a.position, b.position);
    if (positionCmp !== 0) return positionCmp;

    // Never invented, never a stand-in zero (R18(2)) -- a real value beats
    // a missing one, two missing values stay genuinely tied and fall
    // through to cost.
    const decayCmp = compareWithMissingLast(a.decay, b.decay); // lower retrievability = more in need, ranks first
    if (decayCmp !== 0) return decayCmp;

    const costCmp = compareWithMissingLast(a.cost, b.cost); // cheaper wins a genuine tie, missing never invented (R18(5))
    if (costCmp !== 0) return costCmp;

    return 0;
  });
}

/**
 * The fairness rule (R19): primary is the single global best; alternates
 * are the next 2 best EXCLUDING the primary's own area, from the remaining
 * cross-domain pool -- guarantees "other areas" structurally rather than
 * "just the next best regardless of domain." Empty/short input degrades to
 * fewer alternates, never throws.
 */
export function pickPrimaryAndAlternates(
  candidates: Candidate[],
  now: Date
): { primary: Candidate | null; alternates: Candidate[] } {
  const ranked = rankCandidates(candidates, now);
  const primary = ranked[0] ?? null;
  if (!primary) return { primary: null, alternates: [] };
  const alternates = ranked.filter((c) => c.area !== primary.area).slice(0, 2);
  return { primary, alternates };
}
