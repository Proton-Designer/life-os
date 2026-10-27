"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ProvenanceQuote } from "./provenance-quote";
import { fetchSourceChunkText } from "@/app/(app)/personal/self-mastery-actions";
import { buildContextView, type Paragraph } from "@/lib/self-mastery/context-window";

// Fetches on mount, nothing to reset — keyed by sourceChunkId from the
// parent (below) so React remounts this fresh every time the drill-down
// opens for a different lesson, rather than an effect manually clearing
// stale state from the previous one.
function SourceContext({ sourceChunkId, quote }: { sourceChunkId: string; quote: string }) {
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFull, setShowFull] = useState(false);
  const markRef = useRef<HTMLElement | null>(null);
  const view = useMemo(() => (sourceText === null ? null : buildContextView(sourceText, quote)), [sourceText, quote]);

  useEffect(() => {
    let cancelled = false;
    fetchSourceChunkText(sourceChunkId)
      .then((text) => {
        if (!cancelled) setSourceText(text);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceChunkId]);

  // Bring the highlighted quote into view when the dialog opens (a chunk is
  // ~4,500 chars, so with a few sentences of lead-in it can start off-screen
  // on a phone), but never move a quote that is already visible.
  useEffect(() => {
    const mark = markRef.current;
    if (!mark) return;
    const box = mark.closest<HTMLElement>('[data-slot="dialog-content"]')?.getBoundingClientRect();
    const r = mark.getBoundingClientRect();
    const top = Math.max(box?.top ?? 0, 0);
    const bottom = Math.min(box?.bottom ?? window.innerHeight, window.innerHeight);
    if (r.top < top || r.bottom > bottom) mark.scrollIntoView({ block: "center" });
  }, [view]);

  if (loading) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (sourceText === null) {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t load the surrounding text. Try again in a moment.</p>;
  }
  // sourceText is non-null past the guard above, so the view exists.
  const { window: win, full } = view!;
  const paragraphs = showFull ? full : win.paragraphs;
  const firstMarked = paragraphs.findIndex((p) => p.some((s) => s.highlighted));
  return (
    <div className="flex flex-col gap-3">
      {!showFull && win.hasMoreBefore ? <p className="text-sm text-muted-foreground">…</p> : null}
      {paragraphs.map((para, i) => (
        <PassageParagraph key={i} paragraph={para} markRef={i === firstMarked ? markRef : undefined} />
      ))}
      {!showFull && win.hasMoreAfter ? <p className="text-sm text-muted-foreground">…</p> : null}
      {full.length > win.paragraphs.length ? (
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {showFull ? "Show less" : "Show full passage"}
        </button>
      ) : null}
    </div>
  );
}

// The quote's highlight uses the same amber accent as the ProvenanceQuote's
// left rule above it, as a token (never a hex), so it follows the theme.
function PassageParagraph({ paragraph, markRef }: { paragraph: Paragraph; markRef?: RefObject<HTMLElement | null> }) {
  const firstMark = paragraph.findIndex((s) => s.highlighted);
  return (
    <p className="break-words text-sm leading-relaxed text-foreground">
      {paragraph.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            ref={i === firstMark ? markRef : undefined}
            className="rounded px-0.5 text-foreground"
            style={{ backgroundColor: "color-mix(in oklch, var(--accent-deen) 35%, var(--card))" }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

// ULM's actual trust surface (per the ULM lead, verbatim): the quote alone
// is an assertion, the quote inside its surrounding source text is
// verifiable. Two blocks, both untruncated at any width — this dialog is
// the whole reason a user should believe any of the lesson content above
// it. Surrounding text is fetched lazily, only when this opens, never
// preloaded with the lesson list (mirrors ULM's own openProvenance).
export function ProvenanceDrillDown({
  open,
  onOpenChange,
  quote,
  pageRef,
  sectionTitle,
  sourceChunkId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: string;
  pageRef: number | null;
  sectionTitle: string | null;
  sourceChunkId: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Source passage</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What we stored</p>
            <ProvenanceQuote quote={quote} pageRef={pageRef} sectionTitle={sectionTitle} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">In context, from the book</p>
            {!sourceChunkId ? (
              // Deliberately does NOT say the lesson/quote lacks a source —
              // provenance_quote is a verbatim substring of the book,
              // enforced NOT NULL as part of the hallucination firewall.
              // Only the surrounding neighborhood is unstored (ULM lead's
              // correction: the earlier copy here implied the QUOTE's
              // grounding was in question, which is the opposite of true
              // and undermines the one claim this feature exists to make).
              <p className="text-sm text-muted-foreground">The surrounding passage isn&apos;t stored for this lesson.</p>
            ) : open ? (
              <SourceContext key={sourceChunkId} sourceChunkId={sourceChunkId} quote={quote} />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
