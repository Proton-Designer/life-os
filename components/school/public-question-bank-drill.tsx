"use client";

import { useMemo, useState } from "react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PublicBankQuestion } from "@/lib/school/class-share-core";

/**
 * P3-08's drill mode — reveal-on-tap, Next, optional Shuffle, purely
 * client-side over the array the server already delivered on this one
 * page load. NO network calls after mount, for anyone (owner preview or
 * public visitor): drilling never re-hits the share-view route (see
 * lib/school/public-share-rate-limit.ts's own header for why that matters
 * for the rate cap), and nothing about who is drilling or how they
 * answered is ever recorded — there is no account here to record it
 * against, and there should not be one invented for a stranger.
 *
 * Questions are addressed by ARRAY INDEX only, never a database id — the
 * public payload never contained one to begin with (class-share-core.ts's
 * `selectPublicFields`).
 */
export function PublicQuestionBankDrill({ questions }: { questions: PublicBankQuestion[] }) {
  const [order, setOrder] = useState<number[]>(() => questions.map((_, i) => i));
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const current = useMemo(() => (order.length > 0 ? questions[order[position]!] : null), [order, position, questions]);

  function next() {
    setRevealed(false);
    setPosition((p) => (p + 1) % order.length);
  }

  function shuffle() {
    const shuffled = [...order];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    setOrder(shuffled);
    setPosition(0);
    setRevealed(false);
  }

  if (questions.length === 0 || current === null) {
    return <p className="text-sm text-muted-foreground">This bank has no active questions right now.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {position + 1} / {order.length}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={shuffle}>
          <Shuffle className="mr-1.5 size-3.5" aria-hidden />
          Shuffle
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-6">
        {current.topic && <Badge variant="neutral">{current.topic}</Badge>}
        <p className="text-base font-medium">{current.prompt}</p>
        {revealed ? (
          <p className="text-sm text-muted-foreground">{current.answer}</p>
        ) : (
          <Button type="button" variant="secondary" className="w-fit" onClick={() => setRevealed(true)}>
            Reveal answer
          </Button>
        )}
      </div>

      <Button type="button" onClick={next}>
        Next
      </Button>
    </div>
  );
}
