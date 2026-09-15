import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQuestionCore, updateQuestionCore, setQuestionActiveCore } from "../questions-core";

type Row = Record<string, unknown>;

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("createQuestionCore", () => {
  it("inserts trimmed prompt/answer/topic with the given class/origin, defaulting origin to self", async () => {
    const chain = makeChain({ data: { id: "q-new" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    const result = await createQuestionCore(client, "user-1", {
      classId: "class-1",
      prompt: "  What is Big-O of binary search?  ",
      answer: "  O(log n)  ",
      topic: "  Complexity  ",
      sourceAnchor: "Ch. 3, p.42",
    });

    expect(from).toHaveBeenCalledWith("questions");
    expect(chain.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      class_id: "class-1",
      prompt: "What is Big-O of binary search?",
      answer: "O(log n)",
      topic: "Complexity",
      source_anchor: "Ch. 3, p.42",
      source_skipped: false,
      origin: "self",
    });
    expect(result).toEqual({ id: "q-new" });
  });

  it("accepts an explicit origin (ai/missed) instead of defaulting", async () => {
    const chain = makeChain({ data: { id: "q-new" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await createQuestionCore(client, "user-1", {
      classId: "class-1",
      prompt: "x",
      answer: "y",
      sourceSkipped: true,
      origin: "missed",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ origin: "missed", source_skipped: true, source_anchor: null }));
  });

  it("rejects an empty (or whitespace-only) prompt before ever calling the database", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createQuestionCore(client, "user-1", { classId: "class-1", prompt: "   ", answer: "y" })
    ).rejects.toThrow("Prompt is required");
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an empty answer before ever calling the database", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createQuestionCore(client, "user-1", { classId: "class-1", prompt: "x", answer: "" })
    ).rejects.toThrow("Answer is required");
    expect(from).not.toHaveBeenCalled();
  });

  // The schema's own invariant (questions_anchor_present_or_skipped, migration
  // 111): enforced here BEFORE the network round-trip, not only trusted to the
  // database CHECK — a bad submission must fail fast.
  it("rejects a missing source anchor that isn't marked skipped, before ever calling the database", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createQuestionCore(client, "user-1", { classId: "class-1", prompt: "x", answer: "y" })
    ).rejects.toThrow("Provide a source anchor, or mark it skipped");
    expect(from).not.toHaveBeenCalled();
  });

  it("clears any stray source_anchor text when sourceSkipped is true, never storing both", async () => {
    const chain = makeChain({ data: { id: "q-new" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await createQuestionCore(client, "user-1", {
      classId: "class-1",
      prompt: "x",
      answer: "y",
      sourceSkipped: true,
      sourceAnchor: "leftover text from a previous edit",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ source_anchor: null, source_skipped: true }));
  });
});

describe("updateQuestionCore", () => {
  it("patches only the fields explicitly provided, scoped to id and user_id", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateQuestionCore(client, "user-1", "q-1", { prompt: "  Updated prompt  " });

    expect(from).toHaveBeenCalledWith("questions");
    expect(chain.update).toHaveBeenCalledWith({ prompt: "Updated prompt" });
    expect(chain.eq).toHaveBeenCalledWith("id", "q-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("rejects an empty prompt in a patch that touches it", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(updateQuestionCore(client, "user-1", "q-1", { prompt: "   " })).rejects.toThrow("Prompt is required");
    expect(from).not.toHaveBeenCalled();
  });

  it("leaves topic/sourceAnchor untouched when omitted, but clears them to null when explicitly set empty", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateQuestionCore(client, "user-1", "q-1", { topic: "", sourceAnchor: "  " });

    expect(chain.update).toHaveBeenCalledWith({ topic: null, source_anchor: null });
  });
});

describe("setQuestionActiveCore", () => {
  it("retires a question (active: false) without deleting it", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await setQuestionActiveCore(client, "user-1", "q-1", false);

    expect(from).toHaveBeenCalledWith("questions");
    expect(chain.update).toHaveBeenCalledWith({ active: false });
    expect(chain.eq).toHaveBeenCalledWith("id", "q-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("is reversible — the same primitive reactivates a retired question", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await setQuestionActiveCore(client, "user-1", "q-1", true);

    expect(chain.update).toHaveBeenCalledWith({ active: true });
  });
});

