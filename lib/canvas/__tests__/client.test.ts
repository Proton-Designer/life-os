import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Proves lib/canvas/client.ts routes every outbound request through
 * lib/net/safe-outbound-url.ts's `safeFetch`, never Node's raw `fetch`
 * directly (P2-20 security review: SSRF — a user-supplied Canvas instance
 * URL is attacker-controlled, and this client sends the user's own bearer
 * token to wherever it resolves). Written and run BEFORE client.ts was
 * wired to safeFetch to confirm it fails first (it did — see the task log):
 * with client.ts still calling raw fetch(), `safeFetchMock` above was never
 * invoked and every assertion here failed. Left in place as the regression
 * signal against this specific class of bug recurring.
 */

const safeFetchMock = vi.fn();
vi.mock("@/lib/net/safe-outbound-url", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

const { verifyCanvasToken, fetchCanvasCourses } = await import("@/lib/canvas/client");

describe("Canvas client routes through the SSRF-safe fetch wrapper", () => {
  beforeEach(() => safeFetchMock.mockReset());

  it("verifyCanvasToken calls safeFetch, not raw fetch", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1, name: "A. Student" }), { status: 200 }));
    const res = await verifyCanvasToken("https://school.instructure.com", "tok");
    expect(res.ok).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(String(safeFetchMock.mock.calls[0][0])).toContain("/api/v1/users/self");
  });

  it("fetchCanvasCourses calls safeFetch, not raw fetch", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: 10, name: "Math", course_code: "MATH101" }]), { status: 200 }),
    );
    const res = await fetchCanvasCourses("https://school.instructure.com", "tok");
    expect(res.ok).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(String(safeFetchMock.mock.calls[0][0])).toContain("/api/v1/courses");
  });

  it("surfaces a safeFetch rejection (SSRF-blocked target) as a clean {ok:false} result, never throws to the caller", async () => {
    safeFetchMock.mockImplementationOnce(() => Promise.reject(new Error("That host can't be used.")));
    const res = await verifyCanvasToken("https://internal.example.com", "tok");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe("That host can't be used.");
  });

  it("sets authExpired:true on a 401/403, so callers can distinguish it from a network failure (P2-22)", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const res = await verifyCanvasToken("https://school.instructure.com", "stale-tok");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.authExpired).toBe(true);
  });

  it("does NOT set authExpired on a generic network failure", async () => {
    safeFetchMock.mockImplementationOnce(() => Promise.reject(new Error("Couldn't reach that Canvas instance. Check the URL.")));
    const res = await verifyCanvasToken("https://school.instructure.com", "tok");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.authExpired).toBeUndefined();
  });
});
