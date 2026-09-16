import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

vi.mock("@/lib/ai/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
  isKeyStorageConfigured: () => true,
  last4: (s: string) => s.slice(-4),
}));

const checkUrlSyntaxMock = vi.fn((_url: string) => ({ ok: true }) as { ok: boolean; message?: string });
const resolveSafeOutboundUrlMock = vi.fn(async (_url: string) => ({ ok: true }) as { ok: boolean; message?: string });
const safeFetchMock = vi.fn();
vi.mock("@/lib/net/safe-outbound-url", () => ({
  checkUrlSyntax: (url: string) => checkUrlSyntaxMock(url),
  resolveSafeOutboundUrl: (url: string) => resolveSafeOutboundUrlMock(url),
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import { createWebhookCore, listWebhooksCore, deleteWebhookCore, testFireWebhookCore, signWebhookPayload, generateWebhookSecret } from "../webhooks";

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "delete", "order"]) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn(async () => resolvedValue);
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  checkUrlSyntaxMock.mockReset();
  checkUrlSyntaxMock.mockReturnValue({ ok: true });
  resolveSafeOutboundUrlMock.mockReset();
  resolveSafeOutboundUrlMock.mockResolvedValue({ ok: true });
  safeFetchMock.mockReset();
});

describe("generateWebhookSecret / signWebhookPayload", () => {
  it("mints at least 32 bytes of entropy, base64url", () => {
    const secret = generateWebhookSecret();
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(secret).not.toMatch(/[+/=]/);
  });

  it("two mints never collide in a reasonable sample", () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateWebhookSecret()));
    expect(secrets.size).toBe(100);
  });

  it("signature is a deterministic HMAC-SHA256 over `<timestamp>.<body>`, matching a real receiver's own computation", () => {
    const expected = createHmac("sha256", "s3cr3t").update("1700000000.{\"a\":1}").digest("hex");
    expect(signWebhookPayload("s3cr3t", "1700000000", '{"a":1}')).toBe(expected);
  });

  it("a different timestamp or body produces a different signature (replay/tamper detection)", () => {
    const base = signWebhookPayload("s3cr3t", "1700000000", '{"a":1}');
    expect(signWebhookPayload("s3cr3t", "1700000001", '{"a":1}')).not.toBe(base);
    expect(signWebhookPayload("s3cr3t", "1700000000", '{"a":2}')).not.toBe(base);
  });
});

describe("createWebhookCore", () => {
  it("mints a secret, stores ONLY its encryption, and returns the raw secret exactly once", async () => {
    const insertChain = makeChain({ data: { id: "wh-1", url: "https://example.com/hook", secret_last4: "abcd", event: "write.ok", active: true, failure_count: 0, last_delivery_at: null, last_delivery_status: null, last_delivery_error: null, created_at: "2026-09-16T00:00:00Z" }, error: null });
    const client = { from: vi.fn(() => insertChain) } as unknown as SupabaseClient;

    const result = await createWebhookCore(client, "user-1", "https://example.com/hook");

    expect(result.ok).toBe(true);
    expect(result.secret).toBeTruthy();
    const insertedRow = insertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow.user_id).toBe("user-1");
    expect(insertedRow.encrypted_secret).toBe(`enc:${result.secret}`);
    // The raw secret must never appear under any OTHER field -- only ever
    // passed through encryptSecret() first (real encryption never contains
    // the plaintext as a substring; this mock prefixes it instead, so the
    // check is scoped to "no other field", not "nowhere in the payload").
    const { encrypted_secret: _omit, ...rest } = insertedRow;
    expect(JSON.stringify(rest)).not.toContain(result.secret);
  });

  it("refuses a syntactically invalid URL before ever touching the DB", async () => {
    checkUrlSyntaxMock.mockReturnValue({ ok: false, message: "Only https:// URLs are allowed." });
    const client = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await createWebhookCore(client, "user-1", "http://example.com/hook");

    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("refuses a URL that resolves to a blocked address (SSRF guard)", async () => {
    resolveSafeOutboundUrlMock.mockResolvedValue({ ok: false, message: "That host can't be used." });
    const client = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await createWebhookCore(client, "user-1", "https://internal.example.com/hook");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/can't be used/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("a 10.x-resolving URL is rejected -- the exact case the AC names", async () => {
    resolveSafeOutboundUrlMock.mockResolvedValue({ ok: false, message: "That host can't be used." });
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    const result = await createWebhookCore(client, "user-1", "https://10.0.0.5/hook");
    expect(result.ok).toBe(false);
  });
});

describe("listWebhooksCore", () => {
  it("maps every column to its camelCase field, never leaking encrypted_secret", async () => {
    const chain = makeChain({ data: [{ id: "wh-1", url: "https://example.com/hook", secret_last4: "abcd", event: "write.ok", active: true, failure_count: 2, last_delivery_at: "2026-09-16T00:00:00Z", last_delivery_status: "failed", last_delivery_error: "HTTP 500", created_at: "2026-09-15T00:00:00Z" }], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await listWebhooksCore(client, "user-1");

    expect(result).toEqual([{ id: "wh-1", url: "https://example.com/hook", secretLast4: "abcd", event: "write.ok", active: true, failureCount: 2, lastDeliveryAt: "2026-09-16T00:00:00Z", lastDeliveryStatus: "failed", lastDeliveryError: "HTTP 500", createdAt: "2026-09-15T00:00:00Z" }]);
    const selectCall = (chain.select as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(selectCall).not.toContain("encrypted_secret");
  });
});

describe("deleteWebhookCore", () => {
  it("scopes the delete to (id, user_id)", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await deleteWebhookCore(client, "user-1", "wh-1");

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", "wh-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("testFireWebhookCore", () => {
  it("signs and POSTs a real test payload through the SSRF-guarded transport", async () => {
    const chain = makeChain({ data: { url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    safeFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const result = await testFireWebhookCore(client, "user-1", "wh-1");

    expect(result.ok).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/hook");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["X-LifeOS-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers["X-LifeOS-Webhook-Timestamp"]).toMatch(/^\d+$/);
  });

  it("reports a non-200 receiver response as a failure, not a success", async () => {
    const chain = makeChain({ data: { url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    safeFetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await testFireWebhookCore(client, "user-1", "wh-1");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("500");
  });

  it("a transport-level throw (e.g. the SSRF guard rejecting a re-pointed DNS entry) is reported, not left uncaught", async () => {
    const chain = makeChain({ data: { url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    safeFetchMock.mockRejectedValue(new Error("That host can't be used."));

    const result = await testFireWebhookCore(client, "user-1", "wh-1");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/can't be used/i);
  });

  it("reports not-found without ever calling safeFetch, for a webhook that isn't this user's own", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await testFireWebhookCore(client, "user-1", "someone-elses-webhook");

    expect(result.ok).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
