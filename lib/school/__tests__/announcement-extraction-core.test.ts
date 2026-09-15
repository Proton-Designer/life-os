import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P2-21 — stageAnnouncementCore is P2-07's own extraction/staging logic,
 * extracted from app/(app)/school/announcement-actions.ts so the new Canvas
 * announcement poller (lib/canvas/sync-core.ts) can call it directly,
 * without a cookie session. app/(app)/school/__tests__/announcement-actions.test.ts
 * still covers the thin Server Action wrapper end to end; these tests are
 * the core's own, including the canvasAnnouncementId threading that file
 * never exercised.
 */

const extractMock = vi.fn();
vi.mock("@/lib/school/announcement-extraction", () => ({
  extractDeliverablesFromAnnouncementText: (...args: unknown[]) => extractMock(...args),
}));

const createStagingBatchCoreMock = vi.fn(async (..._args: unknown[]) => "batch-1");
const createStagedDeliverablesCoreMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/school/staging-core", () => ({
  createStagingBatchCore: (...args: unknown[]) => createStagingBatchCoreMock(...args),
  createStagedDeliverablesCore: (...args: unknown[]) => createStagedDeliverablesCoreMock(...args),
}));

const { stageAnnouncementCore } = await import("../announcement-extraction-core");
const client = {} as unknown as SupabaseClient;

beforeEach(() => {
  extractMock.mockReset();
  createStagingBatchCoreMock.mockClear();
  createStagedDeliverablesCoreMock.mockClear();
});

describe("stageAnnouncementCore (P2-21, extracted from P2-07's action)", () => {
  it("a too-short paste never calls the gateway or creates a batch", async () => {
    const result = await stageAnnouncementCore(client, "user-1", "class-1", "hi", "2026-09-15");
    expect(result).toEqual({ outcome: "too_short" });
    expect(extractMock).not.toHaveBeenCalled();
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("a no_key/unavailable/parse_failed outcome creates no batch", async () => {
    extractMock.mockResolvedValue({ status: "unavailable" });
    const result = await stageAnnouncementCore(client, "user-1", "class-1", "A real announcement about a quiz.", "2026-09-15");
    expect(result).toEqual({ outcome: "unavailable" });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("a genuine extraction stages with source='announcement' and no canvasAnnouncementId when omitted", async () => {
    extractMock.mockResolvedValue({ status: "extracted", items: [{ name: "Quiz", type: "quiz", date: "2026-10-01", confidence: 0.8, sourceSnippet: "x" }], truncated: false });
    const result = await stageAnnouncementCore(client, "user-1", "class-1", "The quiz moved to Oct 1.", "2026-09-15");
    expect(result).toEqual({ outcome: "extracted", batchId: "batch-1", itemCount: 1, truncated: false });
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(client, "user-1", "class-1", "announcement", "The quiz moved to Oct 1.", undefined);
  });

  it("threads canvasAnnouncementId through to createStagingBatchCore (the poller's dedup marker)", async () => {
    extractMock.mockResolvedValue({ status: "extracted", items: [], truncated: false });
    await stageAnnouncementCore(client, "user-1", "class-1", "New assignment posted.", "2026-09-15", "canvas-announce-42");
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(client, "user-1", "class-1", "announcement", "New assignment posted.", "canvas-announce-42");
  });
});
