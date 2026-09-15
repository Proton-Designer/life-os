import { describe, expect, it, vi, afterEach } from "vitest";

const afterMock = vi.fn((_cb: () => unknown) => {});
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ __fake: "service-client" })) }));

const processOneTranscriptionJobMock = vi.fn(async (..._args: unknown[]) => ({ processed: true, status: "completed", recordingId: "rec-1" }));
vi.mock("@/lib/school/lecture-transcription-worker", () => ({
  processOneTranscriptionJob: (...args: unknown[]) => processOneTranscriptionJobMock(...args),
}));

const { POST } = await import("../route");

const ORIGINAL_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  afterMock.mockClear();
  processOneTranscriptionJobMock.mockClear();
});

function req(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/lecture-transcription", { method: "POST", headers });
}

describe("POST /api/cron/lecture-transcription (P3-15)", () => {
  it("fails CLOSED (503) when CRON_SECRET isn't configured -- never public by accident", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(503);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header (401)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret (401)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
  });

  // tracking-app-a9 + Opus Lead review: pg_net (the actual caller, via
  // jobid 1) times out around 5s -- the route must respond long before a
  // real transcription job could ever finish. This is the load-bearing test:
  // it proves the response doesn't wait on the job at all, by never letting
  // processOneTranscriptionJob's own promise resolve during the request.
  it("schedules the job via after() and returns 202 WITHOUT awaiting it", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    let resolveJob: (() => void) | undefined;
    processOneTranscriptionJobMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveJob = () => resolve({ processed: true, status: "completed", recordingId: "rec-1" });
          // deliberately never called during this test -- if POST were
          // awaiting this promise, the test would hang and time out.
        }),
    );

    const res = await POST(req("Bearer s3cr3t"));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ accepted: true });
    // The job was scheduled (after() received a callback) but not yet run --
    // POST returned before that callback was ever invoked.
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(processOneTranscriptionJobMock).not.toHaveBeenCalled();

    // Now actually run what after() was given, to confirm it's the real job.
    // resolveJob is called right after invoking (not before, and not after
    // awaiting) -- the mocked job promise only resolves once `scheduled()`
    // has actually reached the point of calling processOneTranscriptionJob.
    const scheduled = afterMock.mock.calls[0]![0];
    const runPromise = scheduled();
    resolveJob?.();
    await runPromise;
    expect(processOneTranscriptionJobMock).toHaveBeenCalledTimes(1);
  });

  it("the after() callback logs a caught error instead of throwing unhandled", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    processOneTranscriptionJobMock.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(req("Bearer s3cr3t"));
    const scheduled = afterMock.mock.calls[0]![0];
    await scheduled(); // must not reject -- the route's own try/catch swallows it

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
