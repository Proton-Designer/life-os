import { describe, it, expect } from "vitest";
import {
  passesAntiLeak,
  passesClaimNotQuote,
  passesMechanismRelevance,
  passesTopicality,
  passesTitleClaimRelevance,
  passesCardTextSanity,
} from "../invariants";
import { generateCardsForLesson, buildClozeCard } from "../cards";
import type { CandidateLesson } from "../llm/types";

function makeCandidate(overrides: Partial<CandidateLesson> = {}): CandidateLesson {
  return {
    title: "Use the two-minute rule",
    coreClaim: "Any task under two minutes should be done immediately.",
    mechanism: "This eliminates deferral friction, which is why small tasks pile up otherwise.",
    actionTemplate: "This week, apply this to one small task.",
    evidenceStrength: "author_anecdote",
    provenanceQuote: "Any task under two minutes should be done immediately.",
    pageRef: 10,
    sourceChunkId: "chunk-1",
    ...overrides,
  };
}

describe("passesAntiLeak", () => {
  it("rejects a prompt that mostly restates its own answer", () => {
    const result = passesAntiLeak({
      promptType: "free_recall",
      prompt: "What is the core idea behind 'any task under two minutes should be done immediately'?",
      answer: "Any task under two minutes should be done immediately.",
    });
    expect(result.passed).toBe(false);
  });

  it("accepts a prompt with low content-word overlap with its answer", () => {
    const result = passesAntiLeak({
      promptType: "free_recall",
      prompt: "From page 10: what does this lesson say about quick tasks? Recall it before checking.",
      answer: "Any task under two minutes should be done immediately.",
    });
    expect(result.passed).toBe(true);
  });
});

describe("passesClaimNotQuote", () => {
  it("rejects when claim equals quote (the HeuristicProvider default shape)", () => {
    expect(passesClaimNotQuote(makeCandidate())).toBe(false);
  });

  it("accepts a genuine restatement", () => {
    expect(
      passesClaimNotQuote(
        makeCandidate({
          coreClaim: "Small tasks should be handled right away rather than deferred.",
          provenanceQuote: "Any task under two minutes should be done immediately.",
        }),
      ),
    ).toBe(true);
  });
});

describe("passesMechanismRelevance", () => {
  it("rejects near-orthogonal embeddings", () => {
    const result = passesMechanismRelevance([1, 0, 0], [0, 1, 0]);
    expect(result.passed).toBe(false);
  });

  it("accepts closely aligned embeddings", () => {
    const result = passesMechanismRelevance([1, 0.1, 0], [0.98, 0.15, 0.05]);
    expect(result.passed).toBe(true);
  });
});

describe("generateCardsForLesson (post anti-leak fix)", () => {
  it("free_recall and application prompts pass the anti-leak gate", () => {
    const cards = generateCardsForLesson(makeCandidate());
    const freeRecall = cards.find((c) => c.promptType === "free_recall")!;
    const application = cards.find((c) => c.promptType === "application")!;
    expect(passesAntiLeak(freeRecall).passed).toBe(true);
    expect(passesAntiLeak(application).passed).toBe(true);
  });
});

describe("buildClozeCard", () => {
  it("never blanks a term that also appears in the title", () => {
    const card = buildClozeCard(
      makeCandidate({
        title: "Circumstance does not make the man",
        coreClaim: "Circumstance does not make the man; it reveals him to himself.",
      }),
    );
    if (card) {
      expect(card.answer.toLowerCase()).not.toBe("circumstance");
    }
  });

  it("only blanks content words of at least 4 characters", () => {
    const card = buildClozeCard(makeCandidate());
    if (card) {
      expect(card.answer.length).toBeGreaterThanOrEqual(4);
    }
  });
});

// Calibrated against real prompt/claim cosine pairs: a vague prompt scored
// 0.300, genuinely topic-anchored prompts scored 0.524-0.684.
describe("passesTopicality", () => {
  it("rejects a prompt with no topic anchor at all", () => {
    // Real measured value for "What is the main idea of the lesson?" vs its claim.
    expect(passesTopicality([1, 0, 0], [0.3, Math.sqrt(1 - 0.09), 0]).passed).toBe(false);
  });

  it("accepts a prompt that names the topic", () => {
    expect(passesTopicality([1, 0, 0], [0.6, Math.sqrt(1 - 0.36), 0]).passed).toBe(true);
  });
});

