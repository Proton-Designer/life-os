import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }),
  getProfile: async () => ({ timezone: "America/Chicago" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const SYLLABUS_TEXT = "Course schedule. Midterm on November 3. ".repeat(10);
vi.mock("@/lib/self-mastery/ingestion/pdf", () => ({ loadPdf: async () => ({}), extractPages: async () => [{ pageNumber: 1, text: SYLLABUS_TEXT }] }));
vi.mock("@/lib/self-mastery/ingestion/text-repair", () => ({ repairExtractedPages: (p: unknown) => p }));
const extractMock = vi.fn();
vi.mock("@/lib/school/syllabus-extraction", () => ({ extractDeliverablesFromText: (...a: unknown[]) => extractMock(...a) }));
vi.mock("@/lib/school/staging-core", () => ({ createStagingBatchCore: vi.fn(async () => "b"), createStagedDeliverablesCore: vi.fn() }));
vi.mock("@/lib/canvas/connection-core", () => ({ resolveCanvasConnectionCore: vi.fn() }));
vi.mock("@/lib/canvas/client", () => ({ fetchCanvasCourseSyllabus: vi.fn() }));
vi.mock("@/lib/canvas/syllabus-import-core", () => ({ importCanvasSyllabusCore: vi.fn() }));
const routeMock = vi.fn(async (..._a: unknown[]): Promise<string> => "queue");
vi.mock("@/lib/agent-jobs/route", () => ({ routeAiRequest: (...a: unknown[]) => routeMock(...a) }));
const enqueueMock = vi.fn(async (..._a: unknown[]) => "job-9");
vi.mock("@/lib/agent-jobs/core", () => ({ enqueueAgentJobCore: (...a: unknown[]) => enqueueMock(...a) }));

const { extractSyllabusDeliverables } = await import("../syllabus-extraction-actions");

function pdfForm() {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "syllabus.pdf", { type: "application/pdf" }));
  return fd;
}

beforeEach(() => {
  routeMock.mockReset().mockResolvedValue("queue");
  enqueueMock.mockClear();
  extractMock.mockReset();
});

describe("extractSyllabusDeliverables — no key, connected agent (agent work queue)", () => {
  it("queues the extracted text for the agent instead of calling the model", async () => {
    const result = await extractSyllabusDeliverables("class-1", pdfForm());
    expect(result).toEqual({ outcome: "queued", jobId: "job-9" });
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), {
      kind: "school.syllabus_extract",
      subjectId: "class-1",
      input: { text: SYLLABUS_TEXT.trim(), today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), truncated: false },
    });
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("with a key (inline) it extracts as before and queues nothing", async () => {
    routeMock.mockResolvedValue("inline");
    extractMock.mockResolvedValue({ status: "no_key" });
    const result = await extractSyllabusDeliverables("class-1", pdfForm());
    expect(result).toEqual({ outcome: "no_key" });
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
