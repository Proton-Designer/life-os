import { describe, expect, it } from "vitest";
import { confirmStagingBatchCore, updateStagedDeliverableCore, deleteStagedDeliverableCore, createStagingBatchCore } from "../staging-core";

type Row = Record<string, unknown>;

/**
 * A small, real in-memory database — not a dumb passthrough like
 * get-class-cards.test.ts's own mock — because this suite's whole point is proving two
 * atomic-in-production behaviors (the batch CAS, the per-row conditional stamp) actually
 * hold under real interleaving, not just that the happy path calls the right methods.
 * Mirrors migration 167's own RPCs' SQL semantics directly, including the composite
 * (user_id, id) uniqueness real Postgres would enforce.
 */
function createFakeDb() {
  const tables: Record<string, Row[]> = {
    staging_batches: [],
    staged_deliverables: [],
    class_assessments: [],
    tasks: [],
  };
  // Total inserts ever issued per table, independent of final row count — proves a real
  // race happened (both callers actually inserted) even when the final surviving count
  // looks identical to "no race occurred at all."
  const insertCounts: Record<string, number> = { class_assessments: 0, tasks: 0 };
  let nextId = 0;
  const genId = () => `gen-${nextId++}`;

  function matches(row: Row, eqFilters: [string, unknown][], isNullCols: string[]): boolean {
    return eqFilters.every(([c, v]) => row[c] === v) && isNullCols.every((c) => row[c] == null);
  }

  function from(table: string) {
    const eqFilters: [string, unknown][] = [];
    const isNullCols: string[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let insertRows: Row[] = [];
    let updatePatch: Row = {};

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        eqFilters.push([col, val]);
        return builder;
      },
      is(col: string, _val: null) {
        isNullCols.push(col);
        return builder;
      },
      insert(rows: Row | Row[]) {
        op = "insert";
        insertRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      update(patch: Row) {
        op = "update";
        updatePatch = patch;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      single() {
        return execute().then((r) => {
          if (r.data.length !== 1) return { data: null, error: { message: `expected exactly one row, got ${r.data.length}` } };
          return { data: r.data[0], error: null };
        });
      },
      then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
        return execute().then(resolve);
      },
    };

    function execute(): Promise<{ data: Row[]; error: null }> {
      return Promise.resolve().then(() => {
        if (op === "insert") {
          const created = insertRows.map((r) => ({ id: genId(), ...r }));
          tables[table].push(...created);
          if (table in insertCounts) insertCounts[table]!++;
          return { data: created, error: null };
        }
        const matched = tables[table].filter((r) => matches(r, eqFilters, isNullCols));
        if (op === "update") {
          matched.forEach((r) => Object.assign(r, updatePatch));
          return { data: matched, error: null };
        }
        if (op === "delete") {
          tables[table] = tables[table].filter((r) => !matched.includes(r));
          return { data: matched, error: null };
        }
        return { data: matched, error: null };
      });
    }

    return builder;
  }

  // Mirrors claim_staging_batch's own CAS + resume-report semantics (migration 167).
  async function claimStagingBatch(batchId: string, userId: string): Promise<string | null> {
    const batch = tables.staging_batches.find((b) => b.id === batchId && b.user_id === userId);
    if (!batch) return null;
    if (batch.status === "pending") {
      batch.status = "confirming";
      return "confirming";
    }
    return batch.status as string;
  }

  // Mirrors finalize_staging_batch's own atomic WHERE NOT EXISTS guarantee.
  async function finalizeStagingBatch(batchId: string, userId: string): Promise<boolean> {
    const batch = tables.staging_batches.find((b) => b.id === batchId && b.user_id === userId);
    if (!batch || batch.status !== "confirming") return false;
    const hasUncommitted = tables.staged_deliverables.some((d) => d.batch_id === batchId && d.committed_assessment_id == null);
    if (hasUncommitted) return false;
    batch.status = "confirmed";
    return true;
  }

  const client = {
    from,
    rpc(fn: string, args: { p_batch_id: string }) {
      const userId = "user-1"; // this fake DB is single-tenant; every call uses the same auth.uid()
      if (fn === "claim_staging_batch") {
        return claimStagingBatch(args.p_batch_id, userId).then((data) => ({ data, error: null }));
      }
      if (fn === "finalize_staging_batch") {
        return finalizeStagingBatch(args.p_batch_id, userId).then((data) => ({ data, error: null }));
      }
      throw new Error(`unmocked rpc: ${fn}`);
    },
  };

  return { client, tables, insertCounts };
}

