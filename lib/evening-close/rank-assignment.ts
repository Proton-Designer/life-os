/**
 * Turning the ceremony's outcome into `tasks.mit_rank` values.
 *
 * THE CROWN IS RANK 1. `tasks_mit_rank_per_day_idx` (migration 113) is unique
 * on `(user_id, planned_date, mit_rank)` where `mit_rank is not null`, so the
 * database refuses a second rank-1 for the same day — that index is what makes
 * the crown scarce, not the interface drawing one button.
 *
 * BUT THE INDEX IS A BACKSTOP, NOT THE CHECK. An insert rejected at the index
 * is a 500 to someone standing in a two-minute nightly ritual. This function
 * must never PRODUCE a duplicate rank, so the index only ever catches a bug
 * that got past here.
 *
 * NO CROWN MEANS NO RANKS. Starred-but-uncrowned is a legitimate mid-ceremony
 * state, and promoting the first starred item into the crown would be exactly
 * the collapse the SPEC forbids: "Crowning is a SEPARATE ACT from starring…
 * the surface must not paper over that with a convenience tap." Doing it in the
 * write layer instead of the surface would be the same erosion, one layer down
 * and harder to see.
 */

export type RankAssignment = { id: string; mitRank: 1 | 2 | 3 };

export function assignRanks(input: { starred: string[]; crowned: string | null }): RankAssignment[] {
  const { starred, crowned } = input;

  if (crowned === null) return [];
  if (!starred.includes(crowned)) {
    throw new Error(`assignRanks: crowned id ${crowned} is not starred — crowning an unstarred item is refused`);
  }

  // The crown takes 1; everything else keeps its selection order behind it.
  // Selection order is a real signal the user gave and there is nothing better
  // to sort by, so it is preserved rather than re-derived.
  // MAX_STARRED is 3 and `star()` refuses a fourth, but this is a SEPARATE
  // entry point — the same reason the crown check above exists. Without this,
  // a fourth starred id silently becomes `mitRank: 4`, which the column's
  // CHECK (1..3) rejects at write time, and the `as 2 | 3` cast below would
  // have lied about it all the way to the database.
  if (starred.length > 3) {
    throw new Error(`assignRanks: ${starred.length} starred ids — at most three can carry a rank`);
  }

  const rest = starred.filter((id) => id !== crowned);
  return [
    { id: crowned, mitRank: 1 as const },
    ...rest.map((id, i) => ({ id, mitRank: (i + 2) as 2 | 3 })),
  ];
}
