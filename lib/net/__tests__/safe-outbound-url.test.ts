import { describe, it, expect, vi, beforeEach } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns", () => {
  const promises = { lookup: (...args: unknown[]) => lookupMock(...args) };
  return { promises, default: { promises } };
});

const { checkUrlSyntax, resolveSafeOutboundUrl, safeOrigin, safeFetch } = await import("@/lib/net/safe-outbound-url");

describe("checkUrlSyntax", () => {
  it("rejects a plain-http URL, e.g. the cloud-metadata address over http", () => {
    expect(checkUrlSyntax("http://169.254.169.254").ok).toBe(false);
  });

  it("rejects a URL with embedded credentials", () => {
    expect(checkUrlSyntax("https://user:pass@example.com").ok).toBe(false);
  });

  it("rejects an explicit port", () => {
    expect(checkUrlSyntax("https://example.com:8443").ok).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(checkUrlSyntax("not a url").ok).toBe(false);
  });

  it("allows a plain https URL with no port/credentials", () => {
    expect(checkUrlSyntax("https://school.instructure.com").ok).toBe(true);
  });
});

describe("safeOrigin", () => {
  it("strips path, query, and fragment down to scheme+host", () => {
    expect(safeOrigin("https://school.instructure.com/some/path?x=1#y")).toBe("https://school.instructure.com");
  });
});

describe("resolveSafeOutboundUrl", () => {
  beforeEach(() => lookupMock.mockReset());

  it("rejects https://localhost (resolves to loopback)", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const res = await resolveSafeOutboundUrl("https://localhost");
    expect(res.ok).toBe(false);
  });

  it("rejects a hostname whose DNS answer is a private 10.x address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const res = await resolveSafeOutboundUrl("https://internal.example.com");
    expect(res.ok).toBe(false);
  });

  it("rejects the link-local cloud-metadata address even mixed in with a public answer", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    const res = await resolveSafeOutboundUrl("https://rebind.example.com");
    expect(res.ok).toBe(false);
  });

  it("rejects an IPv4-mapped IPv6 private address", async () => {
    lookupMock.mockResolvedValue([{ address: "::ffff:192.168.1.1", family: 6 }]);
    const res = await resolveSafeOutboundUrl("https://sneaky.example.com");
    expect(res.ok).toBe(false);
  });

  it("rejects IPv6 unique-local (fc00::/7) and link-local (fe80::/10)", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "fd12:3456::1", family: 6 }]);
    expect((await resolveSafeOutboundUrl("https://a.example.com")).ok).toBe(false);
    lookupMock.mockResolvedValueOnce([{ address: "fe80::1", family: 6 }]);
    expect((await resolveSafeOutboundUrl("https://b.example.com")).ok).toBe(false);
  });

  it("allows a legitimate public host", async () => {
    lookupMock.mockResolvedValue([{ address: "104.16.132.1", family: 4 }]);
    const res = await resolveSafeOutboundUrl("https://school.instructure.com");
    expect(res.ok).toBe(true);
  });

  it("re-resolves on every call — DNS rebinding: public at 'save' time, private at 'fetch' time, must reject the second call", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "104.16.132.1", family: 4 }]); // save-time lookup
    const saveTime = await resolveSafeOutboundUrl("https://rebinder.example.com");
    expect(saveTime.ok).toBe(true);

    lookupMock.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]); // fetch-time lookup, re-pointed
    const fetchTime = await resolveSafeOutboundUrl("https://rebinder.example.com");
    expect(fetchTime.ok).toBe(false);
    expect(lookupMock).toHaveBeenCalledTimes(2); // proves no caching between calls
  });
});

describe("safeFetch", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    vi.restoreAllMocks();
  });

  it("does not follow a redirect to an internal address", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "104.16.132.1", family: 4 }]) // initial host: public, allowed
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]); // redirect target: internal

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "https://evil-redirect.example.com/meta" } }),
      );

    await expect(safeFetch("https://good.example.com")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1); // never actually requested the redirect target
  });

  it("allows a safe request with no redirect", async () => {
    lookupMock.mockResolvedValue([{ address: "104.16.132.1", family: 4 }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await safeFetch("https://good.example.com");
    expect(res.status).toBe(200);
  });

  it("throws instead of returning a Response when the target is unsafe", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(safeFetch("https://localhost")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled(); // rejected before any network call was made
  });
});