function seedBatch(tables: ReturnType<typeof createFakeDb>["tables"], overrides: Row = {}): Row {
  const batch = { id: "batch-1", user_id: "user-1", class_id: "class-1", source: "syllabus", status: "pending", ...overrides };
  tables.staging_batches.push(batch);
  return batch;
}

function seedDeliverable(tables: ReturnType<typeof createFakeDb>["tables"], overrides: Row = {}): Row {
  const row = {
    id: `sd-${tables.staged_deliverables.length + 1}`,
    user_id: "user-1",
    batch_id: "batch-1",
    name: "Midterm",
    type: "exam",
    date: "2026-10-06",
    confidence: 0.9,
    committed_assessment_id: null,
    ...overrides,
  };
  tables.staged_deliverables.push(row);
  return row;
}

describe("confirmStagingBatchCore", () => {
  it("happy path: commits every dated row and finalizes the batch", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", name: "Midterm" });
    seedDeliverable(tables, { id: "sd-2", name: "Final" });

    const result = await confirmStagingBatchCore(client as never, "user-1", "batch-1");

    expect(result.status).toBe("confirmed");
    expect(result.committedCount).toBe(2);
    expect(result.remaining).toEqual([]);
    expect(tables.staged_deliverables.every((d) => d.committed_assessment_id != null)).toBe(true);
    expect(tables.class_assessments).toHaveLength(2);
    expect(tables.staging_batches[0]!.status).toBe("confirmed");
  });

  it("no_date rows block finalize but don't stop the resolvable rows from committing", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", name: "Has a date", date: "2026-10-06" });
    seedDeliverable(tables, { id: "sd-2", name: "No date yet", date: null });

    const result = await confirmStagingBatchCore(client as never, "user-1", "batch-1");

    expect(result.status).toBe("confirming");
    expect(result.committedCount).toBe(1);
    expect(result.remaining).toEqual([{ id: "sd-2", name: "No date yet", reason: "no_date" }]);
    expect(tables.class_assessments).toHaveLength(1);
    expect(tables.staging_batches[0]!.status).toBe("confirming");
  });

  it("a zero-child batch confirms on its first call — Phase 1 #19's success state, not an error", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);

    const result = await confirmStagingBatchCore(client as never, "user-1", "batch-1");

    expect(result.status).toBe("confirmed");
    expect(result.committedCount).toBe(0);
    expect(result.remaining).toEqual([]);
  });

  it("calling confirm again on an already-confirmed batch is a no-op, not an error", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables, { status: "confirmed" });

    const result = await confirmStagingBatchCore(client as never, "user-1", "batch-1");

    expect(result.status).toBe("confirmed");
    expect(result.committedCount).toBe(0);
  });

  // The whole reason for the three-state design (Opus Lead's required change): a crash
  // mid-commit must be resumable, filling only the gap, not re-processing what already
  // landed.
  it("resumes a confirming batch: fills only the still-uncommitted row, leaves the already-committed one alone", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables, { status: "confirming" });
    // sd-1 already committed by a prior (crashed) attempt.
    const existingAssessment = { id: "existing-assessment", user_id: "user-1", class_id: "class-1", name: "Already done" };
    tables.class_assessments.push(existingAssessment);
    seedDeliverable(tables, { id: "sd-1", name: "Already done", committed_assessment_id: "existing-assessment" });
    seedDeliverable(tables, { id: "sd-2", name: "Still pending" });

    const result = await confirmStagingBatchCore(client as never, "user-1", "batch-1");

    expect(result.status).toBe("confirmed");
    // Only the ONE gap got committed by this call — the already-done row's own count
    // isn't attributed to this call.
    expect(result.committedCount).toBe(1);
    // No second assessment was created for sd-1 — still exactly the one that was already
    // there plus the one new one for sd-2.
    expect(tables.class_assessments).toHaveLength(2);
    expect(tables.class_assessments.find((a) => a.id === "existing-assessment")).toBeDefined();
    const sd1 = tables.staged_deliverables.find((d) => d.id === "sd-1")!;
    expect(sd1.committed_assessment_id).toBe("existing-assessment"); // untouched
  });

  // Opus Lead's explicit ask: assert the assessment COUNT, not just the return value.
  it("two genuinely concurrent confirms on one pending batch produce exactly one assessment per staged row, never two", async () => {
    const { client, tables, insertCounts } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", name: "Only one of me" });

    const [resultA, resultB] = await Promise.all([
      confirmStagingBatchCore(client as never, "user-1", "batch-1"),
      confirmStagingBatchCore(client as never, "user-1", "batch-1"),
    ]);

    // Proves a REAL race happened — both concurrent callers actually inserted — rather
    // than one call finishing entirely before the other started (which would trivially
    // also leave a final count of 1, without ever exercising the cleanup path at all).
    expect(insertCounts.class_assessments).toBe(2);
    expect(insertCounts.tasks).toBe(2);
    // ...and exactly one class_assessments row survives — the loser's own insert was
    // detected (via the conditional stamp affecting zero rows) and deleted, not left
    // behind as a duplicate.
    expect(tables.class_assessments).toHaveLength(1);
    expect(tables.tasks).toHaveLength(1); // its linked task, same cleanup
    // Exactly one of the two calls actually committed it; the other saw zero rows
    // affected by its own conditional stamp and backed off.
    expect(resultA.committedCount + resultB.committedCount).toBe(1);
    const sd1 = tables.staged_deliverables.find((d) => d.id === "sd-1")!;
    expect(sd1.committed_assessment_id).toBe(tables.class_assessments[0]!.id);
    expect(tables.staging_batches[0]!.status).toBe("confirmed");
  });
});

