import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanvasCourseSummary } from "@/lib/canvas/client";

/**
 * P2-22 04-verification failure (a9, live against production): a fixture
 * connection with an undecryptable stored token left `refreshCanvasCourses`
 * throwing straight out of `resolveStoredConnection`'s `decryptSecret` call
 * — no try/catch anywhere in the action, so the Server Action rejected, the
 * UI showed nothing, and canvas_connections' token_status/last_sync_error
 * were never written. Red first: these tests are written against the
 * PRE-FIX action and fail (the handler rejects instead of resolving to
 * {ok:false,...}) until the try/catch lands.
 */

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update", "upsert"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock } as unknown as SupabaseClient, userId: "user-1" }));
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago" }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock(), getProfile: () => getProfileMock() }));

const decryptSecretMock = vi.fn((s: string) => s);
vi.mock("@/lib/ai/encryption", () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => decryptSecretMock(s),
  isKeyStorageConfigured: () => true,
  last4: (s: string) => s.slice(-4),
}));

const fetchCanvasCoursesMock = vi.fn();
const fetchConcludedCanvasCoursesMock = vi.fn(async (..._args: unknown[]): Promise<{ ok: true; data: CanvasCourseSummary[] }> => ({ ok: true, data: [] }));
const fetchCanvasIcsFeedMock = vi.fn();
vi.mock("@/lib/canvas/client", () => ({
  verifyCanvasToken: vi.fn(),
  fetchCanvasCourses: (...args: unknown[]) => fetchCanvasCoursesMock(...args),
  fetchConcludedCanvasCourses: (...args: unknown[]) => fetchConcludedCanvasCoursesMock(...args),
  fetchCanvasIcsFeed: (...args: unknown[]) => fetchCanvasIcsFeedMock(...args),
}));

const autoImportCanvasCoursesAsClassesCoreMock = vi.fn(async (..._args: unknown[]) => ({ created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 }));
vi.mock("@/lib/canvas/course-auto-import-core", () => ({
  autoImportCanvasCoursesAsClassesCore: (...args: unknown[]) => autoImportCanvasCoursesAsClassesCoreMock(...args),
}));

const reconcileCanvasIcsCoreMock = vi.fn();
vi.mock("@/lib/canvas/ics-reconcile-core", () => ({
  reconcileCanvasIcsCore: (...args: unknown[]) => reconcileCanvasIcsCoreMock(...args),
}));

vi.mock("@/lib/net/safe-outbound-url", () => ({
  checkUrlSyntax: () => ({ ok: true }),
  resolveSafeOutboundUrl: async () => ({ ok: true }),
  safeOrigin: (s: string) => s,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("refreshCanvasCourses failure handling (P2-22 04-verification fix)", () => {
  beforeEach(() => {
    fromMock.mockClear();
    decryptSecretMock.mockReset();
    fetchCanvasCoursesMock.mockReset();
  });

  it("a decrypt failure resolves to {ok:false} and marks the connection expired with a reconnect message, instead of throwing", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "garbage" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    decryptSecretMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });

    const { refreshCanvasCourses } = await import("../canvas-actions");
    const result = await refreshCanvasCourses();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/reconnect/i);
    expect(fetchCanvasCoursesMock).not.toHaveBeenCalled();
    expect(connectionsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ token_status: "expired", last_sync_error: expect.stringMatching(/reconnect/i) }),
    );
  });

  it("an unexpected exception after the connection resolves records a generic last_sync_error and returns {ok:false}, not a thrown rejection", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "enc" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    decryptSecretMock.mockImplementation((s: string) => s);
    fetchCanvasCoursesMock.mockRejectedValue(new Error("boom"));

    const { refreshCanvasCourses } = await import("../canvas-actions");
    const result = await refreshCanvasCourses();

    expect(result.ok).toBe(false);
    expect(connectionsChain.update).toHaveBeenCalledWith(expect.objectContaining({ last_sync_error: expect.any(String) }));
    // Not marked expired -- an unrelated exception isn't evidence the token is bad.
    const updateCall = connectionsChain.update.mock.calls.find((c) => "last_sync_error" in c[0]);
    expect(updateCall?.[0]).not.toHaveProperty("token_status");
  });
});

