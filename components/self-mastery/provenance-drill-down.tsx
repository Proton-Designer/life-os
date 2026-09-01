"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ProvenanceQuote } from "./provenance-quote";
import { fetchSourceChunkText } from "@/app/(app)/personal/self-mastery-actions";

// Fetches on mount, nothing to reset — keyed by sourceChunkId from the
// parent (below) so React remounts this fresh every time the drill-down
// opens for a different lesson, rather than an effect manually clearing
// stale state from the previous one.
function SourceContext({ sourceChunkId }: { sourceChunkId: string }) {
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (sourceText === null) {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t load the surrounding text. Try again in a moment.</p>;
  }
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{sourceText}</p>;
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
  sourceChunkId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: string;
  pageRef: number | null;
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
            <ProvenanceQuote quote={quote} pageRef={pageRef} />
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
              <SourceContext key={sourceChunkId} sourceChunkId={sourceChunkId} />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
