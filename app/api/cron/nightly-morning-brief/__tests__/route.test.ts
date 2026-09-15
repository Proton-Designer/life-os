import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ __fake: "service-client" })) }));

const dispatchNightlyMorningBriefsMock = vi.fn(async (..._args: unknown[]) => ({ usersChecked: 5, generated: 2 }));
vi.mock("@/lib/ai/morning-brief", () => ({
  dispatchNightlyMorningBriefs: (...args: unknown[]) => dispatchNightlyMorningBriefsMock(...args),
}));

const { POST } = await import("../route");

const ORIGINAL_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  dispatchNightlyMorningBriefsMock.mockClear();
});

function req(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/nightly-morning-brief", { method: "POST", headers });
}

describe("POST /api/cron/nightly-morning-brief (P2-02)", () => {
  it("fails CLOSED (503) when CRON_SECRET isn't configured -- never public by accident", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(503);
    expect(dispatchNightlyMorningBriefsMock).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header (401)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(dispatchNightlyMorningBriefsMock).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret (401)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("runs the dispatch and returns its counts on the right secret", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, usersChecked: 5, generated: 2 });
    expect(dispatchNightlyMorningBriefsMock).toHaveBeenCalledTimes(1);
  });
});
