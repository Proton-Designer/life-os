"use server";

import { requireUser, getProfile } from "@/lib/supabase/auth";
import { gatewayChat } from "@/lib/ai/gateway";
import { localDateString } from "@/lib/date-utils";

/**
 * P2-15 — the session closer's "connect this to today" prompt.
 *
 * THE GAP THIS FIXES (docs/audits/2026-09-13-three-app-feature-audit.md
 * §3): the closer SLOT is real (`lib/self-mastery/session/plan.ts`'s
 * `groupQueueIntoPlan` reserves the last `application`-type card for it,
 * pinned last by `build-card-sequence.ts`), but what renders there was
 * just a generic repurposed application card — the same prompt/answer any
 * other card would show, nothing that actually ties it to the user's real
 * day. This adds exactly that: one short, genuine sentence connecting the
 * closer lesson to something real and concrete happening today, generated
 * from the user's OWN school/life data, never invented.
 *
 * SAME "SECOND OPINION, NEVER A GATE" POSTURE AS `answer-feedback-actions.ts`
 * (this file's closest sibling): NULL IS THE NORMAL ANSWER for every
 * failure mode — no key, cap hit, provider down, malformed reply, AND
 * (new to this file) genuinely nothing due today to connect to. The closer
 * card's own prompt/answer already render regardless; this is purely
 * supplementary, fetched fire-and-forget after reveal, exactly like
 * `getAnswerFeedback`. It must never block, delay, or appear as an error.
 *
 * LEAN, DIRECT DAY-CONTEXT QUERY, not a new cross-domain synthesis engine:
 * today's due `tasks` rows (the one generic table Business/School/Co-op
 * dumps into) — same "lean, direct query against the existing generic
 * table" posture `lib/ai/morning-brief.ts`'s own header already
 * established for P2-02. Deeper synthesis (prayers, kill-list, fitness)
 * is P2-03's territory, not duplicated here.
 *
 * WHICH PROVIDER/TIER: `gatewayChat` called with BOTH omitted, so it
 * resolves the CALLER's own saved preference — same mechanism
 * `answer-feedback-actions.ts`/`morning-brief.ts` both already use for an
 * on-demand, optional, dismissible feature (not ingestion's forced-cheap
 * override).
 */

const SYSTEM = [
  "You connect a study lesson to one concrete thing happening in the learner's real day.",
  "You will be given the lesson (a prompt and its correct answer) and a short list of what's due today.",
  "Write EXACTLY ONE short sentence, genuinely specific, that ties the lesson to one of those real items.",
  "Address the learner as 'you'. No preamble, no markdown, no emoji.",
  "If nothing in the list has a real, honest connection to the lesson, reply with EXACTLY: NONE",
  "Never force a connection that isn't really there — a missed connection is far better than an invented one.",
].join(" ");

interface DueTodayItem {
  title: string;
  domain: string | null;
}

/** Exported for tests — kept pure of any Supabase/gatewayChat call so the "what counts as no real day to connect to" and prompt-shaping logic is independently checkable. */
export function buildDayConnectionUserMessage(lessonPrompt: string, lessonAnswer: string, dueToday: DueTodayItem[]): string {
  const dueLines =
    dueToday.length > 0
      ? dueToday.map((t) => `- ${t.title}${t.domain ? ` (${t.domain})` : ""}`).join("\n")
      : "- (nothing due today)";
  return `Lesson prompt: ${lessonPrompt}\nCorrect answer: ${lessonAnswer}\nDue today:\n${dueLines}`;
}

/** `null`/empty raw text, the literal "NONE" reply, or anything longer than a genuine one-liner (a model ignoring the format) all degrade to no connection shown — never a half-formed or truncated-looking line. */
export function normalizeDayConnection(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^none\.?$/i.test(trimmed)) return null;
  const firstLine = trimmed.split("\n")[0]!.trim();
  if (!firstLine || firstLine.length > 220) return null;
  return firstLine;
}

export async function getCloserDayConnection(cardId: string): Promise<string | null> {
  const { supabase, userId } = await requireUser();

  // RLS restricts this to the caller's own card, same as getAnswerFeedback.
  const { data: card, error: cardError } = await supabase.from("cards").select("prompt, answer").eq("id", cardId).maybeSingle();
  if (cardError || !card?.answer) return null;

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const { data: dueRows, error: dueError } = await supabase
    .from("tasks")
    .select("title, domain")
    .eq("user_id", userId)
    .eq("completed", false)
    .eq("due_date", todayStr)
    .limit(10);
  if (dueError) return null; // a read failure here degrades exactly like "nothing due" -- no fabricated connection

  const dueToday: DueTodayItem[] = (dueRows ?? []).map((t) => ({ title: t.title, domain: t.domain }));
  // Nothing real to connect to -- skip the model call entirely rather than
  // asking it to manufacture a connection to an empty list. The plain
  // closer card (prompt/answer) already renders regardless of this.
  if (dueToday.length === 0) return null;

  const res = await gatewayChat(
    supabase,
    userId,
    "closer_day_connection",
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildDayConnectionUserMessage(card.prompt, card.answer, dueToday) },
    ],
    { maxTokens: 120 }
  );
  if (!res.ok || !res.content) return null;

  return normalizeDayConnection(res.content);
}