describe("passesTitleClaimRelevance", () => {
  it("rejects a title that drifts to a different topic than its own claim", () => {
    expect(passesTitleClaimRelevance([1, 0, 0], [0, 1, 0]).passed).toBe(false);
  });

  it("accepts a title aligned with its claim", () => {
    expect(passesTitleClaimRelevance([1, 0.1, 0], [0.95, 0.2, 0]).passed).toBe(true);
  });
});

describe("passesClaimNotQuote — Jaccard near-copy ceiling", () => {
  it("rejects a near-copy the substring check misses (real ULM example)", () => {
    // Quote's two sentences merged into one participial clause — not a
    // substring match, but still a near-copy (0.846 measured Jaccard overlap).
    expect(
      passesClaimNotQuote(
        makeCandidate({
          coreClaim:
            "A man should conceive of a legitimate purpose in his heart, and set out to accomplish it, making this purpose the centralizing point of his thoughts.",
          provenanceQuote:
            "A man should conceive of a legitimate purpose in his heart, and set out to accomplish it. He should make this purpose the centralizing point of his thoughts.",
        }),
      ),
    ).toBe(false);
  });

  it("still accepts a genuine paraphrase (low measured overlap, 0.063)", () => {
    expect(
      passesClaimNotQuote(
        makeCandidate({
          coreClaim: "Improving one's circumstances will not lead to happiness if personal development is neglected.",
          provenanceQuote:
            "Men are anxious to improve their circumstances, but are unwilling to improve themselves; they therefore remain bound.",
        }),
      ),
    ).toBe(true);
  });
});

describe("passesCardTextSanity", () => {
  it("rejects leaked prompt-template scaffolding (real ULM example)", () => {
    expect(
      passesCardTextSanity(
        "You find yourself in a meeting where a colleague is dominating the conversation. How would you use self-control as outlined in application answer:",
      ),
    ).toBe(false);
  });

  it("rejects a question-shaped prompt with no question mark", () => {
    expect(passesCardTextSanity("What does this lesson claim about focus")).toBe(false);
  });

  it("rejects a bare trailing colon", () => {
    expect(passesCardTextSanity("Explain the mechanism behind this:")).toBe(false);
  });

  it("accepts a well-formed question", () => {
    expect(passesCardTextSanity("What does this lesson claim about staying calm under pressure?")).toBe(true);
  });

  it("accepts a well-formed imperative prompt", () => {
    expect(passesCardTextSanity("Explain why this works in your own words.")).toBe(true);
  });

  it("rejects a garbled cloze with an unresolved candidate-list artifact (real ULM example)", () => {
    expect(passesCardTextSanity("What does this lesson say about conclusions / detrimental?")).toBe(false);
  });

  it("does not reject legitimate slash usage with no surrounding spaces", () => {
    expect(passesCardTextSanity("What's the cost/benefit tradeoff this lesson describes?")).toBe(true);
  });

  // D-018 ruling: cloze is structurally never a question, so QUESTION_START
  // must not apply to it — but ONLY to it. This pairing (same declarative
  // sentence shape, only promptType differs) is the test that proves the
  // rule was narrowed for cloze specifically, not weakened for every type.
  const declarativeWhenSentence =
    "When something upsetting happens, the goal is to recover your composure quickly.";

  it("accepts a cloze prompt starting with a question-start word, given promptType 'cloze'", () => {
    expect(passesCardTextSanity(declarativeWhenSentence, "cloze")).toBe(true);
  });

  it("still rejects the identical text as free_recall (no promptType exemption for other types)", () => {
    expect(passesCardTextSanity(declarativeWhenSentence, "free_recall")).toBe(false);
  });

  it("still rejects the identical text when promptType is omitted (fail-closed default)", () => {
    expect(passesCardTextSanity(declarativeWhenSentence)).toBe(false);
  });

  it("still rejects a genuinely truncated cloze-shaped question (SPACED_SLASH_ARTIFACT still applies to cloze)", () => {
    expect(passesCardTextSanity("What does this lesson say about conclusions / detrimental?", "cloze")).toBe(false);
  });
});
