/**
 * The Night Plan — dump → star three → crown one.
 *
 * Ported from CollegeOS (`packages/api/src/day/nightPlan.ts` + the `mit_rank` contract in
 * migration 0005) as the engine half of BOSS-VISION §4.6's evening close. Pure: no clock,
 * no Supabase, no React. The surface is the LifeOS lead's; this holds the invariants so
 * they are true before any row is written.
 *
 * THE ORDER IS THE MECHANISM, NOT A UI FLOW.
 * Dump everything, star three, crown one. Crowning is a SEPARATE ACT from starring, and
 * collapsing them into "pick your top item" loses the two-stage narrowing that makes the
 * crown cost something. `crown()` therefore refuses an unstarred item rather than starring
 * it for you.
 *
 * WHY THE CROWN IS SCARCE HERE AND NOT ONLY IN THE DATABASE.
 * CollegeOS enforces it with a partial unique index -- `tasks_mit_rank_per_day_idx`, unique
 * on `(user_id, planned_date, mit_rank) where mit_rank is not null`. That index must travel
 * with this feature (see SPEC.md), because the failure mode is silent: two crowned items
 * still render perfectly, and the day simply stops having a single most important thing.
 * Nobody sees an error; the ritual just quietly stops working. The engine holds the same
 * invariant so a bug cannot reach the write in the first place.
 *
 * WHAT IS DELIBERATELY ABSENT: any duration estimate. Duration calibration trains on
 * estimate-vs-actual pairs, and the arbiter's `cost` signal reads it downstream. A dump
 * that injects estimates nobody made poisons both. The absence is enforced by shape rather
 * than by remembering not to set it.
 */

/** Where a dumped line came from. `user` is typed in the moment; the rest are seeded. */
export type DumpSource = "user" | "school_risk" | "goal_milestone" | "worry";

export interface DumpItem {
  id: string;
  title: string;
  source: DumpSource;
  /**
   * What this serves, when the user chose to say so. Null and absent both mean unanchored,
   * and that is the DEFAULT rather than a lapse: forcing an answer here makes the plan
   * unusable on the ordinary night when something urgent is the honest one, and trains
   * people to attach a lie.
   */
  servesId?: string | null;
}

export interface NightPlanState {
  items: DumpItem[];
  /** Starred ids in selection order. At most three. */
  starred: string[];
  /** The crowned id. Always also present in `starred`. */
  crowned: string | null;
  /**
   * Tomorrow's due retrieval items as a COUNT, never as dumped rows. Forty dumped cards
   * destroys a two-minute ritual; "14 cards, ~8 min" is context. A count is rendered, a
   * row is planned, and these are different things.
   */
  dueRetrievalCount: number;
}

export interface RankedItem extends DumpItem {
  /** 1 = the crowned MIT, 2 and 3 = the other starred items, mirroring `mit_rank`. */
  rank: 1 | 2 | 3;
}

export const MAX_STARRED = 3;

/**
 * Build tonight's dump.
 *
 * SEEDING IS ONE-SHOT, and `dismissedIds` is what makes that true. Removing a seeded line
 * is a planning act -- the user decided it is not tomorrow's problem -- so re-composing
 * must not resurrect it. Re-seeding on every open would make removal meaningless and turn
 * the dump into a feed.
 *
 * The seeding set is exactly three sources: risk-ranked school deliverables, unfinished
 * goal milestones, and parked worries. Retrieval arrives as a count (see `dueRetrievalCount`).
 */
export function composeDump(
  seeds: readonly DumpItem[],
  dismissedIds: readonly string[],
  opts: { dueRetrievalCount?: number } = {},
): NightPlanState {
  const dismissed = new Set(dismissedIds);
  return {
    items: seeds.filter((s) => !dismissed.has(s.id)),
    starred: [],
    crowned: null,
    dueRetrievalCount: opts.dueRetrievalCount ?? 0,
  };
}

/**
 * Star an item. A fourth star is REFUSED, not absorbed by silently dropping the oldest --
 * the ceiling is the point of the ritual, and a cap that quietly evicts something turns a
 * deliberate choice into a queue.
 */
export function star(state: NightPlanState, id: string): NightPlanState {
  if (!state.items.some((i) => i.id === id)) return state;
  if (state.starred.includes(id)) return state;
  if (state.starred.length >= MAX_STARRED) return state;
  return { ...state, starred: [...state.starred, id] };
}

/** Unstar, and drop the crown with it if it was the crowned item — a crown on an unstarred
 *  item is the two-crown bug wearing different clothes. */
export function unstar(state: NightPlanState, id: string): NightPlanState {
  if (!state.starred.includes(id)) return state;
  return {
    ...state,
    starred: state.starred.filter((s) => s !== id),
    crowned: state.crowned === id ? null : state.crowned,
  };
}

/**
 * Crown a starred item. Crowning a second MOVES the crown; there is never a moment with two.
 * An unstarred id is refused rather than auto-starred: the two-stage narrowing is the ritual.
 */
export function crown(state: NightPlanState, id: string): NightPlanState {
  if (!state.starred.includes(id)) return state;
  return { ...state, crowned: id };
}

/**
 * The plan as ranked items, mirroring `mit_rank`: the crown is 1, the remaining starred
 * items follow in selection order. Items dumped but not starred are absent — that is
 * `mit_rank null`, a real state meaning "written down, not chosen", not missing data.
 */
export function rankedPlan(state: NightPlanState): RankedItem[] {
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const ordered = [
    ...(state.crowned ? [state.crowned] : []),
    ...state.starred.filter((s) => s !== state.crowned),
  ];
  return ordered
    .map((id, index) => {
      const item = byId.get(id);
      return item ? { ...item, rank: (index + 1) as 1 | 2 | 3 } : null;
    })
    .filter((i): i is RankedItem => i !== null);
}
