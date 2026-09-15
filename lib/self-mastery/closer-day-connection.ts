/**
 * P2-15 — pure helpers for the session closer's "connect this to today" line.
 *
 * Lives outside `app/(app)/personal/closer-day-connection-actions.ts` because
 * that file is "use server", and every export of a "use server" module must be
 * an async Server Action — `next build` rejects sync exports there (tsc and
 * vitest cannot see it). Kept pure of any Supabase/gatewayChat call so the
 * prompt shaping and reply normalization are independently checkable.
 */

export interface DueTodayItem {
  title: string;
  domain: string | null;
}

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