// CANVAS-LITE-04: "state the count and offer to import them, rather than
// skipping silently" -- concluded/inactive courses.
describe("refreshCanvasCourses / importConcludedCanvasCourses -- concluded courses (CANVAS-LITE-04)", () => {
  beforeEach(() => {
    fromMock.mockClear();
    fetchCanvasCoursesMock.mockReset();
    fetchConcludedCanvasCoursesMock.mockReset();
    autoImportCanvasCoursesAsClassesCoreMock.mockClear();
    decryptSecretMock.mockImplementation((s: string) => s);
  });

  it("refreshCanvasCourses reports the concluded count without failing the sync when the concluded fetch itself fails", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "enc" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    fetchCanvasCoursesMock.mockResolvedValue({ ok: true, data: [] });
    fetchConcludedCanvasCoursesMock.mockRejectedValue(new Error("boom"));

    const { refreshCanvasCourses } = await import("../canvas-actions");
    const result = await refreshCanvasCourses();

    expect(result.ok).toBe(true);
    expect(result.concludedCount).toBe(0);
    expect(result.message).toBe("No active courses found on Canvas.");
  });

  it("refreshCanvasCourses states the concluded count in the message and on the result", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "enc" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    fetchCanvasCoursesMock.mockResolvedValue({ ok: true, data: [] });
    fetchConcludedCanvasCoursesMock.mockResolvedValue({ ok: true, data: [{ canvasCourseId: "30", name: "Old Course", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }] });

    const { refreshCanvasCourses } = await import("../canvas-actions");
    const result = await refreshCanvasCourses();

    expect(result.concludedCount).toBe(1);
    expect(result.message).toBe("No active courses found on Canvas. 1 concluded course skipped.");
  });

  it("importConcludedCanvasCourses runs the fetched concluded courses through the shared auto-import core and reports the summary", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "enc" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    fetchConcludedCanvasCoursesMock.mockResolvedValue({ ok: true, data: [{ canvasCourseId: "30", name: "Old Course", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }] });
    autoImportCanvasCoursesAsClassesCoreMock.mockResolvedValue({ created: 1, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 });

    const { importConcludedCanvasCourses } = await import("../canvas-actions");
    const result = await importConcludedCanvasCourses();

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Imported 1 concluded course. (1 class added)");
    expect(autoImportCanvasCoursesAsClassesCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", [
      { canvasCourseId: "30", name: "Old Course", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null },
    ]);
  });

  it("importConcludedCanvasCourses reports honestly when there are none, without calling the auto-import core at all", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "enc" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    fetchConcludedCanvasCoursesMock.mockResolvedValue({ ok: true, data: [] });

    const { importConcludedCanvasCourses } = await import("../canvas-actions");
    const result = await importConcludedCanvasCourses();

    expect(result).toEqual({ ok: true, message: "No concluded courses found." });
    expect(autoImportCanvasCoursesAsClassesCoreMock).not.toHaveBeenCalled();
  });
});

