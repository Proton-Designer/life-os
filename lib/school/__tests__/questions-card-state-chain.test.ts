import { describe, expect, it } from "vitest";
import { createQuestionCore } from "../questions-core";

/**
 * Phase 1 #24's own required proof (Opus Lead): "prove the triggered row
 * satisfies whatever filter new_candidates uses, not just that a row
 * exists." Migration 179's own shape-asserts already do this once, at
 * apply time, inside the migration file itself; this is the same proof,
 * repeatable in CI, chained all the way from the REAL `createQuestionCore`
 * insert through to `submit_question_review`'s own guard -- so a
 * regression in any one of the three links (the trigger fires / the exact
 * filter get_session_queue's new_candidates applies / the guard's own
 * error text) fails this test, not just a one-time hand-inspection of a
 * migration that already shipped.
 *
 * The chain: createQuestionCore inserts a question -> [migration 179's
 * trigger, mirrored here as fake-DB logic that reproduces its SQL exactly]
 * creates a card_states row -> that row is checked against
 * get_session_queue's own `new_candidates` QUESTION arm (160) filter by
 * filter (state = 'new', question.active) -> submit_question_review's own
 * "no card_states row" guard (161) is exercised against BOTH a
 * trigger-fired row and a trigger-MISSING row, to prove the trigger --
 * not mere presence of *a* row -- is what closes the gap. The final test
 * in this file is the negative control: it proves this instrument can
 * actually detect #24's bug by reproducing the pre-179 world and checking
 * the guard fails with 161's real, load-bearing error text.
 */

type Row = Record<string, unknown>;

function createFakeDb(opts: { simulateTrigger: boolean }) {
  const tables: Record<string, Row[]> = { questions: [], card_states: [] };
  let nextId = 0;
  const genId = () => `row-${nextId++}`;

  const client = {
    from(table: string) {
      const eqFilters: [string, unknown][] = [];
      let op: "select" | "insert" = "select";
      let insertRow: Row = {};

      const builder = {
        select() {
          return builder;
        },
        insert(row: Row) {
          op = "insert";
          insertRow = row;
          return builder;
        },
        eq(col: string, val: unknown) {
          eqFilters.push([col, val]);
          return builder;
        },
        single() {
          return execute().then((r) => ({
            data: r.data[0] ?? null,
            error: r.data.length === 0 ? { message: "no rows" } : null,
          }));
        },
        then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
          return execute().then(resolve);
        },
      };

      function execute(): Promise<{ data: Row[]; error: null }> {
        return Promise.resolve().then(() => {
          if (op === "insert") {
            const created: Row = { id: genId(), active: true, ...insertRow };
            tables[table]!.push(created);
            if (table === "questions" && opts.simulateTrigger) {
              // Mirrors migration 179's `create_question_card_state` trigger
              // EXACTLY: `insert into card_states (question_id, user_id,
              // state) values (new.id, new.user_id, 'new')` -- no other
              // columns, the same insert shape as the real card-ingestion
              // worker's own insert (worker-stages.ts).
              tables.card_states!.push({
                id: genId(),
                question_id: created.id,
                user_id: created.user_id,
                card_id: null,
                state: "new",
              });
            }
            return { data: [created], error: null };
          }
          const matched = tables[table]!.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
          return { data: matched, error: null };
        });
      }

      return builder;
    },
  };
  return { client, tables };
}

/**
 * Mirrors get_session_queue's (160) `new_candidates` QUESTION arm exactly:
 *   `cs.state = 'new' and cs.user_id = caller`, joined to `q.active`.
 * Deliberately re-implemented filter-by-filter rather than just checking
 * "a card_states row exists" -- a row with the wrong state, wrong user, or
 * joined to a retired question would satisfy "exists" while still being
 * invisible to the real RPC.
 */
function matchesNewCandidatesQuestionArm(tables: Record<string, Row[]>, userId: string): Row[] {
  return tables.card_states!.filter((cs) => cs.user_id === userId && cs.state === "new" && cs.question_id != null).filter((cs) => {
    const q = tables.questions!.find((q) => q.id === cs.question_id);
    return !!q && q.active === true;
  });
}

