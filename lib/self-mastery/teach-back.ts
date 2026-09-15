import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatewayChat } from "@/lib/ai/gateway";

/**
 * P2-18 — Teach-Back mode: the user explains a lesson in their own words,
 * one gatewayChat call evaluates it and returns BOTH probing follow-up
 * questions AND gap feedback together ("one cohesive flow," not an
 * open-ended chat loop — see this task's own Plan for why). Reuses
 * `lessons`' own structured ground truth (title/core_claim/mechanism/
 * action_template/provenance_quote) rather than inventing a second
 * "what should this lesson teach" source.
 *
 * SPEND PROTECTION IS AUTOMATIC: gatewayChat already enforces both the
 * global operator cap (spend-cap.ts) and P2-01's per-user monthly cap
 * (monthly-spend-cap.ts) on every call — no extra wiring needed here,
 * only graceful handling of the resulting outcomes below.
 *
 * NO PERSISTENCE (deliberate scope decision, see this task's own Plan):
 * a teach-back evaluation is ephemeral, not stored.
 */

const MAX_EXPLANATION_CHARS = 4_000;

export type TeachBackOutcome =
  | { status: "evaluated"; followUpQuestions: string[]; gapFeedback: string }
  | { status: "no_key" }
  | { status: "unavailable" }
  | { status: "parse_failed" };

const ResultSchema = z.object({
  followUpQuestions: z.array(z.string().min(1)).min(1).max(3),
  gapFeedback: z.string().min(1),
});

const SYSTEM_PROMPT = `You are evaluating a learner's own explanation of a lesson, teach-back style
(the Feynman technique: if they truly understand it, they can explain it simply).

You will be given the lesson's real content (title, core claim, mechanism, and an action template)
followed by the learner's own explanation of it in their own words.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "followUpQuestions": [1 to 3 short questions that probe whether the explanation actually holds up
    -- ask about a specific gap, an unstated assumption, or a case the explanation doesn't cover],
  "gapFeedback": "1-3 sentences, direct and specific: what the explanation got right, and what it
    missed or got wrong compared to the lesson's real content. Be honest, not just encouraging --
    a teach-back that glosses over a real gap has failed at its one job."
}

If the explanation is empty, nonsensical, or clearly not an attempt to explain the lesson, say so
plainly in gapFeedback rather than inventing follow-up questions about nothing.`;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

interface LessonRow {
  title: string;
  core_claim: string | null;
  mechanism: string | null;
  action_template: string | null;
  provenance_quote: string;
}

function buildLessonContext(lesson: LessonRow): string {
  const parts = [`Title: ${lesson.title}`];
  if (lesson.core_claim) parts.push(`Core claim: ${lesson.core_claim}`);
  if (lesson.mechanism) parts.push(`Mechanism: ${lesson.mechanism}`);
  if (lesson.action_template) parts.push(`Suggested action: ${lesson.action_template}`);
  parts.push(`Source quote: ${lesson.provenance_quote}`);
  return parts.join("\n");
}

/** Fetches the lesson's own ground-truth content, scoped to this user's active lesson — never another user's, never an archived/rejected one (there is nothing real to teach back on those). */
async function fetchTeachableLesson(supabase: SupabaseClient, userId: string, lessonId: string): Promise<LessonRow | null> {
  const { data, error } = await supabase
    .from("lessons")
    .select("title, core_claim, mechanism, action_template, provenance_quote")
    .eq("id", lessonId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function evaluateTeachBack(supabase: SupabaseClient, userId: string, lessonId: string, explanation: string): Promise<TeachBackOutcome> {
  const lesson = await fetchTeachableLesson(supabase, userId, lessonId);
  if (!lesson) return { status: "parse_failed" }; // no real lesson to grade against -- treated the same as an unusable response, not a crash

  const bounded = explanation.length > MAX_EXPLANATION_CHARS ? explanation.slice(0, MAX_EXPLANATION_CHARS) : explanation;

  const result = await gatewayChat(
    supabase,
    userId,
    "self-mastery-teach-back",
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        // Untrusted input wrapped in a tag, same posture as every other
        // user-content-to-the-model call tonight -- a "lesson" that happens
        // to contain something instruction-shaped is content, not a command.
        content: `<lesson>\n${buildLessonContext(lesson)}\n</lesson>\n\n<learner_explanation>\n${bounded}\n</learner_explanation>`,
      },
    ],
    { maxTokens: 500, timeoutMs: 30_000 }
  );

  if (!result.ok) {
    if (result.attempts === undefined && !result.capBlocked && !result.monthlyCapBlocked) return { status: "no_key" };
    return { status: "unavailable" };
  }

  if (!result.content) return { status: "parse_failed" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripCodeFence(result.content));
  } catch {
    return { status: "parse_failed" };
  }

  const validated = ResultSchema.safeParse(parsedJson);
  if (!validated.success) return { status: "parse_failed" };

  return { status: "evaluated", followUpQuestions: validated.data.followUpQuestions, gapFeedback: validated.data.gapFeedback };
}
