"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteBook } from "@/app/(app)/personal/reader-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * What delete_book really does, said plainly. A reader import has no flashcards, so it is always removed for good:
 * the book, your bookmark, its highlights and its reading history (those words leave your daily goal and streak too),
 * and the stored copies. A book with lessons is removed for good only if none of its cards was ever reviewed;
 * otherwise it is hidden and the review history is kept.
 */
export function deleteConsequences(readerOnly: boolean): string[] {
  return readerOnly
    ? ["The book and its stored text and files", "Your bookmark and your highlights", "Its reading history: the words it added to today's goal and your streak are taken back"]
    : [
        "If none of its flashcards was ever reviewed: the book, its lessons and cards, your bookmark, highlights and reading history, and the stored file are removed for good",
        "If you have reviewed its flashcards: the book is hidden from your library and your review history is kept",
      ];
}

/** Delete a library book behind a confirmation that lists what goes with it. Never a one-click delete. */
export function DeleteBookButton({ bookId, title, readerOnly }: { bookId: string; title: string; readerOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Where focus goes once the dialog closes after a successful delete (this card is about to disappear). */
  const handoff = useRef<HTMLElement | null>(null);

  function onOpenChange(next: boolean) {
    if (busy) return;
    if (next) setError(null);
    setOpen(next);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="delete-book"]'));
    const mine = all.findIndex((el) => el.getAttribute("data-book-id") === bookId);
    const neighbour = all[mine + 1] ?? all[mine - 1] ?? document.querySelector<HTMLElement>('[data-testid="try-reader-link"], [data-testid="try-reader-empty"]');
    try {
      const r = await deleteBook(bookId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      handoff.current = neighbour;
      setOpen(false);
      router.refresh();
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${title}`} data-testid="delete-book" data-book-id={bookId} className="size-8 shrink-0 text-muted-foreground">
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(e) => {
          // After a delete the trigger is gone with its card: Radix would drop focus on <body>, so place it ourselves.
          if (!handoff.current) return;
          e.preventDefault();
          handoff.current.focus();
          handoff.current = null;
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>{readerOnly ? "This permanently removes:" : "What happens depends on your review history:"}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="delete-consequences">
          {deleteConsequences(readerOnly).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {readerOnly ? <p className="text-sm font-medium">This can&apos;t be undone.</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} autoFocus>
            Keep it
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={busy} data-testid="confirm-delete-book">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
