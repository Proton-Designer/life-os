import type { EvidenceStrength } from "./llm/types";

const EVIDENCE_CUES: { pattern: RegExp; strength: EvidenceStrength }[] = [
  {
    pattern: /research (consistently )?shows|studies (consistently )?show|meta-analysis|systematic review/i,
    strength: "strong_research",
  },
  {
    pattern: /a study (found|showed)|researchers found|one study|a[n]? [\d,]+[-\s]?(person|participant|year)? study/i,
    strength: "single_study",
  },
];

/**
 * `evidence_strength` should be classified from cue phrases actually present
 * in the source text, not trusted as a model's cold self-label — a
 * generative model asked to label its own claim tends to over-classify
 * confident prose as "strong_research" even when the source cites no study
 * at all. Shared by both providers so the classification never depends on
 * which one produced the candidate.
 */
export function classifyEvidenceStrength(sourceText: string): EvidenceStrength {
  for (const cue of EVIDENCE_CUES) {
    if (cue.pattern.test(sourceText)) return cue.strength;
  }
  return "author_anecdote";
}
