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

const { verifyCanvasToken, fetchCanvasCourses, fetchCanvasAnnouncements, fetchCanvasGradedAssignments, fetchCanvasIcsFeed } = await import("@/lib/canvas/client");

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

  it("fetchCanvasAnnouncements calls safeFetch with context_codes and start_date, maps the response", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: 501, title: "Quiz moved", message: "<p>Moved to Friday</p>", posted_at: "2026-09-10T00:00:00Z" }]), { status: 200 }),
    );
    const res = await fetchCanvasAnnouncements("https://school.instructure.com", "tok", "123", "2026-09-01T00:00:00.000Z");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data).toEqual([{ canvasAnnouncementId: "501", title: "Quiz moved", messageHtml: "<p>Moved to Friday</p>", postedAt: "2026-09-10T00:00:00Z" }]);
    const url = String(safeFetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/v1/announcements");
    expect(url).toContain(encodeURIComponent("course_123"));
    expect(url).toContain(encodeURIComponent("2026-09-01T00:00:00.000Z"));
  });

  it("fetchCanvasGradedAssignments keeps only graded submissions with a numeric score", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 1, name: "Essay 1", due_at: "2026-09-20T23:59:00Z", points_possible: 100, submission: { workflow_state: "graded", score: 92 } },
          { id: 2, name: "Essay 2 (ungraded)", due_at: "2026-09-22T23:59:00Z", points_possible: 100, submission: { workflow_state: "unsubmitted" } },
          { id: 3, name: "Essay 3 (graded, no score)", due_at: null, points_possible: 50, submission: { workflow_state: "graded" } },
        ]),
        { status: 200 },
      ),
    );
    const res = await fetchCanvasGradedAssignments("https://school.instructure.com", "tok", "123");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data).toEqual([{ canvasAssignmentId: "1", name: "Essay 1", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 92 }]);
    const url = String(safeFetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/v1/courses/123/assignments");
    expect(url).toContain("include[]=submission");
  });

  it("fetchCanvasIcsFeed calls safeFetch with the raw feed URL (no /api/v1 path, no Bearer header) and returns the body text", async () => {
    safeFetchMock.mockResolvedValue(new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR", { status: 200 }));
    const res = await fetchCanvasIcsFeed("https://school.instructure.com/feeds/calendars/user_abc123.ics");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(safeFetchMock.mock.calls[0][0]).toBe("https://school.instructure.com/feeds/calendars/user_abc123.ics");
    expect((safeFetchMock.mock.calls[0][1] as { headers?: Record<string, string> }).headers).not.toHaveProperty("Authorization");
  });

  it("fetchCanvasIcsFeed rejects a non-ok status", async () => {
    safeFetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const res = await fetchCanvasIcsFeed("https://school.instructure.com/feeds/calendars/user_abc123.ics");
    expect(res.ok).toBe(false);
  });

  it("fetchCanvasIcsFeed aborts and reports an error once the streamed body exceeds the size cap, without buffering it all first", async () => {
    // 6 MB of 'a' -- over the 5 MB cap -- streamed in 1 MB chunks so this
    // proves the abort happens mid-stream, not only after a hypothetical
    // full buffer-then-check.
    const chunk = new TextEncoder().encode("a".repeat(1024 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    safeFetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    const res = await fetchCanvasIcsFeed("https://school.instructure.com/feeds/calendars/user_abc123.ics");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected rejection");
    expect(res.message).toMatch(/larger than expected/i);
  });
});
