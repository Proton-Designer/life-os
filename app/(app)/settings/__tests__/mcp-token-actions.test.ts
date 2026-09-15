import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/mcp/tokens";

/**
 * Same chain-mock idiom as app/(app)/settings/__tests__/actions.test.ts —
 * mock the lowest-level `createClient`, not `lib/mcp/tokens` itself, so
 * these tests exercise the REAL create/list/revoke logic in that module
 * through the thin "use server" wrapper, not a stand-in for it.
 */
function makeChain(resolved: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "is", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolved);
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain as {
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

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ROW = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "tok-1",
  user_id: "user-1",
  token_hash: "x",
  token_last4: "abcd",
  label: "My CLI",
  scopes: ["read"],
  created_at: "2026-09-08T00:00:00Z",
  last_used_at: null,
  revoked_at: null,
  ...overrides,
});

describe("createMcpToken", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("rejects an empty scopes array before even authenticating", async () => {
    const { createMcpToken } = await import("../mcp-token-actions");
    const result = await createMcpToken("My CLI", []);
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown scope", async () => {
    const { createMcpToken } = await import("../mcp-token-actions");
    const result = await createMcpToken("My CLI", ["admin"]);
    expect(result.ok).toBe(false);
  });

  it("on success, returns the raw token once and the insert carries only its hash", async () => {
    const chain = makeChain({ data: ROW({ scopes: ["read", "write"] }), error: null });
    // P4-12: createAccessToken first counts live tokens (a plain awaited select) -- none yet.
    (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    fromImpl = () => chain;
    const { createMcpToken } = await import("../mcp-token-actions");

    const result = await createMcpToken("My CLI", ["read", "write"]);

    expect(result.ok).toBe(true);
    expect(result.token).toMatch(/^lifeos_pat_/);
    const insertArg = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.token_hash).toBe(hashToken(result.token!));
    expect(insertArg.user_id).toBe("user-1");
    expect(JSON.stringify(insertArg)).not.toContain(result.token);
  });
});

describe("createMcpToken — P4-12 expiry choice (7/30/90 days or never, default 90)", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  function successChain() {
    const chain = makeChain({ data: ROW({ scopes: ["read"] }), error: null });
    (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    fromImpl = () => chain;
    return chain;
  }
  const DAY = 86_400_000;
  function daysFromNow(iso: unknown) {
    return (Date.parse(iso as string) - Date.now()) / DAY;
  }

  it("defaults to 90 days when no choice is given", async () => {
    const chain = successChain();
    const { createMcpToken } = await import("../mcp-token-actions");
    expect((await createMcpToken("CLI", ["read"])).ok).toBe(true);
    const days = daysFromNow((chain.insert.mock.calls[0][0] as Record<string, unknown>).expires_at);
    expect(days).toBeGreaterThan(89.99);
    expect(days).toBeLessThanOrEqual(90);
  });

  it.each([["7", 7], ["30", 30], ["90", 90]] as const)("choice %s stores an expiry %i days out, as a Settings 'pat'", async (choice, n) => {
    const chain = successChain();
    const { createMcpToken } = await import("../mcp-token-actions");
    expect((await createMcpToken("CLI", ["read"], choice)).ok).toBe(true);
    const inserted = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(daysFromNow(inserted.expires_at)).toBeGreaterThan(n - 0.01);
    expect(daysFromNow(inserted.expires_at)).toBeLessThanOrEqual(n);
    expect(inserted.client_kind).toBe("pat");
  });

  it("'never' stores no expiry", async () => {
    const chain = successChain();
    const { createMcpToken } = await import("../mcp-token-actions");
    expect((await createMcpToken("CLI", ["read"], "never")).ok).toBe(true);
    expect((chain.insert.mock.calls[0][0] as Record<string, unknown>).expires_at).toBeNull();
  });

  it("refuses any other value before authenticating or touching the database", async () => {
    const chain = successChain();
    const { createMcpToken } = await import("../mcp-token-actions");
    const res = await createMcpToken("CLI", ["read"], "365");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/7, 30 or 90 days, or never/i);
    expect(chain.insert).not.toHaveBeenCalled();
    expect(getClaimsMock).not.toHaveBeenCalled();
  });
});

describe("getMcpTokenStatuses", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("lists this user's tokens, revoked ones included", async () => {
    const chain = makeChain({
      data: [ROW({ id: "a" }), ROW({ id: "b", revoked_at: "2026-09-08T02:00:00Z" })],
      error: null,
    });
    fromImpl = () => chain;
    const { getMcpTokenStatuses } = await import("../mcp-token-actions");

    const rows = await getMcpTokenStatuses();

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "b")?.revokedAt).not.toBeNull();
  });
});

describe("revokeMcpToken", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("scopes the revoke to the caller's own token id", async () => {
    const chain = makeChain({ data: null, error: null });
    fromImpl = () => chain;
    const { revokeMcpToken } = await import("../mcp-token-actions");

    const result = await revokeMcpToken("tok-1");

    expect(result.ok).toBe(true);
    expect(chain.eq).toHaveBeenCalledWith("id", "tok-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
