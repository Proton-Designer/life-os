import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateRawToken,
  hashToken,
  last4,
  timingSafeEqualStrings,
  validateScopes,
  tokenHasScope,
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
  verifyAccessToken,
  touchLastUsed,
  type McpScope,
} from "../tokens";

/**
 * A duck-typed Supabase chain, same idiom as
 * app/(app)/settings/__tests__/actions.test.ts's makeChain — chainable
 * methods that return `this`, plus `.single`/`.maybeSingle` terminals and a
 * `.then` so a chain that ends without either (e.g. a plain `await
 * supabase.from(...).update(...).eq(...)`) still resolves. tokens.ts takes
 * `supabase` as an explicit parameter rather than calling createClient()
 * itself, so no module mocking is needed here — just a fake object cast to
 * the type.
 */
function makeChain(resolved: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "is", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolved);
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain as unknown as {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

function clientReturning(chain: ReturnType<typeof makeChain>): SupabaseClient {
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

const ROW = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "tok-1",
  user_id: "user-1",
  token_hash: "will-be-overwritten",
  token_last4: "abcd",
  label: "My CLI",
  scopes: ["read"],
  created_at: "2026-09-08T00:00:00Z",
  last_used_at: null,
  revoked_at: null,
  ...overrides,
});

describe("generateRawToken", () => {
  it("is prefixed, greppable, and base64url", () => {
    const token = generateRawToken();
    expect(token.startsWith("lifeos_pat_")).toBe(true);
    const suffix = token.slice("lifeos_pat_".length);
    expect(suffix.length).toBeGreaterThan(30);
    expect(suffix).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
  });
});

describe("hashToken / last4", () => {
  it("is deterministic sha256 hex", () => {
    const h1 = hashToken("lifeos_pat_abc");
    const h2 = hashToken("lifeos_pat_abc");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different input -> different hash", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("last4 exposes only the tail", () => {
    expect(last4("lifeos_pat_wxyz")).toBe("wxyz");
  });
});

describe("timingSafeEqualStrings — copied from app/api/cron/ping/route.ts's idiom", () => {
  it("true for identical strings", () => {
    expect(timingSafeEqualStrings("abc123", "abc123")).toBe(true);
  });

  it("false for different length (the case the manual loop must catch before indexing)", () => {
    expect(timingSafeEqualStrings("short", "muchlonger")).toBe(false);
  });

  it("false for same length, different content", () => {
    expect(timingSafeEqualStrings("aaaaaa", "aaaaab")).toBe(false);
  });

  it("false for empty vs non-empty", () => {
    expect(timingSafeEqualStrings("", "a")).toBe(false);
  });
});

describe("validateScopes", () => {
  it("rejects empty — a token with no permissions is a footgun, not a valid read-only token", () => {
    expect(validateScopes([])).toMatch(/at least one/i);
  });

  it("rejects an unknown scope", () => {
    expect(validateScopes(["admin"])).toMatch(/unknown permission/i);
  });

  it("accepts a real single scope", () => {
    expect(validateScopes(["read"])).toBeNull();
  });

  it("accepts both real scopes together", () => {
    expect(validateScopes(["read", "write"])).toBeNull();
  });
});

describe("tokenHasScope — the actual read-only-token guarantee", () => {
  it("a read-only token does NOT satisfy a write requirement", () => {
    expect(tokenHasScope(["read"], "write")).toBe(false);
  });

  it("a read-only token satisfies a read requirement", () => {
    expect(tokenHasScope(["read"], "read")).toBe(true);
  });

  it("a full-access token satisfies both", () => {
    const scopes: McpScope[] = ["read", "write"];
    expect(tokenHasScope(scopes, "read")).toBe(true);
    expect(tokenHasScope(scopes, "write")).toBe(true);
  });

  it("a write-only token does NOT implicitly satisfy read — scopes are not hierarchical", () => {
    expect(tokenHasScope(["write"], "read")).toBe(false);
  });
});

