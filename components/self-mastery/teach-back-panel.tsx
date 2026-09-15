"use client";

import { useState, useTransition } from "react";
import { getTeachableLessons, submitTeachBack, type TeachableLesson, type SubmitTeachBackResult } from "@/app/(app)/personal/teach-back-actions";

const OUTCOME_MESSAGE: Record<string, string> = {
  too_short: "Write a bit more — at least a couple of sentences of your own explanation.",
  no_key: "Add an API key in Settings to use Teach-Back mode.",
  unavailable: "AI evaluation isn't available right now — try again shortly.",
  parse_failed: "Couldn't evaluate that — try again, or pick a different lesson.",
};

/**
 * P2-18 — Teach-Back mode's entry point: pick a ready book, pick one of its
 * active lessons, write your own explanation, get probing follow-up
 * questions + gap feedback back in one evaluation (lib/self-mastery/
 * teach-back.ts's own header explains why this is one call, not an
 * open-ended chat loop). Deliberately standalone, not woven into the FSRS
 * retrieval session overlay — see this task's own Plan.
 */
export function TeachBackPanel({ books }: { books: { id: string; title: string }[] }) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<TeachableLesson[] | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [result, setResult] = useState<SubmitTeachBackResult | null>(null);
  const [isPending, startTransition] = useTransition();

  if (books.length === 0) return null;

  function pickBook(id: string) {
    setBookId(id);
    setLessonId(null);
    setLessons(null);
    setResult(null);
    startTransition(async () => {
      setLessons(await getTeachableLessons(id));
    });
  }

  function pickLesson(id: string) {
    setLessonId(id);
    setExplanation("");
    setResult(null);
  }

  function handleSubmit() {
    if (!lessonId) return;
    startTransition(async () => {
      setResult(await submitTeachBack(lessonId, explanation));
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      <h3 className="text-sm font-medium">Teach-Back mode</h3>
      <p className="text-xs text-muted-foreground">Explain a lesson in your own words — get probing questions and honest gap feedback.</p>

      <div className="flex flex-wrap gap-2">
        {books.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pickBook(b.id)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              bookId === b.id ? "border-foreground bg-foreground text-background" : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {b.title}
          </button>
        ))}
      </div>

      {bookId && lessons === null && <p className="text-xs text-muted-foreground">Loading lessons…</p>}
      {bookId && lessons !== null && lessons.length === 0 && <p className="text-xs text-muted-foreground">No lessons ready to teach back on yet.</p>}
      {bookId && lessons !== null && lessons.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lessons.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => pickLesson(l.id)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                lessonId === l.id ? "border-foreground bg-foreground text-background" : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {l.title}
            </button>
          ))}
        </div>
      )}

      {lessonId && (
        <div className="flex flex-col gap-2">
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Explain this lesson in your own words, as if teaching someone else…"
            rows={4}
            className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
          />
          <button
            type="button"
            disabled={isPending || explanation.trim().length === 0}
            onClick={handleSubmit}
            className="self-start rounded-md border border-border/50 px-3 py-1.5 text-xs hover:border-border disabled:opacity-50"
          >
            {isPending ? "Evaluating…" : "Submit"}
          </button>
        </div>
      )}

      {result && result.outcome !== "evaluated" && <p className="text-xs text-muted-foreground">{OUTCOME_MESSAGE[result.outcome] ?? "Something went wrong."}</p>}
      {result && result.outcome === "evaluated" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3 text-xs">
          <div>
            <span className="font-medium">Gap feedback</span>
            <p className="mt-1 text-muted-foreground">{result.gapFeedback}</p>
          </div>
          <div>
            <span className="font-medium">Follow-up questions</span>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {result.followUpQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
