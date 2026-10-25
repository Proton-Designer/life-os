import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const { stageItemsForJob } = await import("../stage-for-job");

const JOB = "22222222-2222-4222-8222-222222222222";
const CLASS = "11111111-1111-4111-8111-111111111111";
const ITEMS = [{ name: "Midterm", type: "exam" as const, date: "2026-11-05", confidence: 0.9, sourceSnippet: null }];

/** A tiny in-memory staging_batches / staged_deliverables, with the partial unique index on (user_id, agent_job_id). */
function db() {
  const batches: { id: string; user_id: string; agent_job_id: string | null; source: string; raw_text: string | null }[] = [];
  const items: { batch_id: string }[] = [];
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn((_c?: string, opts?: { count?: string; head?: boolean }) => {
      chain._count = opts?.head ? true : false;
      return chain;
    });
    chain.eq = vi.fn((c: string, v: unknown) => ((eq[c] = v), chain));
    chain.maybeSingle = vi.fn(async () => {
      const row = batches.find((b) => b.user_id === eq.user_id && b.agent_job_id === eq.agent_job_id);
      return { data: row ? { id: row.id } : null, error: null };
    });
    chain.insert = vi.fn((row: Record<string, unknown> | Record<string, unknown>[]) => {
      if (table === "staging_batches") {
        const r = row as Record<string, unknown>;
        if (r.agent_job_id && batches.some((b) => b.user_id === r.user_id && b.agent_job_id === r.agent_job_id)) {
          return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) };
        }
        const id = `batch-${batches.length + 1}`;
        batches.push({ id, user_id: r.user_id as string, agent_job_id: (r.agent_job_id as string) ?? null, source: r.source as string, raw_text: (r.raw_text as string) ?? null });
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      }
      for (const r of row as { batch_id: string }[]) items.push({ batch_id: r.batch_id });
      return Promise.resolve({ error: null });
    });
    // head count of a batch's items
    chain.then = (resolve: (v: unknown) => void) => resolve({ count: items.filter((i) => i.batch_id === eq.batch_id).length, error: null });
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient, batches, items };
}

describe("stageItemsForJob — a job is applied at most once", () => {
  it("creates one batch carrying the job id, with its items", async () => {
    const { client, batches, items } = db();
    const id = await stageItemsForJob(client, "u1", { jobId: JOB, classId: CLASS, source: "announcement", rawText: "moved", items: ITEMS });
    expect(id).toBe("batch-1");
    expect(batches).toEqual([{ id: "batch-1", user_id: "u1", agent_job_id: JOB, source: "announcement", raw_text: "moved" }]);
    expect(items).toHaveLength(1);
  });

  it("THE EDGE: applying the same job a second time (complete_agent_job failed, the sweep re-queued it) creates no second batch and no second items", async () => {
    const { client, batches, items } = db();
    const first = await stageItemsForJob(client, "u1", { jobId: JOB, classId: CLASS, source: "announcement", rawText: "moved", items: ITEMS });
    const second = await stageItemsForJob(client, "u1", { jobId: JOB, classId: CLASS, source: "announcement", rawText: "moved", items: ITEMS });
    expect(second).toBe(first);
    expect(batches).toHaveLength(1);
    expect(items).toHaveLength(1);
  });

  it("a crash between the batch and its items is repaired by the retry (items added once, not twice)", async () => {
    const { client, batches, items } = db();
    batches.push({ id: "batch-0", user_id: "u1", agent_job_id: JOB, source: "syllabus", raw_text: null }); // batch exists, items never inserted
    const id = await stageItemsForJob(client, "u1", { jobId: JOB, classId: CLASS, source: "syllabus", items: ITEMS });
    expect(id).toBe("batch-0");
    expect(items).toHaveLength(1);
    await stageItemsForJob(client, "u1", { jobId: JOB, classId: CLASS, source: "syllabus", items: ITEMS });
    expect(items).toHaveLength(1);
  });

  it("a different job (or a different user's same job id) is a different batch", async () => {
    const { client, batches } = db();
    await stageItemsForJob(client, "u1", { jobId: JOB, classId: CLASS, source: "announcement", items: ITEMS });
    await stageItemsForJob(client, "u1", { jobId: "33333333-3333-4333-8333-333333333333", classId: CLASS, source: "announcement", items: ITEMS });
    await stageItemsForJob(client, "u2", { jobId: JOB, classId: CLASS, source: "announcement", items: ITEMS });
    expect(batches).toHaveLength(3);
  });
});
