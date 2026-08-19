import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToPush } from "../push-subscribe";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function stubServiceWorker(overrides: Partial<ServiceWorkerRegistration> = {}) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }) })),
    },
    ...overrides,
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });
  return registration;
}

describe("subscribeToPush", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "dGVzdC1rZXk"; // base64url-safe dummy
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    // @ts-expect-error test-only global override
    globalThis.Notification = { permission: "default", requestPermission: vi.fn(async () => "granted") };
    stubServiceWorker();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it("reports unsupported when PushManager isn't available", async () => {
    // @ts-expect-error test-only deletion
    delete window.PushManager;
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("aren't supported") });
  });

  it("reports a missing VAPID key rather than throwing", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const result = await subscribeToPush();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("VAPID");
  });

  it("requests permission when not already granted, and reports denial with a specific reason", async () => {
    // @ts-expect-error test-only global override
    globalThis.Notification = { permission: "default", requestPermission: vi.fn(async () => "denied") };
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("blocked") });
  });

  it("does not re-prompt when permission is already granted", async () => {
    const requestPermission = vi.fn(async () => "granted");
    // @ts-expect-error test-only global override
    globalThis.Notification = { permission: "granted", requestPermission };
    await subscribeToPush();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("subscribes and POSTs to /api/push/subscribe on success", async () => {
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/push/subscribe",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reuses an existing subscription instead of creating a new one", async () => {
    const registration = stubServiceWorker();
    registration.pushManager.getSubscription = vi.fn(async () => ({
      toJSON: () => ({ endpoint: "https://push.example/existing", keys: { p256dh: "p", auth: "a" } }),
    })) as unknown as typeof registration.pushManager.getSubscription;
    await subscribeToPush();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("surfaces the server's real error message and status when the subscribe POST is rejected", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Invalid subscription payload" }), { status: 400 }));
    const result = await subscribeToPush();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("400");
      expect(result.reason).toContain("Invalid subscription payload");
    }
  });

  it("catches a thrown error from pushManager.subscribe and returns its real message, never swallowing it", async () => {
    const registration = stubServiceWorker();
    registration.pushManager.subscribe = vi.fn(async () => {
      throw new Error("Registration failed - push service error");
    }) as unknown as typeof registration.pushManager.subscribe;
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: false, reason: "Registration failed - push service error" });
  });
});
