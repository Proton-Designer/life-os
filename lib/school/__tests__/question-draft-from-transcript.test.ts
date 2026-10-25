import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftQuestionsFromTranscript } from "../question-draft-from-transcript";
import * as gatewayModule from "@/lib/ai/gateway";
import type { GatewayChatResult } from "@/lib/ai/gateway";

// Same mocking posture as question-draft-generation.test.ts: mock
// gatewayChat itself, zero network, zero spend, never assume which
// provider answered.
const FAKE_SUPABASE = {} as unknown as SupabaseClient;
const USER_ID = "u-test-1";

function draftsJson(n: number): string {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({ prompt: `Q${i}`, answer: `A${i}`, topic: null, sourceSnippet: null })),
  );
}
function okResult(content: string): GatewayChatResult {
  return { ok: true, content, attempts: 1, keySource: "server" };
}
function noKeyResult(): GatewayChatResult {
  return { ok: false, message: "AI features aren't enabled for this account." };
}
function monthlyCapBlockedResult(): GatewayChatResult {
  return { ok: false, message: "Over this month's budget", monthlyCapBlocked: true };
}

let gatewayChatSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gatewayChatSpy = vi.spyOn(gatewayModule, "gatewayChat");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("draftQuestionsFromTranscript", () => {
  it("a short transcript (one chunk) drafts in a single gatewayChat call, not partial", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(draftsJson(3)));

    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, "a short lecture transcript");

    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "drafted", drafts: expect.any(Array), partial: false });
    if (result.status === "drafted") expect(result.drafts).toHaveLength(3);
  });

  it("uses the school-question-draft-transcript feature name, tagged content, and no tier/provider override", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("[]"));
    await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, "text");

    const [, , feature, messages, opts] = gatewayChatSpy.mock.calls[0]!;
    expect(feature).toBe("school-question-draft-transcript");
    const userMessage = (messages as { role: string; content: string }[]).find((m) => m.role === "user");
    expect(userMessage!.content).toContain("<transcript_segment>");
    const o = opts as { tier?: unknown; provider?: unknown };
    expect(o.tier).toBeUndefined();
    expect(o.provider).toBeUndefined();
  });

  it("chunks a long transcript into multiple SEQUENTIAL gatewayChat calls, each with distinct, non-overlapping content", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(draftsJson(1)));
    const longTranscript = Array.from({ length: 45_000 }, (_, i) => `word${i}`).join(" "); // well past one 20k-char chunk

    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, longTranscript);

    expect(gatewayChatSpy.mock.calls.length).toBeGreaterThan(1);
    const chunkContents = gatewayChatSpy.mock.calls.map(
      (call: unknown[]) => (call[3] as { role: string; content: string }[]).find((m) => m.role === "user")!.content,
    );
    // No two chunks are identical -- proves each call got a different slice, not the same text repeated.
    expect(new Set(chunkContents).size).toBe(chunkContents.length);
    expect(result.status).toBe("drafted");
  });

  it("returns no_key immediately without trying further chunks when the first chunk reports no key", async () => {
    gatewayChatSpy.mockResolvedValue(noKeyResult());
    const longTranscript = Array.from({ length: 45_000 }, (_, i) => `word${i}`).join(" ");

    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, longTranscript);

    expect(result).toEqual({ status: "no_key" });
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps earlier chunks' drafts and marks partial when a later chunk hits the monthly spend cap", async () => {
    gatewayChatSpy.mockResolvedValueOnce(okResult(draftsJson(2))).mockResolvedValueOnce(monthlyCapBlockedResult());
    const longTranscript = Array.from({ length: 45_000 }, (_, i) => `word${i}`).join(" ");

    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, longTranscript);

    expect(gatewayChatSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "drafted", drafts: expect.any(Array), partial: true });
    if (result.status === "drafted") expect(result.drafts).toHaveLength(2);
  });

  it("returns parse_failed when the only chunk's response can't be parsed", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("not json at all"));
    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, "short text");
    expect(result).toEqual({ status: "parse_failed" });
  });

  it("caps total drafts across all chunks at 30 and marks the result partial", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(draftsJson(20))); // max per single call, per the shared schema
    const longTranscript = Array.from({ length: 45_000 }, (_, i) => `word${i}`).join(" "); // >=2 chunks

    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, longTranscript);

    expect(result.status).toBe("drafted");
    if (result.status === "drafted") {
      expect(result.drafts.length).toBeLessThanOrEqual(30);
      expect(result.partial).toBe(true);
    }
  });

  it("returns unavailable (not no_key) for a genuine provider failure after a real attempt", async () => {
    gatewayChatSpy.mockResolvedValue({ ok: false, message: "DeepSeek took too long to respond.", attempts: 3 });
    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, "short text");
    expect(result).toEqual({ status: "unavailable" });
  });

  it("empty transcript text returns parse_failed rather than calling gatewayChat with nothing", async () => {
    const result = await draftQuestionsFromTranscript(FAKE_SUPABASE, USER_ID, "");
    expect(result).toEqual({ status: "parse_failed" });
    expect(gatewayChatSpy).not.toHaveBeenCalled();
  });
});
