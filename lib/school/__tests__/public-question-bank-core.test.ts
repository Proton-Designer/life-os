import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicQuestionBankCore } from "../public-question-bank-core";
import { hashShareToken } from "../class-share-core";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const RAW_TOKEN = "a-real-share-token";

// P3-08: no-enumeration is the whole point of this module -- every one of
// these three describe blocks must produce the identical `null`.
describe("getPublicQuestionBankCore — no-enumeration contract", () => {
  it("returns null for an unknown token (no matching share row at all)", async () => {
    const shareChain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => shareChain) } as unknown as SupabaseClient;

    const result = await getPublicQuestionBankCore(client, RAW_TOKEN);

    expect(result).toBeNull();
    expect(shareChain.eq).toHaveBeenCalledWith("token_hash", hashShareToken(RAW_TOKEN));
    expect(shareChain.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("returns null for a revoked token -- the query itself filters revoked_at is null, so a revoked row never matches", async () => {
    // A revoked row is invisible to this query (is("revoked_at", null)),
    // so the mock correctly returns nothing found, same as "unknown".
    const shareChain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => shareChain) } as unknown as SupabaseClient;

    const result = await getPublicQuestionBankCore(client, RAW_TOKEN);

    expect(result).toBeNull();
  });

  it("returns null when sharing is off entirely (an empty string token)", async () => {
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    const result = await getPublicQuestionBankCore(client, "");
    expect(result).toBeNull();
    expect(client.from).not.toHaveBeenCalled(); // never even queries for an empty token
  });
});

describe("getPublicQuestionBankCore — happy path", () => {
  it("returns the class name and active-only questions, exact field shape, nothing extra", async () => {
    const shareChain = makeChain({ data: { class_id: "class-1" }, error: null });
    const classChain = makeChain({ data: { short_name: "Orgo II", code: "CHEM 201" }, error: null });
    const questionsChain = makeChain({
      data: [
        { prompt: "p1", answer: "a1", topic: "t1" },
        { prompt: "p2", answer: "a2", topic: null },
      ],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "class_question_shares") return shareChain;
      if (table === "classes") return classChain;
      return questionsChain;
    });
    const client = { from } as unknown as SupabaseClient;

    const result = await getPublicQuestionBankCore(client, RAW_TOKEN);

    expect(result).toEqual({
      className: "Orgo II",
      questions: [
        { prompt: "p1", answer: "a1", topic: "t1" },
        { prompt: "p2", answer: "a2", topic: null },
      ],
    });
    expect(questionsChain.eq).toHaveBeenCalledWith("class_id", "class-1");
    expect(questionsChain.eq).toHaveBeenCalledWith("active", true);
    // The one hard security assertion: nothing in the returned payload
    // ever mentions an internal id or the owner.
    expect(JSON.stringify(result)).not.toMatch(/user_id|class_id|"id"/);
  });

  it("returns null (not a partial payload) if the class row is somehow missing", async () => {
    const shareChain = makeChain({ data: { class_id: "class-1" }, error: null });
    const classChain = makeChain({ data: null, error: null });
    const from = vi.fn((table: string) => (table === "class_question_shares" ? shareChain : classChain));
    const client = { from } as unknown as SupabaseClient;

    const result = await getPublicQuestionBankCore(client, RAW_TOKEN);

    expect(result).toBeNull();
  });

  it("throws (not a fabricated null) on a genuine query error, distinct from a legitimate absence", async () => {
    const shareChain = makeChain({ data: null, error: new Error("db down") });
    const client = { from: vi.fn(() => shareChain) } as unknown as SupabaseClient;

    await expect(getPublicQuestionBankCore(client, RAW_TOKEN)).rejects.toThrow("db down");
  });
});
