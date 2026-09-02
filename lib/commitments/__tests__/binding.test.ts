import { describe, expect, it } from "vitest";
import { resolveBinding, type BindingColumns } from "../binding";

const cols = (over: Partial<BindingColumns> = {}): BindingColumns => ({
  killListItemId: null,
  repGoalId: null,
  promotionId: null,
  ...over,
});

/**
 * R30: a session binds to a commitment polymorphically —
 * `(commitment_kind, commitment_id)` with per-kind nullable composite FKs under
 * this codebase's `num_nonnulls = 1` pattern, so evidence accrues to a
 * promotion the same way it does to a kill-list item.
 *
 * The database enforces exactly-one with a CHECK. This resolves the same
 * invariant in the read path, because a reader that assumes the constraint
 * holds will produce a confident wrong answer the day it doesn't — and a row
 * written before the constraint existed, or restored from a dump, is exactly
 * that day.
 */
describe("resolveBinding — exactly one, or a named reason why not", () => {
  it("resolves a kill-list binding", () => {
    expect(resolveBinding(cols({ killListItemId: "k1" }))).toEqual({
      kind: "kill_list_item",
      id: "k1",
    });
  });

  it("resolves a rep-goal binding", () => {
    expect(resolveBinding(cols({ repGoalId: "r1" }))).toEqual({ kind: "rep_goal", id: "r1" });
  });

  it("resolves a promotion binding — the fourth lifecycle", () => {
    expect(resolveBinding(cols({ promotionId: "p1" }))).toEqual({ kind: "promotion", id: "p1" });
  });

  /**
   * UNBOUND IS A REAL STATE, NOT AN ERROR. Most sessions are not evidence for
   * any commitment — someone sits down and works. Returning null here rather
   * than throwing is the difference between "this session served nothing" and
   * "this session is broken", and only the first is true.
   */
  it("an unbound session resolves to null, not an error", () => {
    expect(resolveBinding(cols())).toBeNull();
  });

  /**
   * Two bindings is a DATA defect, and it must not resolve to whichever the
   * reader happens to check first. Silently preferring one would make evidence
   * accrue to a commitment nobody chose, and the wrongness would be invisible:
   * both commitments would look plausible.
   */
  it("two bindings throws rather than picking one", () => {
    expect(() => resolveBinding(cols({ killListItemId: "k1", promotionId: "p1" }))).toThrow(
      /exactly one/i
    );
  });

  it("the error names every binding it found, so the row can be fixed", () => {
    let message = "";
    try {
      resolveBinding(cols({ killListItemId: "k1", repGoalId: "r1", promotionId: "p1" }));
    } catch (e) {
      message = e instanceof Error ? e.message : "";
    }
    expect(message).toMatch(/kill_list_item/);
    expect(message).toMatch(/rep_goal/);
    expect(message).toMatch(/promotion/);
  });

  /**
   * An empty string is not an id. Postgres would store it happily — the FK is
   * what would reject it, and a nullable FK column with '' in it is a row that
   * exists in a state the CHECK counts as PRESENT. Treating it as present here
   * would make an unbound session look bound to nothing-in-particular.
   */
  it("an empty-string id counts as absent, not as a binding", () => {
    expect(resolveBinding(cols({ killListItemId: "" }))).toBeNull();
  });
});