describe("createAccessToken", () => {
  it("rejects invalid scopes before ever touching the database", async () => {
    const chain = makeChain();
    const client = clientReturning(chain);
    const result = await createAccessToken(client, "user-1", "label", []);
    expect(result.ok).toBe(false);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("stores only the hash and last4 — never the raw token — and returns the raw token exactly once", async () => {
    const chain = makeChain({ data: ROW({ scopes: ["read", "write"] }), error: null });
    const client = clientReturning(chain);

    const result = await createAccessToken(client, "user-1", "My CLI", ["read", "write"]);

    expect(result.ok).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.token!.startsWith("lifeos_pat_")).toBe(true);

    const insertArg = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.token_hash).toBe(hashToken(result.token!));
    expect(insertArg).not.toHaveProperty("token"); // the column doesn't exist; this also guards against a future rename accident
    expect(JSON.stringify(insertArg)).not.toContain(result.token);
  });

  it("surfaces a DB error as a plain, non-throwing failure", async () => {
    const chain = makeChain({ data: null, error: { message: "boom" } });
    const client = clientReturning(chain);
    const result = await createAccessToken(client, "user-1", undefined, ["read"]);
    expect(result.ok).toBe(false);
  });
});

describe("listAccessTokens", () => {
  it("maps rows, revoked ones included", async () => {
    const chain = makeChain({
      data: [ROW({ id: "a", revoked_at: null }), ROW({ id: "b", revoked_at: "2026-09-08T01:00:00Z" })],
      error: null,
    });
    const client = clientReturning(chain);

    const rows = await listAccessTokens(client, "user-1");

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "b")?.revokedAt).toBe("2026-09-08T01:00:00Z");
  });

  it("never exposes a hash-shaped field on the returned status", async () => {
    const chain = makeChain({ data: [ROW()], error: null });
    const client = clientReturning(chain);
    const rows = await listAccessTokens(client, "user-1");
    expect(rows[0]).not.toHaveProperty("tokenHash");
    expect(rows[0]).not.toHaveProperty("token_hash");
  });
});

describe("revokeAccessToken", () => {
  it("scopes the update to this user's own, not-yet-revoked row", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = clientReturning(chain);

    const result = await revokeAccessToken(client, "user-1", "tok-1");

    expect(result.ok).toBe(true);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ revoked_at: expect.any(String) }));
    expect(chain.eq).toHaveBeenCalledWith("id", "tok-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.is).toHaveBeenCalledWith("revoked_at", null);
  });
});

describe("verifyAccessToken — the negative cases are the point", () => {
  it("REJECTS a wrong token (no row matches its hash)", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = clientReturning(chain);

    const result = await verifyAccessToken(client, "lifeos_pat_not-a-real-one");

    expect(result).toBeNull();
  });

  it("REJECTS a revoked token, even though its hash matches a real row", async () => {
    const raw = "lifeos_pat_revoked-example";
    const chain = makeChain({
      data: ROW({ token_hash: hashToken(raw), revoked_at: "2026-09-08T00:00:00Z" }),
      error: null,
    });
    const client = clientReturning(chain);

    const result = await verifyAccessToken(client, raw);

    expect(result).toBeNull();
  });

  it("REJECTS a read-only token against a write requirement", async () => {
    const raw = "lifeos_pat_read-only-example";
    const chain = makeChain({
      data: ROW({ token_hash: hashToken(raw), scopes: ["read"] }),
      error: null,
    });
    const client = clientReturning(chain);

    const result = await verifyAccessToken(client, raw, "write");

    expect(result).toBeNull();
  });

  it("ACCEPTS a live token whose scopes cover the requirement", async () => {
    const raw = "lifeos_pat_good-example";
    const chain = makeChain({
      data: ROW({ token_hash: hashToken(raw), scopes: ["read", "write"], user_id: "user-42", id: "tok-42" }),
      error: null,
    });
    const client = clientReturning(chain);

    const result = await verifyAccessToken(client, raw, "write");

    expect(result).toEqual({ userId: "user-42", tokenId: "tok-42", scopes: ["read", "write"] });
  });

  it("a DB error is treated as a rejection, never a throw", async () => {
    const chain = makeChain({ data: null, error: { message: "connection lost" } });
    const client = clientReturning(chain);
    const result = await verifyAccessToken(client, "lifeos_pat_whatever");
    expect(result).toBeNull();
  });
});

describe("touchLastUsed", () => {
  it("updates last_used_at for the given token id", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = clientReturning(chain);

    await touchLastUsed(client, "tok-1");

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ last_used_at: expect.any(String) }));
    expect(chain.eq).toHaveBeenCalledWith("id", "tok-1");
  });
});
