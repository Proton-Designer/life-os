import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CANVAS-GAP-02 — `importCanvasSyllabus`'s own orchestration (connection
 * resolution, course-mapping lookup, fetch failure handling). The actual
 * extraction/staging behavior is `importCanvasSyllabusCore`'s own,
 * already covered by lib/canvas/__tests__/syllabus-import-core.test.ts --
 * mocked here so this file is about WHEN it gets called, not what it does.
 */

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  return chain;
}

let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock } as unknown as SupabaseClient, userId: "user-1" }));
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago" }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock(), getProfile: () => getProfileMock() }));

const resolveCanvasConnectionCoreMock = vi.fn();
vi.mock("@/lib/canvas/connection-core", () => ({
  resolveCanvasConnectionCore: (...args: unknown[]) => resolveCanvasConnectionCoreMock(...args),
}));

const fetchCanvasCourseSyllabusMock = vi.fn();
vi.mock("@/lib/canvas/client", () => ({
  fetchCanvasCourseSyllabus: (...args: unknown[]) => fetchCanvasCourseSyllabusMock(...args),
}));

const importCanvasSyllabusCoreMock = vi.fn();
vi.mock("@/lib/canvas/syllabus-import-core", () => ({
  importCanvasSyllabusCore: (...args: unknown[]) => importCanvasSyllabusCoreMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

// extractSyllabusDeliverables (unaffected, unrelated to CANVAS-GAP-02) is
// also exported from this file and imports pdf.js machinery -- not
// exercised here, but its own module-level imports must not blow up.
vi.mock("@/lib/self-mastery/ingestion/pdf", () => ({ loadPdf: vi.fn(), extractPages: vi.fn() }));
vi.mock("@/lib/self-mastery/ingestion/text-repair", () => ({ repairExtractedPages: vi.fn() }));

beforeEach(() => {
  fromMock.mockClear();
  resolveCanvasConnectionCoreMock.mockReset();
  fetchCanvasCourseSyllabusMock.mockReset();
  importCanvasSyllabusCoreMock.mockReset();
  revalidatePathMock.mockClear();
});

describe("importCanvasSyllabus (CANVAS-GAP-02)", () => {
  it("reports not_connected when Canvas was never connected", async () => {
    resolveCanvasConnectionCoreMock.mockResolvedValue(null);
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "not_connected" });
    expect(fetchCanvasCourseSyllabusMock).not.toHaveBeenCalled();
  });

  it("reports not_connected (never throws) when the stored token can't be decrypted", async () => {
    resolveCanvasConnectionCoreMock.mockRejectedValue(new Error("decrypt failed"));
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "not_connected" });
  });

  it("reports not_mapped when this class has no Canvas course mapping", async () => {
    resolveCanvasConnectionCoreMock.mockResolvedValue({ instanceUrl: "https://school.instructure.com", token: "tok" });
    fromImpl = () => makeChain({ data: null, error: null });
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "not_mapped" });
    expect(fetchCanvasCourseSyllabusMock).not.toHaveBeenCalled();
  });

  it("reports fetch_failed with Canvas's own message on a fetch failure, without throwing", async () => {
    resolveCanvasConnectionCoreMock.mockResolvedValue({ instanceUrl: "https://school.instructure.com", token: "tok" });
    fromImpl = () => makeChain({ data: { canvas_course_id: "10" }, error: null });
    fetchCanvasCourseSyllabusMock.mockResolvedValue({ ok: false, message: "Canvas rejected that token." });
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "fetch_failed", message: "Canvas rejected that token." });
    expect(importCanvasSyllabusCoreMock).not.toHaveBeenCalled();
  });

  it("reports fetch_failed (never throws) when the fetch itself rejects", async () => {
    resolveCanvasConnectionCoreMock.mockResolvedValue({ instanceUrl: "https://school.instructure.com", token: "tok" });
    fromImpl = () => makeChain({ data: { canvas_course_id: "10" }, error: null });
    fetchCanvasCourseSyllabusMock.mockRejectedValue(new Error("boom"));
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "fetch_failed", message: "boom" });
  });

  it("calls importCanvasSyllabusCore with the fetched syllabus and revalidates on a real extraction", async () => {
    resolveCanvasConnectionCoreMock.mockResolvedValue({ instanceUrl: "https://school.instructure.com", token: "tok" });
    fromImpl = () => makeChain({ data: { canvas_course_id: "10" }, error: null });
    fetchCanvasCourseSyllabusMock.mockResolvedValue({ ok: true, data: "<p>Exam 1 on Oct 5</p>" });
    importCanvasSyllabusCoreMock.mockResolvedValue({ outcome: "extracted", batchId: "batch-1", itemCount: 2, truncated: false });
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "extracted", batchId: "batch-1", itemCount: 2, truncated: false });
    expect(importCanvasSyllabusCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "class-1", "America/Chicago", expect.any(Date), "<p>Exam 1 on Oct 5</p>");
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("does NOT revalidate when the core reports 'empty' -- nothing changed", async () => {
    resolveCanvasConnectionCoreMock.mockResolvedValue({ instanceUrl: "https://school.instructure.com", token: "tok" });
    fromImpl = () => makeChain({ data: { canvas_course_id: "10" }, error: null });
    fetchCanvasCourseSyllabusMock.mockResolvedValue({ ok: true, data: null });
    importCanvasSyllabusCoreMock.mockResolvedValue({ outcome: "empty" });
    const { importCanvasSyllabus } = await import("../syllabus-extraction-actions");

    const result = await importCanvasSyllabus("class-1");

    expect(result).toEqual({ outcome: "empty" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
