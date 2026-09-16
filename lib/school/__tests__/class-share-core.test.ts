import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateShareToken,
  hashShareToken,
  createClassShareCore,
  revokeClassShareCore,
  getClassShareStatusCore,
  getSharePreviewCore,
  selectPublicFields,
} from "../class-share-core";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update", "is"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("generateShareToken / hashShareToken", () => {
  it("mints at least 32 bytes of entropy, base64url (no +/= chars)", () => {
    const token = generateShareToken();
    expect(token.length).toBeGreaterThanOrEqual(43); // base64url(32 bytes) is 43 chars, no padding
    expect(token).not.toMatch(/[+/=]/);
  });

  it("two mints never collide in a reasonable sample", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateShareToken()));
    expect(tokens.size).toBe(100);
  });

  it("hashShareToken is deterministic sha256 hex, one-way (different input, different hash)", () => {
    expect(hashShareToken("abc")).toBe(hashShareToken("abc"));
    expect(hashShareToken("abc")).not.toBe(hashShareToken("abd"));
    expect(hashShareToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createClassShareCore", () => {
  it("mints a token, stores ONLY the hash, and returns the raw token exactly once", async () => {
    const statusChain = makeChain({ data: null, error: null }); // getClassShareStatusCore's own check: no active share
    const insertChain = makeChain({ data: null, error: null });
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      return call === 1 ? statusChain : insertChain;
    });
    const client = { from } as unknown as SupabaseClient;

    const result = await createClassShareCore(client, "user-1", "class-1");

    expect(result.rawToken).toBeTruthy();
    const insertedRow = insertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow.user_id).toBe("user-1");
    expect(insertedRow.class_id).toBe("class-1");
    expect(insertedRow.token_hash).toBe(hashShareToken(result.rawToken));
    // The raw token itself must never appear anywhere in what gets written.
    expect(JSON.stringify(insertedRow)).not.toContain(result.rawToken);
  });

  it("REFUSES with a friendly error when a share is already live -- never a raw 23505", async () => {
    const statusChain = makeChain({ data: { created_at: "2026-09-15T00:00:00Z" }, error: null });
    const client = { from: vi.fn(() => statusChain) } as unknown as SupabaseClient;

    await expect(createClassShareCore(client, "user-1", "class-1")).rejects.toThrow(/already shared/i);
  });

  it("throws on a genuine insert error rather than returning a fabricated token", async () => {
    const statusChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: null, error: new Error("db down") });
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      return call === 1 ? statusChain : insertChain;
    });
    const client = { from } as unknown as SupabaseClient;

    await expect(createClassShareCore(client, "user-1", "class-1")).rejects.toThrow("db down");
  });
});

describe("revokeClassShareCore", () => {
  it("sets revoked_at, scoped to (user_id, class_id) and only the live row", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await revokeClassShareCore(client, "user-1", "class-1");

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ revoked_at: expect.any(String) }));
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("class_id", "class-1");
    expect(chain.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("throws on a genuine update error", async () => {
    const chain = makeChain({ data: null, error: new Error("boom") });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(revokeClassShareCore(client, "user-1", "class-1")).rejects.toThrow("boom");
  });
});

describe("getClassShareStatusCore", () => {
  it("active:true with createdAt when a live share exists", async () => {
    const chain = makeChain({ data: { created_at: "2026-09-15T00:00:00Z" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getClassShareStatusCore(client, "user-1", "class-1");

    expect(result).toEqual({ active: true, createdAt: "2026-09-15T00:00:00Z" });
    expect(chain.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("active:false, createdAt null, when nothing live exists -- NEVER a token field", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getClassShareStatusCore(client, "user-1", "class-1");

    expect(result).toEqual({ active: false, createdAt: null });
    expect(Object.keys(result)).not.toContain("token");
    expect(Object.keys(result)).not.toContain("rawToken");
  });
});

describe("selectPublicFields", () => {
  it("projects ONLY prompt/answer/topic, plus className from short_name ?? code -- never id/user_id/class_id", () => {
    const result = selectPublicFields(
      { short_name: "Orgo II", code: "CHEM 201" },
      [
        { prompt: "p1", answer: "a1", topic: "t1" },
        { prompt: "p2", answer: "a2", topic: null },
      ]
    );

    expect(result).toEqual({
      className: "Orgo II",
      questions: [
        { prompt: "p1", answer: "a1", topic: "t1" },
        { prompt: "p2", answer: "a2", topic: null },
      ],
    });
  });

  it("falls back to code when short_name is null", () => {
    const result = selectPublicFields({ short_name: null, code: "CHEM 201" }, []);
    expect(result.className).toBe("CHEM 201");
  });

  it("never leaks extra fields even if the row shape has more on it (e.g. a stray id)", () => {
    const result = selectPublicFields(
      { short_name: "X", code: "X101" },
      [{ prompt: "p", answer: "a", topic: null, id: "sneaky-id", user_id: "sneaky-user" } as never]
    );
    expect(result.questions[0]).toEqual({ prompt: "p", answer: "a", topic: null });
    expect(JSON.stringify(result)).not.toContain("sneaky");
  });
});

describe("getSharePreviewCore", () => {
  it("is scoped to the caller's own user_id + classId on BOTH the class and questions reads, and filters active=true", async () => {
    const classChain = makeChain({ data: { short_name: "Orgo II", code: "CHEM 201" }, error: null });
    const questionsChain = makeChain({ data: [{ prompt: "p1", answer: "a1", topic: null }], error: null });
    const from = vi.fn((table: string) => (table === "classes" ? classChain : questionsChain));
    const client = { from } as unknown as SupabaseClient;

    const result = await getSharePreviewCore(client, "user-1", "class-1");

    expect(classChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(classChain.eq).toHaveBeenCalledWith("id", "class-1");
    expect(questionsChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(questionsChain.eq).toHaveBeenCalledWith("class_id", "class-1");
    expect(questionsChain.eq).toHaveBeenCalledWith("active", true);
    expect(result).toEqual({ className: "Orgo II", questions: [{ prompt: "p1", answer: "a1", topic: null }] });
  });
});
