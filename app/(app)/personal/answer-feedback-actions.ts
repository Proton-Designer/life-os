"use server";

import { requireUser } from "@/lib/supabase/auth";
import { gatewayChat } from "@/lib/ai/gateway";

/**
 * Written feedback on a typed retrieval answer — the one thing a user's own API
 * key currently unlocks.
 *
 * THIS EXISTS SO THE KEY HAS A CALLER. Shipping key storage with nothing
 * consuming it would be the eighth mechanism-with-no-caller found in this
 * codebase today (lessons.embedding, book_milestone, reviews.confidence,
 * seedMeditationsDeck...). A settings toggle that enables nothing observable is
 * indistinguishable from a broken one.
 *
 * NULL IS THE NORMAL ANSWER. No key, provider down, rate limited, malformed
 * reply — every one of those returns null and the session continues exactly as
 * it does today. The user grades their own recall; that is the product. This is
 * a second opinion, never a gate, and it must never block, delay a grade, or
 * appear as an error.
 *
 * CALLED ONLY AFTER REVEAL. It sends the correct answer to a third party, so
 * calling it before the user commits would both leak the answer into a network
 * response and break the reveal-on-commit invariant the session is built on.
 */

export interface AnswerFeedback {
  feedback: string;
  suggestedRating: 1 | 2 | 3 | 4 | null;
}

const SYSTEM = [
  "You give brief, concrete feedback on a learner's attempt to recall a fact.",
  "Compare their attempt to the correct answer.",
  "Two sentences maximum. Address the learner as 'you'. No preamble, no praise padding.",
  "Say specifically what they got right and what they missed.",
  "Then on a final line, exactly: RATING: n",
  "where n is 1 (forgot), 2 (hard), 3 (good), or 4 (easy).",
].join(" ");

export async function getAnswerFeedback(cardId: string, userAnswer: string): Promise<AnswerFeedback | null> {
  const attempt = userAnswer.trim();
  if (!attempt) return null; // nothing to compare; a blank is an honest "I don't know"

  const { supabase, userId } = await requireUser();

  // RLS restricts this to the caller's own cards, so a guessed id yields nothing.
  const { data, error } = await supabase
    .from("cards")
    .select("prompt, answer")
    .eq("id", cardId)
    .maybeSingle();
  if (error || !data?.answer) return null;

  // Routed through the gateway (lib/ai/gateway.ts), not lib/ai/client.ts's
  // chat() directly, as of the Phase 1 LLM gateway build: this is what gets
  // this feature tiering (cheap/deepseek-flash is plenty for a two-sentence
  // critique), the shared-key spend cap, structured retry, and usage
  // logging for free. NULL IS STILL THE NORMAL ANSWER for every reason it
  // always was (no key, cap reached, provider down, malformed reply) --
  // gatewayChat() degrades to `ok: false` for all of them, never throws.
  const res = await gatewayChat(
    supabase,
    userId,
    "answer_feedback",
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Question: ${data.prompt}\nCorrect answer: ${data.answer}\nLearner's attempt: ${attempt}`,
      },
    ],
    { maxTokens: 220 },
  );
  if (!res.ok || !res.content) return null;

  return parseFeedback(res.content);
}

/**
 * Exported for tests. A model that ignores the format must degrade to "feedback
 * without a rating" rather than to a wrong rating — an invented number here
 * would feed a real FSRS grade and corrupt the schedule, which is far worse
 * than showing no suggestion.
 */
export async function parseFeedbackForTest(raw: string): Promise<AnswerFeedback> {
  return parseFeedback(raw);
}

function parseFeedback(raw: string): AnswerFeedback {
  const match = raw.match(/RATING:\s*([1-4])\b/i);
  const suggested = match ? (Number(match[1]) as 1 | 2 | 3 | 4) : null;
  const feedback = raw.replace(/RATING:\s*[1-4]\b/i, "").trim();
  return { feedback: feedback || raw.trim(), suggestedRating: suggested };
}