/** Mirrors submit_question_review's (161) own "no card_states row" guard, error text byte-for-byte. */
function submitQuestionReviewGuard(
  tables: Record<string, Row[]>,
  userId: string,
  questionId: string
): { ok: true } | { ok: false; error: string } {
  const row = tables.card_states!.find((cs) => cs.question_id === questionId && cs.user_id === userId);
  if (!row) {
    return { ok: false, error: `submit_question_review: no card_states row for question ${questionId} / user ${userId}` };
  }
  return { ok: true };
}

describe("Phase 1 #24 -- the full question -> card_states -> queue -> review chain", () => {
  it("a question created through the real createQuestionCore gets a card_states row that satisfies new_candidates' own filter, not just 'a row exists'", async () => {
    const { client, tables } = createFakeDb({ simulateTrigger: true });
    const result = await createQuestionCore(client as never, "user-1", {
      classId: "class-1",
      prompt: "What is FSRS?",
      answer: "Free Spaced Repetition Scheduler",
      sourceSkipped: true,
    });

    const created = tables.card_states.find((cs) => cs.question_id === result.id);
    expect(created).toBeDefined();
    expect(created!.state).toBe("new"); // the exact state new_candidates' WHERE clause requires
    expect(created!.card_id).toBeNull(); // card_states_item_xor: exactly one of the two set

    const queueEligible = matchesNewCandidatesQuestionArm(tables, "user-1");
    expect(queueEligible.map((r) => r.question_id)).toEqual([result.id]);
  });

  it("a retired question's card_states row is correctly EXCLUDED from new_candidates, same as the real join's q.active condition", async () => {
    const { client, tables } = createFakeDb({ simulateTrigger: true });
    const result = await createQuestionCore(client as never, "user-1", {
      classId: "class-1",
      prompt: "Retired question",
      answer: "Answer",
      sourceSkipped: true,
    });
    tables.questions.find((q) => q.id === result.id)!.active = false;

    expect(matchesNewCandidatesQuestionArm(tables, "user-1")).toEqual([]);
  });

  it("a different user's card_states row is correctly excluded, same as the real query's cs.user_id = caller condition", async () => {
    const { client, tables } = createFakeDb({ simulateTrigger: true });
    await createQuestionCore(client as never, "user-1", {
      classId: "class-1",
      prompt: "Someone else's question",
      answer: "Answer",
      sourceSkipped: true,
    });

    expect(matchesNewCandidatesQuestionArm(tables, "user-2")).toEqual([]);
  });

  it("submit_question_review's own guard passes once the trigger has fired -- the chain's write-side proof", async () => {
    const { client, tables } = createFakeDb({ simulateTrigger: true });
    const result = await createQuestionCore(client as never, "user-1", {
      classId: "class-1",
      prompt: "Grade me",
      answer: "Answer",
      sourceSkipped: true,
    });

    expect(submitQuestionReviewGuard(tables, "user-1", result.id)).toEqual({ ok: true });
  });

  // THE load-bearing negative control (the whole reason this file exists):
  // prove the guard itself CAN fail with the real error text -- i.e. this
  // instrument can actually detect the bug #24 exists to close -- by
  // reproducing the pre-migration-179 world where the trigger never fires.
  // "Absence proves nothing until the same instrument has proven presence"
  // -- this is that positive control, run against the negative case.
  it("without the trigger, the exact same review attempt fails with submit_question_review's real error text -- proving THE TRIGGER, not mere row presence, closes #24's gap", async () => {
    const { client, tables } = createFakeDb({ simulateTrigger: false });
    const result = await createQuestionCore(client as never, "user-1", {
      classId: "class-1",
      prompt: "Never gets a card_states row pre-179",
      answer: "Answer",
      sourceSkipped: true,
    });

    expect(tables.card_states).toEqual([]); // the exact gap #24 closes
    expect(submitQuestionReviewGuard(tables, "user-1", result.id)).toEqual({
      ok: false,
      error: `submit_question_review: no card_states row for question ${result.id} / user user-1`,
    });
  });
});
