/**
 * L9/R6's engine: the batch-summarization provider, and the ONLY LlmProvider
 * implementer that talks to DeepSeek. Every other method on this interface
 * (triageChunk/extractLessons/mergeLessons/generateCards/gradeAnswer/
 * checkEntailment) throws "not implemented" here, deliberately — R6's
 * ruling draws the line at "DeepSeek is the bulk-text engine... MCP
 * connector exposes the summaries, never the raw book text," which means
 * DeepSeek's job in this codebase is exactly one call shape, not a second
 * lesson-extraction backend competing with Ollama/Heuristic/DevShim.
 *
 * Deliberately thin: no key resolution, no Supabase access, no retry policy
 * of its own. `apiKey` is resolved by the CALLER (lib/self-mastery/
 * ingestion/summarize-sections.ts, via lib/ai/resolve-key.ts's
 * `resolveApiKey` — the book owner's own BYO key, same mechanism
 * answer-feedback already uses) and handed in at construction, same shape
 * OllamaProvider/DevShimProvider take a plain `baseUrl` rather than
 * resolving their own connection details. Wire calls go through
 * `lib/ai/client.ts`'s existing `chat()` — OpenAI-wire, DeepSeek's own
 * shape, no second HTTP client to maintain.
 */
import type {
  ChunkTriageInput,
  ChunkTriageResult,
  ExtractLessonsInput,
  CandidateLesson,
  MergeLessonsInput,
  GenerateCardsInput,
  GeneratedCard,
  GradeAnswerInput,
  GradeAnswerResult,
  EntailmentCheckInput,
  EntailmentCheckResult,
  SummarizeSectionInput,
  SummarizeSectionResult,
  LlmProvider,
} from "./types";
import { chat } from "@/lib/ai/client";

const NOT_IMPLEMENTED =
  "R6 (PROGRAM-PLAN.md) assigns DeepSeekProvider exactly one job -- batch summarization -- not lesson extraction. Use Ollama/Heuristic/DevShim for this.";

export class DeepSeekProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {}

  async summarizeSection(input: SummarizeSectionInput): Promise<SummarizeSectionResult> {
    const result = await chat(
      "deepseek",
      this.apiKey,
      [
        {
          role: "system",
          content:
            "You write a short, faithful summary of one chapter/section of a nonfiction book, from the excerpts provided. " +
            "Summarize the ideas in your own words -- do not quote long passages verbatim. Do not invent claims the excerpts don't support. " +
            "Plain prose, no headings, no bullet points, 2-4 sentences.",
        },
        {
          role: "user",
          content:
            `Book: "${input.bookTitle}"\nSection: "${input.sectionTitle}"\n\nExcerpts from this section, in order:\n\n${input.chunkTexts.join("\n\n---\n\n")}`,
        },
      ],
      { maxTokens: 400, temperature: 0.2 },
    );

    // `chat()`'s own type has `content` optional even when `ok:true` (its
    // internal empty-response check narrows this at runtime but not in the
    // type) — checked explicitly rather than asserted, same posture as
    // every other caller of this shape in the codebase.
    if (!result.ok || !result.content) {
      // Same posture as lib/ai/client.ts's own callers elsewhere: a failure
      // here is "this enhancement is unavailable right now," not a value
      // to fabricate. The orchestration layer (summarize-sections.ts)
      // leaves the section's `summary` untouched on this — never writes a
      // placeholder, never marks it `summarized_by` for a call that failed.
      throw new Error(`DeepSeekProvider.summarizeSection: ${result.message ?? "the call failed"}`);
    }
    return { summary: result.content.trim() };
  }

  // `async` on every throw-only method below, deliberately — a bare `throw`
  // in a non-async function declared to return a Promise throws
  // SYNCHRONOUSLY at call time, before the caller ever has a promise to
  // `.catch()`/`await` around. `async` makes the interface's own contract
  // (every LlmProvider method returns a Promise) actually hold for the
  // failure path too, not just the success path.
  async triageChunk(_input: ChunkTriageInput): Promise<ChunkTriageResult> {
    throw new Error(`DeepSeekProvider.triageChunk: not implemented -- ${NOT_IMPLEMENTED}`);
  }
  async extractLessons(_input: ExtractLessonsInput): Promise<CandidateLesson[]> {
    throw new Error(`DeepSeekProvider.extractLessons: not implemented -- ${NOT_IMPLEMENTED}`);
  }
  async mergeLessons(_input: MergeLessonsInput): Promise<CandidateLesson[]> {
    throw new Error(`DeepSeekProvider.mergeLessons: not implemented -- ${NOT_IMPLEMENTED}`);
  }
  async generateCards(_input: GenerateCardsInput): Promise<GeneratedCard[]> {
    throw new Error(`DeepSeekProvider.generateCards: not implemented -- ${NOT_IMPLEMENTED}`);
  }
  async gradeAnswer(_input: GradeAnswerInput): Promise<GradeAnswerResult> {
    throw new Error(`DeepSeekProvider.gradeAnswer: not implemented -- ${NOT_IMPLEMENTED}`);
  }
  async checkEntailment(_input: EntailmentCheckInput): Promise<EntailmentCheckResult> {
    throw new Error(`DeepSeekProvider.checkEntailment: not implemented -- ${NOT_IMPLEMENTED}`);
  }
}
