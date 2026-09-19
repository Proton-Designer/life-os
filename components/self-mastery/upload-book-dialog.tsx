"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { prepareBookUpload, finalizeBookUpload, cancelBookUpload } from "@/app/(app)/personal/self-mastery-actions";
import { createClient } from "@/lib/supabase/client";
import { BOOK_MAX_BYTES, BOOK_MAX_SIZE_MESSAGE } from "@/lib/self-mastery/book-upload-limits";

// Hardcoded, not imported -- self-mastery-actions.ts is a "use server"
// module and can only export async functions, so it can't export this
// constant for a Client Component to import. Same convention
// lecture-panel.tsx uses for its own "lectures" bucket name.
const BOOKS_BUCKET = "books";

const UPLOAD_FAILED_MESSAGE = "Upload failed — try again.";

export function UploadBookDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  /** P2-14B: "standard" (default, today's per-chunk behavior) vs "batch" (lower cost, migration 187's books.ingestion_mode). */
  const [ingestionMode, setIngestionMode] = useState<"standard" | "batch">("standard");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setTitle("");
    setAuthor("");
    setIngestionMode("standard");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (isPending) return; // can't abandon an in-flight upload, matching ULM's own rule
    setOpen(next);
    if (!next) reset();
  }

  function handlePickFile(picked: File) {
    // Client-side size check FIRST (same posture as lecture-panel.tsx's own
    // P3-14 04-verification finding, and the same real limit -- see
    // lib/self-mastery/book-upload-limits.ts's header): reject before ever
    // showing the title/author form for a file that's going to fail, not
    // after minting a signed URL for it.
    if (picked.size > BOOK_MAX_BYTES) {
      setError(BOOK_MAX_SIZE_MESSAGE);
      return;
    }
    setFile(picked);
    setError(null);
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.pdf$/i, ""));
    }
  }

  /**
   * Three hops (URGENT pdf-upload fix, 2026-09-19 -- BRIEF-pdf-upload.md):
   * prepare (Server Action -- validates every existing guard, mints a
   * signed upload url, and inserts the `books` row up front) -> the browser
   * uploads the actual PDF bytes straight to Storage, never through a
   * Server Action's own request body -> finalize (Server Action -- re-reads
   * the real object and only then flips status to "processing"). A failure
   * at the upload or finalize hop, after prepare already created a row,
   * calls cancelBookUpload so a book never gets stuck at "uploading"
   * forever with nothing behind it -- see that function's own header for
   * why this risk is new.
   */
  function handleSubmit() {
    if (!file) {
      setError("Choose a PDF to get started.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const prepared = await prepareBookUpload(title.trim(), author.trim(), ingestionMode, file.size);
      if (!prepared.ok) {
        setError(prepared.message);
        return;
      }
      const { bookId, path, token } = prepared;
      try {
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from(BOOKS_BUCKET)
          .uploadToSignedUrl(path, token, file, { contentType: "application/pdf" });
        if (uploadError) throw uploadError;

        const result = await finalizeBookUpload(bookId, path);
        if (!result.ok) {
          await cancelBookUpload(bookId).catch(() => {});
          setError(result.message);
          return;
        }
        handleOpenChange(false);
        router.push(`/personal/self_mastery/${result.bookId}`);
      } catch (err) {
        await cancelBookUpload(bookId).catch(() => {});
        // Storage's own raw rejection for an over-limit object (this can
        // still happen despite the client-side pre-check above, e.g. a
        // stale/lowered limit the client hasn't refreshed) reads as
        // "exceeded the maximum allowed size" -- mapped to the same
        // friendly, actionable message rather than shown verbatim. Same
        // mapping lecture-panel.tsx's own handleFileChosen uses.
        const message = err instanceof Error ? err.message : UPLOAD_FAILED_MESSAGE;
        setError(/exceeded the maximum allowed size/i.test(message) ? BOOK_MAX_SIZE_MESSAGE : message);
      }
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
              <div className="flex flex-col gap-1.5">
                <Label>Processing mode</Label>
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant={ingestionMode === "standard" ? "default" : "outline"} onClick={() => setIngestionMode("standard")}>
                    Standard
                  </Button>
                  <Button type="button" size="sm" variant={ingestionMode === "batch" ? "default" : "outline"} onClick={() => setIngestionMode("batch")}>
                    Batch (lower cost)
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Batch combines several sections per AI call to cost less — it can take longer to see your first cards.
                </p>
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