// Phase 1 #20-22 verification pass (Opus Lead): the tests above are fully
// mocked -- they prove the right SQL methods were called with the right
// arguments, but never prove the composite class-ownership FK or the
// anchor CHECK actually PROTECT anything. This is a small, real in-memory
// database enforcing the SAME invariants migration 111 puts on
// `public.questions` (mirrors staging-core.test.ts's own "not a dumb
// passthrough" convention), so a regression in the composite-FK tenancy
// guard or the anchor invariant fails a TEST, not just a hand-read of the
// migration. A live-DB, read-only positive control (2026-09-14, reported
// to the lead separately) additionally confirmed zero schema drift: the
// CHECK/FK/RLS/index definitions live in production match migration 111
// byte-for-byte, and the exact illegal anchor shape createQuestionCore's
// own validation refuses to ever produce genuinely evaluates to REJECTED
// against the live CHECK expression -- the DB backstop is real, not
// decoration.
describe("createQuestionCore / updateQuestionCore against a stateful, constraint-enforcing fake DB", () => {
  function createFakeDb() {
    const tables: { questions: Row[]; classes: Row[] } = { questions: [], classes: [] };
    let nextId = 0;
    const genId = () => `q-${nextId++}`;

    function checkAnchorInvariant(row: Row) {
      const skipped = row.source_skipped === true;
      const anchor = typeof row.source_anchor === "string" ? row.source_anchor.trim() : "";
      if (!skipped && anchor.length === 0) {
        throw { message: 'new row for relation "questions" violates check constraint "questions_anchor_present_or_skipped"' };
      }
    }

    function checkPromptAnswerNotEmpty(row: Row) {
      if (typeof row.prompt === "string" && row.prompt.trim().length === 0) {
        throw { message: 'new row for relation "questions" violates check constraint "questions_prompt_check"' };
      }
      if (typeof row.answer === "string" && row.answer.trim().length === 0) {
        throw { message: 'new row for relation "questions" violates check constraint "questions_answer_check"' };
      }
    }

    // Mirrors questions_class_id_fkey EXACTLY: a composite (user_id,
    // class_id) -> classes(user_id, id) FK, not a single-column one -- see
    // migration 111's own comment on why the single-column form is
    // exploitable (FK checks bypass RLS; a single-column FK only proves the
    // class EXISTS, never that the caller owns it).
    function checkClassOwnership(userId: unknown, classId: unknown) {
      const owned = tables.classes.some((c) => c.id === classId && c.user_id === userId);
      if (!owned) {
        throw { message: 'insert or update on table "questions" violates foreign key constraint "questions_class_id_fkey"' };
      }
    }

    const client = {
      from(table: "questions") {
        void table;
        const eqFilters: [string, unknown][] = [];
        let op: "select" | "insert" | "update" = "select";
        let insertRow: Row = {};
        let updatePatch: Row = {};

        const builder = {
          select() {
            return builder;
          },
          insert(row: Row) {
            op = "insert";
            insertRow = row;
            return builder;
          },
          update(patch: Row) {
            op = "update";
            updatePatch = patch;
            return builder;
          },
          eq(col: string, val: unknown) {
            eqFilters.push([col, val]);
            return builder;
          },
          single() {
            return execute().then((r) => ({
              data: r.data[0] ?? null,
              error: r.error ?? (r.data.length === 0 ? { message: "no rows" } : null),
            }));
          },
          then<T>(resolve: (v: { data: Row[]; error: unknown }) => T) {
            return execute().then(resolve);
          },
        };

        function execute(): Promise<{ data: Row[]; error: unknown }> {
          return Promise.resolve().then(() => {
            try {
              if (op === "insert") {
                checkClassOwnership(insertRow.user_id, insertRow.class_id);
                const created: Row = {
                  id: genId(),
                  active: true,
                  source_anchor: null,
                  source_skipped: false,
                  topic: null,
                  origin: "self",
                  ...insertRow,
                };
                checkPromptAnswerNotEmpty(created);
                checkAnchorInvariant(created);
                tables.questions.push(created);
                return { data: [created], error: null };
              }
              if (op === "update") {
                const matched = tables.questions.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
                for (const row of matched) {
                  const merged = { ...row, ...updatePatch };
                  checkPromptAnswerNotEmpty(merged);
                  checkAnchorInvariant(merged);
                }
                matched.forEach((r) => Object.assign(r, updatePatch));
                return { data: matched, error: null };
              }
              const matched = tables.questions.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
              return { data: matched, error: null };
            } catch (e) {
              return { data: [], error: e };
            }
          });
        }

        return builder;
      },
    };
    return { client, tables };
  }

  it("a question anchored to a class the caller doesn't own is rejected by the SAME composite FK the schema relies on for tenancy -- not merely 'the class exists'", async () => {
    const { client, tables } = createFakeDb();
    tables.classes.push({ id: "class-1", user_id: "user-B" }); // owned by someone else

    await expect(
      createQuestionCore(client as unknown as SupabaseClient, "user-A", {
        classId: "class-1",
        prompt: "x",
        answer: "y",
        sourceSkipped: true,
      })
    ).rejects.toBeTruthy();
    expect(tables.questions).toEqual([]);
  });

  it("a question anchored to the caller's own class is accepted and actually lands", async () => {
    const { client, tables } = createFakeDb();
    tables.classes.push({ id: "class-1", user_id: "user-A" });

    const result = await createQuestionCore(client as unknown as SupabaseClient, "user-A", {
      classId: "class-1",
      prompt: "x",
      answer: "y",
      sourceSkipped: true,
    });

    expect(tables.questions).toHaveLength(1);
    expect(result.id).toBe(tables.questions[0]!.id);
  });

  it("a caller updating a DIFFERENT user's question id is a real no-op -- the row is untouched, not a leak and not an error", async () => {
    const { client, tables } = createFakeDb();
    tables.classes.push({ id: "class-1", user_id: "user-A" });
    tables.questions.push({
      id: "q-1", user_id: "user-A", class_id: "class-1",
      prompt: "Original", answer: "y", source_anchor: null, source_skipped: true, active: true,
    });

    await updateQuestionCore(client as unknown as SupabaseClient, "user-B", "q-1", { prompt: "Hijacked" });

    expect(tables.questions.find((q) => q.id === "q-1")!.prompt).toBe("Original");
  });

  it("the owning user's update actually lands", async () => {
    const { client, tables } = createFakeDb();
    tables.classes.push({ id: "class-1", user_id: "user-A" });
    tables.questions.push({
      id: "q-1", user_id: "user-A", class_id: "class-1",
      prompt: "Original", answer: "y", source_anchor: null, source_skipped: true, active: true,
    });

    await updateQuestionCore(client as unknown as SupabaseClient, "user-A", "q-1", { prompt: "Updated" });

    expect(tables.questions.find((q) => q.id === "q-1")!.prompt).toBe("Updated");
  });

  // updateQuestionCore's own doc is explicit that it does NOT
  // cross-validate sourceAnchor/sourceSkipped against each other, deferring
  // to "the database's own CHECK... the final word". This proves that
  // backstop is real: a patch that clears the anchor without marking it
  // skipped is rejected, not silently written into an illegal state.
  it("a patch that would leave the row in an illegal anchor state is rejected by the same CHECK the schema enforces", async () => {
    const { client, tables } = createFakeDb();
    tables.classes.push({ id: "class-1", user_id: "user-A" });
    tables.questions.push({
      id: "q-1", user_id: "user-A", class_id: "class-1",
      prompt: "x", answer: "y", source_anchor: "Ch. 1", source_skipped: false, active: true,
    });

    await expect(
      updateQuestionCore(client as unknown as SupabaseClient, "user-A", "q-1", { sourceAnchor: "" })
    ).rejects.toBeTruthy();
  });
});
