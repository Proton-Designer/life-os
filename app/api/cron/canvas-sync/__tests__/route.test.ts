import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * P2-21 poll target. Auth idiom is byte-for-byte copied from
 * app/api/cron/lecture-transcription/route.ts (see this route's own
 * header) — these tests mirror that file's own test shape: the auth
 * gate and the after()-scheduling contract, not the sync logic itself
 * (that's lib/canvas/__tests__/sync-core.test.ts's job).
 */

const syncCanvasAnnouncementsCoreMock = vi.fn();
const syncCanvasGradesCoreMock = vi.fn();
vi.mock("@/lib/canvas/sync-core", () => ({
  syncCanvasAnnouncementsCore: (...args: unknown[]) => syncCanvasAnnouncementsCoreMock(...args),
  syncCanvasGradesCore: (...args: unknown[]) => syncCanvasGradesCoreMock(...args),
}));

type Resp = { data: unknown; error: unknown };
function makeServiceClient(responses: Record<string, Resp>) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "not", "limit"]) chain[method] = vi.fn(() => chain);
    const resolved = responses[table] ?? { data: [], error: null };
    chain.then = (resolve: (v: Resp) => void) => resolve(resolved);
    return chain;
  });
  return { from };
}

let serviceClient: ReturnType<typeof makeServiceClient>;
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => serviceClient,
}));

let afterCallback: (() => Promise<void>) | null = null;
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (cb: () => Promise<void>) => (afterCallback = cb) };
});

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function request(headers: Record<string, string> = {}) {
  return new Request("https://lifeos.test/api/cron/canvas-sync", { method: "POST", headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  syncCanvasAnnouncementsCoreMock.mockReset();
  syncCanvasGradesCoreMock.mockReset();
  syncCanvasAnnouncementsCoreMock.mockResolvedValue({ ok: true, staged: 0 });
  syncCanvasGradesCoreMock.mockResolvedValue({ ok: true, graded: 0, staged: 0 });
  afterCallback = null;
  serviceClient = makeServiceClient({});
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("POST /api/cron/canvas-sync", () => {
  it("503s when CRON_SECRET is unset -- fails closed, never open", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await import("../route");
    const res = await POST(request({ Authorization: "Bearer anything" }));
    expect(res.status).toBe(503);
  });

  it("401s on a wrong or missing token", async () => {
    const { POST } = await import("../route");
    const res = await POST(request({ Authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(afterCallback).toBeNull();
  });

  it("202s immediately and schedules the sync via after(), never awaiting it inline", async () => {
    const { POST } = await import("../route");
    const res = await POST(request({ Authorization: "Bearer test-secret" }));
    expect(res.status).toBe(202);
    expect(afterCallback).not.toBeNull();
    // Nothing synced yet -- the response returned before the scheduled work ran.
    expect(syncCanvasAnnouncementsCoreMock).not.toHaveBeenCalled();
  });

  it("only syncs users with token_status='ok' AND at least one mapped course", async () => {
    serviceClient = makeServiceClient({
      canvas_connections: { data: [{ user_id: "user-1" }, { user_id: "user-2" }], error: null },
      canvas_course_mappings: { data: [{ user_id: "user-1" }], error: null }, // only user-1 has a mapped course
      profiles: { data: [{ user_id: "user-1", timezone: "America/Chicago" }], error: null },
    });
    const { POST } = await import("../route");
    await POST(request({ Authorization: "Bearer test-secret" }));
    await afterCallback!();

    expect(syncCanvasAnnouncementsCoreMock).toHaveBeenCalledTimes(1);
    expect(syncCanvasAnnouncementsCoreMock).toHaveBeenCalledWith(serviceClient, "user-1", "America/Chicago", expect.any(Date));
    expect(syncCanvasGradesCoreMock).toHaveBeenCalledTimes(1);
  });

  it("a sync failure for one user is caught, never propagates out of the backgrounded job", async () => {
    serviceClient = makeServiceClient({
      canvas_connections: { data: [{ user_id: "user-1" }], error: null },
      canvas_course_mappings: { data: [{ user_id: "user-1" }], error: null },
      profiles: { data: [{ user_id: "user-1", timezone: "UTC" }], error: null },
    });
    syncCanvasAnnouncementsCoreMock.mockRejectedValue(new Error("boom"));
    const { POST } = await import("../route");
    await POST(request({ Authorization: "Bearer test-secret" }));
    await expect(afterCallback!()).resolves.toBeUndefined();
  });
});
