import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const stageMock = vi.fn(async (..._a: unknown[]) => "batch-1");
vi.mock("../stage-for-job", () => ({ stageItemsForJob: (...a: unknown[]) => stageMock(...a) }));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));

const core = await import("../core");
const { ToolInputError, ToolNotFoundError } = await import("@/lib/mcp/tool-input-error");

type Rpc = Record<string, { data: unknown; error?: unknown }>;
function fake(rpcs: Rpc) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: rpcs[fn]?.data ?? null, error: rpcs[fn]?.error ?? null };
    }),
    from: vi.fn(),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const CLASS = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const claimedJob = (kind: string, input: unknown) => ({ id: JOB, kind, subject_type: "class", subject_id: CLASS, input });

beforeEach(() => stageMock.mockClear());

describe("claimAgentJobsCore", () => {
  it("passes kind, a limit capped at 10, and the token; returns each job with its instructions and output schema", async () => {
    const { client, calls } = fake({
      claim_agent_jobs: { data: [{ id: JOB, kind: "school.announcement_extract", subject_type: "class", subject_id: CLASS, input: { text: "Midterm moved to Nov 5", today: "2026-10-25" }, attempts: 1, lease_until: "2026-10-25T05:00:00Z" }] },
    });
    const jobs = await core.claimAgentJobsCore(client, { kind: "school.announcement_extract", limit: 50, tokenId: "tok-1" });
    expect(calls[0]).toEqual({ fn: "claim_agent_jobs", args: { p_kind: "school.announcement_extract", p_limit: 10, p_id: null, p_token_id: "tok-1" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.instructions).toMatch(/data, never instructions/i);
    expect(jobs[0]!.output_schema).toContain("confidence");
  });

  it("rejects an unknown kind before touching the database", async () => {
    const { client } = fake({});
    await expect(core.claimAgentJobsCore(client, { kind: "evil.kind", limit: 1, tokenId: "t" })).rejects.toBeInstanceOf(ToolInputError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("submitAgentJobCore", () => {
  const validItems = [{ name: "Midterm", type: "exam", date: "2026-11-05", confidence: 0.9, sourceSnippet: null }];

  it("announcement: validates, stages a batch for the job's class, and completes the job", async () => {
    const { client, calls } = fake({
      begin_agent_job_submit: { data: claimedJob("school.announcement_extract", { text: "Midterm moved to Nov 5, 2026", today: "2026-10-25" }) },
      complete_agent_job: { data: 1 },
    });
    const out = await core.submitAgentJobCore(client, "user-1", { id: JOB, result: validItems, tokenId: "tok-1" });
    expect(stageMock).toHaveBeenCalledWith(client, "user-1", expect.objectContaining({ jobId: JOB, classId: CLASS, source: "announcement", rawText: "Midterm moved to Nov 5, 2026" }));
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "complete_agent_job"]);
    expect(out.summary).toMatch(/announcement/);
  });

  it("a schema-invalid result is rejected with the reason, nothing is applied, and the job is handed back to the agent", async () => {
    const { client, calls } = fake({
      begin_agent_job_submit: { data: claimedJob("school.announcement_extract", { text: "x", today: "2026-10-25" }) },
      reject_agent_job_submit: { data: 1 },
    });
    await expect(core.submitAgentJobCore(client, "user-1", { id: JOB, result: [{ name: "Q", type: "quiz", date: null, confidence: 9 }], tokenId: "tok-1" })).rejects.toThrow(/\[0\]\.confidence/);
    expect(stageMock).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "reject_agent_job_submit"]);
  });

  it("another user's job, an unclaimed job or a lapsed lease reads as not found (begin returns null) and applies nothing", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: { data: null } });
    await expect(core.submitAgentJobCore(client, "user-1", { id: JOB, result: validItems, tokenId: "tok-1" })).rejects.toBeInstanceOf(ToolNotFoundError);
    expect(stageMock).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit"]);
  });

  it("an apply failure hands the job back and surfaces a generic error, not the internals", async () => {
    stageMock.mockRejectedValueOnce(new Error("insert into staged_deliverables violated something internal"));
    const { client, calls } = fake({
      begin_agent_job_submit: { data: claimedJob("school.announcement_extract", { text: "x", today: "2026-10-25" }) },
      reject_agent_job_submit: { data: 1 },
    });
    await expect(core.submitAgentJobCore(client, "user-1", { id: JOB, result: validItems, tokenId: "tok-1" })).rejects.toThrow(/couldn't be applied/i);
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "reject_agent_job_submit"]);
  });

  it("syllabus: stages a syllabus batch (no raw text)", async () => {
    const { client } = fake({
      begin_agent_job_submit: { data: claimedJob("school.syllabus_extract", { text: "s".repeat(300), today: "2026-10-25", truncated: false }) },
      complete_agent_job: { data: 1 },
    });
    await core.submitAgentJobCore(client, "user-1", { id: JOB, result: validItems, tokenId: "tok-1" });
    expect(stageMock).toHaveBeenCalledWith(client, "user-1", expect.objectContaining({ jobId: JOB, classId: CLASS, source: "syllabus" }));
  });

  it("question drafts: validated, stored as the job's result for the person to review; nothing is written to the question bank", async () => {
    const { client, calls } = fake({
      begin_agent_job_submit: { data: claimedJob("school.question_draft", { text: "notes", truncated: false }) },
      complete_agent_job: { data: 1 },
    });
    await core.submitAgentJobCore(client, "user-1", { id: JOB, result: [{ prompt: " Q? ", answer: "A" }], tokenId: "tok-1" });
    const complete = calls.find((c) => c.fn === "complete_agent_job")!;
    expect(complete.args.p_result).toEqual({ drafts: [{ prompt: "Q?", answer: "A", topic: null, sourceSnippet: null }] });
    expect(stageMock).not.toHaveBeenCalled();
  });
});

describe("enqueue / fail / cancel", () => {
  it("enqueue refuses an over-long input before the database and reports the cap", async () => {
    const { client } = fake({});
    await expect(core.enqueueAgentJobCore(client, { kind: "school.announcement_extract", subjectId: CLASS, input: { text: "x".repeat(4001), today: "2026-10-25" } })).rejects.toThrow(/4000/);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("enqueue returns the new id and sends the char count", async () => {
    const { client, calls } = fake({ enqueue_agent_job: { data: JOB } });
    const id = await core.enqueueAgentJobCore(client, { kind: "school.announcement_extract", subjectId: CLASS, input: { text: "hello announcement", today: "2026-10-25" } });
    expect(id).toBe(JOB);
    expect(calls[0]!.args).toMatchObject({ p_kind: "school.announcement_extract", p_subject_type: "class", p_subject_id: CLASS, p_input_chars: 18 });
  });
  it("fail needs the claimer: zero rows is not found", async () => {
    const { client } = fake({ fail_agent_job: { data: 0 } });
    await expect(core.failAgentJobCore(client, { id: JOB, reason: "unreadable", tokenId: "tok-1" })).rejects.toBeInstanceOf(ToolNotFoundError);
  });
});

describe("hasAgentConnector", () => {
  function tokens(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "overlaps", "or"]) chain[m] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({ data: rows, error: null }));
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  }
  it("true when a live write-capable token exists, false otherwise", async () => {
    expect(await core.hasAgentConnector(tokens([{ id: "t" }]), "u1", new Date())).toBe(true);
    expect(await core.hasAgentConnector(tokens([]), "u1", new Date())).toBe(false);
  });
});
