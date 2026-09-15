"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getMyPracticeTests,
  getPracticeTestQuestions,
  submitPracticeTestAnswer,
  completePracticeTest,
  type PracticeTestListItem,
  type PracticeTestQuestion,
} from "@/app/(app)/school/practice-test-actions";
import { Button } from "@/components/ui/button";

/**
 * P2-09 — lists auto-assembled practice tests for a class (assembly itself
 * is server-side, see lib/school/practice-test.ts's cron dispatcher —
 * nothing here creates one) and the take-flow: reveal-then-self-report,
 * the SAME shape the FSRS retrieval session already uses (this app has no
 * automated free-text grading anywhere — see practice-test.ts's own
 * header). List is fetched once on mount and after any mutation, not
 * threaded through server props — a class card doesn't otherwise know
 * about practice tests, so there's no existing server-fetched prop to
 * extend.
 */

function intervalHeading(intervalLabel: string): string {
  return `Practice test (${intervalLabel} before exam)`;
}

export function PracticeTestPanel({ classId }: { classId: string }) {
  const router = useRouter();
  const [tests, setTests] = useState<PracticeTestListItem[] | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refetch() {
    startTransition(async () => {
      setTests(await getMyPracticeTests(classId));
    });
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  if (activeTestId) {
    return (
      <PracticeTestTaker
        practiceTestId={activeTestId}
        onDone={() => {
          setActiveTestId(null);
          refetch();
          router.refresh();
        }}
        onExit={() => setActiveTestId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Practice tests</h3>
      {tests === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : tests.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No practice tests yet — one is assembled automatically as an exam approaches (14, 7, 3, and 1 day before).
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tests.map((t) => (
            <div key={t.id} data-testid={`practice-test-${t.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 p-2 text-xs">
              <span>{intervalHeading(t.intervalLabel)}</span>
              {t.status === "completed" ? (
                <span className="text-muted-foreground">{t.scorePct}% correct</span>
              ) : (
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => setActiveTestId(t.id)}>
                  Start
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PracticeTestTaker({ practiceTestId, onDone, onExit }: { practiceTestId: string; onDone: () => void; onExit: () => void }) {
  const [questions, setQuestions] = useState<PracticeTestQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setQuestions(await getPracticeTestQuestions(practiceTestId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceTestId]);

  if (questions === null) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (questions.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">This practice test has no questions to show.</p>
        <Button size="sm" variant="ghost" onClick={onExit}>
          Back
        </Button>
      </div>
    );
  }

  const current = questions[index]!;
  const isLast = index === questions.length - 1;

  function handleSelfReport(correct: boolean) {
    startTransition(async () => {
      await submitPracticeTestAnswer(practiceTestId, current!.id, correct);
      if (isLast) {
        await completePracticeTest(practiceTestId);
        onDone();
      } else {
        setIndex((i) => i + 1);
        setRevealed(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Question {index + 1} of {questions.length}
        </span>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={onExit}>
          Exit
        </Button>
      </div>
      <p className="text-sm">{current.prompt}</p>
      {revealed ? (
        <>
          <p className="rounded-md bg-muted p-2 text-sm">{current.answer}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending} onClick={() => handleSelfReport(true)}>
              Got it right
            </Button>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleSelfReport(false)}>
              Got it wrong
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => setRevealed(true)} className="self-start">
          Reveal answer
        </Button>
      )}
    </div>
  );
}
