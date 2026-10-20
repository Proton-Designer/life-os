"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReaderChapter } from "@/lib/reader/types";
import { cn } from "@/lib/utils";

export function ChapterDialog({
  open,
  onOpenChange,
  chapters,
  currentChapter,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapters: ReaderChapter[];
  currentChapter: number;
  onPick: (firstWord: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chapters</DialogTitle>
        </DialogHeader>
        <ol className="flex max-h-[60dvh] flex-col gap-1 overflow-y-auto" data-testid="chapter-list">
          {chapters.map((c, i) => (
            <li key={`${i}-${c.firstWord}`}>
              <button
                type="button"
                aria-current={i === currentChapter ? "true" : undefined}
                onClick={() => {
                  onPick(c.firstWord);
                  onOpenChange(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-muted",
                  i === currentChapter && "bg-muted font-medium"
                )}
              >
                <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
