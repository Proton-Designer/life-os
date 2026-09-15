import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
  getProfile: vi.fn(async () => ({ timezone: "America/Chicago" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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

const { extractAnnouncementDeliverables, getAnnouncementHistory } = await import("../announcement-actions");

beforeEach(() => {
  requireUserMock.mockClear();
  extractMock.mockReset();
  createStagingBatchCoreMock.mockClear();
  createStagedDeliverablesCoreMock.mockClear();
});

describe("extractAnnouncementDeliverables (P2-07)", () => {
  it("THE REGRESSION GUARD: a too-short paste never calls the gateway or creates a batch", async () => {
    const result = await extractAnnouncementDeliverables("class-1", "hi");
    expect(result).toEqual({ outcome: "too_short" });
    expect(extractMock).not.toHaveBeenCalled();
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("a no_key/unavailable/parse_failed outcome creates NO batch -- same rule as the syllabus path", async () => {
    extractMock.mockResolvedValue({ status: "no_key" });
    const result = await extractAnnouncementDeliverables("class-1", "A real announcement about a quiz.");
    expect(result).toEqual({ outcome: "no_key" });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("a genuine extraction (including zero items) creates a batch with source='announcement' and the trimmed raw text", async () => {
    extractMock.mockResolvedValue({ status: "extracted", items: [{ name: "Quiz", type: "quiz", date: "2026-10-01", confidence: 0.8, sourceSnippet: "x" }], truncated: false });
    const result = await extractAnnouncementDeliverables("class-1", "  The quiz has been moved to Oct 1.  ");
    expect(result).toEqual({ outcome: "extracted", batchId: "batch-1", itemCount: 1, truncated: false });
    // P2-21: createStagingBatchCore gained a 6th (canvasAnnouncementId) param --
    // undefined for a manually-pasted announcement, unchanged behavior.
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "class-1", "announcement", "The quiz has been moved to Oct 1.", undefined);
    expect(createStagedDeliverablesCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "batch-1", expect.any(Array));
  });

  it("a zero-item extraction still creates a batch (the announcement equivalent of #19 'nothing schedulable found')", async () => {
    extractMock.mockResolvedValue({ status: "extracted", items: [], truncated: false });
    const result = await extractAnnouncementDeliverables("class-1", "Reminder: office hours are at 3pm today.");
    expect(result.outcome).toBe("extracted");
    expect(createStagingBatchCoreMock).toHaveBeenCalledTimes(1);
  });

  it("truncates the stored raw_text to the migration's own CHECK bound", async () => {
    extractMock.mockResolvedValue({ status: "extracted", items: [], truncated: false });
    const longText = "x".repeat(20_000);
    await extractAnnouncementDeliverables("class-1", longText);
    const storedText = createStagingBatchCoreMock.mock.calls[0]![4] as string;
    expect(storedText.length).toBeLessThanOrEqual(10_000);
  });
});

describe("getAnnouncementHistory (P2-07)", () => {
  function makeSupabase(batches: Record<string, unknown>[], deliverables: Record<string, unknown>[]) {
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.in = vi.fn(() => chain);
      chain.order = vi.fn(() => chain);
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
        if (table === "staging_batches") return resolve({ data: batches, error: null });
        if (table === "staged_deliverables") return resolve({ data: deliverables, error: null });
        resolve({ data: [], error: null });
      };
      return chain;
    });
    return { from } as unknown as SupabaseClient;
  }

  it("returns an empty list when the class has no announcement batches, without a second query", async () => {
    requireUserMock.mockResolvedValue({ supabase: makeSupabase([], []), userId: "user-1" });
    const result = await getAnnouncementHistory("class-1");
    expect(result).toEqual([]);
  });

  it("maps each batch with its deliverable count, most recent first (the query's own ordering, trusted)", async () => {
    requireUserMock.mockResolvedValue({
      supabase: makeSupabase(
        [
          { id: "b1", raw_text: "Quiz moved.", status: "confirmed", created_at: "2026-09-10T00:00:00Z" },
          { id: "b2", raw_text: "Exam added.", status: "pending", created_at: "2026-09-05T00:00:00Z" },
        ],
        [
          { batch_id: "b1" },
          { batch_id: "b1" },
          { batch_id: "b2" },
        ]
      ),
      userId: "user-1",
    });
    const result = await getAnnouncementHistory("class-1");
    expect(result).toEqual([
      { id: "b1", rawText: "Quiz moved.", status: "confirmed", itemCount: 2, createdAt: "2026-09-10T00:00:00Z" },
      { id: "b2", rawText: "Exam added.", status: "pending", itemCount: 1, createdAt: "2026-09-05T00:00:00Z" },
    ]);
  });

  it("a batch with zero remaining deliverables (everything rejected) reports itemCount 0, not undefined", async () => {
    requireUserMock.mockResolvedValue({
      supabase: makeSupabase([{ id: "b1", raw_text: "Nothing kept.", status: "confirmed", created_at: "2026-09-10T00:00:00Z" }], []),
      userId: "user-1",
    });
    const result = await getAnnouncementHistory("class-1");
    expect(result[0]!.itemCount).toBe(0);
  });
});
