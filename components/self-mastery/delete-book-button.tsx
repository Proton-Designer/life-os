"use client";

import { useState } from "react";
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
        "If you have reviewed its flashcards: the book is hidden from your library, and nothing else is removed. Your review history, bookmark, highlights, reading history and stored files are kept",
      ];
}

// In order of preference (a comma selector would return the first in document order, i.e. the heading).
const FALLBACK_FOCUS = ['[data-testid="try-reader-empty"]', '[data-testid="try-reader-link"]', "h1"];

/**
 * The deleted card disappears when the page refreshes, and with it this component, so focus can't be placed from
 * inside it (Radix would leave it on <body>). Watch the document instead: once this book's delete button is gone,
 * focus the neighbouring card's, or a stable fallback when it was the last book. Gives up after 5 s.
 */
function focusAfterRemoval(bookId: string, neighbourId: string | null) {
  const gone = () => !document.querySelector(`[data-testid="delete-book"][data-book-id="${CSS.escape(bookId)}"]`);
  const startedAt = location.pathname + location.search;
  const place = () => {
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[role="dialog"]')) return;
    const target =
      (neighbourId && document.querySelector<HTMLElement>(`[data-testid="delete-book"][data-book-id="${CSS.escape(neighbourId)}"]`)) ||
      FALLBACK_FOCUS.map((sel) => document.querySelector<HTMLElement>(sel)).find(Boolean);
    if (target) {
      if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus();
    }
  };
  const observer = new MutationObserver(() => {
    if (location.pathname + location.search !== startedAt) return observer.disconnect();
    if (!gone()) return;
    observer.disconnect();
    place();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 5000);
}

/** Delete a library book behind a confirmation that lists what goes with it. Never a one-click delete. */
export function DeleteBookButton({ bookId, title, readerOnly }: { bookId: string; title: string; readerOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

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
    const neighbourId = (all[mine + 1] ?? all[mine - 1])?.getAttribute("data-book-id") ?? null;
    try {
      const r = await deleteBook(bookId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      focusAfterRemoval(bookId, neighbourId);
      setDeleted(true);
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
          // After a delete the trigger is gone with its card; focusAfterRemoval places focus, not Radix.
          if (deleted) e.preventDefault();
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
