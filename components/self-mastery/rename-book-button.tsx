"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { renameBook } from "@/app/(app)/personal/reader-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_CHARS = 200; // same cap as the import dialog and renameBookCore

/** Edit a library book's title and author. The page refreshes from the server once the change is stored. */
export function RenameBookButton({ bookId, title, author }: { bookId: string; title: string; author: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [by, setBy] = useState(author ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (busy) return;
    if (next) {
      setName(title);
      setBy(author ?? "");
      setError(null);
    }
    setOpen(next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("A book needs a title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await renameBook(bookId, { title: name.trim(), author: by.trim() || null });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${title}`} data-testid="rename-book" className="size-8 shrink-0 text-muted-foreground">
          <Pencil aria-hidden className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rename-title-${bookId}`}>Title</Label>
            <Input id={`rename-title-${bookId}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_CHARS} aria-describedby={error ? `rename-error-${bookId}` : undefined} aria-invalid={error ? true : undefined} autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rename-author-${bookId}`}>Author (optional)</Label>
            <Input id={`rename-author-${bookId}`} value={by} onChange={(e) => setBy(e.target.value)} maxLength={MAX_CHARS} />
          </div>
          {error ? (
            <p id={`rename-error-${bookId}`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
