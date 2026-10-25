import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));
const { validateExtractedItems } = await import("../syllabus-extraction");
const { validateQuestionDrafts } = await import("../question-draft-generation");

const TODAY = "2026-10-25";

describe("validateExtractedItems — what an agent submits for a syllabus / announcement", () => {
  it("accepts a valid array and normalizes it exactly like the in-app path (bad type -> homework_assignment at confidence 0, far date -> null)", () => {
    const res = validateExtractedItems(
      [
        { name: " Midterm 1 ", type: "exam", date: "2026-11-03", confidence: 0.9, sourceSnippet: "Midterm on Nov 3" },
        { name: "Reading quiz", type: "pop quiz", date: "2099-01-01", confidence: 0.8 },
      ],
      TODAY,
    );
    expect(res).toEqual({
      ok: true,
      items: [
        { name: "Midterm 1", type: "exam", date: "2026-11-03", confidence: 0.9, sourceSnippet: "Midterm on Nov 3" },
        { name: "Reading quiz", type: "homework_assignment", date: null, confidence: 0, sourceSnippet: null },
      ],
    });
  });

  it("also accepts the array as a JSON string, with a code fence", () => {
    const res = validateExtractedItems('```json\n[{"name":"Quiz","type":"quiz","date":null,"confidence":0.5}]\n```', TODAY);
    expect(res.ok).toBe(true);
  });

  it("accepts an empty array (nothing to extract is a legitimate result)", () => {
    expect(validateExtractedItems([], TODAY)).toEqual({ ok: true, items: [] });
  });

  it("rejects a schema-invalid result with a message that names the bad field, so the agent can fix it", () => {
    const res = validateExtractedItems([{ name: "Quiz", type: "quiz", date: null, confidence: 7 }], TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/\[0\]\.confidence/);
  });

  it("rejects non-array, non-JSON, and more than 200 items", () => {
    expect(validateExtractedItems({ items: [] }, TODAY).ok).toBe(false);
    expect(validateExtractedItems("not json", TODAY).ok).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => ({ name: `Q${i}`, type: "quiz", date: null, confidence: 1 }));
    expect(validateExtractedItems(many, TODAY).ok).toBe(false);
  });
});

describe("validateQuestionDrafts — what an agent submits for question drafts", () => {
  it("accepts and trims valid drafts", () => {
    const res = validateQuestionDrafts([{ prompt: "  What is X?  ", answer: " Y ", topic: " T ", sourceSnippet: null }]);
    expect(res).toEqual({ ok: true, drafts: [{ prompt: "What is X?", answer: "Y", topic: "T", sourceSnippet: null }] });
  });
  it("rejects more than 20 drafts and a missing answer, naming the field", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ prompt: `Q${i}`, answer: "A" }));
    expect(validateQuestionDrafts(many).ok).toBe(false);
    const res = validateQuestionDrafts([{ prompt: "Q" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/\[0\]\.answer/);
  });
});
