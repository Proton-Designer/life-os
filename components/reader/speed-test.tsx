"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { updateReaderSettings } from "@/app/(app)/personal/reader-actions";
import { SPEED_TEST_PARAGRAPHS, SPEED_TEST_QUESTIONS, SPEED_TEST_TITLE, SPEED_TEST_WORDS } from "@/lib/reader/speed-test-passage";
import { scoreSpeedTest, type SpeedTestResult } from "@/lib/reader/speed-test";
import { readerThemeVars } from "@/lib/reader/themes";

type Phase = "intro" | "reading" | "questions" | "result";

/**
 * Reading-speed test: read an original ~280-word passage at your own pace (timer runs from Start to Done), answer three
 * questions, get words per minute and a comprehension score, and optionally make that your reader speed. The honest
 * caveat is on the screen on purpose: speed without comprehension is not the goal.
 */
export function SpeedTest({ backHref = "/self-mastery" }: { backHref?: string }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [answers, setAnswers] = useState<(number | null)[]>(SPEED_TEST_QUESTIONS.map(() => null));
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef(0);
  const elapsed = useRef(0);

  function start() {
    startedAt.current = Date.now();
    setPhase("reading");
  }
  function done() {
    elapsed.current = Date.now() - startedAt.current;
    setPhase("questions");
  }
  function finish() {
    setResult(scoreSpeedTest({ wordCount: SPEED_TEST_WORDS, elapsedMs: elapsed.current, answers, correctAnswers: SPEED_TEST_QUESTIONS.map((q) => q.answer) }));
    setPhase("result");
  }
  function again() {
    setAnswers(SPEED_TEST_QUESTIONS.map(() => null));
    setResult(null);
    setSaved(null);
    setPhase("intro");
  }
  function applySpeed(wpm: number) {
    setSaved(null);
    startTransition(async () => {
      const res = await updateReaderSettings({ wpm });
      setSaved(res.ok ? `Saved: the reader now starts at ${wpm} words per minute.` : res.message);
    });
  }

  const button = "min-h-11 rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] px-5 text-sm disabled:opacity-60";

  return (
    <main
      data-testid="speed-test"
      style={{ ...readerThemeVars("dark"), background: "var(--reader-bg)", color: "var(--reader-fg)" }}
      className="min-h-dvh w-full px-5 py-8"
    >
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <Link href={backHref} className="text-sm text-[var(--reader-muted)]">
          ← Back
        </Link>
        <h1 className="text-xl font-medium">Reading speed test</h1>

        {phase === "intro" ? (
          <>
            <p className="text-sm leading-relaxed text-[var(--reader-muted)]">
              Read a short passage the way you normally read, press Done, then answer three questions. It takes about two minutes. Speed without understanding
              isn&apos;t the goal, so your score includes how much you took in.
            </p>
            <button type="button" onClick={start} className={button}>
              Start
            </button>
          </>
        ) : null}

        {phase === "reading" ? (
          <>
            <h2 className="text-base font-medium">{SPEED_TEST_TITLE}</h2>
            <div className="flex flex-col gap-3 text-base leading-relaxed" data-testid="speed-test-passage">
              {SPEED_TEST_PARAGRAPHS.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
            <button type="button" onClick={done} className={button}>
              Done
            </button>
          </>
        ) : null}

        {phase === "questions" ? (
          <>
            <p className="text-sm text-[var(--reader-muted)]">The passage is hidden now. Answer from memory.</p>
            {SPEED_TEST_QUESTIONS.map((q, qi) => (
              <fieldset key={q.prompt} className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">
                  {qi + 1}. {q.prompt}
                </legend>
                {q.options.map((o, oi) => (
                  <label key={o} className="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--reader-border)] px-3 text-sm">
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={answers[qi] === oi}
                      onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                    />
                    {o}
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="button" onClick={finish} className={button}>
              See my result
            </button>
          </>
        ) : null}

        {phase === "result" && result ? (
          <div className="flex flex-col gap-4" data-testid="speed-test-result">
            {result.valid ? (
              <>
                <p className="text-3xl font-medium">{result.wpm} words per minute</p>
                <p className="text-sm">
                  Comprehension: {result.correct} of {result.total} ({result.comprehensionPct}%). That is about {result.effectiveWpm} words per minute of what you actually took in.
                </p>
                {result.comprehensionPct < 67 ? (
                  <p className="text-sm text-[var(--reader-muted)]">You missed a lot, so the suggestion below is slower than your measured speed. Understanding comes first.</p>
                ) : null}
                <button type="button" disabled={pending} onClick={() => applySpeed(result.recommendedWpm)} className={button}>
                  Use {result.recommendedWpm} wpm in the reader
                </button>
              </>
            ) : (
              <p className="text-sm">That was too quick to measure. Read the passage through before pressing Done, then try again.</p>
            )}
            {saved ? (
              <p role="status" className="text-sm text-[var(--reader-muted)]">
                {saved}
              </p>
            ) : null}
            <button type="button" onClick={again} className="min-h-11 text-left text-sm text-[var(--reader-muted)] underline-offset-2 hover:underline">
              Take it again
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
