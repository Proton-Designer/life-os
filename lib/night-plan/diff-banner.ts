/**
 * The morning open's read-only diff banner (item #29, step 3).
 *
 * ARCHITECT'S CONSTRAINT: ship only the two triggers derivable from data
 * `/open` already reads — its one query, `tasks` filtered to
 * `planned_date = today AND mit_rank is not null`. No second query, no
 * stored "last seen" snapshot, no new column.
 *
 * TRIGGER 1 — a ranked task whose `completed` is already true. The column is
 * already selected (`open/page.tsx`); trivial.
 *
 * TRIGGER 2 — "a ranked task that no longer exists or moved off today,"
 * DERIVED FROM A GAP IN THE RANK SEQUENCE, not from any second read.
 * `assignRanks` (`lib/evening-close/rank-assignment.ts`) only ever writes a
 * CONTIGUOUS prefix starting at 1 — the crown is 1, the rest follow at 2, 3
 * with no gaps, and nothing else in this codebase sets `mit_rank` at all.
 * So if today's live query comes back with, say, ranks {1, 3} and no 2, the
 * only way that shape can exist is that whatever held rank 2 at write time is
 * no longer in THIS query's result set — deleted, or its `planned_date`
 * moved off today. That is provable from the query's own result, with
 * nothing else to read.
 *
 * KNOWN GAP, ACCEPTED: a single-item plan (crown only, rank 1) that gets
 * deleted leaves an EMPTY result set, which is indistinguishable from "no
 * plan was made" and renders that branch instead of this banner. Detecting
 * that specific case would need a stored count from last night, which is
 * exactly the second-query/second-writer the architect ruled out — flagged
 * here rather than silently accepted as complete.
 */

export type OpenRankedTask = { id: string; title: string; mit_rank: number; completed: boolean };

export type OpenDiff = {
  changed: boolean;
  completedCount: number;
  goneCount: number;
  message: string | null;
};

export function computeOpenDiff(plan: readonly OpenRankedTask[]): OpenDiff {
  const completedCount = plan.filter((t) => t.completed).length;

  const ranksPresent = new Set(plan.map((t) => t.mit_rank));
  const maxRank = plan.reduce((max, t) => Math.max(max, t.mit_rank), 0);
  let goneCount = 0;
  for (let r = 1; r <= maxRank; r++) {
    if (!ranksPresent.has(r)) goneCount++;
  }

  const changed = completedCount > 0 || goneCount > 0;
  if (!changed) {
    return { changed: false, completedCount: 0, goneCount: 0, message: null };
  }

  const parts: string[] = [];
  if (completedCount > 0) {
    parts.push(`${completedCount} of these ${completedCount === 1 ? "is" : "are"} already done`);
  }
  if (goneCount > 0) {
    parts.push(`${goneCount} ${goneCount === 1 ? "moved or is" : "moved or are"} gone`);
  }

  return { changed: true, completedCount, goneCount, message: `Your day changed — ${parts.join("; ")}.` };
}
