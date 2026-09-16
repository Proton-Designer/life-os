import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/ai/encryption", () => ({
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}));

const safeFetchMock = vi.fn();
vi.mock("@/lib/net/safe-outbound-url", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import { enqueueWriteOkWebhookDeliveries, processWebhookDeliveries } from "../webhook-dispatch";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function makeClient(handlers: Record<string, () => Record<string, unknown>>): SupabaseClient {
  const from = vi.fn((table: string) => {
    if (!handlers[table]) throw new Error(`unexpected table in test: ${table}`);
    return handlers[table]();
  });
  return { from } as unknown as SupabaseClient;
}

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("enqueueWriteOkWebhookDeliveries", () => {
  it("does nothing (no insert) when the user has zero active write.ok webhooks", async () => {
    const insert = vi.fn();
    const client = makeClient({
      mcp_webhooks: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        return chain;
      },
      mcp_webhook_deliveries: () => ({ insert }),
    });

    await enqueueWriteOkWebhookDeliveries(client, "user-1", { operation: "deen.prayer.log", summary: "logged fajr" });

    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts one delivery row per active webhook, with the operation/summary in the payload", async () => {
    const insert = vi.fn(async (_rows: Record<string, unknown>[]) => ({ error: null }));
    const client = makeClient({
      mcp_webhooks: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "wh-1" }, { id: "wh-2" }], error: null });
        return chain;
      },
      mcp_webhook_deliveries: () => ({ insert }),
    });

    await enqueueWriteOkWebhookDeliveries(client, "user-1", { operation: "deen.prayer.log", summary: "logged fajr" });

    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0]![0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({ webhook_id: "wh-1", user_id: "user-1", event: "write.ok" }));
    expect((rows[0]!.payload as Record<string, unknown>).operation).toBe("deen.prayer.log");
  });
});

function pendingChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lte", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return chain;
}

function webhookLookupChain(row: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  return chain;
}

function updateSpy() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("processWebhookDeliveries", () => {
  it("marks a successful delivery delivered and resets the webhook's failure_count", async () => {
    const deliveryUpdate = updateSpy();
    const webhookUpdate = updateSpy();
    let deliveryCall = 0;
    let webhookCall = 0;
    const client = makeClient({
      mcp_webhook_deliveries: () => {
        deliveryCall++;
        return deliveryCall === 1 ? pendingChain([{ id: "d-1", webhook_id: "wh-1", payload: { event: "write.ok" }, attempt_count: 0 }]) : deliveryUpdate;
      },
      mcp_webhooks: () => {
        webhookCall++;
        return webhookCall === 1 ? webhookLookupChain({ url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t", failure_count: 2, active: true }) : webhookUpdate;
      },
    });
    safeFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const result = await processWebhookDeliveries(client, NOW);

    expect(result).toEqual({ attempted: 1, delivered: 1, retried: 0, failed: 0, disabled: 0 });
    expect(deliveryUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: "delivered" }));
    expect(webhookUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ failure_count: 0, last_delivery_status: "ok" }));
  });

  it("a first failure schedules ONE retry with backoff -- delivery stays pending, webhook untouched", async () => {
    const deliveryUpdate = updateSpy();
    let deliveryCall = 0;
    const client = makeClient({
      mcp_webhook_deliveries: () => {
        deliveryCall++;
        return deliveryCall === 1 ? pendingChain([{ id: "d-1", webhook_id: "wh-1", payload: {}, attempt_count: 0 }]) : deliveryUpdate;
      },
      mcp_webhooks: () => webhookLookupChain({ url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t", failure_count: 0, active: true }),
    });
    safeFetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await processWebhookDeliveries(client, NOW);

    expect(result).toEqual({ attempted: 1, delivered: 0, retried: 1, failed: 0, disabled: 0 });
    const payload = deliveryUpdate.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.attempt_count).toBe(1);
    expect(new Date(payload.next_attempt_at as string).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("a SECOND failure (after the retry) marks the delivery permanently failed and increments failure_count", async () => {
    const deliveryUpdate = updateSpy();
    const webhookUpdate = updateSpy();
    let deliveryCall = 0;
    let webhookCall = 0;
    const client = makeClient({
      mcp_webhook_deliveries: () => {
        deliveryCall++;
        return deliveryCall === 1 ? pendingChain([{ id: "d-1", webhook_id: "wh-1", payload: {}, attempt_count: 1 }]) : deliveryUpdate;
      },
      mcp_webhooks: () => {
        webhookCall++;
        return webhookCall === 1 ? webhookLookupChain({ url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t", failure_count: 1, active: true }) : webhookUpdate;
      },
    });
    safeFetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await processWebhookDeliveries(client, NOW);

    expect(result).toEqual({ attempted: 1, delivered: 0, retried: 0, failed: 1, disabled: 0 });
    expect(deliveryUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(webhookUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ failure_count: 2, active: true }));
  });

  it("auto-disables the webhook once failure_count reaches the threshold (3)", async () => {
    const deliveryUpdate = updateSpy();
    const webhookUpdate = updateSpy();
    let deliveryCall = 0;
    let webhookCall = 0;
    const client = makeClient({
      mcp_webhook_deliveries: () => {
        deliveryCall++;
        return deliveryCall === 1 ? pendingChain([{ id: "d-1", webhook_id: "wh-1", payload: {}, attempt_count: 1 }]) : deliveryUpdate;
      },
      mcp_webhooks: () => {
        webhookCall++;
        return webhookCall === 1 ? webhookLookupChain({ url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t", failure_count: 2, active: true }) : webhookUpdate;
      },
    });
    safeFetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await processWebhookDeliveries(client, NOW);

    expect(result.disabled).toBe(1);
    expect(webhookUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ failure_count: 3, active: false }));
  });

  it("a delivery whose webhook was removed/disabled between enqueue and drain is marked failed, not retried forever", async () => {
    const deliveryUpdate = updateSpy();
    let deliveryCall = 0;
    const client = makeClient({
      mcp_webhook_deliveries: () => {
        deliveryCall++;
        return deliveryCall === 1 ? pendingChain([{ id: "d-1", webhook_id: "wh-1", payload: {}, attempt_count: 0 }]) : deliveryUpdate;
      },
      mcp_webhooks: () => webhookLookupChain(null),
    });

    const result = await processWebhookDeliveries(client, NOW);

    expect(result).toEqual({ attempted: 1, delivered: 0, retried: 0, failed: 1, disabled: 0 });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("signs the delivery with the real HMAC helper, over the exact serialized payload", async () => {
    let deliveryCall = 0;
    const client = makeClient({
      mcp_webhook_deliveries: () => {
        deliveryCall++;
        return deliveryCall === 1 ? pendingChain([{ id: "d-1", webhook_id: "wh-1", payload: { event: "write.ok", operation: "deen.prayer.log" }, attempt_count: 0 }]) : updateSpy();
      },
      mcp_webhooks: () => (deliveryCall === 1 ? webhookLookupChain({ url: "https://example.com/hook", encrypted_secret: "enc:s3cr3t", failure_count: 0, active: true }) : updateSpy()),
    });
    safeFetchMock.mockResolvedValue({ ok: true, status: 200 });

    await processWebhookDeliveries(client, NOW);

    const [, init] = safeFetchMock.mock.calls[0]!;
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["X-LifeOS-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect((init as { body: string }).body).toBe(JSON.stringify({ event: "write.ok", operation: "deen.prayer.log" }));
  });
});
