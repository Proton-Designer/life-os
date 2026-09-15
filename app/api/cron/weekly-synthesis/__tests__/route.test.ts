import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ __fake: "service-client" })) }));

const dispatchCollegeOsWeeklyNarrativesMock = vi.fn(async (..._args: unknown[]) => ({ usersChecked: 3, generated: 1 }));
vi.mock("@/lib/weekly-review/weekly-narrative", () => ({
  dispatchCollegeOsWeeklyNarratives: (...args: unknown[]) => dispatchCollegeOsWeeklyNarrativesMock(...args),
}));

const dispatchUlmWeeklyRecapsMock = vi.fn(async (..._args: unknown[]) => ({ usersChecked: 3, recorded: 2 }));
vi.mock("@/lib/self-mastery/weekly-retention-recap", () => ({
  dispatchUlmWeeklyRecaps: (...args: unknown[]) => dispatchUlmWeeklyRecapsMock(...args),
}));

const { POST } = await import("../route");

const ORIGINAL_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  dispatchCollegeOsWeeklyNarrativesMock.mockClear();
  dispatchUlmWeeklyRecapsMock.mockClear();
});

function req(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/weekly-synthesis", { method: "POST", headers });
}

describe("POST /api/cron/weekly-synthesis (P2-03)", () => {
  it("fails CLOSED (503) when CRON_SECRET isn't configured -- never public by accident", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(503);
    expect(dispatchCollegeOsWeeklyNarrativesMock).not.toHaveBeenCalled();
    expect(dispatchUlmWeeklyRecapsMock).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header (401)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(dispatchCollegeOsWeeklyNarrativesMock).not.toHaveBeenCalled();
    expect(dispatchUlmWeeklyRecapsMock).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret (401)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("runs BOTH dispatchers on the right secret and returns their counts, separately keyed", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      narratives: { usersChecked: 3, generated: 1 },
      recaps: { usersChecked: 3, recorded: 2 },
    });
    expect(dispatchCollegeOsWeeklyNarrativesMock).toHaveBeenCalledTimes(1);
    expect(dispatchUlmWeeklyRecapsMock).toHaveBeenCalledTimes(1);
  });

  it("both dispatchers receive the SAME `now` instant, so a Sunday-window check can never disagree between them", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    await POST(req("Bearer s3cr3t"));
    const narrativesArgs = dispatchCollegeOsWeeklyNarrativesMock.mock.calls[0]!;
    const recapsArgs = dispatchUlmWeeklyRecapsMock.mock.calls[0]!;
    expect(narrativesArgs[1]).toEqual(recapsArgs[1]);
  });
});
