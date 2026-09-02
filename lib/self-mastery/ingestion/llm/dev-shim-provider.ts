/**
 * A5 item 7b: an LlmProvider backed by the tools-disabled dev shim (A5 gate
 * 1, scripts/dev-provider-shim.mjs), so `checkEntailment` becomes a real
 * semantic check instead of HeuristicProvider's trivially-SUPPORTS
 * shortcut. Only `checkEntailment` is implemented — that's the one method
 * 7b's ruling actually asked for; the other LlmProvider methods throw
 * rather than silently degrading to something nobody asked this class to do.
 *
 * Speaks the wire shape the shim documents (08-DEV-PROVIDER-SCOPE.md /
 * dev-provider-shim.mjs): POST {model, messages, tools, tool_choice,
 * stream:false} to `${baseUrl}/chat/completions`, read
 * `choices[0].message.tool_calls[0].function.arguments` (a JSON string,
 * parsed here — the gateway-adapter scope doc is explicit that the gate is
 * a real parse of an object, never handing the string back raw).
 */
import type { EntailmentCheckInput, EntailmentCheckResult, LlmProvider, ChunkTriageInput, ChunkTriageResult, ExtractLessonsInput, CandidateLesson, MergeLessonsInput, GenerateCardsInput, GeneratedCard, GradeAnswerInput, GradeAnswerResult } from "./types";
import { getDevProviderBaseUrl } from "@/lib/ai/dev-provider";

const ENTAILMENT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["SUPPORTS", "CONTRADICTS", "UNRELATED"] },
    reason: { type: "string" },
  },
  required: ["verdict", "reason"],
} as const;

const ENTAILMENT_SYSTEM_PROMPT =
  "You are checking whether a source passage backs up a claim that was derived from it as a paraphrase or generalization. The claim is normally NOT a verbatim restatement of the passage. Only mark it down if the passage's actual point is a DIFFERENT specific idea than the claim, or the OPPOSITE of the claim.";

export interface DevShimUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
}

export class DevShimProvider implements LlmProvider {
  constructor(private readonly baseUrl: string, private readonly model = "claude-haiku-4-5-20251001") {}

  /** Throws if the dev provider isn't available in this environment — see
   * lib/ai/dev-provider.ts. Callers should check availability before
   * constructing this class; kept as a static factory so "no shim
   * configured" fails at the one obvious call site, not deep inside a
   * request. */
  static fromEnv(): DevShimProvider | null {
    const url = getDevProviderBaseUrl();
    return url ? new DevShimProvider(url) : null;
  }

  /** Set by the most recent checkEntailment call — read by the caller to
   * decide what to record in telemetry (0 tokens is impossible for a real
   * model call; this class never reports 0, unlike HeuristicProvider's
   * trivial path, which is exactly the honest distinction 7b asked for). */
  public lastUsage: DevShimUsage | null = null;

  async checkEntailment(input: EntailmentCheckInput): Promise<EntailmentCheckResult> {
    const prompt = `Claim: "${input.claim}"\n\nPassage: "${input.quote}"\n\nJudge whether the passage SUPPORTS, CONTRADICTS, or is UNRELATED to the claim.`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: ENTAILMENT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        tools: [{ type: "function", function: { name: "entailment_verdict", parameters: ENTAILMENT_SCHEMA } }],
        tool_choice: { type: "function", function: { name: "entailment_verdict" } },
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`dev-shim-provider: checkEntailment failed (HTTP ${res.status}): ${body}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      total_cost_usd?: number;
    };
    const argsString = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsString) {
      throw new Error("dev-shim-provider: checkEntailment got no tool_calls arguments in the response");
    }

    this.lastUsage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      costUsd: json.total_cost_usd,
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(argsString);
    } catch {
      throw new Error(`dev-shim-provider: checkEntailment's tool_calls arguments were not valid JSON: ${argsString.slice(0, 200)}`);
    }

    const isEntailmentResult = (obj: unknown): obj is EntailmentCheckResult => {
      if (typeof obj !== "object" || obj === null) return false;
      const v = (obj as Record<string, unknown>)["verdict"];
      return v === "SUPPORTS" || v === "CONTRADICTS" || v === "UNRELATED";
    };
    if (!isEntailmentResult(parsed)) {
      // Fail closed, matching ollama-provider.ts's own checkEntailment
      // posture: an entailment check that didn't return a valid verdict is
      // exactly the situation this gate exists to catch, not a case to
      // silently trust.
      throw new Error(`dev-shim-provider: checkEntailment's parsed result is not a valid verdict shape: ${argsString.slice(0, 200)}`);
    }
    return { verdict: parsed.verdict, reason: parsed.reason ?? "" };
  }

  triageChunk(_input: ChunkTriageInput): Promise<ChunkTriageResult> {
    throw new Error("DevShimProvider.triageChunk: not implemented -- 7b only wires checkEntailment through the shim.");
  }
  extractLessons(_input: ExtractLessonsInput): Promise<CandidateLesson[]> {
    throw new Error("DevShimProvider.extractLessons: not implemented -- 7b only wires checkEntailment through the shim.");
  }
  mergeLessons(_input: MergeLessonsInput): Promise<CandidateLesson[]> {
    throw new Error("DevShimProvider.mergeLessons: not implemented -- 7b only wires checkEntailment through the shim.");
  }
  generateCards(_input: GenerateCardsInput): Promise<GeneratedCard[]> {
    throw new Error("DevShimProvider.generateCards: not implemented -- 7b only wires checkEntailment through the shim.");
  }
  gradeAnswer(_input: GradeAnswerInput): Promise<GradeAnswerResult> {
    throw new Error("DevShimProvider.gradeAnswer: not implemented -- 7b only wires checkEntailment through the shim.");
  }
}
