"use client";

import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chapterIndexAt } from "@/lib/reader/doc-words";
import type { HighlightItem } from "@/lib/reader/highlights";
import type { ReaderChapter } from "@/lib/reader/types";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** This book's saved highlights in reading order; tapping one jumps to it in the page view. */
export function HighlightsDialog({
  open,
  onOpenChange,
  highlights,
  chapters,
  onJump,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlights: HighlightItem[];
  chapters: ReaderChapter[];
  onJump: (startWord: number) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...highlights].sort((a, b) => a.startWord - b.startWord);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Highlights</DialogTitle>
        </DialogHeader>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Select text in the Page view, or press the highlight button to save the current sentence.
          </p>
        ) : (
          <ul className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto" data-testid="highlight-list">
            {sorted.map((h) => {
              const ch = chapterIndexAt(chapters, h.startWord);
              return (
                <li key={h.id} className="flex items-start gap-1 rounded-lg border">
                  <button
                    type="button"
                    onClick={() => {
                      onJump(h.startWord);
                      onOpenChange(false);
                    }}
                    className="min-h-11 min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="block font-serif leading-snug">{h.text}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {[ch >= 0 ? chapters[ch].title : null, shortDate(h.createdAt)].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete highlight: ${h.text.length > 50 ? `${h.text.slice(0, 50)}…` : h.text}`}
                    onClick={() => onDelete(h.id)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