describe("updateStagedDeliverableCore", () => {
  it("corrects a staged item's name/type/date before confirm", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", name: "Wrong name", type: "homework_assignment", date: null });

    await updateStagedDeliverableCore(client as never, "user-1", "sd-1", { name: "Midterm Exam", type: "exam", date: "2026-10-06" });

    const row = tables.staged_deliverables.find((d) => d.id === "sd-1")!;
    expect(row).toMatchObject({ name: "Midterm Exam", type: "exam", date: "2026-10-06" });
  });

  it("accepts a null date — #17's no-guessing rule applies to the correction too, not just the original extraction", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", date: "2026-10-06" });

    await updateStagedDeliverableCore(client as never, "user-1", "sd-1", { name: "Midterm", type: "exam", date: null });

    expect(tables.staged_deliverables.find((d) => d.id === "sd-1")!.date).toBeNull();
  });

  it("refuses to edit a row that's already committed — committed_assessment_id is set exactly once", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", name: "Original", committed_assessment_id: "already-committed" });

    await updateStagedDeliverableCore(client as never, "user-1", "sd-1", { name: "Should not land", type: "exam", date: "2026-10-06" });

    expect(tables.staged_deliverables.find((d) => d.id === "sd-1")!.name).toBe("Original");
  });
});

describe("deleteStagedDeliverableCore", () => {
  it("rejecting a staged item is a plain delete", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1" });
    seedDeliverable(tables, { id: "sd-2" });

    await deleteStagedDeliverableCore(client as never, "user-1", "sd-1");

    expect(tables.staged_deliverables.map((d) => d.id)).toEqual(["sd-2"]);
  });

  it("refuses to delete a row that's already committed", async () => {
    const { client, tables } = createFakeDb();
    seedBatch(tables);
    seedDeliverable(tables, { id: "sd-1", committed_assessment_id: "already-committed" });

    await deleteStagedDeliverableCore(client as never, "user-1", "sd-1");

    expect(tables.staged_deliverables).toHaveLength(1);
  });
});

describe("createStagingBatchCore (P2-07)", () => {
  it("a syllabus batch omits rawText -- raw_text stays null", async () => {
    const { client, tables } = createFakeDb();
    const batchId = await createStagingBatchCore(client as never, "user-1", "class-1", "syllabus");
    const row = tables.staging_batches.find((b) => b.id === batchId)!;
    expect(row.source).toBe("syllabus");
    expect(row.raw_text).toBeNull();
  });

  it("an announcement batch stores the given rawText", async () => {
    const { client, tables } = createFakeDb();
    const batchId = await createStagingBatchCore(client as never, "user-1", "class-1", "announcement", "Quiz moved to Friday.");
    const row = tables.staging_batches.find((b) => b.id === batchId)!;
    expect(row.source).toBe("announcement");
    expect(row.raw_text).toBe("Quiz moved to Friday.");
  });
});
