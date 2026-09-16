import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CANVAS-GAP-02 — `stripHtml` (sync-core.ts) is NOT mocked here: proving
 * this reuses the exact same HTML-to-text implementation the announcement
 * path already has, not a second one, is the point. `extractDeliverablesFromText`
 * and the staging cores are mocked -- their own behavior is already
 * covered by lib/school/__tests__/syllabus-extraction.test.ts and
 * lib/school/__tests__/staging-core.test.ts.
 */

const extractDeliverablesFromTextMock = vi.fn();
vi.mock("@/lib/school/syllabus-extraction", async (importOriginal) => {
  // Partial mock -- sync-core.ts (imported for the real stripHtml below)
  // transitively pulls RawItemSchema from this SAME module via
  // announcement-extraction.ts, so a full module replacement breaks that
  // unrelated import chain.
  const actual = await importOriginal<typeof import("@/lib/school/syllabus-extraction")>();
  return { ...actual, extractDeliverablesFromText: (...args: unknown[]) => extractDeliverablesFromTextMock(...args) };
});

const createStagingBatchCoreMock = vi.fn(async (..._args: unknown[]) => "batch-new");
const createStagedDeliverablesCoreMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/school/staging-core", () => ({
  createStagingBatchCore: (...args: unknown[]) => createStagingBatchCoreMock(...args),
  createStagedDeliverablesCore: (...args: unknown[]) => createStagedDeliverablesCoreMock(...args),
}));

const { importCanvasSyllabusCore } = await import("../syllabus-import-core");

const client = {} as SupabaseClient;
const userId = "user-1";
const classId = "class-1";
const tz = "America/Chicago";
const now = new Date("2026-09-16T12:00:00.000Z");

beforeEach(() => {
  extractDeliverablesFromTextMock.mockReset();
  createStagingBatchCoreMock.mockClear();
  createStagedDeliverablesCoreMock.mockClear();
});

describe("importCanvasSyllabusCore", () => {
  it("reports 'empty' (not an error) when Canvas has no syllabus_body at all -- never a silent no-op", async () => {
    const outcome = await importCanvasSyllabusCore(client, userId, classId, tz, now, null);
    expect(outcome).toEqual({ outcome: "empty" });
    expect(extractDeliverablesFromTextMock).not.toHaveBeenCalled();
  });

  it("reports 'empty' when the stripped text is too short to be a real syllabus", async () => {
    const outcome = await importCanvasSyllabusCore(client, userId, classId, tz, now, "<p>See front page.</p>");
    expect(outcome).toEqual({ outcome: "empty" });
    expect(extractDeliverablesFromTextMock).not.toHaveBeenCalled();
  });

  it("strips HTML to plain text before extraction -- reuses sync-core.ts's own stripHtml, not a second implementation", async () => {
    extractDeliverablesFromTextMock.mockResolvedValue({ status: "extracted", items: [], truncated: false });
    const html = `<p>${"Exam 1 is on October 5th. ".repeat(10)}</p><script>evil()</script>`;

    await importCanvasSyllabusCore(client, userId, classId, tz, now, html);

    const [, , text] = extractDeliverablesFromTextMock.mock.calls[0]!;
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<script>");
    expect(text).toContain("Exam 1 is on October 5th.");
  });

  it("stages extracted items via the SAME staging pipeline the manual PDF/paste path uses -- source 'syllabus', not a distinct Canvas source", async () => {
    extractDeliverablesFromTextMock.mockResolvedValue({
      status: "extracted",
      items: [{ name: "Midterm", type: "final_midterm", date: "2026-10-15", confidence: 1, sourceSnippet: null }],
      truncated: false,
    });
    const html = `<p>${"Midterm on October 15th. ".repeat(10)}</p>`;

    const outcome = await importCanvasSyllabusCore(client, userId, classId, tz, now, html);

    expect(outcome).toEqual({ outcome: "extracted", batchId: "batch-new", itemCount: 1, truncated: false });
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(client, userId, classId, "syllabus");
    expect(createStagedDeliverablesCoreMock).toHaveBeenCalledWith(client, userId, "batch-new", [
      { name: "Midterm", type: "final_midterm", date: "2026-10-15", confidence: 1, sourceSnippet: null },
    ]);
  });

  it.each(["no_key", "unavailable", "parse_failed"] as const)("passes a non-extracted status (%s) straight through, without staging anything", async (status) => {
    extractDeliverablesFromTextMock.mockResolvedValue({ status });
    const html = `<p>${"Real syllabus content here. ".repeat(10)}</p>`;

    const outcome = await importCanvasSyllabusCore(client, userId, classId, tz, now, html);

    expect(outcome).toEqual({ outcome: status });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("never touches announcement staging's own dedup state -- this is a different pipeline, same extraction function only", async () => {
    extractDeliverablesFromTextMock.mockResolvedValue({ status: "extracted", items: [], truncated: false });
    const html = `<p>${"Real syllabus content here. ".repeat(10)}</p>`;

    await importCanvasSyllabusCore(client, userId, classId, tz, now, html);

    // stageAnnouncementCore/announcement-extraction-core.ts is never imported by
    // this module at all -- verified structurally, not just "wasn't called" (an
    // import that never happens can't accidentally touch announcement state).
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(client, userId, classId, "syllabus");
  });
});
