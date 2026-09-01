"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { uploadBook } from "@/app/(app)/personal/self-mastery-actions";

export function UploadBookDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setTitle("");
    setAuthor("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (isPending) return; // can't abandon an in-flight upload, matching ULM's own rule
    setOpen(next);
    if (!next) reset();
  }

  function handlePickFile(picked: File) {
    setFile(picked);
    setError(null);
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.pdf$/i, ""));
    }
  }

  function handleSubmit() {
    if (!file) {
      setError("Choose a PDF to get started.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("title", title.trim());
      formData.set("author", author.trim());
      const result = await uploadBook(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      handleOpenChange(false);
      router.push(`/personal/self_mastery/${result.bookId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm" data-testid="add-book-trigger" className="gap-1.5">
            <Plus className="size-4" />
            Add a book
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a book</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {!file ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <Upload className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Choose a PDF to get started.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Choose file
              </Button>
              <p className="text-xs text-muted-foreground">Works best with non-fiction. Novels may produce unexpected lessons.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">{file.name}</p>
              <div className="flex flex-col gap-1">
                <Label htmlFor="book-title">Title</Label>
                <Input id="book-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="book-author">Author (optional)</Label>
                <Input id="book-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handlePickFile(picked);
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        {file ? (
          <DialogFooter>
            {isPending ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
            <Button type="button" disabled={!title.trim() || isPending} onClick={handleSubmit} className="w-full sm:w-auto">
              {isPending ? "Uploading…" : "Add to library"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
