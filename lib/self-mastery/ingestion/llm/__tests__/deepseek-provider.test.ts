import { describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "../deepseek-provider";
import * as aiClient from "@/lib/ai/client";

/**
 * UNVERIFIED HALF, STATED PLAINLY (per the lead's own instruction): no
 * DeepSeek key is configured on any account today (zero `user_api_keys`
 * rows), so this suite cannot prove a real DeepSeek call round-trips
 * correctly — that would require live credentials this program doesn't
 * have. What IS proven here: `summarizeSection` builds the right request
 * shape against `lib/ai/client.ts`'s already-tested `chat()` (its own HTTP
 * status/content-shape mapping is covered in lib/ai/__tests__/client.test.ts,
 * not re-tested here), and every other `LlmProvider` method throws with a
 * clear R6 pointer rather than silently doing the wrong job.
 */
describe("DeepSeekProvider.summarizeSection", () => {
  it("calls chat() with provider='deepseek', the given key, and a prompt naming the book/section/excerpts", async () => {
    const chatSpy = vi.spyOn(aiClient, "chat").mockResolvedValue({ ok: true, content: "A short summary." });
    const provider = new DeepSeekProvider("sk-test-key");

    const result = await provider.summarizeSection({
      bookTitle: "Atomic Habits",
      sectionTitle: "Chapter 3",
      chunkTexts: ["First excerpt text.", "Second excerpt text."],
    });

    expect(result.summary).toBe("A short summary.");
    expect(chatSpy).toHaveBeenCalledTimes(1);
    const [provider_, apiKey, messages, opts] = chatSpy.mock.calls[0]!;
    expect(provider_).toBe("deepseek");
    expect(apiKey).toBe("sk-test-key");
    expect(messages.some((m) => m.role === "system")).toBe(true);
    const userMessage = messages.find((m) => m.role === "user")!;
    expect(userMessage.content).toContain("Atomic Habits");
    expect(userMessage.content).toContain("Chapter 3");
    expect(userMessage.content).toContain("First excerpt text.");
    expect(userMessage.content).toContain("Second excerpt text.");
    expect(opts?.maxTokens).toBeGreaterThan(0);

    chatSpy.mockRestore();
  });

  it("trims the returned content", async () => {
    const chatSpy = vi.spyOn(aiClient, "chat").mockResolvedValue({ ok: true, content: "  padded summary  \n" });
    const provider = new DeepSeekProvider("sk-test-key");
    const result = await provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["x"] });
    expect(result.summary).toBe("padded summary");
    chatSpy.mockRestore();
  });

  it("THROWS rather than returning a fabricated summary when chat() fails — never a placeholder value", async () => {
    const chatSpy = vi.spyOn(aiClient, "chat").mockResolvedValue({ ok: false, message: "DeepSeek rejected that key. Check it's still active." });
    const provider = new DeepSeekProvider("sk-bad-key");
    await expect(provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["x"] })).rejects.toThrow(/rejected that key/i);
    chatSpy.mockRestore();
  });

  it("THROWS on a 2xx-but-empty response, same as chat()'s own documented failure mode", async () => {
    const chatSpy = vi.spyOn(aiClient, "chat").mockResolvedValue({ ok: false, message: "DeepSeek returned an empty response." });
    const provider = new DeepSeekProvider("sk-test-key");
    await expect(provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["x"] })).rejects.toThrow(/empty response/i);
    chatSpy.mockRestore();
  });
});

describe("DeepSeekProvider — every other LlmProvider method is out of scope by ruling (R6), not an oversight", () => {
  it("throws a clear R6 pointer for every lesson-extraction method, never a silent wrong answer", async () => {
    const provider = new DeepSeekProvider("sk-test-key");
    await expect(provider.triageChunk({ chunkText: "x" })).rejects.toThrow(/R6/);
    await expect(provider.extractLessons({ chunkText: "x", pageStart: 1, pageEnd: 1, sourceChunkId: "c1" })).rejects.toThrow(/R6/);
    await expect(provider.mergeLessons({ candidates: [], targetCount: { min: 1, max: 2 } })).rejects.toThrow(/R6/);
    await expect(
      provider.generateCards({
        lesson: {
          title: "t",
          coreClaim: "c",
          mechanism: "m",
          actionTemplate: "a",
          evidenceStrength: "author_anecdote",
          provenanceQuote: "q",
          pageRef: 1,
          sourceChunkId: "c1",
        },
      }),
    ).rejects.toThrow(/R6/);
    await expect(provider.gradeAnswer({ cardPrompt: "p", cardAnswer: "a", userAnswer: "u" })).rejects.toThrow(/R6/);
    await expect(provider.checkEntailment({ claim: "c", quote: "q" })).rejects.toThrow(/R6/);
  });
});
