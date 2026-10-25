import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const hasAnyAiKeyMock = vi.fn();
vi.mock("@/lib/ai/resolve-key", () => ({ hasAnyAiKey: (...a: unknown[]) => hasAnyAiKeyMock(...a) }));
const hasConnectorMock = vi.fn();
vi.mock("../core", () => ({ hasAgentConnector: (...a: unknown[]) => hasConnectorMock(...a) }));

const { routeAiRequest } = await import("../route");
const { listAgentJobsForSubject } = await import("../queries");
const client = {} as SupabaseClient;

describe("routeAiRequest — the key stays the fast path, the queue is only the fallback", () => {
  it.each([
    [true, true, "inline"],
    [true, false, "inline"],
    [false, true, "queue"],
    [false, false, "none"],
  ])("key=%s connector=%s -> %s", async (key, connector, expected) => {
    hasAnyAiKeyMock.mockResolvedValue(key);
    hasConnectorMock.mockResolvedValue(connector);
    expect(await routeAiRequest(client, "u1", new Date())).toBe(expected);
  });

  it("does not even look for a connector when there is a key", async () => {
    hasAnyAiKeyMock.mockResolvedValue(true);
    hasConnectorMock.mockClear();
    await routeAiRequest(client, "u1", new Date());
    expect(hasConnectorMock).not.toHaveBeenCalled();
  });
});

describe("listAgentJobsForSubject", () => {
  function rows(data: unknown[]) {
    const eqs: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((c: string, v: unknown) => ((eqs[c] = v), chain));
    chain.in = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(async () => ({ data, error: null }));
    return { c: { from: vi.fn(() => chain) } as unknown as SupabaseClient, eqs };
  }

  it("scopes to the user and class, and shapes live, failed and ready-drafts jobs", async () => {
    const { c, eqs } = rows([
      { id: "a", kind: "school.announcement_extract", status: "pending", created_at: "2026-10-25T14:05:00Z", error: null, result: null },
      { id: "b", kind: "school.syllabus_extract", status: "failed", created_at: "2026-10-25T14:00:00Z", error: "Unreadable.", result: null },
      { id: "c", kind: "school.question_draft", status: "done", created_at: "2026-10-25T13:00:00Z", error: null, result: { drafts: [{ prompt: "Q", answer: "A", topic: null, sourceSnippet: null }] } },
      { id: "d", kind: "school.announcement_extract", status: "done", created_at: "2026-10-25T12:00:00Z", error: null, result: { batchId: "x", itemCount: 2 } },
    ]);
    const jobs = await listAgentJobsForSubject(c, "u1", { subjectId: "class-1" });
    expect(eqs).toMatchObject({ user_id: "u1", subject_id: "class-1" });
    expect(jobs.map((j) => [j.id, j.state])).toEqual([["c", "ready_drafts"], ["b", "failed"], ["a", "waiting"]]); // oldest first; a done extraction needs no card: its batch is on the page
    expect(jobs[0]!.drafts).toHaveLength(1);
    expect(jobs[1]!.error).toBe("Unreadable.");
  });

  it("claimed / applying read as 'working'; a read error reads as nothing", async () => {
    const { c } = rows([
      { id: "a", kind: "school.syllabus_extract", status: "claimed", created_at: "2026-10-25T14:05:00Z", error: null, result: null },
      { id: "b", kind: "school.syllabus_extract", status: "applying", created_at: "2026-10-25T14:06:00Z", error: null, result: null },
    ]);
    expect((await listAgentJobsForSubject(c, "u1", { subjectId: "c" })).map((j) => j.state)).toEqual(["working", "working"]);
    const bad = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ is: () => ({ order: async () => ({ data: null, error: { message: "x" } }) }) }) }) }) }) }) } as unknown as SupabaseClient;
    expect(await listAgentJobsForSubject(bad, "u1", { subjectId: "c" })).toEqual([]);
  });
});
