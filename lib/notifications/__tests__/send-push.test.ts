import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const setVapidDetailsMock = vi.fn();
const sendNotificationMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}));

const { sendPushToUser, hasAnyPushSubscription } = await import("../send-push");

beforeEach(() => {
  setVapidDetailsMock.mockClear();
  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue({});
});

function makeClient(opts: { subs?: { endpoint: string; p256dh: string; auth_key: string }[]; subsError?: unknown; vaultRows?: { name: string; decrypted_secret: string }[]; vaultError?: unknown } = {}) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.limit = vi.fn(() =>
      Promise.resolve({ data: (opts.subs ?? []).slice(0, 1), error: opts.subsError ?? null }),
    );
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      if (table === "push_subscriptions") resolve({ data: opts.subs ?? [], error: opts.subsError ?? null });
      else resolve({ data: [], error: null });
    };
    return chain;
  });

  const rpc = vi.fn(async () => ({
    data: opts.vaultRows ?? [
      { name: "vapid_public_key", decrypted_secret: "pub" },
      { name: "vapid_private_key", decrypted_secret: "priv" },
      { name: "vapid_subject", decrypted_secret: "mailto:test@example.com" },
    ],
    error: opts.vaultError ?? null,
  }));

  return { client: { from, rpc } as unknown as SupabaseClient };
}

const SUB = { endpoint: "https://push.example/1", p256dh: "p256dh-key", auth_key: "auth-key" };

describe("sendPushToUser", () => {
  it("returns hadSubscriptions:false without ever fetching Vault secrets when the user has no device registered", async () => {
    const { client } = makeClient({ subs: [] });
    const result = await sendPushToUser(client, "user-1", "Title", "Body");
    expect(result).toEqual({ hadSubscriptions: false, delivered: 0, total: 0 });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("fetches VAPID secrets via the service-role RPC (verified callable from a plain client, not Deno-bound) and sends to every subscription", async () => {
    const { client } = makeClient({ subs: [SUB, { ...SUB, endpoint: "https://push.example/2" }] });
    const result = await sendPushToUser(client, "user-1", "Kill list", "Go review it");

    expect(client.rpc).toHaveBeenCalledWith("get_vault_secrets", { secret_names: ["vapid_public_key", "vapid_private_key", "vapid_subject"] });
    expect(setVapidDetailsMock).toHaveBeenCalledWith("mailto:test@example.com", "pub", "priv");
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ hadSubscriptions: true, delivered: 2, total: 2 });
  });

  it("a dead subscription (send throws) does not stop delivery to the user's OTHER devices, and is reflected in delivered < total", async () => {
    sendNotificationMock.mockRejectedValueOnce(new Error("410 Gone")).mockResolvedValueOnce({});
    const { client } = makeClient({ subs: [SUB, { ...SUB, endpoint: "https://push.example/2" }] });
    const result = await sendPushToUser(client, "user-1", "Title", "Body");
    expect(result).toEqual({ hadSubscriptions: true, delivered: 1, total: 2 });
  });

  it("throws when Vault secrets are missing rather than silently sending unconfigured", async () => {
    const { client } = makeClient({ subs: [SUB], vaultRows: [{ name: "vapid_public_key", decrypted_secret: "pub" }] });
    await expect(sendPushToUser(client, "user-1", "Title", "Body")).rejects.toThrow(/VAPID secrets missing/i);
  });

  it("throws when the subscriptions query itself errors", async () => {
    const { client } = makeClient({ subsError: { message: "connection lost" } });
    await expect(sendPushToUser(client, "user-1", "Title", "Body")).rejects.toThrow();
  });
});

describe("hasAnyPushSubscription", () => {
  it("true when at least one subscription exists", async () => {
    const { client } = makeClient({ subs: [SUB] });
    expect(await hasAnyPushSubscription(client, "user-1")).toBe(true);
  });

  it("false when none exist", async () => {
    const { client } = makeClient({ subs: [] });
    expect(await hasAnyPushSubscription(client, "user-1")).toBe(false);
  });
});
