import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeFakeDb, type FakeDb } from "@/lib/self-mastery/ingestion/__tests__/fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));
vi.mock("../stage-for-job", () => ({ stageItemsForJob: vi.fn() }));
let service: FakeDb;
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => service.client }));

const { submitAgentJobCore, claimAgentJobsCore } = await import("../core");
const { ToolNotFoundError, ToolInputError } = await import("@/lib/mcp/tool-input-error");

const BOOK = "b0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";
const JOB = "22222222-2222-4222-8222-222222222222";
const QUOTE = "Habits are the compound interest of self-improvement.";
const input = { stage: "extracting_lessons", text: `Chapter one. ${QUOTE} Small changes seem to make no difference until you cross a threshold.`, location: "page 3", page_start: 3, page_end: 3, source_chunk_id: "chunk-1", paged: true };
const good = { lessons: [{ title: "Let tiny gains compound", core_claim: "Repeated slight improvements add up to a large payoff much later.", mechanism: "Each gain builds on the previous one, so progress accelerates.", action_template: "Pick one habit and improve it by a little each day.", provenance_quote: QUOTE }] };

/** The USER client: begin_agent_job_submit hands the claimed job to ONE caller (a compare-and-set); everything else is recorded. */
function userClient(opts: { begin: (calls: number) => unknown }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let begins = 0;
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "begin_agent_job_submit") return { data: opts.begin(++begins), error: null };
      return { data: 1, error: null };
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}
const begun = { id: JOB, kind: "self_mastery.book_stage", subject_type: "book", subject_id: BOOK, input };

beforeEach(() => {
  service = makeFakeDb({
    books: [{ id: BOOK, user_id: USER }],
    ingestion_jobs: [{ id: "ij-1", book_id: BOOK, stage: "extracting_lessons" }],
    source_chunks: [{ id: "chunk-1", book_id: BOOK, section_id: null }],
    lessons: [],
  });
});

describe("book_stage through the agent job pipeline", () => {
  it("a valid result is applied to the stage's tables, the ingestion job is released, and the job completes", async () => {
    const { client, calls } = userClient({ begin: () => begun });
    await submitAgentJobCore(client, USER, { id: JOB, result: good, tokenId: "tok" });
    expect(service.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1")).toHaveLength(1);
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "unpark_ingestion_for_book", "complete_agent_job"]);
  });

  it("a SCHEMA-INVALID stage result is rejected with the reason, nothing is written, the ingestion job stays parked, and the job goes back to the agent", async () => {
    const { client, calls } = userClient({ begin: () => begun });
    await expect(submitAgentJobCore(client, USER, { id: JOB, result: { lessons: "nope" }, tokenId: "tok" })).rejects.toThrow(/lessons/);
    expect(service.tables.lessons).toHaveLength(0);
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "reject_agent_job_submit"]);
  });

  it("a DOUBLE SUBMIT applies once: the second call finds the job no longer claimed (the database's compare-and-set returned nothing) and writes nothing", async () => {
    const { client, calls } = userClient({ begin: (n) => (n === 1 ? begun : null) });
    await submitAgentJobCore(client, USER, { id: JOB, result: good, tokenId: "tok" });
    await expect(submitAgentJobCore(client, USER, { id: JOB, result: good, tokenId: "tok" })).rejects.toBeInstanceOf(ToolNotFoundError);
    expect(service.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1")).toHaveLength(1);
    expect(calls.filter((c) => c.fn === "complete_agent_job")).toHaveLength(1);
  });

  it("ANOTHER USER'S job: begin returns nothing for a job that is not the caller's, so nothing is read, written or released", async () => {
    const { client, calls } = userClient({ begin: () => null });
    await expect(submitAgentJobCore(client, "someone-else", { id: JOB, result: good, tokenId: "tok" })).rejects.toBeInstanceOf(ToolNotFoundError);
    expect(service.tables.lessons).toHaveLength(0);
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit"]);
  });

  it("a book that is not the job owner's is never written to, even if a job somehow pointed at it", async () => {
    service.tables.books![0]!.user_id = "someone-else";
    const { client, calls } = userClient({ begin: () => begun });
    await expect(submitAgentJobCore(client, USER, { id: JOB, result: good, tokenId: "tok" })).rejects.toBeInstanceOf(ToolInputError);
    expect(service.tables.lessons).toHaveLength(0);
    expect(calls.map((c) => c.fn)).toContain("reject_agent_job_submit");
  });
});

describe("claim returns a book step with its stage's instructions", () => {
  it("instructions are built from the stage (not the passage), the passage rides in untrusted_input, and the output schema is the stage's", async () => {
    const client = { rpc: async () => ({ data: [{ id: JOB, kind: "self_mastery.book_stage", subject_type: "book", subject_id: BOOK, input, attempts: 1, lease_until: "x" }], error: null }) } as unknown as SupabaseClient;
    const [j] = await claimAgentJobsCore(client, { kind: "self_mastery.book_stage", limit: 10, tokenId: "tok" });
    expect(j!.instructions).toMatch(/copied verbatim/);
    expect(j!.instructions).toMatch(/untrusted/i);
    expect(j!.instructions).not.toContain("Small changes seem to make no difference");
    expect(j!.untrusted_input).toMatchObject({ text: expect.stringContaining("Small changes") });
    expect(j!.output_schema).toContain('"lessons"');
  });

  it("a batch claim of 10 book steps is allowed", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await claimAgentJobsCore({ rpc } as unknown as SupabaseClient, { kind: "self_mastery.book_stage", limit: 10, tokenId: "tok" });
    expect(rpc).toHaveBeenCalledWith("claim_agent_jobs", expect.objectContaining({ p_limit: 10 }));
  });
});
