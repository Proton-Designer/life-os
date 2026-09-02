/**
 * The polymorphic session→commitment binding (R30).
 *
 * A Deep Work session can be evidence for a commitment, and there are several
 * kinds: a kill-list item, a rep goal, and — R30's fourth lifecycle — a lesson
 * PROMOTION, the time-boxed experiment. Rather than one unified commitments
 * table, the session carries per-kind nullable FK columns under this codebase's
 * `num_nonnulls = 1` pattern, so evidence accrues to a promotion exactly the way
 * it does to a kill-list item.
 *
 * WHY THIS RESOLVES THE INVARIANT INSTEAD OF ASSUMING IT. The database enforces
 * exactly-one with a CHECK, and a reader that trusts the constraint produces a
 * confident wrong answer on the day it does not hold — a row written before the
 * constraint existed, a restore from a dump, a migration applied half-way. That
 * day has happened here: production spent hours this week in a half-applied
 * state where some constraints were present and others were not, and every
 * reader believed all of them were.
 *
 * UNBOUND IS A REAL STATE. Most sessions serve no commitment — someone sits
 * down and works. `null` is that answer, and it is not an error; throwing would
 * make ordinary work look like corruption. Two bindings IS corruption, and it
 * throws rather than silently preferring whichever column the reader checks
 * first: picking one would make evidence accrue to a commitment nobody chose,
 * invisibly, because both would look plausible afterwards.
 */

export type CommitmentKind = "kill_list_item" | "rep_goal" | "promotion";

export type Binding = { kind: CommitmentKind; id: string };

export type BindingColumns = {
  killListItemId: string | null;
  repGoalId: string | null;
  promotionId: string | null;
};

/** An empty string is not an id — see the test. Treated as absent. */
function present(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

export function resolveBinding(columns: BindingColumns): Binding | null {
  const found: Binding[] = [];
  if (present(columns.killListItemId)) found.push({ kind: "kill_list_item", id: columns.killListItemId });
  if (present(columns.repGoalId)) found.push({ kind: "rep_goal", id: columns.repGoalId });
  if (present(columns.promotionId)) found.push({ kind: "promotion", id: columns.promotionId });

  if (found.length === 0) return null;
  if (found.length > 1) {
    // Name every one of them: the point of the message is that someone can go
    // and fix the row, and "more than one binding" does not tell them which.
    throw new Error(
      `resolveBinding: expected exactly one commitment binding, found ${found.length} — ` +
        found.map((f) => `${f.kind}=${f.id}`).join(", ")
    );
  }
  return found[0];
}
