"use client";

import { useState } from "react";
import { Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProvenanceQuote } from "./provenance-quote";
import { ProvenanceDrillDown } from "./provenance-drill-down";
import { MemoryStrengthBar } from "./memory-strength-bar";
import type { BookDetailLesson, EvidenceStrength } from "@/lib/self-mastery/types";

// DB enum values, not packages/design's stale "strong_research_base"
// spelling — the ULM lead's explicit instruction not to inherit that drift.
const EVIDENCE_LABEL: Record<EvidenceStrength, string> = {
  author_anecdote: "Author anecdote",
  single_study: "Single study",
  strong_research: "Strong research base",
};

const CARD_STATE_LABEL: Record<string, string> = {
  new: "Not yet reviewed",
  learning: "Learning",
  review: "Reviewing",
  relearning: "Relearning",
};

export function LessonCard({ lesson }: { lesson: BookDetailLesson }) {
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const reviewedCount = lesson.cards.filter((c) => c.state !== "new").length;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold text-foreground">{lesson.title}</h3>
        {lesson.coreClaim ? <p className="text-sm text-muted-foreground">{lesson.coreClaim}</p> : null}
      </div>

      <button type="button" onClick={() => setDrillDownOpen(true)} className="text-left transition-opacity hover:opacity-90">
        <ProvenanceQuote quote={lesson.provenanceQuote} pageRef={lesson.pageRef} />
      </button>

      {lesson.mechanism ? (
        <div className="flex gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-muted-foreground">Why it works</p>
            <p className="text-sm text-foreground">{lesson.mechanism}</p>
          </div>
        </div>
      ) : null}

      {lesson.actionTemplate ? (
        <div className="flex gap-2.5">
          <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-muted-foreground">Try this</p>
            <p className="text-sm text-foreground">{lesson.actionTemplate}</p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {lesson.evidenceStrength ? (
          <span className="text-xs text-muted-foreground">{EVIDENCE_LABEL[lesson.evidenceStrength]}</span>
        ) : (
          <span />
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => setDrillDownOpen(true)}>
          See in context
        </Button>
      </div>

      {lesson.cards.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
          <MemoryStrengthBar
            value={lesson.memoryStrength}
            label="This lesson"
            size="sm"
            reviewedCount={reviewedCount}
            totalCount={lesson.cards.length}
          />
          {/* Per-card breakdown alongside the aggregate, not instead of it
              (ULM lead: "strictly more informative" to show both). */}
          <ul className="flex flex-wrap gap-1.5">
            {lesson.cards.map((c) => (
              <li
                key={c.cardId}
                className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                title={c.promptType}
              >
                {CARD_STATE_LABEL[c.state] ?? c.state}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ProvenanceDrillDown
        open={drillDownOpen}
        onOpenChange={setDrillDownOpen}
        quote={lesson.provenanceQuote}
        pageRef={lesson.pageRef}
        sourceChunkId={lesson.sourceChunkId}
      />
    </div>
  );
}