// CANVAS-LITE-04: the same honest course-import summary the token path's
// connectCanvas/refreshCanvasCourses already show must also appear here --
// a no-token student sees identical reporting.
describe("reconcileCanvasIcs -- course-import summary (CANVAS-LITE-04)", () => {
  beforeEach(() => {
    fromMock.mockClear();
    fetchCanvasIcsFeedMock.mockReset();
    reconcileCanvasIcsCoreMock.mockReset();
  });

  it("appends the course-import summary to the assignment message", async () => {
    const connectionsChain = makeChain({ data: { encrypted_ics_feed_url: "enc-url", last_ics_reconcile_at: null }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    fetchCanvasIcsFeedMock.mockResolvedValue({ ok: true, data: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" });
    reconcileCanvasIcsCoreMock.mockResolvedValue({
      parsedAssignmentEvents: 3,
      alreadyCovered: 0,
      linkedToExisting: 0,
      unmapped: 0,
      newlyStaged: 2,
      courseImport: { created: 1, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 },
    });

    const { reconcileCanvasIcs } = await import("../canvas-actions");
    const result = await reconcileCanvasIcs();

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Found 2 new assignments staged for your review. (1 class added)");
  });

  it("reports no assignments AND no course changes honestly, without a stray trailing note", async () => {
    const connectionsChain = makeChain({ data: { encrypted_ics_feed_url: "enc-url", last_ics_reconcile_at: null }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    fetchCanvasIcsFeedMock.mockResolvedValue({ ok: true, data: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" });
    reconcileCanvasIcsCoreMock.mockResolvedValue({
      parsedAssignmentEvents: 0,
      alreadyCovered: 0,
      linkedToExisting: 0,
      unmapped: 0,
      newlyStaged: 0,
      courseImport: { created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 },
    });

    const { reconcileCanvasIcs } = await import("../canvas-actions");
    const result = await reconcileCanvasIcs();

    expect(result.message).toBe("No new assignments found in your calendar feed.");
  });
});

// CANVAS-GAP-06: a genuinely no-token account (the user's own situation --
// their school blocks Canvas access tokens) must be able to save an ICS
// feed URL with ZERO prior canvas_connections row, and the resulting
// status must never claim a token connection that doesn't exist.
describe("saveCanvasIcsFeedUrl / getCanvasConnectionStatus -- token-less ICS accounts (CANVAS-GAP-06)", () => {
  beforeEach(() => {
    fromMock.mockClear();
  });

  it("saveCanvasIcsFeedUrl succeeds when NO canvas_connections row exists yet, via upsert not update", async () => {
    const connectionsChain = makeChain({ data: null, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));

    const { saveCanvasIcsFeedUrl } = await import("../canvas-actions");
    const result = await saveCanvasIcsFeedUrl("https://school.instructure.com/feeds/calendars/user_abc123.ics");

    expect(result.ok).toBe(true);
    expect(connectionsChain.upsert).toHaveBeenCalled();
    const payload = connectionsChain.upsert.mock.calls[0]![0] as Record<string, unknown>;
    // Honest: no token fields fabricated to satisfy the (now-nullable) columns.
    expect(payload).not.toHaveProperty("instance_url");
    expect(payload).not.toHaveProperty("encrypted_token");
    expect(payload).not.toHaveProperty("token_last4");
    expect(payload).toHaveProperty("encrypted_ics_feed_url");
    expect(payload).toHaveProperty("ics_feed_url_last4");
  });

  it("saveCanvasIcsFeedUrl still works (adopts the existing row) when a token connection already exists", async () => {
    const connectionsChain = makeChain({ data: { user_id: "user-1" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));

    const { saveCanvasIcsFeedUrl } = await import("../canvas-actions");
    const result = await saveCanvasIcsFeedUrl("https://school.instructure.com/feeds/calendars/user_abc123.ics");

    expect(result.ok).toBe(true);
    expect(connectionsChain.upsert).toHaveBeenCalled();
  });

  it("getCanvasConnectionStatus reports connected:false for an ICS-only row (instance_url null), even though a row exists", async () => {
    const connectionsChain = makeChain({
      data: {
        instance_url: null,
        token_last4: null,
        canvas_user_name: null,
        token_status: null,
        last_synced_at: null,
        last_sync_error: null,
        ics_feed_url_last4: "c123",
        last_ics_reconcile_at: null,
      },
      error: null,
    });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));

    const { getCanvasConnectionStatus } = await import("../canvas-actions");
    const status = await getCanvasConnectionStatus();

    expect(status.connected).toBe(false);
    expect(status.icsFeedConnected).toBe(true);
  });

  it("getCanvasConnectionStatus still reports connected:true for a real token row", async () => {
    const connectionsChain = makeChain({
      data: {
        instance_url: "https://school.instructure.com",
        token_last4: "abcd",
        canvas_user_name: "A Student",
        token_status: "ok",
        last_synced_at: null,
        last_sync_error: null,
        ics_feed_url_last4: null,
        last_ics_reconcile_at: null,
      },
      error: null,
    });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));

    const { getCanvasConnectionStatus } = await import("../canvas-actions");
    const status = await getCanvasConnectionStatus();

    expect(status.connected).toBe(true);
  });
});
