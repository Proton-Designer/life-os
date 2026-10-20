"use client";

import Link from "next/link";
import { useState } from "react";
import { Highlighter, Trash2 } from "lucide-react";
import { deleteHighlight, listHighlights } from "@/app/(app)/personal/reader-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Item {
  id: string;
  bookId: string;
  bookTitle: string;
  startWord: number;
  text: string;
  createdAt: string;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Every highlight across the library, newest first; each opens its book in the Page view at that passage. */
export function GlobalHighlightsDialog() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await listHighlights(null);
      if (r.ok) setItems(r.highlights);
      else setError(r.message);
    } catch {
      setError("Couldn't load your highlights. Please try again.");
    }
  }

  async function remove(id: string) {
    const before = items;
    setItems((prev) => prev?.filter((h) => h.id !== id) ?? prev);
    try {
      const r = await deleteHighlight(id);
      if (!r.ok) throw new Error(r.message);
    } catch {
      setItems(before);
      setError("Couldn't delete that highlight.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" data-testid="open-highlights">
          <Highlighter className="size-4" />
          Highlights
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Highlights</DialogTitle>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {items === null && !error ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet. Highlight a passage while you read and it shows up here.</p>
        ) : (
          <ul className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto" data-testid="global-highlights">
            {items?.map((h) => (
              <li key={h.id} className="flex items-start gap-1 rounded-lg border">
                <Link href={`/read/${h.bookId}?at=${h.startWord}`} className="block min-h-11 min-w-0 flex-1 px-3 py-2 text-sm hover:bg-muted">
                  <span className="block font-serif leading-snug">{h.text}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {h.bookTitle} · {shortDate(h.createdAt)}
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label="Delete highlight"
                  onClick={() => void remove(h.id)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
